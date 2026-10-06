begin;
select plan(16);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('72000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'inventory-ux-owner@example.test', '{}', '{}'),
  ('72000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'inventory-ux-staff@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('72000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values ('72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'inventory-ux-staff@example.test', 'Inventory UX staff', true);
insert into auth.sessions (id, user_id)
values ('82000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002');
select private.seed_inventory_catalog_for_owner('72000000-0000-4000-8000-000000000001');
update public.inventory_items set active = false where owner_id = '72000000-0000-4000-8000-000000000001';
update public.inventory_items set active = true where owner_id = '72000000-0000-4000-8000-000000000001' and source_code = '001';
select set_config('test.inventory_item_id', (
  select id::text from public.inventory_items where owner_id = '72000000-0000-4000-8000-000000000001' and source_code = '001'
), true);

select ok((select relrowsecurity from pg_class where oid = 'public.inventory_items'::regclass)
  and has_function_privilege('authenticated', 'public.owner_verify_inventory_item_conversion(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.owner_verify_inventory_item_conversion(uuid)', 'EXECUTE'),
  'unit verification is available only through the authenticated owner-guarded RPC');
select ok(has_function_privilege('authenticated', 'public.inventory_count_items_needing_recount(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.inventory_receipt_outlier_baselines(uuid[],uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.inventory_receipt_outlier_baselines(uuid[],uuid)', 'EXECUTE'),
  'recount and outlier baseline readers are callable only by authenticated sessions');
select ok(to_regclass('public.inventory_counts_owner_finalized_export_idx') is not null,
  'exported finalized count lookups have an owner-scoped timestamp index');
select ok(to_regclass('public.inventory_receipts_owner_updated_export_idx') is not null
  and to_regclass('public.inventory_receipts_owner_received_export_idx') is not null
  and to_regclass('public.inventory_receipt_versions_owner_export_event_idx') is not null,
  'exported receipt event scans have owner-scoped timestamp and stable-order indexes');
select ok(to_regclass('public.inventory_count_corrections_owner_page_idx') is not null,
  'count correction history is indexed for bounded timestamp keyset pages');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '72000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'session_id', '82000000-0000-4000-8000-000000000001', 'iat', extract(epoch from now())::bigint
)::text, true);
select public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', current_setting('test.inventory_item_id'), 'large_quantity', '1', 'loose_quantity', '0')));
select public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', current_setting('test.inventory_item_id'), 'large_quantity', '1', 'loose_quantity', '0')));
select public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id', current_setting('test.inventory_item_id'), 'large_quantity', '1', 'loose_quantity', '0')));
reset role;

select is((select receipt_count from public.inventory_receipt_outlier_baselines(array[current_setting('test.inventory_item_id')::uuid]) limit 1),
  3, 'baseline reader groups historical lines by receipt and reports the three recent receipts');
select is((select median_quantity from public.inventory_receipt_outlier_baselines(array[current_setting('test.inventory_item_id')::uuid]) limit 1),
  1000::numeric, 'outlier baseline uses the exact median quantity');

update public.inventory_receipts
set received_at = ((private.current_week_start_vn() - 7)::timestamp at time zone 'Asia/Ho_Chi_Minh'),
    updated_at = ((private.current_week_start_vn() - 7)::timestamp at time zone 'Asia/Ho_Chi_Minh')
where owner_id = '72000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '72000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'session_id', '82000000-0000-4000-8000-000000000001', 'iat', extract(epoch from now())::bigint
)::text, true);
select ok((select receipt_count = 0 and median_quantity is null
  from public.inventory_receipt_outlier_baselines(array[current_setting('test.inventory_item_id')::uuid]) limit 1),
  'staff outlier baseline does not expose receipts outside the current week');
reset role;
update public.inventory_receipts set received_at = clock_timestamp(), updated_at = clock_timestamp()
where owner_id = '72000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '72000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'session_id', '82000000-0000-4000-8000-000000000001', 'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object(
      'item_id', current_setting('test.inventory_item_id'), 'large_quantity', '100', 'loose_quantity', '0'
    )));
    raise exception 'staff receipt above five times the baseline was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'Large inventory receipt quantity requires owner confirmation' then raise; end if;
  end;
end $$;
reset role;
select is((select count(*) from public.inventory_receipts where owner_id = '72000000-0000-4000-8000-000000000001'),
  3::bigint, 'the rejected staff outlier creates no receipt');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '72000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'session_id', '82000000-0000-4000-8000-000000000001', 'iat', extract(epoch from now())::bigint
)::text, true);
select set_config('test.inventory_count_id', public.open_inventory_count(private.current_business_date_vn())::text, true);
select public.save_inventory_count_draft(current_setting('test.inventory_count_id')::uuid, jsonb_build_array(jsonb_build_object(
  'item_id', current_setting('test.inventory_item_id'), 'large_quantity', '0', 'small_quantity', '1000'
)));
select is((select count(*) from public.inventory_count_items_needing_recount(current_setting('test.inventory_count_id')::uuid)),
  0::bigint, 'freshly entered stock count does not request a recount');
select public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object(
  'item_id', current_setting('test.inventory_item_id'), 'large_quantity', '0', 'loose_quantity', '1'
)));
select is((select array_agg(recount.item_id) from public.inventory_count_items_needing_recount(current_setting('test.inventory_count_id')::uuid) as recount(item_id)),
  array[current_setting('test.inventory_item_id')::uuid], 'receipt activity after the count requests a targeted item recount');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('test.outside_week_count_id', public.open_inventory_count(private.current_week_start_vn() - 1)::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '72000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'session_id', '82000000-0000-4000-8000-000000000001', 'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform * from public.inventory_count_items_needing_recount(current_setting('test.outside_week_count_id')::uuid);
    raise exception 'staff inspected an inventory date outside the current week';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('staff recount checks stay inside the current week');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.owner_verify_inventory_item_conversion(current_setting('test.inventory_item_id')::uuid);
reset role;
select ok((select conversion_verified_at is not null and conversion_verified_by = '72000000-0000-4000-8000-000000000001'
  from public.inventory_items where id = current_setting('test.inventory_item_id')::uuid), 'owner can verify the current package conversion');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.owner_update_inventory_item(current_setting('test.inventory_item_id')::uuid, 'Đường cát', 'Nguyên liệu', 'Kg', 2000, 'Gr', false);
reset role;
select ok((select conversion_verified_at is null and conversion_verified_by is null
  from public.inventory_items where id = current_setting('test.inventory_item_id')::uuid), 'editing a unit or factor clears the old verification');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '72000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'session_id', '82000000-0000-4000-8000-000000000001', 'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform public.owner_verify_inventory_item_conversion(current_setting('test.inventory_item_id')::uuid);
    raise exception 'staff unexpectedly verified a conversion';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('staff cannot certify catalog conversion units');

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.owner_create_inventory_receipt(jsonb_build_array(jsonb_build_object(
      'item_id', current_setting('test.inventory_item_id'), 'large_quantity', '100', 'loose_quantity', '0'
    )), false);
    raise exception 'owner created an outlier without confirmation';
  exception when sqlstate '22023' then
    if sqlerrm <> 'Large inventory receipt quantity requires owner confirmation' then raise; end if;
  end;
end $$;
select public.owner_create_inventory_receipt(jsonb_build_array(jsonb_build_object(
  'item_id', current_setting('test.inventory_item_id'), 'large_quantity', '100', 'loose_quantity', '0'
)), true);
reset role;
select is((select count(*) from public.inventory_receipts where owner_id = '72000000-0000-4000-8000-000000000001'),
  5::bigint, 'owner can record a high quantity after explicit confirmation');

select * from finish();
rollback;
