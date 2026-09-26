alter table public.daily_records
  add column reconciliation_status text not null default 'unreconciled'
    check (reconciliation_status in ('unreconciled', 'pending', 'matched', 'discrepancy')),
  add column bluebook_total_vnd bigint check (bluebook_total_vnd >= 0),
  add column reconciliation_difference_vnd bigint,
  add column reconciliation_note text
    check (reconciliation_note is null or length(reconciliation_note) <= 240),
  add column electricity_reset_reason text
    check (electricity_reset_reason is null or length(trim(electricity_reset_reason)) between 2 and 240),
  add constraint daily_records_reconciliation_values_consistent
    check (
      (reconciliation_status = 'matched' and bluebook_total_vnd is not null and reconciliation_difference_vnd is not null and reconciliation_difference_vnd = 0)
      or (reconciliation_status = 'discrepancy' and bluebook_total_vnd is not null and reconciliation_difference_vnd is not null and reconciliation_difference_vnd <> 0)
      or (reconciliation_status in ('unreconciled', 'pending') and bluebook_total_vnd is null and reconciliation_difference_vnd is null)
    );

create table public.monthly_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  month_start date not null check (
    month_start >= date '2026-09-01' and extract(day from month_start) = 1
  ),
  category text not null check (category in ('rent', 'wages', 'water')),
  amount_delta_vnd bigint not null check (amount_delta_vnd <> 0),
  note text not null check (length(trim(note)) between 2 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.monthly_cost_adjustments enable row level security;
revoke all on public.monthly_cost_adjustments from anon, authenticated;
grant select, insert, update, delete on public.monthly_cost_adjustments to authenticated;
create policy "monthly cost adjustments owner select"
  on public.monthly_cost_adjustments for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "monthly cost adjustments owner insert"
  on public.monthly_cost_adjustments for insert to authenticated
  with check (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "monthly cost adjustments owner update"
  on public.monthly_cost_adjustments for update to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()))
  with check (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "monthly cost adjustments owner delete"
  on public.monthly_cost_adjustments for delete to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create trigger audit_row_change after insert or update or delete on public.monthly_cost_adjustments
  for each row execute function private.audit_row_change();
create trigger set_updated_at before update on public.monthly_cost_adjustments
  for each row execute function private.touch_updated_at();
create index monthly_cost_adjustments_owner_month_idx
  on public.monthly_cost_adjustments (owner_id, month_start, category);
