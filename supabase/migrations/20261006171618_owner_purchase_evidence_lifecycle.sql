-- Add a private owner-only R2 lifecycle for purchase evidence.
-- R2 and Postgres cannot share a transaction: intents reserve capacity, finalization
-- verifies the object before attaching it, and the cleanup lease makes orphan deletion retryable.

alter table public.owner_purchase_upload_intents
  add column reimbursement_id uuid,
  add column cleanup_claimed_at timestamptz,
  add column staging_cleaned_at timestamptz,
  add column sealed_object_path text not null unique,
  add constraint owner_purchase_upload_intents_reimbursement_fk
    foreign key (owner_id, voucher_id, reimbursement_id)
    references public.owner_purchase_reimbursements (owner_id, voucher_id, id) on delete restrict,
  add constraint owner_purchase_upload_intents_image_mime_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  add constraint owner_purchase_upload_intents_image_size_check
    check (byte_size between 1 and 2097152),
  add constraint owner_purchase_upload_intents_sealed_path_check
    check (
      split_part(sealed_object_path, '/', 1) = owner_id::text
      and split_part(sealed_object_path, '/', 2) = 'owner-advances'
      and split_part(sealed_object_path, '/', 3) = voucher_id::text
      and array_length(string_to_array(sealed_object_path, '/'), 1) = 4
      and split_part(sealed_object_path, '/', 4) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and ((mime_type = 'image/jpeg' and right(sealed_object_path, 4) = '.jpg')
        or (mime_type = 'image/png' and right(sealed_object_path, 4) = '.png')
        or (mime_type = 'image/webp' and right(sealed_object_path, 5) = '.webp'))
    );

alter table public.owner_purchase_evidence
  add constraint owner_purchase_evidence_image_mime_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  add constraint owner_purchase_evidence_image_size_check
    check (byte_size between 1 and 2097152);

create function public.owner_create_purchase_upload_intent(
  p_voucher_id uuid,
  p_object_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_file_name text,
  p_caption text default null,
  p_reimbursement_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_reserved_count integer;
  v_intent_id uuid;
  v_extension text;
  v_sealed_object_path text;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;

  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_byte_size is null or p_byte_size not between 1 and 2097152
    or p_file_name is null or length(btrim(p_file_name)) not between 1 and 255
    or (p_caption is not null and length(p_caption) > 500) then
    raise exception using errcode = '22023', message = 'Invalid purchase evidence metadata';
  end if;

  if p_object_path is null
    or array_length(string_to_array(p_object_path, '/'), 1) is distinct from 4
    or split_part(p_object_path, '/', 1) <> v_actor::text
    or split_part(p_object_path, '/', 2) <> 'owner-advances-staging'
    or split_part(p_object_path, '/', 3) <> p_voucher_id::text
    or split_part(p_object_path, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    or (p_mime_type = 'image/jpeg' and right(p_object_path, 4) <> '.jpg')
    or (p_mime_type = 'image/png' and right(p_object_path, 4) <> '.png')
    or (p_mime_type = 'image/webp' and right(p_object_path, 5) <> '.webp') then
    raise exception using errcode = '22023', message = 'Invalid purchase evidence object key';
  end if;

  select voucher.status into v_status
  from public.owner_purchase_vouchers as voucher
  where voucher.owner_id = v_actor and voucher.id = p_voucher_id
  for update;
  if not found or v_status = 'canceled' then
    raise exception using errcode = '22023', message = 'Purchase voucher is unavailable';
  end if;

  if p_reimbursement_id is not null and not exists (
    select 1 from public.owner_purchase_reimbursements as reimbursement
    where reimbursement.owner_id = v_actor
      and reimbursement.voucher_id = p_voucher_id
      and reimbursement.id = p_reimbursement_id
      and reimbursement.event_type = 'payment'
  ) then
    raise exception using errcode = '22023', message = 'Reimbursement is unavailable';
  end if;

  select count(*)::integer into v_reserved_count
  from (
    select evidence.id
    from public.owner_purchase_evidence as evidence
    where evidence.owner_id = v_actor and evidence.voucher_id = p_voucher_id
    union all
    select intent.id
    from public.owner_purchase_upload_intents as intent
    where intent.owner_id = v_actor and intent.voucher_id = p_voucher_id
      and intent.status in ('pending', 'uploaded') and intent.expires_at > v_now
  ) as reserved;
  if v_reserved_count >= 10 then
    raise exception using errcode = '22023', message = 'A voucher can have at most 10 evidence images';
  end if;

  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    else 'webp'
  end;
  v_intent_id := gen_random_uuid();
  v_sealed_object_path := format('%s/owner-advances/%s/%s.%s', v_actor, p_voucher_id, v_intent_id, v_extension);

  insert into public.owner_purchase_upload_intents (
    id, owner_id, voucher_id, reimbursement_id, object_path, sealed_object_path, mime_type, byte_size,
    file_name, caption, status, expires_at, created_by
  ) values (
    v_intent_id, v_actor, p_voucher_id, p_reimbursement_id, p_object_path, v_sealed_object_path, p_mime_type, p_byte_size,
    btrim(p_file_name), nullif(btrim(p_caption), ''), 'pending', v_now + interval '10 minutes', v_actor
  );

  return v_intent_id;
end;
$$;
revoke all on function public.owner_create_purchase_upload_intent(uuid, text, text, bigint, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.owner_create_purchase_upload_intent(uuid, text, text, bigint, text, text, uuid)
  to authenticated;

create function public.owner_expire_purchase_upload_intent(p_upload_intent_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.owner_purchase_upload_intents%rowtype;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;

  select intent.* into v_intent
  from public.owner_purchase_upload_intents as intent
  where intent.owner_id = v_actor and intent.id = p_upload_intent_id
  for update;
  if not found then return null; end if;

  if exists (
    select 1 from public.owner_purchase_evidence as evidence
    where evidence.owner_id = v_actor and evidence.upload_intent_id = p_upload_intent_id
  ) or v_intent.status in ('attached', 'deleted') then
    return null;
  end if;

  if v_intent.status in ('pending', 'uploaded') then
    update public.owner_purchase_upload_intents as intent
    set status = 'expired', cleanup_claimed_at = null
    where intent.owner_id = v_actor and intent.id = p_upload_intent_id;
  elsif v_intent.status <> 'expired' then
    return null;
  end if;

  return v_intent.object_path;
end;
$$;
revoke all on function public.owner_expire_purchase_upload_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.owner_expire_purchase_upload_intent(uuid)
  to authenticated;

create function public.owner_finalize_purchase_upload(p_upload_intent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_voucher_id uuid;
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_intent public.owner_purchase_upload_intents%rowtype;
  v_evidence_id uuid;
  v_evidence_count integer;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;

  select intent.voucher_id into v_voucher_id
  from public.owner_purchase_upload_intents as intent
  where intent.owner_id = v_actor and intent.id = p_upload_intent_id;
  if not found then
    raise exception using errcode = '22023', message = 'Purchase upload intent is unavailable';
  end if;

  select voucher.* into v_voucher
  from public.owner_purchase_vouchers as voucher
  where voucher.owner_id = v_actor and voucher.id = v_voucher_id
  for update;
  if not found or v_voucher.status = 'canceled' then
    raise exception using errcode = '22023', message = 'Purchase voucher is unavailable';
  end if;

  select intent.* into v_intent
  from public.owner_purchase_upload_intents as intent
  where intent.owner_id = v_actor and intent.id = p_upload_intent_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Purchase upload intent is unavailable';
  end if;

  if v_intent.status = 'attached' then
    select evidence.id into v_evidence_id
    from public.owner_purchase_evidence as evidence
    where evidence.owner_id = v_actor and evidence.upload_intent_id = p_upload_intent_id;
    if v_evidence_id is null then
      raise exception using errcode = '23514', message = 'Attached purchase evidence metadata is missing';
    end if;
    return v_evidence_id;
  end if;

  if v_intent.status not in ('pending', 'uploaded') or v_intent.expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'Purchase upload intent has expired';
  end if;

  select count(*)::integer into v_evidence_count
  from public.owner_purchase_evidence as evidence
  where evidence.owner_id = v_actor and evidence.voucher_id = v_voucher_id;
  if v_evidence_count >= 10 then
    raise exception using errcode = '22023', message = 'A voucher can have at most 10 evidence images';
  end if;

  insert into public.owner_purchase_evidence (
    owner_id, voucher_id, reimbursement_id, upload_intent_id, object_path,
    mime_type, byte_size, file_name, caption, created_by
  ) values (
    v_actor, v_voucher_id, v_intent.reimbursement_id, v_intent.id, v_intent.sealed_object_path,
    v_intent.mime_type, v_intent.byte_size, v_intent.file_name, v_intent.caption, v_actor
  ) returning id into v_evidence_id;

  update public.owner_purchase_upload_intents as intent
  set status = 'attached', cleanup_claimed_at = null
  where intent.owner_id = v_actor and intent.id = p_upload_intent_id;

  return v_evidence_id;
end;
$$;
revoke all on function public.owner_finalize_purchase_upload(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.owner_finalize_purchase_upload(uuid)
  to authenticated;

create function public.owner_claim_expired_purchase_uploads()
returns table (upload_intent_id uuid, object_path text, sealed_object_path text, attached boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;

  return query
  with candidates as (
    select intent.id
    from public.owner_purchase_upload_intents as intent
    where intent.owner_id = v_actor
      and intent.status in ('pending', 'uploaded', 'expired', 'attached')
      and intent.expires_at <= v_now - interval '1 hour'
      and (intent.status <> 'attached' or intent.staging_cleaned_at is null)
      and (intent.cleanup_claimed_at is null or intent.cleanup_claimed_at <= v_now - interval '10 minutes')
      and (intent.status = 'attached' or not exists (
        select 1 from public.owner_purchase_evidence as evidence
        where evidence.owner_id = intent.owner_id and evidence.upload_intent_id = intent.id
      ))
    order by intent.expires_at, intent.id
    limit 100
    for update of intent skip locked
  ), claimed as (
    update public.owner_purchase_upload_intents as intent
    set status = case when intent.status = 'attached' then 'attached' else 'expired' end,
        cleanup_claimed_at = v_now
    from candidates
    where intent.owner_id = v_actor and intent.id = candidates.id
    returning intent.id, intent.object_path, intent.sealed_object_path, (intent.status = 'attached') as attached
  )
  select claimed.id, claimed.object_path, claimed.sealed_object_path, claimed.attached from claimed;
end;
$$;
revoke all on function public.owner_claim_expired_purchase_uploads()
  from public, anon, authenticated, service_role;
grant execute on function public.owner_claim_expired_purchase_uploads()
  to authenticated;

create function public.owner_mark_expired_purchase_upload_deleted(p_upload_intent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;

  update public.owner_purchase_upload_intents as intent
  set status = case when intent.status = 'attached' then 'attached' else 'deleted' end,
      staging_cleaned_at = case when intent.status = 'attached' then clock_timestamp() else intent.staging_cleaned_at end,
      cleanup_claimed_at = null
  where intent.owner_id = v_actor and intent.id = p_upload_intent_id
    and intent.status in ('expired', 'attached') and intent.cleanup_claimed_at is not null
    and intent.cleanup_claimed_at > clock_timestamp() - interval '10 minutes'
    and intent.expires_at <= clock_timestamp() - interval '1 hour'
    and ((intent.status = 'attached' and intent.staging_cleaned_at is null and exists (
      select 1 from public.owner_purchase_evidence as evidence
      where evidence.owner_id = intent.owner_id and evidence.upload_intent_id = intent.id
    )) or (intent.status = 'expired' and not exists (
      select 1 from public.owner_purchase_evidence as evidence
      where evidence.owner_id = intent.owner_id and evidence.upload_intent_id = intent.id
    )));

  return found;
end;
$$;
revoke all on function public.owner_mark_expired_purchase_upload_deleted(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.owner_mark_expired_purchase_upload_deleted(uuid)
  to authenticated;
