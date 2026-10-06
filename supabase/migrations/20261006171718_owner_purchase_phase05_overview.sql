create index if not exists owner_purchase_reimbursements_owner_date_voucher_idx
  on public.owner_purchase_reimbursements (owner_id, business_date, voucher_id);

create or replace function public.owner_purchase_overview_summary(
  p_month_start date,
  p_as_of date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_month_end date;
  v_month_cutoff date;
  v_month_advanced bigint;
  v_month_reimbursed bigint;
  v_month_outstanding bigint;
  v_current_outstanding bigint;
  v_finalized_count integer;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_month_start is null or extract(day from p_month_start) <> 1
    or p_month_start < date '2026-09-01'
    or p_as_of is null or p_as_of < date '2026-09-01'
    or p_as_of > private.current_business_date_vn() then
    raise exception using errcode = '22023', message = 'Invalid purchase overview range';
  end if;

  v_month_end := ((p_month_start + interval '1 month')::date - 1);
  v_month_cutoff := least(v_month_end, p_as_of);

  select count(*)::integer, coalesce(sum(voucher.invoice_total_vnd), 0)::bigint
  into v_finalized_count, v_month_advanced
  from public.owner_purchase_vouchers as voucher
  where voucher.owner_id = v_actor
    and voucher.status = 'finalized'
    and voucher.purchase_date >= p_month_start
    and voucher.purchase_date <= v_month_end;

  select coalesce(sum(event_totals.net_reimbursed_vnd), 0)::bigint
  into v_month_reimbursed
  from public.owner_purchase_vouchers as voucher
  cross join lateral (
    select coalesce(sum(case when reimbursement.event_type = 'payment'
      then reimbursement.amount_vnd else -reimbursement.amount_vnd end), 0)::bigint as net_reimbursed_vnd
    from public.owner_purchase_reimbursements as reimbursement
    where reimbursement.owner_id = v_actor
      and reimbursement.voucher_id = voucher.id
      and reimbursement.business_date <= v_month_cutoff
  ) as event_totals
  where voucher.owner_id = v_actor
    and voucher.status = 'finalized'
    and voucher.purchase_date >= p_month_start
    and voucher.purchase_date <= v_month_end;

  v_month_outstanding := v_month_advanced - v_month_reimbursed;
  if v_month_reimbursed < 0 or v_month_outstanding < 0 then
    raise exception using errcode = '22023', message = 'Purchase cohort reimbursement balance is invalid';
  end if;

  select coalesce(sum(voucher.invoice_total_vnd - event_totals.net_reimbursed_vnd), 0)::bigint
  into v_current_outstanding
  from public.owner_purchase_vouchers as voucher
  cross join lateral (
    select coalesce(sum(case when reimbursement.event_type = 'payment'
      then reimbursement.amount_vnd else -reimbursement.amount_vnd end), 0)::bigint as net_reimbursed_vnd
    from public.owner_purchase_reimbursements as reimbursement
    where reimbursement.owner_id = v_actor
      and reimbursement.voucher_id = voucher.id
      and reimbursement.business_date <= p_as_of
  ) as event_totals
  where voucher.owner_id = v_actor
    and voucher.status = 'finalized';

  if v_current_outstanding < 0 then
    raise exception using errcode = '22023', message = 'Current purchase reimbursement balance is invalid';
  end if;

  return jsonb_build_object(
    'month_advanced_vnd', v_month_advanced,
    'month_reimbursed_vnd', v_month_reimbursed,
    'month_outstanding_vnd', v_month_outstanding,
    'current_outstanding_vnd', v_current_outstanding,
    'finalized_count', v_finalized_count,
    'month_cutoff_date', v_month_cutoff
  );
end;
$$;
revoke all on function public.owner_purchase_overview_summary(date, date) from public, anon, authenticated;
grant execute on function public.owner_purchase_overview_summary(date, date) to authenticated;

create or replace function public.owner_record_purchase_reimbursement(
  p_voucher_id uuid,
  p_event_type text,
  p_business_date date,
  p_amount_vnd bigint,
  p_note text,
  p_idempotency_key uuid,
  p_reverses_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_existing public.owner_purchase_reimbursements%rowtype;
  v_original public.owner_purchase_reimbursements%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_event_id uuid := gen_random_uuid();
  v_net_paid bigint;
  v_reversed_for_event bigint;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_event_type is null or p_event_type not in ('payment', 'reversal')
    or p_business_date is null or p_business_date < date '2026-09-01'
    or p_business_date > private.current_business_date_vn()
    or p_amount_vnd is null or p_amount_vnd not between 1 and 9007199254740991
    or p_idempotency_key is null
    or (p_note is not null and length(p_note) > 1000)
    or (p_event_type = 'payment' and p_reverses_event_id is not null)
    or (p_event_type = 'reversal' and p_reverses_event_id is null) then
    raise exception using errcode = '22023', message = 'Invalid reimbursement event';
  end if;
  v_request := jsonb_build_object(
    'event_type', p_event_type,
    'business_date', p_business_date,
    'amount_vnd', p_amount_vnd,
    'note', nullif(btrim(p_note), ''),
    'reverses_event_id', p_reverses_event_id
  );

  perform private.lock_inventory_owner(v_actor);
  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'finalized' then
    raise exception using errcode = '22023', message = 'Only a finalized purchase can receive a reimbursement';
  end if;
  if p_business_date < v_voucher.purchase_date then
    raise exception using errcode = '22023', message = 'Reimbursement date cannot be before the purchase date';
  end if;
  select * into v_existing from public.owner_purchase_reimbursements
  where owner_id = v_actor and voucher_id = p_voucher_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different reimbursement';
    end if;
    return v_existing.result_payload;
  end if;

  select coalesce(sum(case when event_type = 'payment' then amount_vnd else -amount_vnd end), 0)::bigint
  into v_net_paid
  from public.owner_purchase_reimbursements
  where owner_id = v_actor and voucher_id = p_voucher_id;
  if p_event_type = 'payment' then
    if v_net_paid + p_amount_vnd > v_voucher.invoice_total_vnd then
      raise exception using errcode = '22023', message = 'Reimbursements cannot exceed the amount personally advanced';
    end if;
    v_net_paid := v_net_paid + p_amount_vnd;
  else
    select * into v_original from public.owner_purchase_reimbursements
    where owner_id = v_actor and voucher_id = p_voucher_id
      and id = p_reverses_event_id and event_type = 'payment'
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Reversal must reference a payment on this voucher';
    end if;
    if p_business_date < v_original.business_date then
      raise exception using errcode = '22023', message = 'Reversal date cannot be before the original payment';
    end if;
    select coalesce(sum(amount_vnd), 0)::bigint into v_reversed_for_event
    from public.owner_purchase_reimbursements
    where owner_id = v_actor and reverses_event_id = p_reverses_event_id;
    if v_reversed_for_event + p_amount_vnd > v_original.amount_vnd or v_net_paid < p_amount_vnd then
      raise exception using errcode = '22023', message = 'Reimbursement reversal exceeds the unreversed payment';
    end if;
    v_net_paid := v_net_paid - p_amount_vnd;
  end if;
  if v_net_paid < 0 then
    raise exception using errcode = '22023', message = 'Reimbursement balance cannot be negative';
  end if;

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'reimbursed_vnd', v_net_paid,
    'outstanding_vnd', v_voucher.invoice_total_vnd - v_net_paid
  );
  insert into public.owner_purchase_reimbursements (
    id, owner_id, voucher_id, event_type, business_date, amount_vnd, note,
    reverses_event_id, idempotency_key, request_payload, result_payload, actor_id
  ) values (
    v_event_id, v_actor, p_voucher_id, p_event_type, p_business_date, p_amount_vnd,
    nullif(btrim(p_note), ''), p_reverses_event_id, p_idempotency_key,
    v_request, v_result, v_actor
  );
  perform private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'reimbursement_recorded', v_actor, null,
    null, v_result, v_event_id, p_idempotency_key
  );
  return v_result;
end;
$$;
revoke all on function public.owner_record_purchase_reimbursement(uuid, text, date, bigint, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_record_purchase_reimbursement(uuid, text, date, bigint, text, uuid, uuid)
  to authenticated;
