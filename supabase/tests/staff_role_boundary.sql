begin;
select plan(18);

select ok(to_regclass('public.store_memberships') is not null, 'staff membership table exists');
select ok(to_regclass('public.daily_shift_deletions') is not null, 'per-shift deletion history exists');
select ok(not has_table_privilege('authenticated', 'public.daily_records', 'INSERT'), 'staff cannot insert daily records directly');
select ok(not has_table_privilege('authenticated', 'public.daily_records', 'UPDATE'), 'staff cannot update daily records directly');
select ok(not has_table_privilege('authenticated', 'public.daily_expenses', 'INSERT'), 'staff cannot insert expenses directly');
select ok(not has_table_privilege('authenticated', 'public.daily_expenses', 'DELETE'), 'staff cannot hard-delete expenses');
select ok(not has_table_privilege('authenticated', 'public.day_photos', 'INSERT'), 'staff cannot insert photo metadata directly');
select ok(has_table_privilege('authenticated', 'public.daily_records', 'SELECT'), 'staff can read safe daily rows through RLS');
select ok(has_table_privilege('authenticated', 'public.day_photos', 'SELECT'), 'staff can read evidence through RLS');

select has_function('public', 'staff_save_shift_revenue', array['date', 'text', 'bigint']);
select has_function('public', 'staff_delete_shift_revenue', array['date', 'text']);
select has_function('public', 'staff_increment_platform_orders', array['date', 'text', 'integer']);
select has_function('public', 'staff_set_platform_orders', array['date', 'text', 'integer']);
select has_function('public', 'staff_set_total_bill_count', array['date', 'integer']);
select has_function('public', 'staff_set_meter_readings', array['date', 'numeric', 'numeric']);
select has_function('public', 'staff_create_day_photo', array['date', 'text', 'text', 'text', 'text']);
select has_function('public', 'owner_restore_shift_revenue', array['uuid']);

select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff uploads today''s evidence files'), 'staff Storage upload policy is present');

select * from finish();
rollback;
