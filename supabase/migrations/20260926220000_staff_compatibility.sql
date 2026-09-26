create table public.daily_admin_details (
  owner_id uuid not null references auth.users (id) on delete restrict,
  business_date date not null,
  business_status text not null default 'open'
    check (business_status in ('open', 'closed', 'no_business')),
  cleaning_done boolean,
  arrangement_done boolean,
  note text check (note is null or length(note) <= 1000),
  reconciliation_status text not null default 'unreconciled'
    check (reconciliation_status in ('unreconciled', 'pending', 'matched', 'discrepancy')),
  bluebook_total_vnd bigint check (bluebook_total_vnd >= 0),
  reconciliation_difference_vnd bigint,
  reconciliation_note text check (reconciliation_note is null or length(reconciliation_note) <= 240),
  electricity_reset_reason text
    check (electricity_reset_reason is null or length(trim(electricity_reset_reason)) between 2 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, business_date),
  foreign key (owner_id, business_date)
    references public.daily_records (owner_id, business_date) on delete cascade,
  constraint daily_admin_details_reconciliation_values_consistent
    check (
      (reconciliation_status = 'matched' and bluebook_total_vnd is not null and reconciliation_difference_vnd = 0)
      or (reconciliation_status = 'discrepancy' and bluebook_total_vnd is not null and reconciliation_difference_vnd is not null and reconciliation_difference_vnd <> 0)
      or (reconciliation_status in ('unreconciled', 'pending') and bluebook_total_vnd is null and reconciliation_difference_vnd is null)
    )
);

alter table public.daily_admin_details enable row level security;
revoke all on public.daily_admin_details from anon, authenticated;
grant select, insert, update, delete on public.daily_admin_details to authenticated;
create policy "daily admin details owner select"
  on public.daily_admin_details for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "daily admin details owner insert"
  on public.daily_admin_details for insert to authenticated
  with check (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "daily admin details owner update"
  on public.daily_admin_details for update to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()))
  with check (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "daily admin details owner delete"
  on public.daily_admin_details for delete to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create trigger audit_row_change after insert or update or delete on public.daily_admin_details
  for each row execute function private.audit_row_change();
create trigger set_updated_at before update on public.daily_admin_details
  for each row execute function private.touch_updated_at();

insert into public.daily_admin_details (
  owner_id, business_date, business_status, cleaning_done, arrangement_done, note,
  reconciliation_status, bluebook_total_vnd, reconciliation_difference_vnd,
  reconciliation_note, electricity_reset_reason, created_at, updated_at
)
select
  owner_id, business_date, business_status, cleaning_done, arrangement_done, note,
  reconciliation_status, bluebook_total_vnd, reconciliation_difference_vnd,
  reconciliation_note, electricity_reset_reason, created_at, updated_at
from public.daily_records
on conflict (owner_id, business_date) do update set
  business_status = excluded.business_status,
  cleaning_done = excluded.cleaning_done,
  arrangement_done = excluded.arrangement_done,
  note = excluded.note,
  reconciliation_status = excluded.reconciliation_status,
  bluebook_total_vnd = excluded.bluebook_total_vnd,
  reconciliation_difference_vnd = excluded.reconciliation_difference_vnd,
  reconciliation_note = excluded.reconciliation_note,
  electricity_reset_reason = excluded.electricity_reset_reason,
  updated_at = excluded.updated_at;

do $$
declare
  mismatch_count bigint;
begin
  select count(*) into mismatch_count
  from public.daily_records as daily
  left join public.daily_admin_details as details
    on details.owner_id = daily.owner_id and details.business_date = daily.business_date
  where details.owner_id is null
     or details.business_status is distinct from daily.business_status
     or details.cleaning_done is distinct from daily.cleaning_done
     or details.arrangement_done is distinct from daily.arrangement_done
     or details.note is distinct from daily.note
     or details.reconciliation_status is distinct from daily.reconciliation_status
     or details.bluebook_total_vnd is distinct from daily.bluebook_total_vnd
     or details.reconciliation_difference_vnd is distinct from daily.reconciliation_difference_vnd
     or details.reconciliation_note is distinct from daily.reconciliation_note
     or details.electricity_reset_reason is distinct from daily.electricity_reset_reason;

  if mismatch_count > 0 then
    raise exception 'daily_admin_details backfill mismatch: % rows', mismatch_count;
  end if;
end;
$$;

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  role text not null default 'staff' check (role = 'staff'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index store_memberships_one_active_staff_per_store_idx
  on public.store_memberships (owner_id) where active;
create index store_memberships_owner_id_idx on public.store_memberships (owner_id);
alter table public.store_memberships enable row level security;
revoke all on public.store_memberships from anon, authenticated;
grant select on public.store_memberships to authenticated;
create policy "store owner reads own memberships"
  on public.store_memberships for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "staff reads own active membership"
  on public.store_memberships for select to authenticated
  using (active and user_id = (select auth.uid()));

create or replace function private.is_active_store_member(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_memberships as membership
    where membership.owner_id = p_owner_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'staff'
      and membership.active
  );
$$;
revoke all on function private.is_active_store_member(uuid) from public, anon;
grant execute on function private.is_active_store_member(uuid) to authenticated;

alter table public.daily_records
  add column grab_order_count integer not null default 0 check (grab_order_count >= 0),
  add column shopee_order_count integer not null default 0 check (shopee_order_count >= 0),
  add column total_bill_count integer check (total_bill_count >= 0);

alter table public.daily_expenses
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;

create function private.sync_daily_admin_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.business_status is not distinct from new.business_status
      and old.cleaning_done is not distinct from new.cleaning_done
      and old.arrangement_done is not distinct from new.arrangement_done
      and old.note is not distinct from new.note
      and old.reconciliation_status is not distinct from new.reconciliation_status
      and old.bluebook_total_vnd is not distinct from new.bluebook_total_vnd
      and old.reconciliation_difference_vnd is not distinct from new.reconciliation_difference_vnd
      and old.reconciliation_note is not distinct from new.reconciliation_note
      and old.electricity_reset_reason is not distinct from new.electricity_reset_reason then
      return new;
    end if;
  end if;

  insert into public.daily_admin_details (
    owner_id, business_date, business_status, cleaning_done, arrangement_done, note,
    reconciliation_status, bluebook_total_vnd, reconciliation_difference_vnd,
    reconciliation_note, electricity_reset_reason, created_at, updated_at
  ) values (
    new.owner_id, new.business_date, new.business_status, new.cleaning_done,
    new.arrangement_done, new.note, new.reconciliation_status, new.bluebook_total_vnd,
    new.reconciliation_difference_vnd, new.reconciliation_note,
    new.electricity_reset_reason, new.created_at, new.updated_at
  )
  on conflict (owner_id, business_date) do update set
    business_status = excluded.business_status,
    cleaning_done = excluded.cleaning_done,
    arrangement_done = excluded.arrangement_done,
    note = excluded.note,
    reconciliation_status = excluded.reconciliation_status,
    bluebook_total_vnd = excluded.bluebook_total_vnd,
    reconciliation_difference_vnd = excluded.reconciliation_difference_vnd,
    reconciliation_note = excluded.reconciliation_note,
    electricity_reset_reason = excluded.electricity_reset_reason,
    updated_at = excluded.updated_at;

  return new;
end;
$$;
revoke all on function private.sync_daily_admin_from_legacy() from public, anon, authenticated;
create trigger sync_daily_admin_from_legacy
  after insert or update on public.daily_records
  for each row execute function private.sync_daily_admin_from_legacy();

create function private.sync_legacy_daily_admin_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  update public.daily_records as daily set
    business_status = new.business_status,
    cleaning_done = new.cleaning_done,
    arrangement_done = new.arrangement_done,
    note = new.note,
    reconciliation_status = new.reconciliation_status,
    bluebook_total_vnd = new.bluebook_total_vnd,
    reconciliation_difference_vnd = new.reconciliation_difference_vnd,
    reconciliation_note = new.reconciliation_note,
    electricity_reset_reason = new.electricity_reset_reason
  where daily.owner_id = new.owner_id
    and daily.business_date = new.business_date
    and (
      daily.business_status is distinct from new.business_status
      or daily.cleaning_done is distinct from new.cleaning_done
      or daily.arrangement_done is distinct from new.arrangement_done
      or daily.note is distinct from new.note
      or daily.reconciliation_status is distinct from new.reconciliation_status
      or daily.bluebook_total_vnd is distinct from new.bluebook_total_vnd
      or daily.reconciliation_difference_vnd is distinct from new.reconciliation_difference_vnd
      or daily.reconciliation_note is distinct from new.reconciliation_note
      or daily.electricity_reset_reason is distinct from new.electricity_reset_reason
    );

  return new;
end;
$$;
revoke all on function private.sync_legacy_daily_admin_details() from public, anon, authenticated;
create trigger sync_legacy_daily_admin_details
  after insert or update on public.daily_admin_details
  for each row execute function private.sync_legacy_daily_admin_details();

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  record_key text;
  row_owner uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_row := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_row := to_jsonb(new); end if;

  if tg_table_name = 'daily_records' then
    if old_row is not null then
      old_row := old_row - array[
        'business_status', 'cleaning_done', 'arrangement_done', 'note',
        'reconciliation_status', 'bluebook_total_vnd', 'reconciliation_difference_vnd',
        'reconciliation_note', 'electricity_reset_reason'
      ];
    end if;
    if new_row is not null then
      new_row := new_row - array[
        'business_status', 'cleaning_done', 'arrangement_done', 'note',
        'reconciliation_status', 'bluebook_total_vnd', 'reconciliation_difference_vnd',
        'reconciliation_note', 'electricity_reset_reason'
      ];
    end if;
    if tg_op = 'UPDATE' and old_row is not distinct from new_row then
      return new;
    end if;
  end if;

  row_data := coalesce(new_row, old_row);
  row_owner := (row_data ->> 'owner_id')::uuid;
  if row_owner is null or ((select auth.uid()) is not null and row_owner <> (select auth.uid())) then
    raise exception 'Invalid owner for audit event';
  end if;

  record_key := coalesce(row_data ->> 'id', row_data ->> 'business_date', row_data ->> 'month_start', row_data ->> 'week_start');
  if record_key is null then raise exception 'Cannot audit row without a record key'; end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data
  ) values (
    row_owner, (select auth.uid()), case when (select auth.uid()) is null then 'system' else 'owner' end,
    tg_table_name, record_key, tg_op, old_row, new_row
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.save_owner_daily_record(
  p_business_date date,
  p_business_status text,
  p_shift_06_10_vnd bigint,
  p_shift_10_14_vnd bigint,
  p_shift_14_18_vnd bigint,
  p_shift_18_22_vnd bigint,
  p_grab_vnd bigint,
  p_shopee_vnd bigint,
  p_electricity_morning_kwh numeric,
  p_electricity_evening_kwh numeric,
  p_cleaning_done boolean,
  p_arrangement_done boolean,
  p_note text,
  p_reconciliation_status text,
  p_bluebook_total_vnd bigint,
  p_reconciliation_difference_vnd bigint,
  p_reconciliation_note text,
  p_electricity_reset_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception 'Owner authorization required';
  end if;
  if p_business_date < date '2026-09-01' then raise exception 'Business date is outside the ledger'; end if;

  insert into public.daily_records (
    owner_id, business_date, shift_06_10_vnd, shift_10_14_vnd, shift_14_18_vnd,
    shift_18_22_vnd, grab_vnd, shopee_vnd, electricity_morning_kwh, electricity_evening_kwh
  ) values (
    current_owner_id, p_business_date, p_shift_06_10_vnd, p_shift_10_14_vnd, p_shift_14_18_vnd,
    p_shift_18_22_vnd, p_grab_vnd, p_shopee_vnd, p_electricity_morning_kwh, p_electricity_evening_kwh
  )
  on conflict (owner_id, business_date) do update set
    shift_06_10_vnd = excluded.shift_06_10_vnd,
    shift_10_14_vnd = excluded.shift_10_14_vnd,
    shift_14_18_vnd = excluded.shift_14_18_vnd,
    shift_18_22_vnd = excluded.shift_18_22_vnd,
    grab_vnd = excluded.grab_vnd,
    shopee_vnd = excluded.shopee_vnd,
    electricity_morning_kwh = excluded.electricity_morning_kwh,
    electricity_evening_kwh = excluded.electricity_evening_kwh;

  insert into public.daily_admin_details (
    owner_id, business_date, business_status, cleaning_done, arrangement_done, note,
    reconciliation_status, bluebook_total_vnd, reconciliation_difference_vnd,
    reconciliation_note, electricity_reset_reason
  ) values (
    current_owner_id, p_business_date, p_business_status, p_cleaning_done, p_arrangement_done,
    p_note, p_reconciliation_status, p_bluebook_total_vnd, p_reconciliation_difference_vnd,
    p_reconciliation_note, p_electricity_reset_reason
  )
  on conflict (owner_id, business_date) do update set
    business_status = excluded.business_status,
    cleaning_done = excluded.cleaning_done,
    arrangement_done = excluded.arrangement_done,
    note = excluded.note,
    reconciliation_status = excluded.reconciliation_status,
    bluebook_total_vnd = excluded.bluebook_total_vnd,
    reconciliation_difference_vnd = excluded.reconciliation_difference_vnd,
    reconciliation_note = excluded.reconciliation_note,
    electricity_reset_reason = excluded.electricity_reset_reason;
end;
$$;
revoke all on function public.save_owner_daily_record(date, text, bigint, bigint, bigint, bigint, bigint, bigint, numeric, numeric, boolean, boolean, text, text, bigint, bigint, text, text) from public, anon;
grant execute on function public.save_owner_daily_record(date, text, bigint, bigint, bigint, bigint, bigint, bigint, numeric, numeric, boolean, boolean, text, text, bigint, bigint, text, text) to authenticated;
