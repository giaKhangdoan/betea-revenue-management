begin;
select plan(11);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'inventory-owner@example.test', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'inventory-staff@example.test', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'inventory-inactive@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('10000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'inventory-staff@example.test', 'Inventory staff', true),
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'inventory-inactive@example.test', 'Inactive staff', false);
insert into auth.sessions (id, user_id)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003');

select private.seed_inventory_catalog_for_owner('10000000-0000-4000-8000-000000000001');

select ok(to_regclass('public.inventory_items') is not null, 'inventory catalog table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.inventory_items'::regclass), 'catalog has row-level security enabled');
select ok(has_table_privilege('authenticated', 'public.inventory_items', 'SELECT'), 'authenticated users can read through RLS');
select ok(not has_table_privilege('anon', 'public.inventory_items', 'SELECT'), 'anonymous users cannot read the catalog');
select ok(exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'inventory_items'
    and policyname = 'active store members read inventory catalog'
    and qual like '%is_active_store_member%'
), 'staff reads require active membership');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.owner_profiles'::regclass
    and tgname = 'seed_inventory_catalog_after_owner_insert'
    and not tgisinternal
), 'new owners receive the seeded catalog');
select is((select count(*) from public.inventory_items where owner_id = '10000000-0000-4000-8000-000000000001'), 43::bigint, 'running the catalog seeder twice leaves 43 rows');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.inventory_items where owner_id = '10000000-0000-4000-8000-000000000001') <> 43 then
    raise exception 'owner could not read all inventory items';
  end if;
end $$;
reset role;
select pass('owner can directly read the full catalog');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '20000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  if (select count(*) from public.inventory_items where owner_id = '10000000-0000-4000-8000-000000000001') <> 43 then
    raise exception 'active staff could not read the catalog';
  end if;
end $$;
reset role;
select pass('active staff can directly read the catalog');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'session_id', '20000000-0000-4000-8000-000000000002',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  if (select count(*) from public.inventory_items where owner_id = '10000000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'inactive staff could read the catalog';
  end if;
end $$;
reset role;
select pass('inactive staff cannot directly read the catalog');

set local role anon;
do $$ begin
  begin
    perform 1 from public.inventory_items;
    raise exception 'anonymous user unexpectedly read inventory';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
select pass('anonymous users cannot directly read the catalog');

select * from finish();
rollback;
