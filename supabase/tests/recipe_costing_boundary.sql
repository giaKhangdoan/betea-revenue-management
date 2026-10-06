begin;
select plan(24);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'recipe-owner@example.test', '{}', '{}'),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'recipe-staff@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('91000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'recipe-staff@example.test', 'Recipe staff', true);
insert into auth.sessions (id, user_id)
values ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002');

select ok(to_regclass('public.recipe_cost_workspace') is not null, 'recipe workspace table exists');
select ok(to_regclass('public.recipe_cost_snapshots') is not null, 'recipe history table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.recipe_cost_workspace'::regclass), 'workspace has row-level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.recipe_cost_snapshots'::regclass), 'history has row-level security enabled');
select ok(has_table_privilege('authenticated', 'public.recipe_cost_workspace', 'SELECT'), 'authenticated reads pass through owner RLS');
select ok(not has_table_privilege('anon', 'public.recipe_cost_workspace', 'SELECT'), 'anonymous users cannot read recipe costs');
select ok(not has_table_privilege('authenticated', 'public.recipe_cost_workspace', 'INSERT'), 'workspace writes are forced through the atomic owner RPC');
select ok(not has_table_privilege('authenticated', 'public.recipe_cost_workspace', 'UPDATE'), 'workspace updates cannot bypass revision checks');
select ok(not has_table_privilege('authenticated', 'public.recipe_cost_snapshots', 'UPDATE'), 'history cannot be updated');
select ok(not has_table_privilege('authenticated', 'public.recipe_cost_snapshots', 'DELETE'), 'history cannot be deleted');
select ok(has_function_privilege('authenticated', 'public.owner_save_recipe_cost_workspace(integer,jsonb,jsonb,text)', 'EXECUTE'), 'authenticated owners can reach the guarded save RPC');
select ok(not has_function_privilege('anon', 'public.owner_save_recipe_cost_workspace(integer,jsonb,jsonb,text)', 'EXECUTE'), 'anonymous users cannot call the save RPC');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.owner_save_recipe_cost_workspace(
  0,
  '{"unitConversions":[],"ingredients":[],"batches":[],"products":[]}'::jsonb,
  '{"calculationVersion":1,"ingredients":{},"batches":{},"products":{}}'::jsonb,
  'Initial recipe setup'
), 1, 'the first owner save creates revision 1');
select is(public.owner_save_recipe_cost_workspace(
  1,
  '{"unitConversions":[],"ingredients":[{"id":"tea","purchasePriceVnd":"200000"}],"batches":[],"products":[]}'::jsonb,
  '{"calculationVersion":1,"ingredients":{"tea":{"unitCostVnd":"200"}},"batches":{},"products":{}}'::jsonb,
  'Tea price entered'
), 2, 'a subsequent owner save creates revision 2');
select is((select count(*) from public.recipe_cost_workspace), 1::bigint, 'owner can read the current recipe workspace');
select is((select count(*) from public.recipe_cost_snapshots), 2::bigint, 'owner can read recipe cost history');
do $$ begin
  begin
    perform public.owner_save_recipe_cost_workspace(
      0,
      '{"unitConversions":[],"ingredients":[],"batches":[],"products":[]}'::jsonb,
      '{"calculationVersion":1,"ingredients":{},"batches":{},"products":{}}'::jsonb,
      'Stale write'
    );
    raise exception 'stale revision unexpectedly overwrote the recipe workspace';
  exception when serialization_failure then null;
  end;
end $$;
reset role;
select pass('a stale expected revision cannot overwrite newer recipe data');

select is((select count(*) from public.recipe_cost_snapshots where owner_id = '91000000-0000-4000-8000-000000000001'), 2::bigint, 'each workspace save writes a matching immutable snapshot');
select is((select revision from public.recipe_cost_workspace where owner_id = '91000000-0000-4000-8000-000000000001'), 2, 'workspace points to the latest revision');
select is((select document #>> '{ingredients,0,purchasePriceVnd}' from public.recipe_cost_snapshots where owner_id = '91000000-0000-4000-8000-000000000001' and revision = 2), '200000', 'history retains the exact source input used by its calculation');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002"}', true);
select is((select count(*) from public.recipe_cost_workspace), 0::bigint, 'staff cannot read owner recipe cost data');
select is((select count(*) from public.recipe_cost_snapshots), 0::bigint, 'staff cannot read owner cost history');
do $$ begin
  begin
    perform public.owner_save_recipe_cost_workspace(
      0,
      '{"unitConversions":[],"ingredients":[],"batches":[],"products":[]}'::jsonb,
      '{"calculationVersion":1,"ingredients":{},"batches":{},"products":{}}'::jsonb,
      'Unauthorized'
    );
    raise exception 'staff unexpectedly saved recipe costs';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('staff cannot save owner recipe cost data through the RPC');

set local role anon;
do $$ begin
  begin
    perform 1 from public.recipe_cost_workspace;
    raise exception 'anonymous user unexpectedly read recipe costs';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('anonymous users cannot directly read recipe cost data');

select * from finish();
rollback;
