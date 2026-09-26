create or replace function private.current_business_date_vn()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;
revoke all on function private.current_business_date_vn() from public, anon;
grant execute on function private.current_business_date_vn() to authenticated;

create or replace function private.current_week_start_vn()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;
revoke all on function private.current_week_start_vn() from public, anon;
grant execute on function private.current_week_start_vn() to authenticated;

drop trigger if exists sync_daily_admin_from_legacy on public.daily_records;
drop trigger if exists sync_legacy_daily_admin_details on public.daily_admin_details;
drop function if exists private.sync_daily_admin_from_legacy();
drop function if exists private.sync_legacy_daily_admin_details();

alter table public.daily_records
  drop column business_status,
  drop column cleaning_done,
  drop column arrangement_done,
  drop column note,
  drop column reconciliation_status,
  drop column bluebook_total_vnd,
  drop column reconciliation_difference_vnd,
  drop column reconciliation_note,
  drop column electricity_reset_reason;

create policy "staff reads current week daily sales"
  on public.daily_records for select to authenticated
  using (
    private.is_active_store_member(owner_id)
    and business_date >= private.current_week_start_vn()
    and business_date <= private.current_week_start_vn() + 6
  );

create policy "staff reads current week incidental expenses"
  on public.daily_expenses for select to authenticated
  using (
    private.is_active_store_member(owner_id)
    and business_date >= private.current_week_start_vn()
    and business_date <= private.current_week_start_vn() + 6
  );

create policy "staff inserts today's daily sales"
  on public.daily_records for insert to authenticated
  with check (
    private.is_active_store_member(owner_id)
    and business_date = private.current_business_date_vn()
  );

create policy "staff updates today's daily sales"
  on public.daily_records for update to authenticated
  using (
    private.is_active_store_member(owner_id)
    and business_date = private.current_business_date_vn()
  )
  with check (
    private.is_active_store_member(owner_id)
    and business_date = private.current_business_date_vn()
  );

create policy "staff inserts today's incidental expenses"
  on public.daily_expenses for insert to authenticated
  with check (
    private.is_active_store_member(owner_id)
    and business_date = private.current_business_date_vn()
    and deleted_at is null
    and deleted_by is null
  );

create policy "staff updates today's incidental expenses"
  on public.daily_expenses for update to authenticated
  using (
    private.is_active_store_member(owner_id)
    and business_date = private.current_business_date_vn()
  )
  with check (
    private.is_active_store_member(owner_id)
    and business_date = private.current_business_date_vn()
    and (deleted_at is null or deleted_by = (select auth.uid()))
  );

revoke delete on public.daily_expenses from authenticated;

alter table public.audit_events drop constraint if exists audit_events_actor_type_check;
alter table public.audit_events
  add constraint audit_events_actor_type_check check (actor_type in ('owner', 'staff', 'system'));

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
  row_actor_type text;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_row := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_row := to_jsonb(new); end if;

  row_data := coalesce(new_row, old_row);
  row_owner := (row_data ->> 'owner_id')::uuid;
  if row_owner is null then raise exception 'Invalid owner for audit event'; end if;

  if (select auth.uid()) is null then
    row_actor_type := 'system';
  elsif private.is_store_owner() and row_owner = (select auth.uid()) then
    row_actor_type := 'owner';
  elsif private.is_active_store_member(row_owner) then
    row_actor_type := 'staff';
  else
    raise exception 'Invalid actor for audit event';
  end if;

  record_key := coalesce(row_data ->> 'id', row_data ->> 'business_date', row_data ->> 'month_start', row_data ->> 'week_start');
  if record_key is null then raise exception 'Cannot audit row without a record key'; end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data
  ) values (
    row_owner, (select auth.uid()), row_actor_type, tg_table_name, record_key, tg_op, old_row, new_row
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.audit_row_change() from public, anon, authenticated;
