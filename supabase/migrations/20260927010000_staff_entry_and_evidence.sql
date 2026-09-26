-- Staff writes use narrow allowlisted functions. The base tables remain readable
-- for the owner and the current-week staff dashboard, but cannot be mutated by
-- a direct Data API request.

create table public.daily_shift_deletions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  business_date date not null,
  shift_code text not null check (shift_code in ('06-10', '10-14', '14-18', '18-22')),
  amount_vnd bigint not null check (amount_vnd >= 0),
  deleted_by uuid not null references auth.users (id) on delete restrict,
  deleted_at timestamptz not null default now(),
  restored_by uuid references auth.users (id) on delete set null,
  restored_at timestamptz,
  foreign key (owner_id, business_date)
    references public.daily_records (owner_id, business_date) on delete cascade
);

alter table public.daily_shift_deletions enable row level security;
revoke all on public.daily_shift_deletions from anon, authenticated;
grant select on public.daily_shift_deletions to authenticated;
create policy "owner reads deleted shifts"
  on public.daily_shift_deletions for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create index daily_shift_deletions_owner_date_idx
  on public.daily_shift_deletions (owner_id, business_date, deleted_at desc);
create index daily_expenses_deleted_by_idx on public.daily_expenses (deleted_by);
create index daily_shift_deletions_deleted_by_idx on public.daily_shift_deletions (deleted_by);
create index daily_shift_deletions_restored_by_idx on public.daily_shift_deletions (restored_by);
create trigger audit_row_change after insert or update on public.daily_shift_deletions
  for each row execute function private.audit_row_change();

-- Staff RPCs write rows that belong to the store owner. Keep those writes
-- auditable while preserving the owner boundary and recording the actor role.
alter table public.audit_events
  drop constraint if exists audit_events_actor_type_check;
alter table public.audit_events
  add constraint audit_events_actor_type_check
  check (actor_type in ('owner', 'staff', 'system'));

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
  current_actor uuid := (select auth.uid());
  current_actor_type text;
begin
  if tg_op = 'INSERT' then
    new_row := to_jsonb(new);
    row_data := new_row;
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    row_data := new_row;
  else
    old_row := to_jsonb(old);
    row_data := old_row;
  end if;

  row_owner := (row_data ->> 'owner_id')::uuid;
  if row_owner is null then
    raise exception 'Invalid owner for audit event';
  end if;

  if current_actor is null then
    current_actor_type := 'system';
  elsif private.is_store_owner() and row_owner = current_actor then
    current_actor_type := 'owner';
  elsif private.is_active_store_member(row_owner) then
    current_actor_type := 'staff';
  else
    raise exception 'Invalid actor for audit event';
  end if;

  record_key := coalesce(row_data ->> 'id', row_data ->> 'business_date', row_data ->> 'month_start', row_data ->> 'week_start');
  if record_key is null then
    raise exception 'Cannot audit row without a record key';
  end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data
  ) values (
    row_owner, current_actor, current_actor_type, tg_table_name, record_key, tg_op, old_row, new_row
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.audit_row_change() from public, anon;
grant execute on function private.audit_row_change() to authenticated;

-- Existing owner save RPC is the only owner write path after the table grant is
-- removed. Its own owner check remains in the function body.
alter function public.save_owner_daily_record(
  date, text, bigint, bigint, bigint, bigint, bigint, bigint, numeric, numeric,
  boolean, boolean, text, text, bigint, bigint, text, text
) security definer;

revoke insert, update on public.daily_records from authenticated;
revoke insert, update, delete on public.daily_expenses from authenticated;
grant select on public.daily_records, public.daily_expenses to authenticated;

drop policy if exists "staff reads current week daily sales" on public.daily_records;
drop policy if exists "daily_records owner select" on public.daily_records;
create policy "daily records owner or staff select"
  on public.daily_records for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );

drop policy if exists "staff reads current week incidental expenses" on public.daily_expenses;
drop policy if exists "daily_expenses owner select" on public.daily_expenses;
create policy "daily expenses owner or staff select"
  on public.daily_expenses for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and deleted_at is null
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );

drop policy if exists "staff inserts today's daily sales" on public.daily_records;
drop policy if exists "staff updates today's daily sales" on public.daily_records;
drop policy if exists "staff inserts today's incidental expenses" on public.daily_expenses;
drop policy if exists "staff updates today's incidental expenses" on public.daily_expenses;

drop policy if exists "staff reads own active membership" on public.store_memberships;
drop policy if exists "store owner reads own memberships" on public.store_memberships;
create policy "membership owner or current staff select"
  on public.store_memberships for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (active and user_id = (select auth.uid())
      and private.is_current_staff_auth_session(user_id, staff_session_valid_after))
  );

create or replace function private.staff_owner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.owner_id
  from public.store_memberships as membership
  where membership.user_id = (select auth.uid())
    and membership.role = 'staff'
    and membership.active
    and private.is_current_staff_auth_session(membership.user_id, membership.staff_session_valid_after)
  limit 1;
$$;
revoke all on function private.staff_owner_id() from public, anon;
grant execute on function private.staff_owner_id() to authenticated;

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
    raise exception 'Owner authorization required';
  end if;
  if p_business_date < date '2026-09-01' or p_amount_vnd is null or p_amount_vnd <= 0
     or length(normalized_reason) not between 2 and 240 then
    raise exception 'Invalid incidental expense';
  end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;

  insert into public.daily_expenses (owner_id, business_date, amount_vnd, reason)
  values (current_owner_id, p_business_date, p_amount_vnd, normalized_reason)
  returning id into expense_id;
  return expense_id;
end;
$$;
revoke all on function public.owner_add_daily_expense(date, bigint, text) from public, anon, authenticated;
grant execute on function public.owner_add_daily_expense(date, bigint, text) to authenticated;

create or replace function public.staff_save_shift_revenue(
  p_business_date date,
  p_shift_code text,
  p_amount_vnd bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_shift_code not in ('06-10', '10-14', '14-18', '18-22') or p_amount_vnd is null or p_amount_vnd < 0 then
    raise exception 'Invalid shift revenue';
  end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;

  update public.daily_records set
    shift_06_10_vnd = case when p_shift_code = '06-10' then p_amount_vnd else shift_06_10_vnd end,
    shift_10_14_vnd = case when p_shift_code = '10-14' then p_amount_vnd else shift_10_14_vnd end,
    shift_14_18_vnd = case when p_shift_code = '14-18' then p_amount_vnd else shift_14_18_vnd end,
    shift_18_22_vnd = case when p_shift_code = '18-22' then p_amount_vnd else shift_18_22_vnd end,
    updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date;
end;
$$;

create or replace function public.staff_delete_shift_revenue(
  p_business_date date,
  p_shift_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
  previous_amount bigint;
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_shift_code not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift'; end if;

  select case p_shift_code
    when '06-10' then shift_06_10_vnd
    when '10-14' then shift_10_14_vnd
    when '14-18' then shift_14_18_vnd
    else shift_18_22_vnd
  end
  into previous_amount
  from public.daily_records
  where owner_id = current_owner_id and business_date = p_business_date
  for update;
  if previous_amount is null then return; end if;

  insert into public.daily_shift_deletions (owner_id, business_date, shift_code, amount_vnd, deleted_by)
  values (current_owner_id, p_business_date, p_shift_code, previous_amount, (select auth.uid()));

  update public.daily_records set
    shift_06_10_vnd = case when p_shift_code = '06-10' then null else shift_06_10_vnd end,
    shift_10_14_vnd = case when p_shift_code = '10-14' then null else shift_10_14_vnd end,
    shift_14_18_vnd = case when p_shift_code = '14-18' then null else shift_14_18_vnd end,
    shift_18_22_vnd = case when p_shift_code = '18-22' then null else shift_18_22_vnd end,
    updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date;
end;
$$;

create or replace function public.staff_save_platform_revenue(
  p_business_date date,
  p_channel text,
  p_amount_vnd bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_channel not in ('grab', 'shopee') or p_amount_vnd is null or p_amount_vnd < 0 then raise exception 'Invalid platform revenue'; end if;
  insert into public.daily_records (owner_id, business_date) values (current_owner_id, p_business_date) on conflict (owner_id, business_date) do nothing;
  update public.daily_records set
    grab_vnd = case when p_channel = 'grab' then p_amount_vnd else grab_vnd end,
    shopee_vnd = case when p_channel = 'shopee' then p_amount_vnd else shopee_vnd end,
    updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date;
end;
$$;

create or replace function public.staff_increment_platform_orders(
  p_business_date date,
  p_channel text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare current_owner_id uuid := (select private.staff_owner_id()); new_count integer;
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_channel not in ('grab', 'shopee') or p_delta is null or p_delta <= 0 then raise exception 'Invalid order increment'; end if;
  insert into public.daily_records (owner_id, business_date) values (current_owner_id, p_business_date) on conflict (owner_id, business_date) do nothing;
  update public.daily_records set
    grab_order_count = case when p_channel = 'grab' then grab_order_count + p_delta else grab_order_count end,
    shopee_order_count = case when p_channel = 'shopee' then shopee_order_count + p_delta else shopee_order_count end,
    updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date
  returning case when p_channel = 'grab' then grab_order_count else shopee_order_count end into new_count;
  return new_count;
end;
$$;

create or replace function public.staff_set_platform_orders(
  p_business_date date,
  p_channel text,
  p_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_channel not in ('grab', 'shopee') or p_count is null or p_count < 0 then raise exception 'Invalid order count'; end if;
  insert into public.daily_records (owner_id, business_date) values (current_owner_id, p_business_date) on conflict (owner_id, business_date) do nothing;
  update public.daily_records set
    grab_order_count = case when p_channel = 'grab' then p_count else grab_order_count end,
    shopee_order_count = case when p_channel = 'shopee' then p_count else shopee_order_count end,
    updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date;
end;
$$;

create or replace function public.staff_set_total_bill_count(
  p_business_date date,
  p_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_count is null or p_count < 0 then raise exception 'Invalid bill count'; end if;
  insert into public.daily_records (owner_id, business_date) values (current_owner_id, p_business_date) on conflict (owner_id, business_date) do nothing;
  update public.daily_records set total_bill_count = p_count, updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date;
end;
$$;

create or replace function public.staff_set_meter_readings(
  p_business_date date,
  p_morning_kwh numeric,
  p_evening_kwh numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if (p_morning_kwh is not null and p_morning_kwh < 0) or (p_evening_kwh is not null and p_evening_kwh < 0) then raise exception 'Invalid meter reading'; end if;
  insert into public.daily_records (owner_id, business_date) values (current_owner_id, p_business_date) on conflict (owner_id, business_date) do nothing;
  update public.daily_records set electricity_morning_kwh = p_morning_kwh, electricity_evening_kwh = p_evening_kwh, updated_at = now()
  where owner_id = current_owner_id and business_date = p_business_date;
end;
$$;

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
declare current_owner_id uuid := (select private.staff_owner_id()); expense_id uuid; normalized_reason text := trim(p_reason);
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() or p_amount_vnd is null or p_amount_vnd <= 0 or length(normalized_reason) not between 2 and 240 then raise exception 'Invalid incidental expense'; end if;
  insert into public.daily_records (owner_id, business_date) values (current_owner_id, p_business_date) on conflict (owner_id, business_date) do nothing;
  insert into public.daily_expenses (owner_id, business_date, amount_vnd, reason) values (current_owner_id, p_business_date, p_amount_vnd, normalized_reason) returning id into expense_id;
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
declare current_owner_id uuid := (select private.staff_owner_id()); normalized_reason text := trim(p_reason);
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 or length(normalized_reason) not between 2 and 240 then raise exception 'Invalid incidental expense'; end if;
  update public.daily_expenses set amount_vnd = p_amount_vnd, reason = normalized_reason, updated_at = now()
  where id = p_expense_id and owner_id = current_owner_id and business_date = private.current_business_date_vn() and deleted_at is null;
  if not found then raise exception 'Expense not found or no longer editable'; end if;
end;
$$;

create or replace function public.staff_delete_incidental_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_owner_id uuid := (select private.staff_owner_id());
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  update public.daily_expenses set deleted_at = now(), deleted_by = (select auth.uid()), updated_at = now()
  where id = p_expense_id and owner_id = current_owner_id and business_date = private.current_business_date_vn() and deleted_at is null;
  if not found then raise exception 'Expense not found or no longer editable'; end if;
end;
$$;

create or replace function public.owner_restore_shift_revenue(p_deletion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  deletion_row public.daily_shift_deletions%rowtype;
  existing_amount bigint;
begin
  if current_owner_id is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  select * into deletion_row
  from public.daily_shift_deletions
  where id = p_deletion_id and owner_id = current_owner_id and restored_at is null
  for update;
  if not found then raise exception 'Deleted shift not found or already restored'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, deletion_row.business_date)
  on conflict (owner_id, business_date) do nothing;
  execute format(
    'select %I from public.daily_records where owner_id = $1 and business_date = $2 for update',
    case deletion_row.shift_code
      when '06-10' then 'shift_06_10_vnd'
      when '10-14' then 'shift_10_14_vnd'
      when '14-18' then 'shift_14_18_vnd'
      else 'shift_18_22_vnd'
    end
  ) into existing_amount using current_owner_id, deletion_row.business_date;
  if existing_amount is not null then raise exception 'Shift already has a value'; end if;

  execute format(
    'update public.daily_records set %I = $1, updated_at = now() where owner_id = $2 and business_date = $3',
    case deletion_row.shift_code
      when '06-10' then 'shift_06_10_vnd'
      when '10-14' then 'shift_10_14_vnd'
      when '14-18' then 'shift_14_18_vnd'
      else 'shift_18_22_vnd'
    end
  ) using deletion_row.amount_vnd, current_owner_id, deletion_row.business_date;
  update public.daily_shift_deletions
  set restored_by = current_owner_id, restored_at = now()
  where id = deletion_row.id;
end;
$$;

revoke all on function public.staff_save_shift_revenue(date, text, bigint) from public, anon, authenticated;
revoke all on function public.staff_delete_shift_revenue(date, text) from public, anon, authenticated;
revoke all on function public.staff_save_platform_revenue(date, text, bigint) from public, anon, authenticated;
revoke all on function public.staff_increment_platform_orders(date, text, integer) from public, anon, authenticated;
revoke all on function public.staff_set_platform_orders(date, text, integer) from public, anon, authenticated;
revoke all on function public.staff_set_total_bill_count(date, integer) from public, anon, authenticated;
revoke all on function public.staff_set_meter_readings(date, numeric, numeric) from public, anon, authenticated;
revoke all on function public.staff_add_incidental_expense(date, bigint, text) from public, anon, authenticated;
revoke all on function public.staff_update_incidental_expense(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.staff_delete_incidental_expense(uuid) from public, anon, authenticated;
revoke all on function public.owner_restore_shift_revenue(uuid) from public, anon, authenticated;
grant execute on function public.staff_save_shift_revenue(date, text, bigint) to authenticated;
grant execute on function public.staff_delete_shift_revenue(date, text) to authenticated;
grant execute on function public.staff_save_platform_revenue(date, text, bigint) to authenticated;
grant execute on function public.staff_increment_platform_orders(date, text, integer) to authenticated;
grant execute on function public.staff_set_platform_orders(date, text, integer) to authenticated;
grant execute on function public.staff_set_total_bill_count(date, integer) to authenticated;
grant execute on function public.staff_set_meter_readings(date, numeric, numeric) to authenticated;
grant execute on function public.staff_add_incidental_expense(date, bigint, text) to authenticated;
grant execute on function public.staff_update_incidental_expense(uuid, bigint, text) to authenticated;
grant execute on function public.staff_delete_incidental_expense(uuid) to authenticated;
grant execute on function public.owner_restore_shift_revenue(uuid) to authenticated;
