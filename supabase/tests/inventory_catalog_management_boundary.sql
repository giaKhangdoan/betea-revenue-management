begin;
select plan(16);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'catalog-owner@example.test', '{}', '{}'),
  ('40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'catalog-staff@example.test', '{}', '{}'),
  ('40000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'catalog-inactive@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('40000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'catalog-staff@example.test', 'Catalog staff', true),
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'catalog-inactive@example.test', 'Inactive staff', false);
insert into auth.sessions (id, user_id)
values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003');
select private.seed_inventory_catalog_for_owner('40000000-0000-4000-8000-000000000001');

select ok(has_function_privilege('authenticated', 'public.owner_create_inventory_item(text,text,text,numeric,text,boolean)', 'EXECUTE'), 'authenticated callers reach the guarded owner create RPC');
select ok(not has_function_privilege('anon', 'public.owner_create_inventory_item(text,text,text,numeric,text,boolean)', 'EXECUTE'), 'anonymous callers cannot invoke catalog writes');
select ok(not has_table_privilege('authenticated', 'public.inventory_items', 'INSERT'), 'catalog writes cannot bypass the owner RPC');
select ok(not has_table_privilege('authenticated', 'public.inventory_items', 'UPDATE'), 'catalog updates cannot bypass the owner RPC');
select ok(not has_table_privilege('authenticated', 'public.inventory_items', 'DELETE'), 'catalog history cannot be deleted directly');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.open_inventory_count(current_date);
reset role;
select is((select count(*) from public.inventory_count_items where count_id = (select id from public.inventory_counts where owner_id = '40000000-0000-4000-8000-000000000001' and business_date = current_date)), 43::bigint, 'opening a count snapshots the active catalog');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '40000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '50000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);
select public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object(
  'item_id', (select id::text from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'),
  'large_quantity', '1', 'loose_quantity', '0'
)));
reset role;
select ok(exists (select 1 from public.inventory_receipt_lines where receipt_id in (select id from public.inventory_receipts where owner_id = '40000000-0000-4000-8000-000000000001')), 'receipt stores its own catalog snapshot');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.owner_update_inventory_item(
  (select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'),
  'Đường cập nhật', 'Nguyên liệu', 'Chai', 500, 'Ml', false
);
reset role;
select is((select name from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'), 'Đường cập nhật', 'owner can edit a catalog item');
select is((select item_name || '|' || large_unit || '|' || conversion_factor::text || '|' || small_unit from public.inventory_count_items where count_id = (select id from public.inventory_counts where owner_id = '40000000-0000-4000-8000-000000000001' and business_date = current_date) and item_id = (select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001')), 'Đường cát|Kg|1000.000|Gr', 'saved count retains its original item and conversion snapshot');
select is((select item_name || '|' || large_unit || '|' || conversion_factor::text || '|' || small_unit from public.inventory_receipt_lines where receipt_id = (select id from public.inventory_receipts where owner_id = '40000000-0000-4000-8000-000000000001' limit 1)), 'Đường cát|Kg|1000.000|Gr', 'saved receipt retains its original item and conversion snapshot');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.owner_update_inventory_item(
      (select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'),
      'Đường cập nhật', 'Nguyên liệu', 'Chai', 1.0001, 'Ml', false
    );
    raise exception 'conversion factor with more than three decimals was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.owner_update_inventory_item(
      (select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'),
      'Đường cập nhật', 'Nguyên liệu', ' ', 500, 'Ml', false
    );
    raise exception 'blank unit was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.owner_update_inventory_item(
      (select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'),
      'Đường cập nhật', 'Nguyên liệu', 'Hộp', 0.5, 'Cái', false
    );
    raise exception 'fractional conversion factor for indivisible unit was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
select pass('database rejects invalid conversion factors, blank units, and fractional factors for indivisible units');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.owner_create_inventory_item('New item', 'Vật tư', 'Hộp', 4, 'Cái', false);
select public.owner_deactivate_inventory_item((select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'));
select public.open_inventory_count(current_date - 1);
reset role;
select is((select count(*) from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and name = 'New item'), 1::bigint, 'owner can add a catalog item');
select ok(not (select active from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'), 'owner can deactivate an item without deleting it');
select ok(not exists (
  select 1 from public.inventory_count_items as count_item
  join public.inventory_counts as count on count.id = count_item.count_id
  where count.owner_id = '40000000-0000-4000-8000-000000000001'
    and count.business_date = current_date - 1
    and count_item.item_id = (select id from public.inventory_items where owner_id = count.owner_id and source_code = '001')
), 'deactivated items are omitted from later count snapshots');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '40000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '50000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform public.owner_create_inventory_item('Unauthorized', 'Vật tư', 'Gói', 1, 'Gói', false);
    raise exception 'active staff unexpectedly changed the catalog';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('active staff cannot change the catalog through a direct RPC call');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '40000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'session_id', '50000000-0000-4000-8000-000000000002',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform public.owner_deactivate_inventory_item((select id from public.inventory_items where owner_id = '40000000-0000-4000-8000-000000000001' and source_code = '001'));
    raise exception 'inactive staff unexpectedly changed the catalog';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('inactive staff cannot change the catalog through a direct RPC call');

select * from finish();
rollback;
