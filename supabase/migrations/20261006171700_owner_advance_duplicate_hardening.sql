create extension if not exists unaccent with schema extensions;

-- One daily expense can be an explicitly reviewed false positive for more than
-- one finalized purchase, so preserve a decision per expense/voucher pair.
alter table public.owner_purchase_source_links
  drop constraint if exists owner_purchase_source_links_owner_id_daily_expense_id_key;
alter table public.owner_purchase_source_links
  drop constraint if exists owner_purchase_source_links_owner_expense_voucher_key;
alter table public.owner_purchase_source_links
  add constraint owner_purchase_source_links_owner_expense_voucher_key
  unique (owner_id, daily_expense_id, voucher_id);
create index if not exists owner_purchase_source_links_review_request_idx
  on public.owner_purchase_source_links (owner_id, (request_payload ->> 'idempotency_key'))
  where request_payload ->> 'operation' = 'owner_add_daily_expense_after_duplicate_review';

create or replace function private.normalize_owner_purchase_text(p_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent(coalesce(p_value, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;
revoke all on function private.normalize_owner_purchase_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.owner_purchase_text_matches(p_left text, p_right text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_left text := private.normalize_owner_purchase_text(p_left);
  v_right text := private.normalize_owner_purchase_text(p_right);
  v_shorter text;
  v_longer text;
begin
  if v_left = '' or v_right = '' then return false; end if;
  if v_left = v_right then return true; end if;
  if length(v_left) <= length(v_right) then
    v_shorter := v_left;
    v_longer := v_right;
  else
    v_shorter := v_right;
    v_longer := v_left;
  end if;
  return length(v_shorter) >= 4
    and position(' ' || v_shorter || ' ' in ' ' || v_longer || ' ') > 0;
end;
$$;
revoke all on function private.owner_purchase_text_matches(text, text)
  from public, anon, authenticated, service_role;

create or replace function private.owner_purchase_input_matches_voucher(
  p_owner_id uuid,
  p_voucher_id uuid,
  p_business_date date,
  p_amount_vnd bigint,
  p_reason text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.owner_purchase_vouchers as voucher
    where voucher.owner_id = p_owner_id and voucher.id = p_voucher_id
      and p_business_date = voucher.purchase_date
      and (
        (p_amount_vnd = voucher.invoice_total_vnd and (
          private.owner_purchase_text_matches(p_reason, voucher.note)
          or private.owner_purchase_text_matches(p_reason, voucher.vendor)
        ))
        or exists (
          select 1
          from public.owner_purchase_lines as line
          where line.owner_id = voucher.owner_id
            and line.voucher_id = voucher.id
            and line.active
            and line.line_amount_vnd = p_amount_vnd
            and private.owner_purchase_text_matches(p_reason, line.description)
        )
      )
  );
$$;
revoke all on function private.owner_purchase_input_matches_voucher(uuid, uuid, date, bigint, text)
  from public, anon, authenticated, service_role;

create or replace function private.owner_purchase_daily_expense_matches(
  p_owner_id uuid,
  p_voucher_id uuid,
  p_expense_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daily_expenses as expense
    where expense.owner_id = p_owner_id and expense.id = p_expense_id
      and expense.deleted_at is null
      and private.owner_purchase_input_matches_voucher(
        p_owner_id, p_voucher_id, expense.business_date, expense.amount_vnd, expense.reason
      )
  );
$$;
revoke all on function private.owner_purchase_daily_expense_matches(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.reject_unresolved_owner_purchase_expenses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from 'draft' or new.status is distinct from 'finalized' then
    return new;
  end if;

  perform private.lock_inventory_owner(new.owner_id);
  if exists (
    select 1
    from public.daily_expenses as expense
    where expense.owner_id = new.owner_id
      and expense.deleted_at is null
      and private.owner_purchase_daily_expense_matches(new.owner_id, new.id, expense.id)
      and not exists (
        select 1
        from public.owner_purchase_source_links as source_link
        where source_link.owner_id = new.owner_id
          and source_link.voucher_id = new.id
          and source_link.daily_expense_id = expense.id
          and source_link.resolution in ('personal_paid', 'different_purchase')
      )
  ) then
    raise exception using errcode = '22023', message = 'Review every matching active daily expense before finalizing this purchase';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_unresolved_owner_purchase_expenses()
  from public, anon, authenticated, service_role;
drop trigger if exists owner_purchase_voucher_requires_duplicate_review on public.owner_purchase_vouchers;
create trigger owner_purchase_voucher_requires_duplicate_review
before update of status on public.owner_purchase_vouchers
for each row execute function private.reject_unresolved_owner_purchase_expenses();

-- A finalized voucher may be corrected only while it remains clear of any new
-- daily-expense match. This runs after the correction has updated its lines and
-- voucher fields, so the matcher sees the proposed final state. An exception
-- rolls the complete correction (including receipt/history edits) back.
create or replace function private.reject_new_owner_purchase_correction_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from 'finalized' or new.status is distinct from 'finalized' then
    return new;
  end if;

  perform private.lock_inventory_owner(new.owner_id);
  if exists (
    select 1
    from public.daily_expenses as expense
    where expense.owner_id = new.owner_id
      and expense.deleted_at is null
      and private.owner_purchase_daily_expense_matches(new.owner_id, new.id, expense.id)
      and not exists (
        select 1
        from public.owner_purchase_source_links as source_link
        where source_link.owner_id = new.owner_id
          and source_link.voucher_id = new.id
          and source_link.daily_expense_id = expense.id
          and source_link.resolution in ('personal_paid', 'different_purchase')
      )
  ) then
    raise exception using errcode = '22023', message = 'Review matching daily expenses before correcting this finalized purchase';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_new_owner_purchase_correction_matches()
  from public, anon, authenticated, service_role;
drop trigger if exists owner_purchase_voucher_correction_requires_duplicate_review on public.owner_purchase_vouchers;
create trigger owner_purchase_voucher_correction_requires_duplicate_review
after update of purchase_date, vendor, invoice_total_vnd, note, updated_at on public.owner_purchase_vouchers
for each row execute function private.reject_new_owner_purchase_correction_matches();

-- Supported staff/admin expense RPCs share the same owner lock with purchase
-- finalization. This post-write check prevents a later expense from silently
-- duplicating a finalized purchase; the transaction rolls back on a match.
create or replace function private.reject_linked_or_duplicate_finalized_expense(
  p_owner_id uuid,
  p_expense_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.owner_purchase_source_links as source_link
    where source_link.owner_id = p_owner_id and source_link.daily_expense_id = p_expense_id
  ) then
    raise exception using errcode = '22023', message = 'This daily expense has already been reviewed against a purchase and cannot be changed';
  end if;

  if exists (
    select 1
    from public.owner_purchase_vouchers as voucher
    join public.daily_expenses as expense on expense.owner_id = voucher.owner_id
    where voucher.owner_id = p_owner_id
      and voucher.status = 'finalized'
      and expense.id = p_expense_id
      and expense.deleted_at is null
      and private.owner_purchase_daily_expense_matches(p_owner_id, voucher.id, expense.id)
      and not exists (
        select 1 from public.owner_purchase_source_links as source_link
        where source_link.owner_id = p_owner_id
          and source_link.voucher_id = voucher.id
          and source_link.daily_expense_id = expense.id
          and source_link.resolution in ('personal_paid', 'different_purchase')
      )
  ) then
    raise exception using errcode = '22023', message = 'This daily expense matches a finalized purchase and must be reviewed before it can be changed';
  end if;
end;
$$;
revoke all on function private.reject_linked_or_duplicate_finalized_expense(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Keep owner clients on the guarded RPC path; the base ledger grants must not
-- allow authenticated direct writes that would skip locking and duplicate checks.
revoke insert, update, delete on public.daily_expenses from authenticated;
grant select on public.daily_expenses to authenticated;

-- Serialize all supported daily-expense writes with purchase finalization. The
-- finalization trigger takes the same owner row lock before checking candidates.
create or replace function public.owner_add_daily_expense(
  p_business_date date,
  p_amount_vnd bigint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  expense_id uuid;
  normalized_reason text := trim(p_reason);
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner authorization required';
  end if;
  if p_business_date is null or p_business_date < date '2026-09-01'
    or p_amount_vnd is null or p_amount_vnd <= 0
    or length(normalized_reason) not between 2 and 240 then
    raise exception using errcode = '22023', message = 'Invalid incidental expense';
  end if;
  perform private.lock_inventory_owner(current_owner_id);
  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.daily_expenses (owner_id, business_date, amount_vnd, reason)
  values (current_owner_id, p_business_date, p_amount_vnd, normalized_reason)
  returning id into expense_id;
  perform private.reject_linked_or_duplicate_finalized_expense(current_owner_id, expense_id);
  return expense_id;
end;
$$;

-- A staff entry can legitimately look like an already-finalized personal
-- purchase. The ordinary staff/admin RPCs reject it; an owner can explicitly
-- confirm it is a separate shop-paid transaction, keep the daily expense, and
-- append a decision/event for every current finalized-voucher match atomically.
create or replace function public.owner_add_daily_expense_after_duplicate_review(
  p_business_date date,
  p_amount_vnd bigint,
  p_reason text,
  p_matched_voucher_ids uuid[],
  p_review_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(p_reason);
  v_review_reason text := btrim(p_review_reason);
  v_candidate_ids uuid[] := array[]::uuid[];
  v_provided_ids uuid[] := array[]::uuid[];
  v_voucher_id uuid;
  v_link_key uuid;
  v_expense_id uuid;
  v_expense public.daily_expenses%rowtype;
  v_existing public.owner_purchase_source_links%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_before_state jsonb;
  v_after_state jsonb;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner authorization required';
  end if;
  if p_business_date is null or p_business_date < date '2026-09-01'
    or p_amount_vnd is null or p_amount_vnd <= 0
    or length(v_reason) not between 2 and 240
    or length(v_review_reason) not between 5 and 500
    or p_idempotency_key is null
    or p_matched_voucher_ids is null
    or cardinality(p_matched_voucher_ids) not between 1 and 1000
    or array_position(p_matched_voucher_ids, null) is not null then
    raise exception using errcode = '22023', message = 'Invalid reviewed daily expense';
  end if;

  perform private.lock_inventory_owner(v_actor);
  select coalesce(array_agg(distinct supplied_id order by supplied_id), array[]::uuid[])
  into v_provided_ids from unnest(p_matched_voucher_ids) as supplied(supplied_id);
  if cardinality(v_provided_ids) <> cardinality(p_matched_voucher_ids) then
    raise exception using errcode = '22023', message = 'Every matched finalized purchase may be reviewed only once';
  end if;
  v_request := jsonb_build_object(
    'operation', 'owner_add_daily_expense_after_duplicate_review',
    'idempotency_key', p_idempotency_key,
    'business_date', p_business_date,
    'amount_vnd', p_amount_vnd,
    'reason', v_reason,
    'matched_voucher_ids', to_jsonb(v_provided_ids),
    'resolution', 'different_purchase',
    'review_reason', v_review_reason
  );
  -- Replay a committed request before inspecting live voucher state. A voucher
  -- can be corrected after the original write, but a lost response must never
  -- turn the same idempotency key into a second daily expense.
  select * into v_existing from public.owner_purchase_source_links
  where owner_id = v_actor
    and request_payload ->> 'operation' = 'owner_add_daily_expense_after_duplicate_review'
    and request_payload ->> 'idempotency_key' = p_idempotency_key::text
  order by created_at, id
  limit 1;
  if found then
    if v_existing.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different expense review';
    end if;
    return v_existing.result_payload;
  end if;

  select coalesce(array_agg(voucher.id order by voucher.id), array[]::uuid[])
  into v_candidate_ids
  from public.owner_purchase_vouchers as voucher
  where voucher.owner_id = v_actor and voucher.status = 'finalized'
    and private.owner_purchase_input_matches_voucher(
      v_actor, voucher.id, p_business_date, p_amount_vnd, v_reason
    );
  if v_candidate_ids is distinct from v_provided_ids then
    raise exception using errcode = '40001', message = 'Matching finalized purchases changed; reload and review every current match';
  end if;

  v_link_key := pg_catalog.md5(p_idempotency_key::text || ':' || v_candidate_ids[1]::text)::uuid;
  select * into v_existing from public.owner_purchase_source_links
  where owner_id = v_actor and idempotency_key = v_link_key;
  if found then
    if v_existing.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different expense review';
    end if;
    return v_existing.result_payload;
  end if;

  insert into public.daily_records (owner_id, business_date)
  values (v_actor, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.daily_expenses (owner_id, business_date, amount_vnd, reason)
  values (v_actor, p_business_date, p_amount_vnd, v_reason)
  returning * into v_expense;
  v_expense_id := v_expense.id;
  v_result := jsonb_build_object(
    'daily_expense_id', v_expense_id,
    'resolution', 'different_purchase',
    'matched_voucher_ids', to_jsonb(v_candidate_ids)
  );

  foreach v_voucher_id in array v_candidate_ids loop
    v_link_key := pg_catalog.md5(p_idempotency_key::text || ':' || v_voucher_id::text)::uuid;
    v_before_state := jsonb_build_object(
      'voucher', private.owner_purchase_snapshot(v_actor, v_voucher_id),
      'daily_expense', null,
      'proposed_daily_expense', jsonb_build_object(
        'business_date', p_business_date, 'amount_vnd', p_amount_vnd, 'reason', v_reason
      )
    );
    v_after_state := jsonb_build_object(
      'voucher', private.owner_purchase_snapshot(v_actor, v_voucher_id),
      'daily_expense', to_jsonb(v_expense),
      'resolution', 'different_purchase',
      'reason', v_review_reason,
      'matched_voucher_ids', to_jsonb(v_candidate_ids)
    );
    insert into public.owner_purchase_source_links (
      owner_id, daily_expense_id, voucher_id, resolution, before_state,
      request_payload, result_payload, idempotency_key, actor_id
    ) values (
      v_actor, v_expense_id, v_voucher_id, 'different_purchase', v_before_state,
      v_request, v_result, v_link_key, v_actor
    );
    perform private.append_owner_purchase_event(
      v_actor, v_voucher_id, 'duplicate_resolved', v_actor, v_review_reason,
      v_before_state, v_after_state, v_expense_id, v_link_key
    );
  end loop;
  return v_result;
end;
$$;
revoke all on function public.owner_add_daily_expense_after_duplicate_review(date, bigint, text, uuid[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_add_daily_expense_after_duplicate_review(date, bigint, text, uuid[], text, uuid)
  to authenticated;

create or replace function public.staff_add_incidental_expense(
  p_business_date date,
  p_amount_vnd bigint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
  expense_id uuid;
  normalized_reason text := trim(p_reason);
begin
  if current_owner_id is null then
    raise exception using errcode = '42501', message = 'Active staff authorization required';
  end if;
  if p_business_date is null or p_business_date <> private.current_business_date_vn()
    or p_amount_vnd is null or p_amount_vnd <= 0
    or length(normalized_reason) not between 2 and 240 then
    raise exception using errcode = '22023', message = 'Invalid incidental expense';
  end if;
  perform private.lock_inventory_owner(current_owner_id);
  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.daily_expenses (owner_id, business_date, amount_vnd, reason)
  values (current_owner_id, p_business_date, p_amount_vnd, normalized_reason)
  returning id into expense_id;
  perform private.reject_linked_or_duplicate_finalized_expense(current_owner_id, expense_id);
  return expense_id;
end;
$$;

create or replace function public.staff_update_incidental_expense(
  p_expense_id uuid,
  p_amount_vnd bigint,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
  normalized_reason text := trim(p_reason);
begin
  if current_owner_id is null then
    raise exception using errcode = '42501', message = 'Active staff authorization required';
  end if;
  if p_expense_id is null or p_amount_vnd is null or p_amount_vnd <= 0
    or length(normalized_reason) not between 2 and 240 then
    raise exception using errcode = '22023', message = 'Invalid incidental expense';
  end if;
  perform private.lock_inventory_owner(current_owner_id);
  perform private.reject_linked_or_duplicate_finalized_expense(current_owner_id, p_expense_id);
  update public.daily_expenses set amount_vnd = p_amount_vnd, reason = normalized_reason, updated_at = now()
  where id = p_expense_id and owner_id = current_owner_id
    and business_date = private.current_business_date_vn() and deleted_at is null;
  if not found then raise exception using errcode = '22023', message = 'Expense not found or no longer editable'; end if;
  perform private.reject_linked_or_duplicate_finalized_expense(current_owner_id, p_expense_id);
end;
$$;

create or replace function public.staff_delete_incidental_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then
    raise exception using errcode = '42501', message = 'Active staff authorization required';
  end if;
  if p_expense_id is null then raise exception using errcode = '22023', message = 'Invalid expense ID'; end if;
  perform private.lock_inventory_owner(current_owner_id);
  perform private.reject_linked_or_duplicate_finalized_expense(current_owner_id, p_expense_id);
  update public.daily_expenses set deleted_at = now(), deleted_by = (select auth.uid()), updated_at = now()
  where id = p_expense_id and owner_id = current_owner_id
    and business_date = private.current_business_date_vn() and deleted_at is null;
  if not found then raise exception using errcode = '22023', message = 'Expense not found or no longer editable'; end if;
end;
$$;

create or replace function public.owner_resolve_purchase_duplicates(
  p_voucher_id uuid,
  p_decisions jsonb,
  p_existing_receipt_id uuid,
  p_receipt_line_links jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_expense public.daily_expenses%rowtype;
  v_decision jsonb;
  v_decision_ids uuid[] := array[]::uuid[];
  v_expense_ids uuid[] := array[]::uuid[];
  v_resolution text;
  v_reason text;
  v_key uuid;
  v_request jsonb;
  v_batch_request jsonb;
  v_existing public.owner_purchase_source_links%rowtype;
  v_existing_count integer := 0;
  v_match_count integer := 0;
  v_personal_count integer := 0;
  v_shop_count integer := 0;
  v_different_count integer := 0;
  v_before_expenses jsonb := '[]'::jsonb;
  v_after_expenses jsonb := '[]'::jsonb;
  v_result jsonb;
  v_before_voucher jsonb;
  v_now timestamptz := clock_timestamp();
  v_status text;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_voucher_id is null or p_idempotency_key is null
    or jsonb_typeof(p_decisions) is distinct from 'array'
    or jsonb_array_length(p_decisions) not between 1 and 1000
    or p_receipt_line_links is null or jsonb_typeof(p_receipt_line_links) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid duplicate resolution batch';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) as entries(value)
  loop
    begin
      v_expense.id := (v_decision ->> 'daily_expense_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid daily expense in duplicate decision';
    end;
    v_resolution := v_decision ->> 'resolution';
    v_reason := btrim(v_decision ->> 'reason');
    if v_expense.id is null or v_expense.id = any(v_decision_ids)
      or v_resolution is null or v_resolution not in ('personal_paid', 'shop_cash', 'different_purchase')
      or v_reason is null
      or (v_resolution = 'different_purchase' and length(v_reason) < 5)
      or (v_resolution <> 'different_purchase' and length(v_reason) < 2)
      or length(v_reason) > 500 then
      raise exception using errcode = '22023', message = 'Every matching expense needs one valid, auditable decision';
    end if;
    v_decision_ids := array_append(v_decision_ids, v_expense.id);
    if v_resolution = 'personal_paid' then v_personal_count := v_personal_count + 1; end if;
    if v_resolution = 'shop_cash' then v_shop_count := v_shop_count + 1; end if;
    if v_resolution = 'different_purchase' then v_different_count := v_different_count + 1; end if;
  end loop;

  if v_shop_count > 0 and v_personal_count > 0 then
    raise exception using errcode = '22023', message = 'A purchase cannot be both shop-funded and personally paid';
  end if;
  if v_shop_count > 0 and (p_existing_receipt_id is not null or jsonb_array_length(p_receipt_line_links) <> 0) then
    raise exception using errcode = '22023', message = 'A shop-funded duplicate cannot link owner stock';
  end if;
  if v_different_count > 0
    and (p_existing_receipt_id is not null or jsonb_array_length(p_receipt_line_links) <> 0) then
    raise exception using errcode = '22023', message = 'A purchase confirmed as separate must create a new inventory receipt';
  end if;
  v_status := case when v_shop_count > 0 then 'canceled' else 'finalized' end;
  v_result := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'status', v_status,
    'daily_expense_ids', to_jsonb(v_decision_ids),
    'decisions_count', cardinality(v_decision_ids)
  );

  v_batch_request := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'decisions', p_decisions,
    'existing_receipt_id', p_existing_receipt_id,
    'receipt_line_links', p_receipt_line_links
  );
  perform private.lock_inventory_owner(v_actor);

  -- A batch key deterministically scopes one idempotency key per expense row.
  -- A changed or partially replayed batch is rejected without applying writes.
  for v_decision in select value from jsonb_array_elements(p_decisions) as entries(value)
  loop
    v_expense.id := (v_decision ->> 'daily_expense_id')::uuid;
    v_key := pg_catalog.md5(p_idempotency_key::text || ':' || v_expense.id::text)::uuid;
    v_request := jsonb_build_object('batch_request', v_batch_request, 'daily_expense_id', v_expense.id);
    select * into v_existing from public.owner_purchase_source_links
    where owner_id = v_actor and voucher_id = p_voucher_id and daily_expense_id = v_expense.id;
    if found then
      if v_existing.idempotency_key is distinct from v_key or v_existing.request_payload is distinct from v_request then
        raise exception using errcode = '22023', message = 'This daily expense already has a different recorded source decision';
      end if;
      v_existing_count := v_existing_count + 1;
      v_result := v_existing.result_payload;
    end if;
  end loop;
  if v_existing_count > 0 then
    if v_existing_count <> cardinality(v_decision_ids) then
      raise exception using errcode = '22023', message = 'A duplicate decision batch was only partially replayed';
    end if;
    return v_result;
  end if;

  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Duplicate review requires an owner purchase draft';
  end if;
  v_before_voucher := private.owner_purchase_snapshot(v_actor, p_voucher_id);
  select count(*)::integer into v_match_count
  from public.daily_expenses as expense
  where expense.owner_id = v_actor and expense.deleted_at is null
    and private.owner_purchase_daily_expense_matches(v_actor, p_voucher_id, expense.id);
  if v_match_count <> cardinality(v_decision_ids) then
    raise exception using errcode = '40001', message = 'Matching daily expenses changed; reload the review and decide every current match';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) as entries(value)
  loop
    v_expense.id := (v_decision ->> 'daily_expense_id')::uuid;
    select * into v_expense from public.daily_expenses
    where owner_id = v_actor and id = v_expense.id and deleted_at is null for update;
    if not found or not private.owner_purchase_daily_expense_matches(v_actor, p_voucher_id, v_expense.id) then
      raise exception using errcode = '40001', message = 'Daily expense no longer matches this purchase draft';
    end if;
    if exists (select 1 from public.owner_purchase_source_links where owner_id = v_actor
      and voucher_id = p_voucher_id and daily_expense_id = v_expense.id) then
      raise exception using errcode = '22023', message = 'This daily expense already has a recorded source decision';
    end if;
    v_before_expenses := v_before_expenses || jsonb_build_array(to_jsonb(v_expense));
    v_expense_ids := array_append(v_expense_ids, v_expense.id);
  end loop;

  -- Write the append-only source audit before finalization so the database
  -- invariant can distinguish a reviewed separate purchase from an omission.
  for v_decision in select value from jsonb_array_elements(p_decisions) as entries(value)
  loop
    v_expense.id := (v_decision ->> 'daily_expense_id')::uuid;
    v_resolution := v_decision ->> 'resolution';
    v_key := pg_catalog.md5(p_idempotency_key::text || ':' || v_expense.id::text)::uuid;
    v_request := jsonb_build_object('batch_request', v_batch_request, 'daily_expense_id', v_expense.id);
    insert into public.owner_purchase_source_links (
      owner_id, daily_expense_id, voucher_id, resolution, before_state,
      request_payload, result_payload, idempotency_key, actor_id
    ) values (
      v_actor, v_expense.id, p_voucher_id, v_resolution,
      (select to_jsonb(expense) from public.daily_expenses as expense where expense.owner_id = v_actor and expense.id = v_expense.id),
      v_request,
      v_result,
      v_key, v_actor
    );
  end loop;

  for v_decision in select value from jsonb_array_elements(p_decisions) as entries(value)
  loop
    if v_decision ->> 'resolution' = 'personal_paid' then
      update public.daily_expenses set deleted_at = v_now, deleted_by = v_actor, updated_at = v_now
      where owner_id = v_actor and id = (v_decision ->> 'daily_expense_id')::uuid and deleted_at is null;
      if not found then raise exception using errcode = '40001', message = 'Daily expense changed during duplicate resolution'; end if;
    end if;
  end loop;

  if v_shop_count > 0 then
    select btrim(value ->> 'reason') into v_reason
    from jsonb_array_elements(p_decisions) as entries(value)
    where value ->> 'resolution' = 'shop_cash' limit 1;
    perform public.owner_cancel_purchase_voucher(p_voucher_id, v_reason);
  else
    perform private.finalize_owner_purchase_voucher_impl(
      v_actor, p_voucher_id, v_actor, p_existing_receipt_id, p_receipt_line_links
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(expense) order by expense.id), '[]'::jsonb)
  into v_after_expenses
  from public.daily_expenses as expense
  where expense.owner_id = v_actor and expense.id = any(v_expense_ids);
  perform private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'duplicate_resolved', v_actor,
    'Đã đối chiếu ' || cardinality(v_expense_ids)::text || ' khoản chi phát sinh',
    jsonb_build_object('voucher', v_before_voucher, 'daily_expenses', v_before_expenses),
    jsonb_build_object('voucher', private.owner_purchase_snapshot(v_actor, p_voucher_id),
      'daily_expenses', v_after_expenses, 'decisions', p_decisions, 'result', v_result),
    null, p_idempotency_key
  );
  return v_result;
end;
$$;
revoke all on function public.owner_resolve_purchase_duplicates(uuid, jsonb, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_resolve_purchase_duplicates(uuid, jsonb, uuid, jsonb, uuid)
  to authenticated;

create or replace function public.owner_resolve_purchase_duplicate(
  p_voucher_id uuid,
  p_daily_expense_id uuid,
  p_resolution text,
  p_reason text,
  p_existing_receipt_id uuid,
  p_receipt_line_links jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_receipt_id uuid := p_existing_receipt_id;
  v_receipt_line_links jsonb := coalesce(p_receipt_line_links, '[]'::jsonb);
begin
  if p_resolution = 'shop_cash' or p_resolution = 'different_purchase' then
    v_existing_receipt_id := null;
    v_receipt_line_links := '[]'::jsonb;
  end if;
  return public.owner_resolve_purchase_duplicates(
    p_voucher_id,
    jsonb_build_array(jsonb_build_object(
      'daily_expense_id', p_daily_expense_id,
      'resolution', p_resolution,
      'reason', p_reason
    )),
    v_existing_receipt_id,
    v_receipt_line_links,
    p_idempotency_key
  );
end;
$$;
revoke all on function public.owner_resolve_purchase_duplicate(uuid, uuid, text, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_resolve_purchase_duplicate(uuid, uuid, text, text, uuid, jsonb, uuid)
  to authenticated;
