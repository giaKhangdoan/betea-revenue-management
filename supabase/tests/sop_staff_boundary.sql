begin;
select plan(34);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('93000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sop-owner@example.test', '{}', '{}'),
  ('93000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sop-staff@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('93000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'sop-staff@example.test', 'SOP staff', true);
insert into auth.sessions (id, user_id)
values ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002');

select ok(to_regclass('public.owner_sop_workspace') is not null, 'owner SOP draft table exists');
select ok(to_regclass('public.owner_sop_snapshots') is not null, 'owner SOP history table exists');
select ok(to_regclass('public.staff_sop_publications') is not null, 'staff-safe publication table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.owner_sop_workspace'::regclass), 'SOP drafts have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.owner_sop_snapshots'::regclass), 'SOP history has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.staff_sop_publications'::regclass), 'staff publications have RLS enabled');
select ok(has_table_privilege('authenticated', 'public.owner_sop_workspace', 'SELECT'), 'owner reads SOP drafts through owner RLS');
select ok(not has_table_privilege('anon', 'public.owner_sop_workspace', 'SELECT'), 'anonymous users cannot read drafts');
select ok(not has_table_privilege('authenticated', 'public.owner_sop_workspace', 'INSERT'), 'draft writes use the revision-checked RPC');
select ok(not has_table_privilege('authenticated', 'public.owner_sop_snapshots', 'UPDATE'), 'SOP history cannot be updated');
select ok(has_table_privilege('authenticated', 'public.staff_sop_publications', 'SELECT'), 'staff publications are readable through membership RLS');
select ok(not has_table_privilege('anon', 'public.staff_sop_publications', 'SELECT'), 'anonymous users cannot read published SOP');
select ok(has_function_privilege('authenticated', 'public.owner_save_sop_workspace(integer,integer,jsonb,text)', 'EXECUTE'), 'authenticated session reaches guarded SOP save RPC');
select ok(not has_function_privilege('anon', 'public.owner_save_sop_workspace(integer,integer,jsonb,text)', 'EXECUTE'), 'anonymous users cannot save SOP drafts');
select ok(has_function_privilege('authenticated', 'public.owner_publish_staff_sop(integer,integer,jsonb)', 'EXECUTE'), 'authenticated session reaches guarded SOP publish RPC');
select ok(not has_function_privilege('anon', 'public.owner_publish_staff_sop(integer,integer,jsonb)', 'EXECUTE'), 'anonymous users cannot publish SOP');
select ok(has_function_privilege('authenticated', 'private.owner_save_sop_workspace_impl(integer,integer,jsonb,text)', 'EXECUTE'), 'public save wrapper can reach its private owner-checked helper');
select ok(not has_function_privilege('anon', 'private.owner_save_sop_workspace_impl(integer,integer,jsonb,text)', 'EXECUTE'), 'anonymous users cannot execute the private save helper');

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.owner_save_recipe_cost_workspace(
  0,
  '{"unitConversions":[],"ingredients":[{"id":"tea","name":"Hồng Trà","purchaseQuantity":"1000","purchaseUnit":"g","purchasePriceVnd":"200000","costUnit":"g"}],"batches":[],"products":[{"id":"drink","name":"Trà Sữa","variants":[{"size":"S","salePriceVnd":"30000","components":[{"kind":"ingredient","ingredientId":"tea","quantity":"40","unit":"g"}]}]}]}'::jsonb,
  '{"calculationVersion":1,"ingredients":{"tea":{"unitCostVnd":"200"}},"batches":{},"products":{}}'::jsonb,
  'Recipe test data'
), 1, 'owner recipe revision is created for SOP consistency checks');
select is(public.owner_save_sop_workspace(
  0, 1,
  '{"products":[{"productId":"drink","variants":[{"size":"S","steps":[{"id":"step-1","title":"Ủ trà","instruction":"Ngâm 8 phút."}],"notes":"Lắc đều."}]}]}'::jsonb,
  'Initial SOP'
), 1, 'owner saves a draft tied to recipe revision 1');
select is((select count(*) from public.owner_sop_workspace), 1::bigint, 'owner can read the SOP draft');
select is((select count(*) from public.owner_sop_snapshots), 1::bigint, 'saving a draft creates immutable history');
do $$ begin
  begin
    perform public.owner_publish_staff_sop(
      1, 2,
      '{"products":[{"name":"Trà Sữa","variants":[{"size":"S","sizeOz":12,"components":[{"name":"Hồng Trà","quantity":"40","unit":"g"}],"steps":[{"title":"Ủ trà","instruction":"Ngâm 8 phút."}]}]}]}'::jsonb
    );
    raise exception 'SOP unexpectedly published against a stale recipe revision';
  exception when serialization_failure then null;
  end;
end $$;
select pass('a recipe revision mismatch blocks SOP publication');
select is(public.owner_publish_staff_sop(
  1, 1,
  '{"privateCost":"999999","products":[{"name":"Trà Sữa","salePriceVnd":"30000","unitCostVnd":"5000","variants":[{"size":"S","sizeOz":12,"grossMarginPercent":"80","components":[{"name":"Hồng Trà","quantity":"40","unit":"g","unitCostVnd":"500","purchasePriceVnd":"200000"}],"steps":[{"title":"Ủ trà","instruction":"Ngâm 8 phút.","internalCost":"999999"}],"notes":"Lắc đều."}]}]}'::jsonb
), 1, 'owner publishes the first staff revision');
select is((select document from public.staff_sop_publications where owner_id = '93000000-0000-4000-8000-000000000001'),
  '{"products":[{"name":"Trà Sữa","variants":[{"size":"S","sizeOz":12,"components":[{"name":"Hồng Trà","quantity":"40","unit":"g"}],"steps":[{"title":"Ủ trà","instruction":"Ngâm 8 phút."}],"notes":"Lắc đều."}]}]}'::jsonb,
  'publication is reconstructed with only the explicit staff-safe allowlist');
select ok(not ((select document from public.staff_sop_publications where owner_id = '93000000-0000-4000-8000-000000000001')::text ~* '(cost|price|margin|profit|999999|30000|200000)'), 'published JSON contains no financial fields or injected values');
select ok(not (((select document from public.staff_sop_publications where owner_id = '93000000-0000-4000-8000-000000000001') #> '{products,0,variants,0,components,0}') ? 'unitCostVnd'), 'nested ingredient data contains no unit cost');
do $$ begin
  begin
    perform public.owner_save_sop_workspace(0, 1, '{"products":[]}'::jsonb, 'Stale draft');
    raise exception 'stale SOP revision unexpectedly overwrote the draft';
  exception when serialization_failure then null;
  end;
end $$;
select pass('stale SOP revision cannot overwrite the draft');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '93000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '94000000-0000-4000-8000-000000000002',
  'iat', extract(epoch from now())::bigint
)::text, true);
select is((select count(*) from public.staff_sop_publications), 1::bigint, 'active staff can read the published SOP');
select is((select count(*) from public.owner_sop_workspace), 0::bigint, 'staff cannot read the owner draft');
select is((select count(*) from public.owner_sop_snapshots), 0::bigint, 'staff cannot read SOP revision history');
do $$ begin
  begin
    perform public.owner_save_sop_workspace(1, 1, '{"products":[]}'::jsonb, 'Staff attempt');
    raise exception 'staff unexpectedly saved a draft';
  exception when insufficient_privilege then null;
  end;
end $$;
select pass('staff cannot save an owner SOP draft');
do $$ begin
  begin
    perform public.owner_publish_staff_sop(1, 1, '{"products":[]}'::jsonb);
    raise exception 'staff unexpectedly published an SOP';
  exception when insufficient_privilege then null;
  end;
end $$;
select pass('staff cannot publish a staff SOP');
reset role;

set local role anon;
do $$ begin
  begin
    perform 1 from public.staff_sop_publications;
    raise exception 'anonymous user unexpectedly read SOP';
  exception when insufficient_privilege then null;
  end;
end $$;
select pass('anonymous users cannot read the staff SOP publication');
reset role;

select * from finish();
rollback;
