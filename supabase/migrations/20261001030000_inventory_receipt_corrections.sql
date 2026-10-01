create table public.inventory_receipt_corrections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  receipt_id uuid not null,
  corrected_at timestamptz not null default clock_timestamp(),
  corrected_by uuid not null references auth.users (id) on delete restrict,
  corrected_by_label text not null,
  reason text not null check (length(trim(reason)) > 0),
  prior_lines jsonb not null check (jsonb_typeof(prior_lines) = 'array'),
  foreign key (owner_id, receipt_id)
    references public.inventory_receipts (owner_id, id) on delete cascade
);

create index inventory_receipt_corrections_receipt_idx
  on public.inventory_receipt_corrections (owner_id, receipt_id, corrected_at desc);

alter table public.inventory_receipt_corrections enable row level security;
revoke all on public.inventory_receipt_corrections from anon, authenticated;
grant select on public.inventory_receipt_corrections to authenticated;

create policy "owner reads inventory receipt corrections"
  on public.inventory_receipt_corrections for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create function private.apply_inventory_receipt_correction(
  p_receipt_id uuid,
  p_owner_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_lines jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor_label text;
  v_prior_lines jsonb;
  v_prior_item_ids uuid[];
  v_now timestamptz := clock_timestamp();
begin
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'A correction reason is required';
  end if;

  select coalesce(nullif(trim(membership.display_name), ''), nullif(account.email, ''), p_actor_id::text)
  into v_actor_label
  from auth.users as account
  left join public.store_memberships as membership
    on membership.owner_id = p_owner_id and membership.user_id = p_actor_id
  where account.id = p_actor_id;

  select coalesce(jsonb_agg(to_jsonb(line) order by line.line_number), '[]'::jsonb),
    coalesce(array_agg(line.item_id), array[]::uuid[])
  into v_prior_lines, v_prior_item_ids
  from public.inventory_receipt_lines as line
  where line.owner_id = p_owner_id and line.receipt_id = p_receipt_id;

  insert into public.inventory_receipt_corrections (
    owner_id, receipt_id, corrected_at, corrected_by, corrected_by_label, reason, prior_lines
  ) values (
    p_owner_id, p_receipt_id, v_now, p_actor_id, coalesce(v_actor_label, p_actor_id::text), trim(p_reason), v_prior_lines
  );

  delete from public.inventory_receipt_lines where owner_id = p_owner_id and receipt_id = p_receipt_id;
  perform private.replace_inventory_receipt_lines(p_receipt_id, p_owner_id, p_lines, v_prior_item_ids);
  update public.inventory_receipts
  set updated_at = v_now, updated_by = p_actor_id
  where id = p_receipt_id and owner_id = p_owner_id;
end;
$$;
revoke all on function private.apply_inventory_receipt_correction(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

drop function public.staff_update_inventory_receipt(uuid, jsonb);

create function public.staff_update_inventory_receipt(p_receipt_id uuid, p_lines jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_received_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select membership.owner_id
  into v_owner_id
  from public.store_memberships as membership
  where membership.user_id = v_actor and membership.active;
  if not found or not private.is_active_store_member(v_owner_id) then
    raise exception using errcode = '42501', message = 'Active store staff membership required';
  end if;

  select receipt.received_at
  into v_received_at
  from public.inventory_receipts as receipt
  where receipt.id = p_receipt_id and receipt.owner_id = v_owner_id
  for update;
  if not found or (v_received_at at time zone 'Asia/Ho_Chi_Minh')::date <> private.current_business_date_vn() then
    raise exception using errcode = '42501', message = 'Receipt is not eligible for staff edit today';
  end if;
  if exists (
    select 1 from public.inventory_counts as count_sheet
    where count_sheet.owner_id = v_owner_id and count_sheet.status = 'finalized'
      and count_sheet.finalized_at >= v_received_at
  ) then
    raise exception using errcode = '42501', message = 'Receipt requires an owner correction after count finalization';
  end if;

  perform private.apply_inventory_receipt_correction(p_receipt_id, v_owner_id, v_actor, p_reason, p_lines);
  return p_receipt_id;
end;
$$;
revoke all on function public.staff_update_inventory_receipt(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.staff_update_inventory_receipt(uuid, jsonb, text) to authenticated;

create function public.owner_correct_inventory_receipt(p_receipt_id uuid, p_lines jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  perform 1 from public.inventory_receipts
  where id = p_receipt_id and owner_id = v_actor
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Receipt not found';
  end if;

  perform private.apply_inventory_receipt_correction(p_receipt_id, v_actor, v_actor, p_reason, p_lines);
  return p_receipt_id;
end;
$$;
revoke all on function public.owner_correct_inventory_receipt(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.owner_correct_inventory_receipt(uuid, jsonb, text) to authenticated;
