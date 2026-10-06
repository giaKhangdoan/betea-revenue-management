begin;
select plan(46);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'purchase-owner@example.test', '{}', '{}'),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'purchase-staff@example.test', '{}', '{}');
insert into public.owner_profiles (user_id) values ('91000000-0000-4000-8000-000000000001');
insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'purchase-staff@example.test', 'Purchase staff', true);
insert into auth.sessions (id, user_id)
values ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002');
select private.seed_inventory_catalog_for_owner('91000000-0000-4000-8000-000000000001');

create function public.owner_purchase_test_fail_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('test.fail_owner_purchase_snapshot', true) = 'on' then
    raise exception using errcode = '22023', message = 'Injected purchase snapshot failure';
  end if;
  return new;
end;
$$;
revoke all on function public.owner_purchase_test_fail_snapshot() from public, anon, authenticated;
create trigger owner_purchase_test_fail_snapshot
before insert on public.inventory_receipt_versions
for each row execute function public.owner_purchase_test_fail_snapshot();

select ok(to_regclass('public.owner_purchase_vouchers') is not null, 'voucher table exists');
select ok(to_regclass('public.owner_purchase_lines') is not null, 'purchase lines table exists');
select ok(to_regclass('public.owner_purchase_events') is not null, 'audit events table exists');
select ok(to_regclass('public.owner_purchase_source_links') is not null, 'daily-expense resolution links table exists');
select ok(to_regclass('public.owner_purchase_stock_links') is not null, 'stock source links table exists');
select ok(to_regclass('public.owner_purchase_reimbursements') is not null, 'reimbursement events table exists');
select ok(to_regclass('public.owner_purchase_profit_postings') is not null, 'profit postings table exists');
select ok(to_regclass('public.owner_purchase_upload_intents') is not null, 'private upload intents table exists');
select ok(to_regclass('public.owner_purchase_evidence') is not null, 'private invoice evidence table exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid = any(array[
  'public.owner_purchase_vouchers'::regclass, 'public.owner_purchase_lines'::regclass,
  'public.owner_purchase_events'::regclass, 'public.owner_purchase_source_links'::regclass,
  'public.owner_purchase_stock_links'::regclass, 'public.owner_purchase_reimbursements'::regclass,
  'public.owner_purchase_profit_postings'::regclass, 'public.owner_purchase_profit_requests'::regclass,
  'public.owner_purchase_upload_intents'::regclass, 'public.owner_purchase_evidence'::regclass
])), 'all owner-purchase tables enable RLS');
select ok((
  select bool_and(not has_table_privilege('authenticated', table_name, privilege_name))
  from unnest(array[
    'public.owner_purchase_vouchers', 'public.owner_purchase_lines', 'public.owner_purchase_events',
    'public.owner_purchase_source_links', 'public.owner_purchase_stock_links',
    'public.owner_purchase_reimbursements', 'public.owner_purchase_profit_postings',
    'public.owner_purchase_profit_requests', 'public.owner_purchase_upload_intents', 'public.owner_purchase_evidence'
  ]) as t(table_name)
  cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as p(privilege_name)
), 'authenticated clients cannot write purchase or evidence tables directly');
select ok(not has_table_privilege('anon', 'public.owner_purchase_evidence', 'SELECT'), 'anon cannot read invoice evidence');
select ok(has_function_privilege('authenticated', 'public.owner_create_purchase_voucher(date,text,bigint,text,jsonb)', 'EXECUTE'), 'authenticated reaches the guarded create RPC');
select ok(has_function_privilege('authenticated', 'public.owner_update_purchase_voucher(uuid,date,text,bigint,text,jsonb,text)', 'EXECUTE'), 'authenticated reaches the guarded update RPC');
select ok(has_function_privilege('authenticated', 'public.owner_cancel_purchase_voucher(uuid,text)', 'EXECUTE'), 'authenticated reaches the guarded cancel RPC');
select ok(has_function_privilege('authenticated', 'public.owner_finalize_purchase_voucher(uuid,uuid,jsonb)', 'EXECUTE'), 'authenticated reaches the guarded finalize RPC');
select ok(has_function_privilege('authenticated', 'public.owner_resolve_purchase_duplicate(uuid,uuid,text,text,uuid,jsonb,uuid)', 'EXECUTE'), 'authenticated reaches the guarded duplicate RPC');
select ok(has_function_privilege('authenticated', 'public.owner_resolve_purchase_duplicates(uuid,jsonb,uuid,jsonb,uuid)', 'EXECUTE'), 'authenticated reaches the guarded batch duplicate RPC');
select ok(has_function_privilege('authenticated', 'public.owner_record_purchase_reimbursement(uuid,text,date,bigint,text,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.owner_purchase_overview_summary(date,date)', 'EXECUTE'), 'authenticated reaches the guarded reimbursement and summary RPCs');
select ok(has_function_privilege('authenticated', 'public.owner_post_purchase_costs(uuid,uuid[],date,uuid)', 'EXECUTE'), 'authenticated reaches the guarded profit RPC');
select ok(has_function_privilege('authenticated', 'public.owner_correct_purchase_voucher(uuid,date,text,bigint,text,jsonb,uuid,jsonb,text)', 'EXECUTE'), 'authenticated reaches the guarded correction RPC');
select ok(has_function_privilege('authenticated', 'public.owner_reverse_purchase_cost_posting(uuid,date,text,uuid)', 'EXECUTE'), 'authenticated reaches the guarded reversal RPC');
select ok(not has_function_privilege('anon', 'public.owner_create_purchase_voucher(date,text,bigint,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.owner_resolve_purchase_duplicates(uuid,jsonb,uuid,jsonb,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.owner_purchase_overview_summary(date,date)', 'EXECUTE')
  and has_function_privilege('authenticated','public.owner_add_daily_expense_after_duplicate_review(date,bigint,text,uuid[],text,uuid)','EXECUTE'),
  'anon cannot execute purchase RPCs; reviewed expense entry is exposed only through the owner-checked RPC');
select ok(not has_table_privilege('authenticated','public.daily_expenses','INSERT')
  and not has_table_privilege('authenticated','public.daily_expenses','UPDATE')
  and not has_table_privilege('authenticated','public.daily_expenses','DELETE'), 'authenticated clients can only mutate daily expenses through guarded RPCs');
select ok(not has_function_privilege('authenticated', 'private.append_owner_purchase_event(uuid,uuid,text,uuid,text,jsonb,jsonb,uuid,uuid)', 'EXECUTE'), 'clients cannot call the private audit append helper');
reset role;
select ok(
  private.inventory_history_snapshot_state_key('receipt','[]'::jsonb) = '[]'::jsonb
  and private.inventory_history_snapshot_state_key('count','[]'::jsonb) is null
  and private.inventory_history_snapshot_state_key('receipt',null::jsonb) is null
  and private.inventory_history_snapshot_state_key('count',null::jsonb) is null
  and private.inventory_history_snapshot_state_key('receipt','[{}]'::jsonb) is null
  and private.inventory_history_snapshot_state_key('count','[{}]'::jsonb) is null,
  'empty receipt is valid while empty, null, and malformed count/receipt snapshots are rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  v_owner constant uuid := '91000000-0000-4000-8000-000000000001';
  v_item uuid := (select id from public.inventory_items where owner_id = v_owner and source_code = '001');
  v_lines jsonb;
  v_voucher uuid;
  v_receipt uuid;
  v_result jsonb;
  v_before bigint;
  v_error_message text;
begin
  v_lines := jsonb_build_array(
    jsonb_build_object('description','Trà nguyên liệu','cost_class','raw_material','inventory_class','stock',
      'inventory_item_id',v_item::text,'large_quantity','1','loose_quantity','0','line_amount_vnd',75000),
    jsonb_build_object('description','Vật dụng','cost_class','non_ingredient','inventory_class','non_stock',
      'unit_snapshot','cái','quantity_snapshot','1','line_amount_vnd',25000),
    jsonb_build_object('description','Dịch vụ chưa báo giá','cost_class','non_ingredient','inventory_class','non_stock',
      'unit_snapshot','lần','quantity_snapshot','1','line_amount_vnd',null)
  );
  begin
    perform public.owner_create_purchase_voucher(private.current_business_date_vn() + 1,'Tương lai',1,null,v_lines);
    raise exception using errcode='P0001',message='future purchase unexpectedly succeeded';
  exception when sqlstate '22023' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message <> 'Purchase date cannot be in the future' then raise exception 'future purchase failed for the wrong reason: %',v_error_message; end if;
  end;
  v_voucher := public.owner_create_purchase_voucher(date '2026-10-05','Nhà cung cấp A',100000,'Phiếu kiểm thử',v_lines);
  perform set_config('test.owner_purchase_voucher_id',v_voucher::text,true);
  if (select status from public.owner_purchase_vouchers where id=v_voucher) <> 'draft'
    or (select count(*) from public.owner_purchase_lines where voucher_id=v_voucher and active) <> 3
    or exists (select 1 from public.owner_purchase_reimbursements where voucher_id=v_voucher)
    or exists (select 1 from public.owner_purchase_profit_postings where voucher_id=v_voucher)
    or (select linked_inventory_receipt_id from public.owner_purchase_vouchers where id=v_voucher) is not null then
    raise exception 'Draft unexpectedly changed inventory, reimbursement, or profit';
  end if;

  v_before := (select count(*) from public.owner_purchase_vouchers);
  begin
    perform public.owner_create_purchase_voucher(date '2026-10-05','Invalid stock',1,null,
      jsonb_build_array(jsonb_build_object('description','Unknown','cost_class','raw_material','inventory_class','stock',
        'inventory_item_id','ffffffff-ffff-4fff-8fff-ffffffffffff','large_quantity','1','loose_quantity','0','line_amount_vnd',1)));
    raise exception using errcode='P0001',message='invalid stock unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.owner_purchase_vouchers) <> v_before then
    raise exception 'Invalid stock line left a partial voucher header';
  end if;
  begin
    perform public.owner_create_purchase_voucher(date '2026-10-05','Zero stock',1,null,
      jsonb_build_array(jsonb_build_object('description','Zero','cost_class','raw_material','inventory_class','stock',
        'inventory_item_id',v_item::text,'large_quantity','0','loose_quantity','0','line_amount_vnd',1)));
    raise exception using errcode='P0001',message='zero-quantity stock unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.owner_purchase_vouchers) <> v_before then
    raise exception 'Zero-quantity stock left a partial voucher header';
  end if;

  v_result := public.owner_finalize_purchase_voucher(v_voucher);
  v_receipt := (v_result->>'inventory_receipt_id')::uuid;
  perform set_config('test.owner_purchase_receipt_id',v_receipt::text,true);
  perform set_config('test.owner_purchase_stock_line_id',(
    select id::text from public.owner_purchase_lines where voucher_id=v_voucher and active and inventory_class='stock'
  ),true);
  if v_receipt is null
    or (select status from public.owner_purchase_vouchers where id=v_voucher) <> 'finalized'
    or (select inventory_receipt_created from public.owner_purchase_vouchers where id=v_voucher) is not true
    or (select count(*) from public.inventory_receipt_lines where receipt_id=v_receipt) <> 1
    or (select count(*) from public.owner_purchase_stock_links where voucher_id=v_voucher) <> 1
    or not exists (select 1 from public.inventory_receipt_versions where receipt_id=v_receipt
      and event_type='receipt_created'
      and lines_snapshot @> jsonb_build_array(jsonb_build_object('purchase_line_id',current_setting('test.owner_purchase_stock_line_id')::uuid))) then
    raise exception 'Finalize failed to atomically create one stock line, source link, and initial snapshot';
  end if;
  if public.owner_finalize_purchase_voucher(v_voucher) is distinct from v_result
    or (select count(*) from public.inventory_receipts where id=v_receipt) <> 1
    or (select count(*) from public.inventory_receipt_versions where receipt_id=v_receipt) <> 1 then
    raise exception 'Exact finalize retry duplicated inventory effects';
  end if;
end $$;
reset role;
select pass('draft is inert; invalid stock rolls back; mixed finalization creates one stock link and initial snapshot; exact replay adds no effects');
select is((select count(*) from public.owner_purchase_lines where voucher_id=current_setting('test.owner_purchase_voucher_id')::uuid and active),3::bigint,'mixed voucher keeps all active lines');
select is((select count(*) from public.inventory_receipt_lines where receipt_id=current_setting('test.owner_purchase_receipt_id')::uuid),1::bigint,'non-stock service lines do not affect inventory');
select is((select count(*) from public.owner_purchase_events where voucher_id=current_setting('test.owner_purchase_voucher_id')::uuid and event_type='voucher_finalized'),1::bigint,'finalize appends one audit event');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_voucher uuid:=current_setting('test.owner_purchase_voucher_id')::uuid;
  v_first uuid;
  v_result jsonb;
  v_posting uuid;
  v_reversal uuid;
  v_lines jsonb;
  v_error_message text;
begin
  v_result:=public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-05',40000,'Hoàn một phần','93000000-0000-4000-8000-000000000001',null);
  v_first:=(v_result->>'event_id')::uuid;
  if public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-05',40000,'Hoàn một phần','93000000-0000-4000-8000-000000000001',null) is distinct from v_result
    or (select count(*) from public.owner_purchase_reimbursements where voucher_id=v_voucher)<>1 then raise exception 'refund replay duplicated the event'; end if;
  begin
    perform public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-05',40000,'Khác','93000000-0000-4000-8000-000000000001',null);
    raise exception using errcode='P0001',message='changed replay unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-04',1,'Trước ngày mua','93000000-0000-4000-8000-000000000006',null);
    raise exception using errcode='P0001',message='pre-purchase reimbursement unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.owner_record_purchase_reimbursement(v_voucher,'payment',private.current_business_date_vn() + 1,1,'Ngày tương lai','93000000-0000-4000-8000-000000000007',null);
    raise exception using errcode='P0001',message='future reimbursement unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-06',60001,'Vượt tổng','93000000-0000-4000-8000-000000000002',null);
    raise exception using errcode='P0001',message='over-limit refund unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
  perform public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-06',60000,'Hoàn phần còn lại','93000000-0000-4000-8000-000000000003',null);
  begin
    perform public.owner_record_purchase_reimbursement(v_voucher,'payment',date '2026-10-06',1,'Vượt một đồng','93000000-0000-4000-8000-000000000004',null);
    raise exception using errcode='P0001',message='payment above invoice unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
  perform public.owner_record_purchase_reimbursement(v_voucher,'reversal',date '2026-10-06',10000,'Điều chỉnh','93000000-0000-4000-8000-000000000005',v_first);
  begin
    perform public.owner_record_purchase_reimbursement(v_voucher,'reversal',date '2026-10-04',1000,'Trước lần hoàn','93000000-0000-4000-8000-000000000008',v_first);
    raise exception using errcode='P0001',message='reversal before original payment unexpectedly succeeded';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from public.owner_purchase_reimbursements where voucher_id=v_voucher)<>3
    or not exists(select 1 from public.owner_purchase_reimbursements where id=v_first and event_type='payment')
    or not exists(select 1 from public.owner_purchase_reimbursements where reverses_event_id=v_first and event_type='reversal' and amount_vnd=10000)
    then raise exception 'reversal did not append an event or preserve the original payment'; end if;

  v_result:=public.owner_post_purchase_costs(v_voucher,null,date '2026-10-01','94000000-0000-4000-8000-000000000001');
  if jsonb_array_length(v_result->'posted')<>1 or jsonb_array_length(v_result->'skipped')<>1
    or (v_result->'posted'->0->>'amount_vnd')::bigint<>25000
    or (select count(*) from public.owner_purchase_profit_postings where voucher_id=v_voucher and posting_type='post')<>1
    then raise exception 'all-eligible posting did not include only priced non-ingredient lines'; end if;
  v_posting:=(v_result->'posted'->0->>'posting_id')::uuid;
  if public.owner_post_purchase_costs(v_voucher,null,date '2026-10-01','94000000-0000-4000-8000-000000000001') is distinct from v_result then
    raise exception 'profit-post replay did not return the stored result'; end if;
  begin
    perform public.owner_post_purchase_costs(v_voucher,array[(select id from public.owner_purchase_lines where voucher_id=v_voucher and active and cost_class='raw_material' limit 1)],date '2026-10-01','94000000-0000-4000-8000-000000000002');
    raise exception using errcode='P0001',message='raw material unexpectedly eligible';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.owner_post_purchase_costs(v_voucher,array[(select id from public.owner_purchase_lines where voucher_id=v_voucher and active and line_amount_vnd=25000 limit 1)],date '2026-10-01','94000000-0000-4000-8000-000000000003');
    raise exception using errcode='P0001',message='already-posted line unexpectedly posted twice';
  exception when sqlstate '22023' then null; end;
  v_reversal:=public.owner_reverse_purchase_cost_posting(v_posting,date '2026-10-01','Đảo bút toán','94000000-0000-4000-8000-000000000004');
  if (select count(*) from public.owner_purchase_profit_postings where source_line_id=(select source_line_id from public.owner_purchase_profit_postings where id=v_posting))<>2
    or not exists(select 1 from public.owner_purchase_profit_postings where id=v_reversal and posting_type='reversal' and reverses_posting_id=v_posting)
    or public.owner_reverse_purchase_cost_posting(v_posting,date '2026-10-01','Đảo bút toán','94000000-0000-4000-8000-000000000004')<>v_reversal
    then raise exception 'profit reversal was not append-only and idempotent'; end if;

  select jsonb_agg(case when inventory_class='stock' then jsonb_build_object(
    'line_id',id,'description',description,'cost_class',cost_class,'inventory_class',inventory_class,
    'inventory_item_id',inventory_item_id::text,'large_quantity',trunc(large_quantity)::text,
    'loose_quantity',loose_quantity::text,'line_amount_vnd',line_amount_vnd
  ) else jsonb_build_object('line_id',id,'description',description,'cost_class',cost_class,
    'inventory_class',inventory_class,'unit_snapshot',unit_snapshot,'quantity_snapshot',quantity_snapshot::text,
    'line_amount_vnd',line_amount_vnd) end order by line_number) into v_lines
  from public.owner_purchase_lines where voucher_id=v_voucher and active;
  begin
    perform public.owner_correct_purchase_voucher(v_voucher,date '2026-10-06','Nhà cung cấp A',100000,
      'Đã đối chiếu',v_lines,null,'[]'::jsonb,'Không chuyển ngày mua qua ngày đã hoàn tiền');
    raise exception using errcode='P0001',message='correction moved purchase past an existing reimbursement';
  exception when sqlstate '22023' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message <> 'Purchase date cannot move past a reimbursement event' then raise exception 'purchase correction failed for the wrong reason: %',v_error_message; end if;
  end;
  perform public.owner_correct_purchase_voucher(v_voucher,date '2026-10-05','Nhà cung cấp A',100000,
    'Đã đối chiếu',v_lines,null,'[]'::jsonb,'Giữ nguyên liên kết và xác nhận số lượng');
  if not exists(select 1 from public.owner_purchase_stock_links where voucher_id=v_voucher and purchase_line_id=current_setting('test.owner_purchase_stock_line_id')::uuid)
    or not exists(select 1 from public.inventory_receipt_corrections where receipt_id=current_setting('test.owner_purchase_receipt_id')::uuid
      and reason='Giữ nguyên liên kết và xác nhận số lượng'
      and prior_lines @> jsonb_build_array(jsonb_build_object('purchase_line_id',current_setting('test.owner_purchase_stock_line_id')::uuid)))
    or not exists(select 1 from public.inventory_receipt_versions where receipt_id=current_setting('test.owner_purchase_receipt_id')::uuid
      and event_type='receipt_corrected' and reason='Giữ nguyên liên kết và xác nhận số lượng'
      and lines_snapshot @> jsonb_build_array(jsonb_build_object('purchase_line_id',current_setting('test.owner_purchase_stock_line_id')::uuid)))
    then raise exception 'correction lost its purchase-line linkage or audit snapshot'; end if;
end $$;
select is(
  jsonb_build_array(
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-05')->>'month_advanced_vnd')::bigint,
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-05')->>'month_reimbursed_vnd')::bigint,
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-05')->>'month_outstanding_vnd')::bigint,
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-05')->>'current_outstanding_vnd')::bigint
  ),
  jsonb_build_array(100000,40000,60000,60000),
  'an earlier cutoff excludes later reimbursement and reversal events'
);
select is(
  jsonb_build_array(
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-06')->>'month_advanced_vnd')::bigint,
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-06')->>'month_reimbursed_vnd')::bigint,
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-06')->>'month_outstanding_vnd')::bigint,
    (public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-06')->>'current_outstanding_vnd')::bigint,
    public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-06')->>'month_cutoff_date'
  ),
  jsonb_build_array(100000,90000,10000,10000,'2026-10-06'),
  'purchase cohort and current balance include only reimbursement events through the requested cutoff'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok(
  $$select public.owner_purchase_overview_summary(date '2026-10-01', date '2026-10-06')$$,
  '42501', null, 'staff cannot read the owner purchase overview summary'
);
reset role;
select pass('refund partial/replay/over-limit rules, raw-material exclusion, priced versus unpriced posting, append-only reversal, and stable stock correction are enforced');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_voucher uuid:=current_setting('test.owner_purchase_voucher_id')::uuid;
  v_receipt uuid:=current_setting('test.owner_purchase_receipt_id')::uuid;
  v_stock_line uuid:=current_setting('test.owner_purchase_stock_line_id')::uuid;
  v_item uuid:=(select inventory_item_id from public.owner_purchase_lines where id=v_stock_line);
  v_lines jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'line_id',id,'description',description,'cost_class',cost_class,'inventory_class','non_stock',
    'unit_snapshot',unit_snapshot,'quantity_snapshot',quantity_snapshot::text,'line_amount_vnd',line_amount_vnd
  ) order by line_number) into v_lines
  from public.owner_purchase_lines where voucher_id=v_voucher and active and inventory_class='non_stock';
  perform public.owner_correct_purchase_voucher(v_voucher,date '2026-10-05','Nhà cung cấp A',100000,
    'Đã đối chiếu',v_lines,null,'[]'::jsonb,'Bỏ toàn bộ dòng tồn kho của phiếu');
  if (select count(*) from public.inventory_receipt_lines where receipt_id=v_receipt)<>0
    or (select count(*) from public.owner_purchase_stock_links where voucher_id=v_voucher)<>0
    or not exists(select 1 from public.inventory_receipt_versions where receipt_id=v_receipt
      and sequence_no=(select max(sequence_no) from public.inventory_receipt_versions where receipt_id=v_receipt)
      and event_type='receipt_corrected' and lines_snapshot='[]'::jsonb)
    or not exists(select 1 from public.inventory_receipt_corrections where receipt_id=v_receipt
      and reason='Bỏ toàn bộ dòng tồn kho của phiếu'
      and prior_lines @> jsonb_build_array(jsonb_build_object('purchase_line_id',v_stock_line))) then
    raise exception 'Removing all voucher stock inserted a placeholder or missed the empty before/after snapshots';
  end if;

  v_lines:=jsonb_build_array(jsonb_build_object(
    'line_id',v_stock_line,'description','Trà nguyên liệu','cost_class','raw_material','inventory_class','stock',
    'inventory_item_id',v_item::text,'large_quantity','1','loose_quantity','0','line_amount_vnd',75000
  )) || coalesce((
    select jsonb_agg(jsonb_build_object(
      'line_id',id,'description',description,'cost_class',cost_class,'inventory_class','non_stock',
      'unit_snapshot',unit_snapshot,'quantity_snapshot',quantity_snapshot::text,'line_amount_vnd',line_amount_vnd
    ) order by line_number)
    from public.owner_purchase_lines where voucher_id=v_voucher and active and inventory_class='non_stock'
  ),'[]'::jsonb);
  perform public.owner_correct_purchase_voucher(v_voucher,date '2026-10-05','Nhà cung cấp A',100000,
    'Đã đối chiếu',v_lines,null,'[]'::jsonb,'Khôi phục dòng tồn kho đã xác minh');
  if (select count(*) from public.inventory_receipt_lines where receipt_id=v_receipt)<>1
    or (select count(*) from public.owner_purchase_stock_links where voucher_id=v_voucher)<>1
    or not exists(select 1 from public.inventory_receipt_versions where receipt_id=v_receipt
      and sequence_no=(select max(sequence_no) from public.inventory_receipt_versions where receipt_id=v_receipt)
      and event_type='receipt_corrected' and lines_snapshot @> jsonb_build_array(jsonb_build_object(
        'purchase_line_id',v_stock_line,'converted_quantity','1000.000')))
    or not exists(select 1 from public.inventory_receipt_corrections where receipt_id=v_receipt
      and reason='Khôi phục dòng tồn kho đã xác minh' and prior_lines='[]'::jsonb) then
    raise exception 'Restoring stock from an empty receipt did not create a valid nonempty correction state (receipt lines %, voucher links %, latest snapshot %, latest prior %) ',
      (select count(*) from public.inventory_receipt_lines where receipt_id=v_receipt),
      (select count(*) from public.owner_purchase_stock_links where voucher_id=v_voucher),
      (select lines_snapshot from public.inventory_receipt_versions where receipt_id=v_receipt order by sequence_no desc limit 1),
      (select prior_lines from public.inventory_receipt_corrections where receipt_id=v_receipt order by corrected_at desc, id desc limit 1);
  end if;
end $$;
reset role;
do $$
begin
  if private.inventory_receipt_correction_history_problem(
    '91000000-0000-4000-8000-000000000001',
    current_setting('test.owner_purchase_receipt_id')::uuid
  ) is not null then
    raise exception 'Phase 01 correction checker rejected a valid empty-to-nonempty correction chain';
  end if;
end $$;
select pass('voucher-created receipt can be emptied without a placeholder and restored; the Phase 01 checker accepts the valid empty-to-nonempty timeline');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','91000000-0000-4000-8000-000000000002',
  'role','authenticated',
  'session_id','92000000-0000-4000-8000-000000000002',
  'iat',extract(epoch from now())::bigint
)::text,true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_tea uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='018');
  v_today date:=private.current_business_date_vn();
  v_expense uuid;
  v_shop_expense uuid;
  v_other_expense uuid;
  v_failed_expense uuid;
  v_receipt uuid;
  v_shared_receipt uuid;
begin
  if (select count(*) from public.owner_purchase_vouchers)<>0 or (select count(*) from public.owner_purchase_lines)<>0
    or (select count(*) from public.owner_purchase_events)<>0 or (select count(*) from public.owner_purchase_source_links)<>0
    or (select count(*) from public.owner_purchase_stock_links)<>0 or (select count(*) from public.owner_purchase_reimbursements)<>0
    or (select count(*) from public.owner_purchase_profit_postings)<>0 or (select count(*) from public.owner_purchase_upload_intents)<>0
    or (select count(*) from public.owner_purchase_evidence)<>0 then raise exception 'staff read owner-only purchase/evidence rows'; end if;
  v_receipt:=public.staff_create_inventory_receipt(jsonb_build_array(jsonb_build_object('item_id',v_item::text,'large_quantity','1','loose_quantity','0')));
  perform set_config('test.staff_receipt_id',v_receipt::text,true);
  perform set_config('test.staff_receipt_line_id',(select id::text from public.inventory_receipt_lines where receipt_id=v_receipt),true);
  v_expense:=public.staff_add_incidental_expense(v_today,36000,'Đường');
  perform set_config('test.staff_personal_expense_id',v_expense::text,true);
  v_shop_expense:=public.staff_add_incidental_expense(v_today,50000,'Sửa chữa');
  perform set_config('test.staff_shop_expense_id',v_shop_expense::text,true);
  v_other_expense:=public.staff_add_incidental_expense(v_today,22000,'Khoản phát sinh khác');
  perform set_config('test.staff_other_expense_id',v_other_expense::text,true);
  v_failed_expense:=public.staff_add_incidental_expense(v_today,15000,'Đường');
  perform set_config('test.staff_failed_expense_id',v_failed_expense::text,true);
  v_shared_receipt:=public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id',v_item::text,'large_quantity','2','loose_quantity','0'),
    jsonb_build_object('item_id',v_tea::text,'large_quantity','1','loose_quantity','0')
  ));
  perform set_config('test.shared_receipt_id',v_shared_receipt::text,true);
  perform set_config('test.shared_sugar_line_id',(select id::text from public.inventory_receipt_lines where receipt_id=v_shared_receipt and item_id=v_item),true);
  perform set_config('test.shared_tea_line_id',(select id::text from public.inventory_receipt_lines where receipt_id=v_shared_receipt and item_id=v_tea),true);
  begin perform public.owner_create_purchase_voucher(date '2026-10-06','Staff',1,null,'[]'::jsonb); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_update_purchase_voucher(null,null,null,null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_cancel_purchase_voucher(null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_finalize_purchase_voucher(null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_resolve_purchase_duplicate(null,null,null,null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_record_purchase_reimbursement(null,null,null,null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_post_purchase_costs(null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_correct_purchase_voucher(null,null,null,null,null,null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_reverse_purchase_cost_posting(null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
  begin perform public.owner_add_daily_expense_after_duplicate_review(null,null,null,null,null,null); raise exception using errcode='P0001'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pass('staff sees no owner advances or evidence, retains permitted shop-funded entry, and cannot invoke any owner financial RPC');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_today date:=private.current_business_date_vn();
  v_expense uuid:=current_setting('test.staff_personal_expense_id')::uuid;
  v_unrelated uuid:=current_setting('test.staff_failed_expense_id')::uuid;
  v_item uuid:=(select id from public.inventory_items where owner_id='91000000-0000-4000-8000-000000000001' and source_code='001');
  v_voucher uuid;
  v_before_receipts bigint:=(select count(*) from public.inventory_receipts);
begin
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Đường',36000,null,jsonb_build_array(jsonb_build_object(
    'description','Đường','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',36000)));
  begin
    perform public.owner_finalize_purchase_voucher(v_voucher,null,'[]'::jsonb);
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  if (select status from public.owner_purchase_vouchers where id=v_voucher)<>'draft'
    or (select count(*) from public.inventory_receipts)<>v_before_receipts then
    raise exception 'Direct finalization bypassed unresolved expense review';
  end if;
  begin
    perform public.owner_resolve_purchase_duplicate(v_voucher,v_unrelated,'personal_paid','Đối chiếu nhầm',null,'[]'::jsonb,
      '95000000-0000-4000-8000-000000000099');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' or sqlstate '40001' then null; end;
  if (select deleted_at is not null from public.daily_expenses where id=v_unrelated)
    or (select status from public.owner_purchase_vouchers where id=v_voucher)<>'draft'
    or not exists(select 1 from public.daily_expenses where id=v_expense and deleted_at is null) then
    raise exception 'An unrelated daily expense was changed during failed duplicate resolution';
  end if;
end $$;
reset role;
select pass('database blocks direct finalization with unresolved matches and refuses to soft-delete a same-day but nonmatching expense');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_expense uuid:=current_setting('test.staff_personal_expense_id')::uuid;
  v_receipt uuid:=current_setting('test.staff_receipt_id')::uuid;
  v_receipt_line uuid:=current_setting('test.staff_receipt_line_id')::uuid;
  v_today date:=private.current_business_date_vn();
  v_voucher uuid;
  v_line uuid;
  v_result jsonb;
  v_receipts_before bigint;
begin
  v_receipts_before:=(select count(*) from public.inventory_receipts);
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Vật liệu cùng giao dịch',36000,null,jsonb_build_array(jsonb_build_object(
    'description','Đường','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',36000)));
  v_line:=(select id from public.owner_purchase_lines where voucher_id=v_voucher and active);
  v_result:=public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'personal_paid','Tôi đã trả bằng tiền cá nhân',v_receipt,
    jsonb_build_array(jsonb_build_object('purchase_line_id',v_line,'receipt_line_id',v_receipt_line)),'95000000-0000-4000-8000-000000000001');
  if (select status from public.owner_purchase_vouchers where id=v_voucher)<>'finalized'
    or (select deleted_at is null from public.daily_expenses where id=v_expense)
    or (select count(*) from public.owner_purchase_source_links where daily_expense_id=v_expense and resolution='personal_paid')<>1
    or (select count(*) from public.inventory_receipts)<>v_receipts_before
    or not exists(select 1 from public.owner_purchase_stock_links where voucher_id=v_voucher and receipt_id=v_receipt and receipt_line_id=v_receipt_line)
    or not exists(select 1 from public.owner_purchase_source_links where daily_expense_id=v_expense and before_state->>'amount_vnd'='36000')
    then raise exception 'personal-paid resolution did not reuse stock and reclassify exactly once'; end if;
  if public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'personal_paid','Tôi đã trả bằng tiền cá nhân',v_receipt,
      jsonb_build_array(jsonb_build_object('purchase_line_id',v_line,'receipt_line_id',v_receipt_line)),'95000000-0000-4000-8000-000000000001') is distinct from v_result
    or (select count(*) from public.owner_purchase_source_links where daily_expense_id=v_expense)<>1 then raise exception 'duplicate retry was not idempotent'; end if;
  begin
    perform public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'personal_paid','Khác lý do',v_receipt,
      jsonb_build_array(jsonb_build_object('purchase_line_id',v_line,'receipt_line_id',v_receipt_line)),'95000000-0000-4000-8000-000000000001');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.owner_correct_purchase_voucher(v_voucher,v_today,'Vật liệu cùng giao dịch',36000,null,
      jsonb_build_array(jsonb_build_object('line_id',v_line,'description','Đường','cost_class','raw_material','inventory_class','stock',
        'inventory_item_id',v_item::text,'large_quantity','2','loose_quantity','0','line_amount_vnd',36000)),
      v_receipt,jsonb_build_array(jsonb_build_object('purchase_line_id',v_line,'receipt_line_id',v_receipt_line)),'Không sửa receipt đã được nhập chung');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  if not exists(select 1 from public.inventory_receipt_lines where id=v_receipt_line and converted_quantity=1000)
    or (select count(*) from public.owner_purchase_stock_links where receipt_line_id=v_receipt_line)<>1 then raise exception 'rejected shared receipt edit changed stock links'; end if;
end $$;
reset role;
select pass('personal-paid duplicate reuses a matching existing receipt, preserves the source audit, and rejects replay changes and shared-stock edits');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_today date:=private.current_business_date_vn();
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_tea uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='018');
  v_receipt uuid:=current_setting('test.shared_receipt_id')::uuid;
  v_sugar_receipt_line uuid:=current_setting('test.shared_sugar_line_id')::uuid;
  v_tea_receipt_line uuid:=current_setting('test.shared_tea_line_id')::uuid;
  v_sugar_voucher uuid;
  v_tea_voucher uuid;
  v_sugar_purchase_line uuid;
  v_tea_purchase_line uuid;
  v_tea_link_id uuid;
  v_correction_lines jsonb;
begin
  v_sugar_voucher:=public.owner_create_purchase_voucher(v_today,'Shared receipt sugar',50000,null,jsonb_build_array(jsonb_build_object(
    'description','Đường','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','2','loose_quantity','0','line_amount_vnd',50000)));
  v_sugar_purchase_line:=(select id from public.owner_purchase_lines where voucher_id=v_sugar_voucher and active);
  perform public.owner_finalize_purchase_voucher(v_sugar_voucher,v_receipt,jsonb_build_array(jsonb_build_object(
    'purchase_line_id',v_sugar_purchase_line,'receipt_line_id',v_sugar_receipt_line)));

  v_tea_voucher:=public.owner_create_purchase_voucher(v_today,'Shared receipt tea',80000,null,jsonb_build_array(jsonb_build_object(
    'description','Hồng trà','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_tea::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',80000)));
  v_tea_purchase_line:=(select id from public.owner_purchase_lines where voucher_id=v_tea_voucher and active);
  perform public.owner_finalize_purchase_voucher(v_tea_voucher,v_receipt,jsonb_build_array(jsonb_build_object(
    'purchase_line_id',v_tea_purchase_line,'receipt_line_id',v_tea_receipt_line)));
  select id into v_tea_link_id from public.owner_purchase_stock_links
  where voucher_id=v_tea_voucher and purchase_line_id=v_tea_purchase_line;

  v_correction_lines:=jsonb_build_array(jsonb_build_object(
    'line_id',v_sugar_purchase_line,'description','Đường','cost_class','raw_material','inventory_class','stock',
    'inventory_item_id',v_item::text,'large_quantity','3','loose_quantity','0','line_amount_vnd',50000));
  perform public.owner_correct_purchase_voucher(v_sugar_voucher,v_today,'Shared receipt sugar',50000,null,
    v_correction_lines,v_receipt,'[]'::jsonb,'Sửa riêng dòng đường của phiếu');

  if (select count(*) from public.inventory_receipt_lines where receipt_id=v_receipt)<>2
    or not exists(select 1 from public.inventory_receipt_lines where id=v_sugar_receipt_line and converted_quantity=3000)
    or not exists(select 1 from public.inventory_receipt_lines where id=v_tea_receipt_line and converted_quantity=500)
    or not exists(select 1 from public.owner_purchase_stock_links where id=v_tea_link_id and voucher_id=v_tea_voucher
      and purchase_line_id=v_tea_purchase_line and receipt_line_id=v_tea_receipt_line)
    or not exists(select 1 from public.inventory_receipt_corrections where receipt_id=v_receipt
      and reason='Sửa riêng dòng đường của phiếu'
      and prior_lines @> jsonb_build_array(
        jsonb_build_object('id',v_sugar_receipt_line,'source_voucher_id',v_sugar_voucher,'purchase_line_id',v_sugar_purchase_line,'converted_quantity','2000.000'),
        jsonb_build_object('id',v_tea_receipt_line,'source_voucher_id',v_tea_voucher,'purchase_line_id',v_tea_purchase_line,'converted_quantity','500.000')
      ))
    or not exists(select 1 from public.inventory_receipt_versions where receipt_id=v_receipt and event_type='receipt_corrected'
      and sequence_no=(select max(sequence_no) from public.inventory_receipt_versions where receipt_id=v_receipt)
      and lines_snapshot @> jsonb_build_array(
        jsonb_build_object('id',v_sugar_receipt_line,'purchase_line_id',v_sugar_purchase_line,'converted_quantity','3000.000'),
        jsonb_build_object('id',v_tea_receipt_line,'purchase_line_id',v_tea_purchase_line,'converted_quantity','500.000')
      )) then
    raise exception 'Shared receipt correction changed an unrelated line/link or omitted full prior/after snapshots; prior %, latest version %, current lines %',
      coalesce((select prior_lines from public.inventory_receipt_corrections
        where receipt_id=v_receipt and reason='Sửa riêng dòng đường của phiếu'
        order by corrected_at desc, id desc limit 1), '[]'::jsonb),
      coalesce((select lines_snapshot from public.inventory_receipt_versions
        where receipt_id=v_receipt and event_type='receipt_corrected'
          and reason='Sửa riêng dòng đường của phiếu'
        order by sequence_no desc limit 1), '[]'::jsonb),
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',line.id,'item_id',line.item_id,'line_number',line.line_number,
        'converted_quantity',line.converted_quantity
      ) order by line.line_number, line.id)
        from public.inventory_receipt_lines as line where line.receipt_id=v_receipt), '[]'::jsonb);
  end if;
end $$;
reset role;
select pass('shared receipt correction changes only the voucher-linked row and preserves unrelated receipt lines, IDs, another voucher link, and full before/after snapshots');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_today date:=private.current_business_date_vn();
  v_expense uuid:=current_setting('test.staff_shop_expense_id')::uuid;
  v_voucher uuid;
  v_other_expense uuid:=current_setting('test.staff_other_expense_id')::uuid;
  v_other_voucher uuid;
  v_shop_result jsonb;
  v_diff_result jsonb;
  v_receipts_before bigint;
  v_lines jsonb:=jsonb_build_array(jsonb_build_object('description','Sửa chữa','cost_class','non_ingredient',
    'inventory_class','non_stock','unit_snapshot','lần','quantity_snapshot','1','line_amount_vnd',50000));
  v_item uuid:=(select id from public.inventory_items where owner_id='91000000-0000-4000-8000-000000000001' and source_code='001');
  v_candidate_receipt uuid;
  v_candidate_receipt_line uuid;
  v_before_receipts bigint;
  v_other_line uuid;
begin
  v_receipts_before:=(select count(*) from public.inventory_receipts);
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Sửa chữa',50000,null,v_lines);
  begin perform public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'shop_cash','',null,'[]'::jsonb,'96000000-0000-4000-8000-000000000001'); raise exception using errcode='P0001'; exception when sqlstate '22023' then null; end;
  v_shop_result:=public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'shop_cash','Đã ghi chi phí trong ngày',null,'[]'::jsonb,'96000000-0000-4000-8000-000000000001');
  if (select status from public.owner_purchase_vouchers where id=v_voucher)<>'canceled'
    or (select deleted_at is not null from public.daily_expenses where id=v_expense)
    or exists(select 1 from public.owner_purchase_stock_links where voucher_id=v_voucher)
    or (select linked_inventory_receipt_id from public.owner_purchase_vouchers where id=v_voucher) is not null
    or (select count(*) from public.inventory_receipts)<>v_receipts_before
    or public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'shop_cash','Đã ghi chi phí trong ngày',null,'[]'::jsonb,'96000000-0000-4000-8000-000000000001') is distinct from v_shop_result
    then raise exception 'shop-cash decision did not keep the expense, cancel the voucher, and replay safely'; end if;

  -- This separate purchase has an existing matching stock receipt candidate.
  perform set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','91000000-0000-4000-8000-000000000002','role','authenticated',
    'session_id','92000000-0000-4000-8000-000000000002','iat',extract(epoch from now())::bigint
  )::text,true);
  v_candidate_receipt:=public.staff_create_inventory_receipt(jsonb_build_array(
    jsonb_build_object('item_id',v_item::text,'large_quantity','1','loose_quantity','0')));
  select id into v_candidate_receipt_line from public.inventory_receipt_lines
  where receipt_id=v_candidate_receipt and item_id=v_item;
  perform set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  v_before_receipts:=(select count(*) from public.inventory_receipts);
  v_other_voucher:=public.owner_create_purchase_voucher(v_today,'Nhà cung cấp khác',70000,null,jsonb_build_array(jsonb_build_object(
    'description','Khoản phát sinh khác','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',22000)));
  v_other_line:=(select id from public.owner_purchase_lines where voucher_id=v_other_voucher and active);
  begin
    perform public.owner_resolve_purchase_duplicate(v_other_voucher,v_other_expense,'different_purchase','',null,'[]'::jsonb,'96000000-0000-4000-8000-000000000003');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  v_diff_result:=public.owner_resolve_purchase_duplicate(v_other_voucher,v_other_expense,'different_purchase','Đây là giao dịch khác',v_candidate_receipt,
    jsonb_build_array(jsonb_build_object('purchase_line_id',v_other_line,'receipt_line_id',v_candidate_receipt_line)),'96000000-0000-4000-8000-000000000002');
  if (select status from public.owner_purchase_vouchers where id=v_other_voucher)<>'finalized'
    or (select deleted_at is not null from public.daily_expenses where id=v_other_expense)
    or not exists(select 1 from public.owner_purchase_source_links where daily_expense_id=v_other_expense and resolution='different_purchase')
    or public.owner_resolve_purchase_duplicate(v_other_voucher,v_other_expense,'different_purchase','Đây là giao dịch khác',v_candidate_receipt,
      jsonb_build_array(jsonb_build_object('purchase_line_id',v_other_line,'receipt_line_id',v_candidate_receipt_line)),'96000000-0000-4000-8000-000000000002') is distinct from v_diff_result
    or (select count(*) from public.inventory_receipts)<>v_before_receipts+1
    or (select linked_inventory_receipt_id from public.owner_purchase_vouchers where id=v_other_voucher)=v_candidate_receipt
    or exists(select 1 from public.owner_purchase_stock_links where receipt_id=v_candidate_receipt and receipt_line_id=v_candidate_receipt_line)
    then raise exception 'different-purchase decision did not retain expense and replay safely'; end if;
end $$;
reset role;
select pass('shop-cash requires a reason and retains its active expense; different-purchase creates a new stock receipt, retains expense, and supports exact replay');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_today date:=private.current_business_date_vn();
  v_item uuid:=(select id from public.inventory_items where owner_id='91000000-0000-4000-8000-000000000001' and source_code='001');
  v_personal_expense uuid;
  v_separate_expense uuid;
  v_voucher uuid;
  v_result jsonb;
  v_receipts_before bigint;
begin
  v_personal_expense:=public.owner_add_daily_expense(v_today,218731,'Batch evidence xanthan');
  v_separate_expense:=public.owner_add_daily_expense(v_today,218731,'Batch evidence xanthan');
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Batch evidence xanthan',218731,null,jsonb_build_array(jsonb_build_object(
    'description','Batch evidence xanthan','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',218731)));
  v_receipts_before:=(select count(*) from public.inventory_receipts);
  v_result:=public.owner_resolve_purchase_duplicates(v_voucher,jsonb_build_array(
    jsonb_build_object('daily_expense_id',v_personal_expense,'resolution','personal_paid','reason','Admin tự trả khoản này'),
    jsonb_build_object('daily_expense_id',v_separate_expense,'resolution','different_purchase','reason','Khoản này thuộc hóa đơn khác')
  ),null,'[]'::jsonb,'97000000-0000-4000-8000-000000000099');
  if (select status from public.owner_purchase_vouchers where id=v_voucher)<>'finalized'
    or (select deleted_at is null from public.daily_expenses where id=v_personal_expense)
    or (select deleted_at is not null from public.daily_expenses where id=v_separate_expense)
    or (select count(*) from public.owner_purchase_source_links where voucher_id=v_voucher)<>2
    or not exists(select 1 from public.owner_purchase_source_links where voucher_id=v_voucher
      and daily_expense_id=v_personal_expense and resolution='personal_paid')
    or not exists(select 1 from public.owner_purchase_source_links where voucher_id=v_voucher
      and daily_expense_id=v_separate_expense and resolution='different_purchase')
    or (select count(*) from public.inventory_receipts)<>v_receipts_before+1
    or public.owner_resolve_purchase_duplicates(v_voucher,jsonb_build_array(
      jsonb_build_object('daily_expense_id',v_personal_expense,'resolution','personal_paid','reason','Admin tự trả khoản này'),
      jsonb_build_object('daily_expense_id',v_separate_expense,'resolution','different_purchase','reason','Khoản này thuộc hóa đơn khác')
    ),null,'[]'::jsonb,'97000000-0000-4000-8000-000000000099') is distinct from v_result then
    raise exception 'Batch review failed to record one action per candidate and finalize exactly once';
  end if;
end $$;
reset role;
select pass('batch duplicate resolution requires and audits a decision for every current match, supports false positives, and replays idempotently');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_today date:=private.current_business_date_vn();
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_voucher uuid;
begin
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Fresh Tea Box',87654,null,jsonb_build_array(jsonb_build_object(
    'description','Fresh Tea Box','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',87654)));
  perform public.owner_finalize_purchase_voucher(v_voucher);
  perform set_config('test.late_voucher',v_voucher::text,true);
  begin
    perform public.owner_add_daily_expense(v_today,87654,'Fresh Tea Box');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  if exists(select 1 from public.daily_expenses where owner_id=v_owner and business_date=v_today
    and amount_vnd=87654 and reason='Fresh Tea Box' and deleted_at is null) then
    raise exception 'Owner expense insert after finalization bypassed duplicate protection';
  end if;

end $$;
reset role;

do $$
declare
  v_voucher uuid:=current_setting('test.late_voucher')::uuid;
  v_legacy_expense uuid;
begin
  -- Seed a legacy row to prove staff cannot hide an already-matching finalized
  -- expense by soft-deleting it through the supported RPC.
  insert into public.daily_records(owner_id,business_date)
  select owner_id,purchase_date from public.owner_purchase_vouchers where id=v_voucher
  on conflict (owner_id,business_date) do nothing;
  insert into public.daily_expenses(owner_id,business_date,amount_vnd,reason)
  select owner_id,purchase_date,87654,'Fresh Tea Box'
  from public.owner_purchase_vouchers where id=v_voucher
  returning id into v_legacy_expense;
  perform set_config('test.legacy_matching_expense',v_legacy_expense::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','91000000-0000-4000-8000-000000000002',
  'role','authenticated',
  'session_id','92000000-0000-4000-8000-000000000002',
  'iat',extract(epoch from now())::bigint
)::text,true);

do $$
declare
  v_today date:=private.current_business_date_vn();
  v_legacy_expense uuid:=current_setting('test.legacy_matching_expense')::uuid;
  v_staff_expense uuid;
begin
  v_staff_expense:=public.staff_add_incidental_expense(v_today,12345,'Phát sinh khác');
  begin
    perform public.staff_update_incidental_expense(v_staff_expense,87654,'Fresh Tea Box');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  if (select amount_vnd from public.daily_expenses where id=v_staff_expense)<>12345
    or (select reason from public.daily_expenses where id=v_staff_expense)<>'Phát sinh khác' then
    raise exception 'Staff edit to a finalized-purchase match was not rolled back';
  end if;
  begin
    perform public.staff_delete_incidental_expense(v_legacy_expense);
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  if (select deleted_at from public.daily_expenses where id=v_legacy_expense) is not null then
    raise exception 'Staff deleted an expense that matches a finalized purchase';
  end if;
end $$;
reset role;
select pass('owner/staff expense inserts and edits cannot race or create duplicates after finalization, and matched rows cannot be deleted');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_today date:=private.current_business_date_vn();
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_first uuid;
  v_second uuid;
  v_voucher_ids uuid[];
  v_result jsonb;
  v_expenses_before bigint;
begin
  v_first:=public.owner_create_purchase_voucher(v_today,'Supplier one',543216,null,jsonb_build_array(jsonb_build_object(
    'description','Shop delivery parcel','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',543216)));
  v_second:=public.owner_create_purchase_voucher(v_today,'Supplier two',543216,null,jsonb_build_array(jsonb_build_object(
    'description','Shop delivery parcel','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',543216)));
  perform public.owner_finalize_purchase_voucher(v_first);
  perform public.owner_finalize_purchase_voucher(v_second);
  select array_agg(id order by id) into v_voucher_ids from unnest(array[v_first,v_second]) as ids(id);
  select count(*) into v_expenses_before from public.daily_expenses where owner_id=v_owner;
  v_result:=public.owner_add_daily_expense_after_duplicate_review(
    v_today,543216,'Shop delivery parcel',v_voucher_ids,
    'Chi phí giao hàng riêng, không nằm trong hai hóa đơn nguyên liệu.',
    '98000000-0000-4000-8000-000000000001'
  );
  if public.owner_add_daily_expense_after_duplicate_review(
    v_today,543216,'Shop delivery parcel',v_voucher_ids,
    'Chi phí giao hàng riêng, không nằm trong hai hóa đơn nguyên liệu.',
    '98000000-0000-4000-8000-000000000001'
  ) is distinct from v_result
    or (select count(*) from public.daily_expenses where owner_id=v_owner)<>v_expenses_before+1
    or (select count(*) from public.owner_purchase_source_links where daily_expense_id=(v_result->>'daily_expense_id')::uuid
      and resolution='different_purchase')<>2
    or (select count(*) from public.owner_purchase_events where related_id=(v_result->>'daily_expense_id')::uuid
      and event_type='duplicate_resolved')<>2
    or exists(select 1 from public.owner_purchase_source_links where daily_expense_id=(v_result->>'daily_expense_id')::uuid
      and request_payload->>'review_reason' is distinct from 'Chi phí giao hàng riêng, không nằm trong hai hóa đơn nguyên liệu.') then
    raise exception 'Finalized duplicate review did not audit every matching voucher exactly once';
  end if;
  perform public.owner_correct_purchase_voucher(v_first,v_today-1,'Supplier one',543216,null,null,null,'[]'::jsonb,
    'Sửa ngày phiếu sau khi đã ghi nhận giao dịch riêng');
  if public.owner_add_daily_expense_after_duplicate_review(
    v_today,543216,'Shop delivery parcel',v_voucher_ids,
    'Chi phí giao hàng riêng, không nằm trong hai hóa đơn nguyên liệu.',
    '98000000-0000-4000-8000-000000000001'
  ) is distinct from v_result
    or (select count(*) from public.daily_expenses where owner_id=v_owner)<>v_expenses_before+1 then
    raise exception 'A retry after voucher correction did not replay the original result exactly once';
  end if;
  begin
    perform public.owner_add_daily_expense_after_duplicate_review(
      v_today,543216,'Changed description',v_voucher_ids,
      'Chi phí giao hàng riêng, không nằm trong hai hóa đơn nguyên liệu.',
      '98000000-0000-4000-8000-000000000001'
    );
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
select pass('admin can add a true separate shop expense after explicit review; every finalized match is audited and retries remain idempotent after voucher corrections');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_today date:=private.current_business_date_vn();
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_voucher uuid;
  v_expense uuid;
  v_line uuid;
  v_receipt uuid;
  v_receipt_line uuid;
  v_versions_before bigint;
  v_events_before bigint;
begin
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Vendor Old',50000,'Old receipt',jsonb_build_array(jsonb_build_object(
    'description','Tea leaf','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',50000)));
  perform public.owner_finalize_purchase_voucher(v_voucher);
  select id into v_line from public.owner_purchase_lines where voucher_id=v_voucher and active;
  select linked_inventory_receipt_id into v_receipt from public.owner_purchase_vouchers where id=v_voucher;
  select receipt_line_id into v_receipt_line from public.owner_purchase_stock_links where voucher_id=v_voucher;
  select count(*) into v_versions_before from public.inventory_receipt_versions where receipt_id=v_receipt;
  -- This expense is not a match until the finalized voucher is corrected.
  v_expense:=public.owner_add_daily_expense(v_today,997771,'Later freight');
  select count(*) into v_events_before from public.owner_purchase_events
    where voucher_id=v_voucher and event_type='voucher_corrected';
  begin
    perform public.owner_correct_purchase_voucher(v_voucher,v_today,'Later freight',997771,'Updated note',jsonb_build_array(jsonb_build_object(
      'line_id',v_line,'description','Tea leaf revised','cost_class','raw_material','inventory_class','stock',
      'inventory_item_id',v_item::text,'large_quantity','2','loose_quantity','0','line_amount_vnd',50000)),null,'[]'::jsonb,
      'Correcting the invoice to its verified values');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  if (select vendor from public.owner_purchase_vouchers where id=v_voucher)<>'Vendor Old'
    or (select invoice_total_vnd from public.owner_purchase_vouchers where id=v_voucher)<>50000
    or (select note from public.owner_purchase_vouchers where id=v_voucher)<>'Old receipt'
    or (select deleted_at from public.daily_expenses where id=v_expense) is not null
    or (select large_quantity from public.owner_purchase_lines where id=v_line)<>1
    or (select converted_quantity from public.inventory_receipt_lines where id=v_receipt_line)<>1000
    or (select count(*) from public.inventory_receipt_versions where receipt_id=v_receipt)<>v_versions_before
    or (select count(*) from public.owner_purchase_events where voucher_id=v_voucher and event_type='voucher_corrected')<>v_events_before then
    raise exception 'Rejected correction left voucher or audit changes behind';
  end if;
end $$;
reset role;
select pass('correction of a finalized voucher rolls back when its new fields would create an unreviewed daily-expense match');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  v_owner constant uuid:='91000000-0000-4000-8000-000000000001';
  v_item uuid:=(select id from public.inventory_items where owner_id=v_owner and source_code='001');
  v_today date:=private.current_business_date_vn();
  v_expense uuid:=current_setting('test.staff_failed_expense_id')::uuid;
  v_voucher uuid;
  v_before_receipts bigint;
  v_before_versions bigint;
begin
  v_voucher:=public.owner_create_purchase_voucher(v_today,'Rollback test',15000,null,jsonb_build_array(jsonb_build_object(
    'description','Đường','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',15000)));
  v_before_receipts:=(select count(*) from public.inventory_receipts);
  v_before_versions:=(select count(*) from public.inventory_receipt_versions);
  perform set_config('test.fail_owner_purchase_snapshot','on',true);
  begin
    perform public.owner_resolve_purchase_duplicate(v_voucher,v_expense,'personal_paid','Đối chiếu',null,'[]'::jsonb,'97000000-0000-4000-8000-000000000001');
    raise exception using errcode='P0001';
  exception when sqlstate '22023' then null; end;
  perform set_config('test.fail_owner_purchase_snapshot','off',true);
  if (select status from public.owner_purchase_vouchers where id=v_voucher)<>'draft'
    or (select deleted_at is not null from public.daily_expenses where id=v_expense)
    or exists(select 1 from public.owner_purchase_source_links where daily_expense_id=v_expense)
    or (select count(*) from public.inventory_receipts)<>v_before_receipts
    or (select count(*) from public.inventory_receipt_versions)<>v_before_versions then raise exception 'duplicate failure left partial changes'; end if;

  v_voucher:=public.owner_create_purchase_voucher(v_today,'Snapshot rollback',10000,null,jsonb_build_array(jsonb_build_object(
    'description','Đường','cost_class','raw_material','inventory_class','stock','inventory_item_id',v_item::text,
    'large_quantity','1','loose_quantity','0','line_amount_vnd',10000)));
  perform set_config('test.fail_owner_purchase_snapshot','on',true);
  begin perform public.owner_finalize_purchase_voucher(v_voucher); raise exception using errcode='P0001'; exception when sqlstate '22023' then null; end;
  perform set_config('test.fail_owner_purchase_snapshot','off',true);
  if (select status from public.owner_purchase_vouchers where id=v_voucher)<>'draft'
    or (select count(*) from public.inventory_receipts)<>v_before_receipts
    or (select count(*) from public.inventory_receipt_versions)<>v_before_versions then raise exception 'finalization failure left partial receipt/history'; end if;
end $$;
reset role;
select pass('forced receipt-history failures roll back voucher, receipt, stock history, duplicate link, and daily-expense changes');

set local role anon;
do $$ begin
  begin perform 1 from public.owner_purchase_evidence; raise exception 'anon read evidence'; exception when insufficient_privilege then null; end;
  begin perform public.owner_create_purchase_voucher(date '2026-10-06','Anon',1,null,'[]'::jsonb); raise exception 'anon created voucher'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pass('anon cannot query invoice evidence or execute an owner purchase RPC');

select * from finish();
rollback;
