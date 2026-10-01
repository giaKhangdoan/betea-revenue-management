begin;
select plan(7);

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
select ok(not exists (
  select owner.user_id
  from public.owner_profiles as owner
  left join public.inventory_items as item
    on item.owner_id = owner.user_id and item.source_code is not null
  group by owner.user_id having count(item.id) <> 43
), 'each seeded owner has exactly 43 source items');

select * from finish();
rollback;
