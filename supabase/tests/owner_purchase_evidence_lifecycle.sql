begin;
select plan(28);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('93000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'evidence-owner@example.test', '{}', '{}'),
  ('93000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'evidence-staff@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('93000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'evidence-staff@example.test', 'Evidence staff', true);

select ok((select relrowsecurity from pg_class where oid = 'public.owner_purchase_evidence'::regclass), 'purchase evidence metadata keeps RLS enabled');
select ok((
  select bool_and(not has_table_privilege('authenticated', 'public.owner_purchase_upload_intents', privilege_name)
    and not has_table_privilege('authenticated', 'public.owner_purchase_evidence', privilege_name))
  from unnest(array['INSERT', 'UPDATE', 'DELETE']) as privileges(privilege_name)
), 'authenticated clients cannot directly mutate upload intents or evidence');
select ok(has_function_privilege('authenticated', 'public.owner_create_purchase_upload_intent(uuid,text,text,bigint,text,text,uuid)', 'EXECUTE'), 'authenticated can request owner-guarded upload intents');
select ok(has_function_privilege('authenticated', 'public.owner_finalize_purchase_upload(uuid)', 'EXECUTE'), 'authenticated can request owner-guarded finalization');
select ok(has_function_privilege('authenticated', 'public.owner_claim_expired_purchase_uploads()', 'EXECUTE'), 'authenticated can request owner-guarded orphan cleanup');
select ok(not has_table_privilege('anon', 'public.owner_purchase_evidence', 'SELECT'), 'anonymous users cannot read purchase evidence');
select ok(not has_function_privilege('anon', 'public.owner_create_purchase_upload_intent(uuid,text,text,bigint,text,text,uuid)', 'EXECUTE'), 'anonymous users cannot request evidence uploads');

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  v_owner constant uuid := '93000000-0000-4000-8000-000000000001';
  v_voucher uuid;
  v_stale_voucher uuid;
  v_intent uuid;
  v_stale_intent uuid;
  v_path text;
  v_rejected boolean;
  v_index integer;
begin
  v_voucher := public.owner_create_purchase_voucher(date '2026-10-05', 'Test vendor', 1200, null,
    jsonb_build_array(jsonb_build_object('description','Hóa đơn kiểm thử','cost_class','non_ingredient',
      'inventory_class','non_stock','unit_snapshot','cái','quantity_snapshot','1','line_amount_vnd',1200)));
  perform set_config('test.evidence_voucher_id', v_voucher::text, true);
  v_path := format('%s/owner-advances-staging/%s/%s.png', v_owner, v_voucher, gen_random_uuid());
  v_intent := public.owner_create_purchase_upload_intent(v_voucher, v_path, 'image/png', 1200, 'bill.png', 'Invoice', null);
  perform set_config('test.evidence_intent_id', v_intent::text, true);

  v_rejected := false;
  begin
    perform public.owner_create_purchase_upload_intent(v_voucher,
      format('%s/owner-advances-staging/%s/%s.pdf', v_owner, v_voucher, gen_random_uuid()),
      'application/pdf', 1200, 'bill.pdf', null, null);
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'PDF evidence unexpectedly accepted'; end if;
  perform set_config('test.evidence_invalid_mime_rejected', 'true', true);

  v_rejected := false;
  begin
    perform public.owner_create_purchase_upload_intent(v_voucher,
      format('%s/owner-advances-staging/%s/%s.png', v_owner, v_voucher, gen_random_uuid()),
      'image/png', 2097153, 'large.png', null, null);
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Oversize evidence unexpectedly accepted'; end if;
  perform set_config('test.evidence_oversize_rejected', 'true', true);

  v_rejected := false;
  begin
    perform public.owner_create_purchase_upload_intent(v_voucher,
      format('%s/other-prefix/%s/%s.png', v_owner, v_voucher, gen_random_uuid()),
      'image/png', 1200, 'outside.png', null, null);
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Out-of-prefix object key unexpectedly accepted'; end if;
  perform set_config('test.evidence_bad_prefix_rejected', 'true', true);

  for v_index in 1..9 loop
    perform public.owner_create_purchase_upload_intent(v_voucher,
      format('%s/owner-advances-staging/%s/%s.webp', v_owner, v_voucher, gen_random_uuid()),
      'image/webp', 500, 'photo.webp', null, null);
  end loop;
  v_rejected := false;
  begin
    perform public.owner_create_purchase_upload_intent(v_voucher,
      format('%s/owner-advances-staging/%s/%s.jpg', v_owner, v_voucher, gen_random_uuid()),
      'image/jpeg', 500, 'extra.jpg', null, null);
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'More than 10 reserved or attached images unexpectedly accepted'; end if;
  perform set_config('test.evidence_cap_rejected', 'true', true);

  v_stale_voucher := public.owner_create_purchase_voucher(date '2026-10-05', 'Cleanup vendor', 500, null,
    jsonb_build_array(jsonb_build_object('description','Cleanup test line','cost_class','non_ingredient',
      'inventory_class','non_stock','unit_snapshot','cái','quantity_snapshot','1','line_amount_vnd',500)));
  v_stale_intent := public.owner_create_purchase_upload_intent(v_stale_voucher,
    format('%s/owner-advances-staging/%s/%s.webp', v_owner, v_stale_voucher, gen_random_uuid()),
    'image/webp', 500, 'orphan.webp', null, null);
  perform set_config('test.evidence_stale_intent_id', v_stale_intent::text, true);
end;
$$;

select ok((select status = 'pending' and byte_size = 1200 and mime_type = 'image/png'
  from public.owner_purchase_upload_intents where id = current_setting('test.evidence_intent_id')::uuid), 'owner can create a pending intent with server-generated path metadata');
select ok((select object_path <> sealed_object_path
    and split_part(object_path, '/', 2) = 'owner-advances-staging'
    and split_part(sealed_object_path, '/', 2) = 'owner-advances'
  from public.owner_purchase_upload_intents where id = current_setting('test.evidence_intent_id')::uuid), 'upload capability path is separate from the server-sealed evidence path');
select ok(current_setting('test.evidence_invalid_mime_rejected') = 'true', 'PDF and unsupported evidence MIME types are rejected');
select ok(current_setting('test.evidence_oversize_rejected') = 'true', 'evidence larger than 2 MB is rejected');
select ok(current_setting('test.evidence_bad_prefix_rejected') = 'true', 'object keys outside the owner-advance namespace are rejected');
select ok(current_setting('test.evidence_cap_rejected') = 'true', 'a voucher cannot reserve more than 10 images');

do $$
declare
  v_owner constant uuid := '93000000-0000-4000-8000-000000000001';
  v_evidence_id uuid;
begin
  v_evidence_id := public.owner_finalize_purchase_upload(current_setting('test.evidence_intent_id')::uuid);
  perform set_config('test.evidence_id', v_evidence_id::text, true);
end;
$$;
select ok((select intent.status = 'attached' and evidence.id = current_setting('test.evidence_id')::uuid
    and evidence.voucher_id = intent.voucher_id and evidence.object_path = intent.sealed_object_path
    and evidence.object_path <> intent.object_path
    and evidence.byte_size = intent.byte_size and evidence.mime_type = intent.mime_type
  from public.owner_purchase_upload_intents as intent
  join public.owner_purchase_evidence as evidence on evidence.upload_intent_id = intent.id
  where intent.id = current_setting('test.evidence_intent_id')::uuid), 'finalization atomically attaches verified metadata to the matching voucher');
select ok(public.owner_finalize_purchase_upload(current_setting('test.evidence_intent_id')::uuid) = current_setting('test.evidence_id')::uuid, 'replaying finalization returns the same evidence id');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select ok(not exists (select 1 from public.owner_purchase_evidence where id = current_setting('test.evidence_id')::uuid), 'staff cannot read evidence metadata by a known evidence id');
select ok(not exists (select 1 from public.owner_purchase_upload_intents where id = current_setting('test.evidence_intent_id')::uuid), 'staff cannot read owner upload intents');
select throws_ok(
  $$select public.owner_create_purchase_upload_intent(current_setting('test.evidence_voucher_id')::uuid, 'anything', 'image/png', 10, 'x.png', null, null)$$,
  '42501', null, 'staff cannot create owner purchase upload intents'
);
select throws_ok(
  $$select * from public.owner_claim_expired_purchase_uploads()$$,
  '42501', null, 'staff cannot invoke owner orphan cleanup'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
reset role;
update public.owner_purchase_upload_intents
set expires_at = clock_timestamp() - interval '2 hours'
where id = current_setting('test.evidence_stale_intent_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.owner_claim_expired_purchase_uploads()
  where upload_intent_id = current_setting('test.evidence_stale_intent_id')::uuid;
  if v_claim.upload_intent_id is null then raise exception 'Expired evidence intent was not claimed'; end if;
  perform set_config('test.evidence_claimed_path', v_claim.object_path, true);
  perform set_config('test.evidence_claimed_sealed_path', v_claim.sealed_object_path, true);
  perform set_config('test.evidence_claimed_attached', v_claim.attached::text, true);
end;
$$;
select ok(current_setting('test.evidence_claimed_path') like '93000000-0000-4000-8000-000000000001/owner-advances-staging/%'
    and current_setting('test.evidence_claimed_sealed_path') like '93000000-0000-4000-8000-000000000001/owner-advances/%'
    and current_setting('test.evidence_claimed_attached') = 'false', 'cleanup only returns validated staging and sealed namespaces');
select ok((select status = 'expired' and cleanup_claimed_at is not null
  from public.owner_purchase_upload_intents where id = current_setting('test.evidence_stale_intent_id')::uuid), 'stale upload receives an expiring cleanup lease');
select ok(public.owner_mark_expired_purchase_upload_deleted(current_setting('test.evidence_stale_intent_id')::uuid), 'successful cleanup marks an orphan intent deleted');
select ok(not public.owner_mark_expired_purchase_upload_deleted(current_setting('test.evidence_stale_intent_id')::uuid), 'repeating the delete mark is harmless');
select ok(not exists (select 1 from public.owner_claim_expired_purchase_uploads()), 'deleted evidence is not claimed again');

reset role;
update public.owner_purchase_upload_intents
set expires_at = clock_timestamp() - interval '2 hours'
where id = current_setting('test.evidence_intent_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.owner_claim_expired_purchase_uploads()
  where upload_intent_id = current_setting('test.evidence_intent_id')::uuid;
  if v_claim.upload_intent_id is null or v_claim.attached is not true then
    raise exception 'Attached evidence staging key was not claimed for delayed cleanup';
  end if;
  perform set_config('test.evidence_attached_cleanup_path', v_claim.object_path, true);
end;
$$;
select ok(current_setting('test.evidence_attached_cleanup_path') like '93000000-0000-4000-8000-000000000001/owner-advances-staging/%', 'delayed cleanup targets the replayable staging key for attached evidence');
select ok((select status = 'attached' and cleanup_claimed_at is not null
  from public.owner_purchase_upload_intents where id = current_setting('test.evidence_intent_id')::uuid), 'staging cleanup lease keeps finalized evidence attached');
select ok(public.owner_mark_expired_purchase_upload_deleted(current_setting('test.evidence_intent_id')::uuid), 'staging cleanup marks only the attached intent staging key as cleaned');
select ok((select status = 'attached' and staging_cleaned_at is not null and cleanup_claimed_at is null
  from public.owner_purchase_upload_intents where id = current_setting('test.evidence_intent_id')::uuid), 'staging cleanup preserves the sealed evidence metadata');

select * from finish();
rollback;
