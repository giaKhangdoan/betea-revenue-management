begin;
select plan(11);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'count-owner@example.test', '{}', '{}'),
  ('50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'count-staff@example.test', '{}', '{}'),
  ('50000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'count-inactive@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('50000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values
  ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'count-staff@example.test', 'Count staff', true),
  ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', 'count-inactive@example.test', 'Inactive staff', false);
insert into auth.sessions (id, user_id)
values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003');
select private.seed_inventory_catalog_for_owner('50000000-0000-4000-8000-000000000001');

update public.inventory_items set active = false where owner_id = '50000000-0000-4000-8000-000000000001';
update public.inventory_items set active = true
where owner_id = '50000000-0000-4000-8000-000000000001' and source_code in ('001', '016');

select ok(to_regprocedure('public.finalize_inventory_count(uuid)') is not null, 'finalization is exposed as a database function');
select ok(not has_function_privilege('anon', 'public.finalize_inventory_count(uuid)', 'EXECUTE'), 'anonymous users cannot call finalization');
select ok(has_function_privilege('authenticated', 'public.finalize_inventory_count(uuid)', 'EXECUTE'), 'authenticated users reach guarded finalization');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '50000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', '60000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);

do $$
declare
  v_count_id uuid;
  v_receipt_id uuid;
  v_item_sugar uuid := (select id from public.inventory_items where owner_id = '50000000-0000-4000-8000-000000000001' and source_code = '001');
  v_item_pack uuid := (select id from public.inventory_items where owner_id = '50000000-0000-4000-8000-000000000001' and source_code = '016');
begin
  v_count_id := public.open_inventory_count(private.current_business_date_vn());
  perform set_config('test.count_id', v_count_id::text, true);

  perform public.save_inventory_count_draft(v_count_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_sugar::text, 'large_quantity', null, 'small_quantity', '0')
  ));
  v_receipt_id := public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id', v_item_sugar::text, 'large_quantity', '1', 'loose_quantity', '0')
  ));
  perform set_config('test.receipt_id', v_receipt_id::text, true);

  begin
    perform public.finalize_inventory_count(v_count_id);
    raise exception using errcode = 'P0001', message = 'incomplete count unexpectedly finalized';
  exception when sqlstate '22023' then null;
  end;

  perform public.save_inventory_count_draft(v_count_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_pack::text, 'large_quantity', null, 'small_quantity', '0')
  ));
  begin
    perform public.finalize_inventory_count(v_count_id);
    raise exception using errcode = 'P0001', message = 'count with a post-count receipt unexpectedly finalized';
  exception when sqlstate '22023' then null;
  end;

  -- Saving the same explicit zero still records a recount after the receipt.
  perform public.save_inventory_count_draft(v_count_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_sugar::text, 'large_quantity', null, 'small_quantity', '0')
  ));
  perform public.finalize_inventory_count(v_count_id);
end $$;

select pass('incomplete counts and counts made stale by a later receipt are refused');
select ok((select status = 'finalized' and finalized_by = auth.uid() and finalized_at is not null
  from public.inventory_counts where id = current_setting('test.count_id')::uuid), 'finalization records its actor and cutoff');
select ok((select receipt.received_at <= count_sheet.finalized_at
  from public.inventory_receipts as receipt
  join public.inventory_counts as count_sheet on count_sheet.id = current_setting('test.count_id')::uuid
  where receipt.id = current_setting('test.receipt_id')::uuid), 'receipt before the cutoff belongs to the finalized period');
select ok((select count_item.counted_quantity = 0 and count_item.counted_at > receipt.received_at
  from public.inventory_count_items as count_item
  join public.inventory_receipts as receipt on receipt.id = current_setting('test.receipt_id')::uuid
  join public.inventory_receipt_lines as receipt_line on receipt_line.receipt_id = receipt.id
  where count_item.count_id = current_setting('test.count_id')::uuid
    and count_item.item_id = receipt_line.item_id
  limit 1), 'first finalized count keeps explicit zero after recount instead of inferring receipt stock');

do $$
begin
  begin
    perform public.save_inventory_count_draft(current_setting('test.count_id')::uuid, '[]'::jsonb);
    raise exception using errcode = 'P0001', message = 'finalized count unexpectedly remained editable';
  exception when others then
    if sqlerrm = 'finalized count unexpectedly remained editable' then raise; end if;
  end;
  begin
    perform public.staff_update_inventory_receipt(current_setting('test.receipt_id')::uuid, '[]'::jsonb, 'Try editing a finalized receipt');
    raise exception using errcode = 'P0001', message = 'receipt in finalized count unexpectedly remained editable';
  exception when sqlstate '42501' then null;
  end;
end $$;
select pass('finalized count and included receipt reject staff edits');

do $$
declare
  v_item_pack uuid := (select id from public.inventory_items where owner_id = '50000000-0000-4000-8000-000000000001' and source_code = '016');
  v_receipt_id uuid;
begin
  v_receipt_id := public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id', v_item_pack::text, 'large_quantity', '1', 'loose_quantity', '0')
  ));
  if (select received_at from public.inventory_receipts where id = v_receipt_id)
    <= (select finalized_at from public.inventory_counts where id = current_setting('test.count_id')::uuid) then
    raise exception 'receipt after finalization did not receive a later cutoff';
  end if;
  perform public.staff_update_inventory_receipt(v_receipt_id, jsonb_build_array(
    jsonb_build_object('item_id', v_item_pack::text, 'large_quantity', '2', 'loose_quantity', '0')
  ), 'Correct next-period receipt');
end $$;
select pass('receipt after the cutoff belongs to the next period and remains editable today');

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '50000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'session_id', '60000000-0000-4000-8000-000000000002',
  'iat', extract(epoch from now())::bigint
)::text, true);
do $$ begin
  begin
    perform public.finalize_inventory_count(current_setting('test.count_id')::uuid);
    raise exception using errcode = 'P0001', message = 'inactive staff unexpectedly finalized a count';
  exception when sqlstate '42501' then null;
  end;
end $$;
select pass('inactive staff cannot finalize through a direct RPC call');

set local role anon;
do $$ begin
  begin
    perform public.finalize_inventory_count(current_setting('test.count_id')::uuid);
    raise exception using errcode = 'P0001', message = 'anonymous user unexpectedly finalized a count';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pass('anonymous users cannot finalize through a direct RPC call');

select * from finish();
rollback;
