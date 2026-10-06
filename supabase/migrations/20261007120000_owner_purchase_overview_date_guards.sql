create function private.guard_owner_purchase_voucher_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_date > private.current_business_date_vn() then
    raise exception using errcode = '22023', message = 'Purchase date cannot be in the future';
  end if;
  if tg_op = 'UPDATE' then
    if new.purchase_date is distinct from old.purchase_date
      and exists (
        select 1 from public.owner_purchase_reimbursements as reimbursement
        where reimbursement.owner_id = new.owner_id
          and reimbursement.voucher_id = new.id
          and reimbursement.business_date < new.purchase_date
      ) then
      raise exception using errcode = '22023', message = 'Purchase date cannot move past a reimbursement event';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_owner_purchase_voucher_dates() from public, anon, authenticated;

create trigger owner_purchase_voucher_dates_guard_on_insert
before insert on public.owner_purchase_vouchers
for each row execute function private.guard_owner_purchase_voucher_dates();

create trigger owner_purchase_voucher_dates_guard_on_update
before update of purchase_date on public.owner_purchase_vouchers
for each row execute function private.guard_owner_purchase_voucher_dates();

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
    and voucher.purchase_date <= v_month_cutoff;

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
      and reimbursement.business_date >= voucher.purchase_date
      and (reimbursement.event_type = 'payment' or exists (
        select 1 from public.owner_purchase_reimbursements as original_payment
        where original_payment.owner_id = v_actor
          and original_payment.voucher_id = voucher.id
          and original_payment.id = reimbursement.reverses_event_id
          and original_payment.event_type = 'payment'
          and original_payment.business_date >= voucher.purchase_date
          and reimbursement.business_date >= original_payment.business_date
      ))
  ) as event_totals
  where voucher.owner_id = v_actor
    and voucher.status = 'finalized'
    and voucher.purchase_date >= p_month_start
    and voucher.purchase_date <= v_month_cutoff;

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
      and reimbursement.business_date >= voucher.purchase_date
      and (reimbursement.event_type = 'payment' or exists (
        select 1 from public.owner_purchase_reimbursements as original_payment
        where original_payment.owner_id = v_actor
          and original_payment.voucher_id = voucher.id
          and original_payment.id = reimbursement.reverses_event_id
          and original_payment.event_type = 'payment'
          and original_payment.business_date >= voucher.purchase_date
          and reimbursement.business_date >= original_payment.business_date
      ))
  ) as event_totals
  where voucher.owner_id = v_actor
    and voucher.status = 'finalized'
    and voucher.purchase_date <= p_as_of;

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
