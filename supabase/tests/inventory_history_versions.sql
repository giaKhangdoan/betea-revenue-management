begin;
select plan(29);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'history-owner@example.test', '{}', '{}'),
  ('70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'history-staff@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('70000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'history-staff@example.test', 'History staff', true);
insert into auth.sessions (id, user_id)
values ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002');
select private.seed_inventory_catalog_for_owner('70000000-0000-4000-8000-000000000001');

update public.inventory_items set active = false where owner_id = '70000000-0000-4000-8000-000000000001';
update public.inventory_items set active = true
where owner_id = '70000000-0000-4000-8000-000000000001' and source_code = '001';

select ok(to_regclass('public.inventory_receipt_versions') is not null, 'receipt event snapshots table exists');
select ok(to_regclass('public.inventory_count_versions') is not null, 'count event snapshots table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.inventory_receipt_versions'::regclass), 'receipt event snapshots use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.inventory_count_versions'::regclass), 'count event snapshots use RLS');
select ok(not has_table_privilege('authenticated', 'public.inventory_receipt_versions', 'INSERT'), 'authenticated cannot append receipt snapshots directly');
select ok(not has_table_privilege('authenticated', 'public.inventory_count_versions', 'INSERT'), 'authenticated cannot append count snapshots directly');
select ok(exists (
  select 1 from pg_proc as routine join pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'private' and routine.proname = 'append_inventory_receipt_snapshot'
), 'receipt snapshot append helper exists in private schema');
select ok(not exists (
  select 1 from pg_proc as routine join pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'private' and routine.proname = 'append_inventory_receipt_snapshot'
    and has_function_privilege('authenticated', routine.oid, 'EXECUTE')
), 'authenticated cannot call receipt snapshot append helper directly');
select ok(not exists (
  select 1 from pg_proc as routine join pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'private' and routine.proname = 'append_inventory_receipt_snapshot'
    and has_function_privilege('anon', routine.oid, 'EXECUTE')
), 'anonymous users cannot call receipt snapshot append helper');
select ok(exists (
  select 1 from pg_proc as routine join pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'private' and routine.proname = 'append_inventory_count_snapshot'
), 'count snapshot append helper exists in private schema');
select ok(not exists (
  select 1 from pg_proc as routine join pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'private' and routine.proname = 'append_inventory_count_snapshot'
    and has_function_privilege('authenticated', routine.oid, 'EXECUTE')
), 'authenticated cannot call count snapshot append helper directly');
select ok(not exists (
  select 1 from pg_proc as routine join pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'private' and routine.proname = 'append_inventory_count_snapshot'
    and has_function_privilege('anon', routine.oid, 'EXECUTE')
), 'anonymous users cannot call count snapshot append helper');

create function public.fail_inventory_history_snapshot_for_test()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('test.fail_inventory_history_snapshot', true) = 'on' then
    raise exception using errcode = 'P0001', message = 'forced inventory snapshot append failure';
  end if;
  return new;
end;
$$;
create trigger fail_inventory_receipt_snapshot_for_test
before insert on public.inventory_receipt_versions
for each row execute function public.fail_inventory_history_snapshot_for_test();
create trigger fail_inventory_count_snapshot_for_test
before insert on public.inventory_count_versions
for each row execute function public.fail_inventory_history_snapshot_for_test();

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '70000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '80000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);

do $$
declare
  v_item_id uuid := (
    select id from public.inventory_items
    where owner_id = '70000000-0000-4000-8000-000000000001' and source_code = '001'
  );
  v_receipt_id uuid;
  v_count_id uuid;
begin
  v_receipt_id := public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id', v_item_id::text, 'large_quantity', '2', 'loose_quantity', '0')
  ));
  perform set_config('test.receipt_id', v_receipt_id::text, true);

  perform public.staff_update_inventory_receipt(v_receipt_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_id::text, 'large_quantity', '3', 'loose_quantity', '0')
  ), 'Correct delivery quantity');

  perform public.staff_update_inventory_receipt(v_receipt_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_id::text, 'large_quantity', '4', 'loose_quantity', '0')
  ), 'Correct delivery quantity again');

  v_count_id := public.open_inventory_count(private.current_business_date_vn());
  perform set_config('test.count_id', v_count_id::text, true);
  perform public.save_inventory_count_draft(v_count_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_id::text, 'large_quantity', null, 'small_quantity', '3000')
  ));
  perform public.finalize_inventory_count(v_count_id);
end $$;
select pass('staff receipt creation, receipt correction and count finalization execute through their guarded RPCs');

reset role;
select ok(exists (
  select 1 from public.inventory_receipt_versions as version
  join public.inventory_receipts as receipt on receipt.id = version.receipt_id and receipt.owner_id = version.owner_id
  where version.receipt_id = current_setting('test.receipt_id')::uuid
    and version.event_type = 'receipt_created'
    and version.effective_at = receipt.received_at
    and version.actor_id = '70000000-0000-4000-8000-000000000002'
    and exists (select 1 from jsonb_array_elements(version.lines_snapshot) as line where (line ->> 'converted_quantity')::numeric = 2000)
), 'staff receipt creation appends the canonical initial lines at its received cutoff in the same transaction');
select ok(exists (
  select 1 from public.inventory_receipt_versions as version
  where version.receipt_id = current_setting('test.receipt_id')::uuid
    and version.event_type = 'receipt_corrected'
    and version.effective_at > (
      select received_at from public.inventory_receipts where id = current_setting('test.receipt_id')::uuid
    )
    and version.actor_id = '70000000-0000-4000-8000-000000000002'
    and version.reason = 'Correct delivery quantity'
    and exists (select 1 from jsonb_array_elements(version.lines_snapshot) as line where (line ->> 'converted_quantity')::numeric = 3000)
), 'receipt correction appends a timestamped after-state with actor and reason');
select ok((
  select count(*) = 3
    and bool_or(event_type = 'receipt_created' and exists (
      select 1 from jsonb_array_elements(lines_snapshot) as line where (line ->> 'converted_quantity')::numeric = 2000
    ))
  from public.inventory_receipt_versions
  where receipt_id = current_setting('test.receipt_id')::uuid
), 'receipt correction leaves the original receipt snapshot immutable');
select ok(exists (
  select 1 from public.inventory_count_versions as version
  join public.inventory_counts as count_sheet on count_sheet.id = version.count_id and count_sheet.owner_id = version.owner_id
  where version.count_id = current_setting('test.count_id')::uuid
    and version.event_type = 'count_finalized'
    and version.effective_at = count_sheet.finalized_at
    and version.actor_id = '70000000-0000-4000-8000-000000000002'
    and exists (select 1 from jsonb_array_elements(version.items_snapshot) as item where (item ->> 'counted_quantity')::numeric = 3000)
), 'count finalization appends the complete canonical count snapshot at its finalized cutoff');

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_item_id uuid := (
    select id from public.inventory_items
    where owner_id = '70000000-0000-4000-8000-000000000001' and source_code = '001'
  );
begin
  perform public.owner_correct_inventory_count(
    current_setting('test.count_id')::uuid,
    jsonb_build_array(jsonb_build_object('item_id', v_item_id::text, 'large_quantity', null, 'small_quantity', '2900')),
    'Correct closing count'
  );
  perform public.owner_correct_inventory_count(
    current_setting('test.count_id')::uuid,
    jsonb_build_array(jsonb_build_object('item_id', v_item_id::text, 'large_quantity', null, 'small_quantity', '2800')),
    'Correct closing count again'
  );
end $$;
reset role;
select ok(exists (
  select 1 from public.inventory_count_versions as version
  where version.count_id = current_setting('test.count_id')::uuid
    and version.event_type = 'count_corrected'
    and version.effective_at > (
      select finalized_at from public.inventory_counts where id = current_setting('test.count_id')::uuid
    )
    and version.actor_id = '70000000-0000-4000-8000-000000000001'
    and version.reason = 'Correct closing count'
    and exists (select 1 from jsonb_array_elements(version.items_snapshot) as item where (item ->> 'counted_quantity')::numeric = 2900)
), 'count correction appends a timestamped after-state with actor and reason');
select ok((
  select count(*) = 3
    and bool_or(event_type = 'count_finalized' and exists (
      select 1 from jsonb_array_elements(items_snapshot) as item where (item ->> 'counted_quantity')::numeric = 3000
    ))
  from public.inventory_count_versions
  where count_id = current_setting('test.count_id')::uuid
), 'count correction leaves the original finalized snapshot immutable');

select ok(private.inventory_receipt_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.receipt_id')::uuid
) is null, 'multiple receipt corrections form a validated historical chain');
select ok(private.inventory_count_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.count_id')::uuid
) is null, 'multiple count corrections match each next before-state and the current finalized state');

update public.inventory_receipt_corrections as correction
set corrected_at = (
  select min(earlier.corrected_at) from public.inventory_receipt_corrections as earlier
  where earlier.owner_id = correction.owner_id and earlier.receipt_id = correction.receipt_id
)
where correction.id = (
  select latest.id from public.inventory_receipt_corrections as latest
  where latest.receipt_id = current_setting('test.receipt_id')::uuid
  order by latest.corrected_at desc, latest.id desc offset 0 limit 1
);
select ok(checker.reason is not null,
  'ambiguous receipt correction timestamps remain unverified; checker returned: ' || coalesce(checker.reason, '<NULL>'))
from (select private.inventory_receipt_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.receipt_id')::uuid
) as reason) as checker;
update public.inventory_receipt_corrections as correction
set corrected_at = receipt.received_at + case
  when exists (
    select 1 from jsonb_array_elements(correction.prior_lines) as line(value)
    where (line.value ->> 'converted_quantity')::numeric = 2000
  ) then interval '1 minute'
  when exists (
    select 1 from jsonb_array_elements(correction.prior_lines) as line(value)
    where (line.value ->> 'converted_quantity')::numeric = 3000
  ) then interval '2 minutes'
  else interval '3 minutes'
end
from public.inventory_receipts as receipt
where correction.receipt_id = receipt.id
  and correction.receipt_id = current_setting('test.receipt_id')::uuid;
update public.inventory_receipt_corrections
set prior_lines = '[{}]'::jsonb
where id = (
  select latest.id from public.inventory_receipt_corrections as latest
  where latest.receipt_id = current_setting('test.receipt_id')::uuid
  order by latest.corrected_at desc, latest.id desc limit 1
);
select ok(checker.reason like 'A receipt correction before-state%',
  'malformed receipt before-state is rejected instead of guessed; checker returned: ' || coalesce(checker.reason, '<NULL>'))
from (select private.inventory_receipt_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.receipt_id')::uuid
) as reason) as checker;

update public.inventory_count_corrections as correction
set prior_items = jsonb_set(correction.prior_items, '{0,counted_quantity}', '"9999"'::jsonb)
where correction.id = (
  select latest.id from public.inventory_count_corrections as latest
  where latest.count_id = current_setting('test.count_id')::uuid
  order by latest.corrected_at desc, latest.id desc limit 1
);
select ok(private.inventory_count_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.count_id')::uuid
) like 'A count correction before-state does not match%', 'broken count correction chain is rejected');
update public.inventory_count_corrections as latest
set prior_items = (
  select earlier.updated_items from public.inventory_count_corrections as earlier
  where earlier.count_id = latest.count_id and earlier.corrected_at < latest.corrected_at
  order by earlier.corrected_at desc, earlier.id desc limit 1
)
where latest.id = (
  select newest.id from public.inventory_count_corrections as newest
  where newest.count_id = current_setting('test.count_id')::uuid
  order by newest.corrected_at desc, newest.id desc limit 1
);
update public.inventory_count_corrections
set updated_items = jsonb_set(updated_items, '{0,counted_quantity}', '"9999"'::jsonb)
where id = (
  select latest.id from public.inventory_count_corrections as latest
  where latest.count_id = current_setting('test.count_id')::uuid
  order by latest.corrected_at desc, latest.id desc limit 1
);
select ok(private.inventory_count_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.count_id')::uuid
) like 'Current finalized count does not match%', 'count final state mismatch is rejected');
update public.inventory_count_corrections as correction
set corrected_at = (
  select min(earlier.corrected_at) from public.inventory_count_corrections as earlier
  where earlier.owner_id = correction.owner_id and earlier.count_id = correction.count_id
)
where correction.id = (
  select latest.id from public.inventory_count_corrections as latest
  where latest.count_id = current_setting('test.count_id')::uuid
  order by latest.corrected_at desc, latest.id desc limit 1
);
select ok(private.inventory_count_correction_history_problem(
  '70000000-0000-4000-8000-000000000001', current_setting('test.count_id')::uuid
) like 'Correction timestamps tie%', 'count corrections with tied timestamps are unverified');
update public.inventory_counts as count_sheet
set finalized_at = receipt.received_at
from public.inventory_receipts as receipt
where count_sheet.id = current_setting('test.count_id')::uuid
  and receipt.id = current_setting('test.receipt_id')::uuid;
select ok(exists (
  select 1 from private.inventory_history_cross_entity_tie_pairs() as tie
  where tie.owner_id = '70000000-0000-4000-8000-000000000001'
    and tie.receipt_id = current_setting('test.receipt_id')::uuid
    and tie.count_id = current_setting('test.count_id')::uuid
), 'same-owner receipt and finalized-count events at an exact shared cutoff are ambiguous');

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '70000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '80000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);
select set_config('test.fail_inventory_history_snapshot', 'on', true);
do $$
declare
  v_item_id uuid := (
    select id from public.inventory_items
    where owner_id = '70000000-0000-4000-8000-000000000001' and source_code = '001'
  );
  v_before integer := (select count(*) from public.inventory_receipts);
begin
  begin
    perform public.staff_create_inventory_receipt(jsonb_build_array(
      jsonb_build_object('item_id', v_item_id::text, 'large_quantity', '1', 'loose_quantity', '0')
    ));
    raise exception 'receipt unexpectedly succeeded with a forced snapshot failure';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forced inventory snapshot append failure' then raise; end if;
  end;
  if (select count(*) from public.inventory_receipts) <> v_before then
    raise exception 'receipt header survived a failed snapshot append';
  end if;
end $$;
select pass('receipt creation rolls back atomically when the initial snapshot append fails');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_item_id uuid := (
    select id from public.inventory_items
    where owner_id = '70000000-0000-4000-8000-000000000001' and source_code = '001'
  );
  v_count_id uuid := public.open_inventory_count(private.current_business_date_vn() - 1);
begin
  perform public.save_inventory_count_draft(v_count_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_id::text, 'large_quantity', null, 'small_quantity', '2800')
  ));
  begin
    perform public.finalize_inventory_count(v_count_id);
    raise exception 'count unexpectedly finalized with a forced snapshot failure';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forced inventory snapshot append failure' then raise; end if;
  end;
  if (select status <> 'draft' from public.inventory_counts where id = v_count_id) then
    raise exception 'count finalization survived a failed snapshot append';
  end if;
  if exists (select 1 from public.inventory_count_versions where count_id = v_count_id) then
    raise exception 'count snapshot survived its failed finalization';
  end if;
end $$;
select pass('count finalization rolls back atomically when the initial snapshot append fails');

reset role;
select * from finish();
rollback;
