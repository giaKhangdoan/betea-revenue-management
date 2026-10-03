begin;
select plan(24);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'receipt-owner@example.test', '{}', '{}'),
  ('30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'receipt-staff@example.test', '{}', '{}'),
  ('30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'receipt-inactive@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('30000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'receipt-staff@example.test', 'Receipt staff', true),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'receipt-inactive@example.test', 'Inactive staff', false);
insert into auth.sessions (id, user_id)
values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003');
select private.seed_inventory_catalog_for_owner('30000000-0000-4000-8000-000000000001');

select ok(to_regclass('public.inventory_receipts') is not null, 'receipt headers table exists');
select ok(to_regclass('public.inventory_receipt_lines') is not null, 'receipt lines table exists');
select ok(to_regclass('public.inventory_receipt_corrections') is not null, 'receipt correction history table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.inventory_receipts'::regclass), 'receipt headers use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.inventory_receipt_lines'::regclass), 'receipt lines use RLS');
select ok(has_table_privilege('authenticated', 'public.inventory_receipts', 'SELECT'), 'authenticated can read through RLS');
select ok(not has_table_privilege('authenticated', 'public.inventory_receipt_corrections', 'INSERT'), 'authenticated cannot write correction history directly');
select ok(not has_table_privilege('authenticated', 'public.inventory_receipts', 'INSERT'), 'authenticated cannot insert headers directly');
select ok(not has_table_privilege('authenticated', 'public.inventory_receipt_lines', 'UPDATE'), 'authenticated cannot update lines directly');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '40000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);

do $$
declare
  v_first uuid;
  v_second uuid;
  v_item_kg uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '001');
  v_item_pack uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '006');
begin
  v_first := public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id', v_item_kg::text, 'large_quantity', '2', 'loose_quantity', '500'),
    jsonb_build_object('item_id', v_item_pack::text, 'large_quantity', '3', 'loose_quantity', '0')
  ));
  perform set_config('test.first_receipt_id', v_first::text, true);
  if not exists (
    select 1 from public.inventory_receipts
    where id = v_first and receipt_code like 'PN-%' and created_by = auth.uid()
      and created_by_label = 'Receipt staff'
      and received_at >= now() - interval '1 minute' and received_at <= clock_timestamp()
  ) then raise exception 'receipt header is missing server metadata'; end if;
  if not exists (
    select 1 from public.inventory_receipt_lines
    where receipt_id = v_first and line_number = 1 and item_id = v_item_kg and item_name = 'Đường cát'
      and large_unit = 'Kg' and large_quantity = 2 and conversion_factor = 1000
      and small_unit = 'Gr' and loose_quantity = 500 and converted_quantity = 2500
  ) then raise exception 'receipt quantity was not converted and snapshotted exactly'; end if;

  v_second := public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id', v_item_pack::text, 'large_quantity', '1', 'loose_quantity', '0')
  ));
  perform set_config('test.second_receipt_id', v_second::text, true);
  if v_first = v_second or (select count(*) from public.inventory_receipts where (received_at at time zone 'Asia/Ho_Chi_Minh')::date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) <> 2 then
    raise exception 'multiple unique receipts on the same day were not saved';
  end if;
end $$;
select pass('staff creates multiple receipts with exact conversion and account snapshots');

do $$
declare
  v_first uuid := current_setting('test.first_receipt_id')::uuid;
  v_item_kg uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '001');
begin
  perform public.staff_update_inventory_receipt(v_first, jsonb_build_array(
    jsonb_build_object('item_id', v_item_kg::text, 'large_quantity', '3', 'loose_quantity', '100')
  ), 'Corrected delivery quantity');
  if not exists (select 1 from public.inventory_receipt_lines where receipt_id = v_first and converted_quantity = 3100) then
    raise exception 'today receipt did not update';
  end if;
  if not exists (
    select 1 from public.inventory_receipt_corrections
    where receipt_id = v_first and corrected_by = auth.uid() and corrected_by_label = 'Receipt staff'
      and reason = 'Corrected delivery quantity' and prior_lines @> '[{"converted_quantity":2500}]'::jsonb
  ) then raise exception 'staff receipt correction history is incomplete'; end if;
  if (select count(*) from public.inventory_receipt_corrections) <> 0 then raise exception 'staff read owner-only correction history'; end if;
end $$;
select pass('staff updates a receipt created today with prior values and reason in owner-only history');

reset role;
insert into public.inventory_counts (owner_id, business_date, status, created_by, updated_by, finalized_by, finalized_at)
values (
  '30000000-0000-4000-8000-000000000001',
  (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  'finalized',
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '40000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform public.staff_update_inventory_receipt(
      current_setting('test.first_receipt_id')::uuid,
      jsonb_build_array(jsonb_build_object(
        'item_id', (select id::text from public.inventory_items where source_code = '001' and owner_id = '30000000-0000-4000-8000-000000000001'),
        'large_quantity', '4', 'loose_quantity', '0'
      )),
      'Attempt after count finalization'
    );
    raise exception 'staff edited a receipt included in a finalized count';
  exception when insufficient_privilege then null;
  end;
end $$;
select pass('staff cannot edit a receipt included in a finalized count');

reset role;
update public.inventory_items set active = false
where owner_id = '30000000-0000-4000-8000-000000000001' and source_code in ('001', '006');
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_first uuid := current_setting('test.first_receipt_id')::uuid;
  v_item_kg uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '001');
  v_item_pack uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '006');
begin
  begin
    perform public.owner_correct_inventory_receipt(v_first, jsonb_build_array(
      jsonb_build_object('item_id', v_item_pack::text, 'large_quantity', '1', 'loose_quantity', '0')
    ), 'Try adding inactive item');
    raise exception using errcode = 'P0001', message = 'new inactive items unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
  perform public.owner_correct_inventory_receipt(v_first, jsonb_build_array(
    jsonb_build_object('item_id', v_item_kg::text, 'large_quantity', '4', 'loose_quantity', '0')
  ), 'Owner correction after finalized count');
  if not exists (select 1 from public.inventory_receipt_lines where receipt_id = v_first and converted_quantity = 4000) then
    raise exception 'owner correction did not replace receipt lines';
  end if;
  if not exists (
    select 1 from public.inventory_receipt_corrections
    where receipt_id = v_first and corrected_by = auth.uid() and corrected_by_label = 'receipt-owner@example.test'
      and reason = 'Owner correction after finalized count' and prior_lines @> '[{"converted_quantity":3100}]'::jsonb
  ) then raise exception 'owner correction audit is incomplete'; end if;
  if exists (select 1 from public.inventory_items where id = v_item_kg and active) then
    raise exception 'owner correction reactivated a historical catalog item';
  end if;
end $$;
select pass('owner corrects a receipt after count finalization with reason and retained values');

do $$
begin
  begin
    perform public.staff_create_inventory_receipt('[]'::jsonb);
    raise exception 'empty receipt unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
end $$;
select pass('empty receipts are rejected');

do $$
declare
  v_item uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '001');
begin
  begin
    perform public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', v_item::text, 'large_quantity', '-1', 'loose_quantity', '0')));
    raise exception 'negative quantity unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
end $$;
select pass('negative quantities are rejected');

do $$
declare
  v_item uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '006');
begin
  begin
    perform public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', v_item::text, 'large_quantity', '1', 'loose_quantity', '0.5')));
    raise exception 'fractional indivisible quantity unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
end $$;
select pass('indivisible units reject fractional loose quantities');

do $$
declare
  v_item uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '001');
begin
  begin
    perform public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', v_item::text, 'large_quantity', '1', 'loose_quantity', '0.0001')));
    raise exception 'excess quantity precision unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
end $$;
select pass('quantities with more than three decimal places are rejected');

do $$
declare
  v_item uuid := (select id from public.inventory_items where owner_id = '30000000-0000-4000-8000-000000000001' and source_code = '001');
begin
  begin
    perform public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', v_item::text, 'large_quantity', '99999999999999999', 'loose_quantity', '0')));
    raise exception 'overflowing converted quantity unexpectedly succeeded';
  exception when sqlstate '22003' then null;
  end;
end $$;
select pass('converted quantities that overflow the stored range are rejected');

do $$
begin
  begin
    update public.inventory_receipts set created_by_label = 'forged' where id = current_setting('test.first_receipt_id')::uuid;
    raise exception 'direct header update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
select pass('staff cannot bypass the guarded write functions');

reset role;
update public.inventory_receipts
set received_at = now() - interval '8 days'
where id = current_setting('test.second_receipt_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '40000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$
begin
  if (select count(*) from public.inventory_receipts) <> 1 then raise exception 'staff saw a receipt outside the current week'; end if;
  if (select count(*) from public.inventory_receipt_lines) <> 2 then raise exception 'staff saw lines outside the current week'; end if;
end $$;
select pass('staff reads only current-week receipt headers and lines');

do $$
begin
  begin
    perform public.staff_update_inventory_receipt(current_setting('test.second_receipt_id')::uuid, '[]'::jsonb, 'Late edit');
    raise exception 'old receipt update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
select pass('staff cannot edit a receipt outside today');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '30000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'session_id', '40000000-0000-4000-8000-000000000002',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$
begin
  begin
    perform public.staff_create_inventory_receipt('[]'::jsonb);
    raise exception 'inactive staff write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.inventory_receipts) <> 0 then raise exception 'inactive staff read receipts'; end if;
end $$;
select pass('inactive staff cannot create or read receipts');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.inventory_receipts) <> 2 then raise exception 'owner could not read all receipt dates'; end if;
end $$;
select pass('owner can read receipts across all dates');

set local role anon;
do $$ begin
  begin
    perform 1 from public.inventory_receipts;
    raise exception 'anonymous user unexpectedly read receipts';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('anonymous users cannot read receipts');

select * from finish();
rollback;
