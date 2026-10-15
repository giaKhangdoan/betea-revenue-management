-- Electricity meter and equipment diary. Existing kWh columns remain the
-- single source of truth for monthly cost calculations and the public GET API.

alter table public.daily_records
  add column electricity_morning_status text,
  add column electricity_morning_recorded_at time,
  add column electricity_morning_unavailable_reason text,
  add column electricity_morning_note text,
  add column electricity_evening_status text,
  add column electricity_evening_recorded_at time,
  add column electricity_evening_unavailable_reason text,
  add column electricity_evening_note text,
  add column electricity_evening_turned_off_unneeded boolean,
  add column electricity_evening_checked_cooler_doors boolean,
  add column electricity_evening_meter_photo_confirmed boolean;

alter table public.daily_records
  add constraint daily_records_electricity_morning_status_check
    check (electricity_morning_status is null or electricity_morning_status in ('recorded', 'unable')),
  add constraint daily_records_electricity_morning_status_values_check
    check (
      (electricity_morning_status is distinct from 'recorded'
        or (electricity_morning_recorded_at is not null and electricity_morning_kwh is not null
          and electricity_morning_unavailable_reason is null))
      and (electricity_morning_status is distinct from 'unable'
        or (electricity_morning_recorded_at is null and electricity_morning_kwh is null
          and nullif(trim(electricity_morning_unavailable_reason), '') is not null))
    ),
  add constraint daily_records_electricity_evening_status_check
    check (electricity_evening_status is null or electricity_evening_status in ('recorded', 'unable')),
  add constraint daily_records_electricity_evening_status_values_check
    check (
      (electricity_evening_status is distinct from 'recorded'
        or (electricity_evening_recorded_at is not null and electricity_evening_kwh is not null
          and electricity_evening_unavailable_reason is null))
      and (electricity_evening_status is distinct from 'unable'
        or (electricity_evening_recorded_at is null and electricity_evening_kwh is null
          and nullif(trim(electricity_evening_unavailable_reason), '') is not null))
    ),
  add constraint daily_records_electricity_notes_check
    check (
      (electricity_morning_unavailable_reason is null or length(trim(electricity_morning_unavailable_reason)) between 2 and 240)
      and (electricity_morning_note is null or length(electricity_morning_note) <= 500)
      and (electricity_evening_unavailable_reason is null or length(trim(electricity_evening_unavailable_reason)) between 2 and 240)
      and (electricity_evening_note is null or length(electricity_evening_note) <= 500)
    );

alter table public.day_photos
  add column electricity_period text;
alter table public.day_photos
  drop constraint if exists day_photos_category_check;
alter table public.day_photos
  add constraint day_photos_category_check
    check (category in ('bluebook', 'cleaning', 'arrangement', 'other', 'electricity_meter')),
  add constraint day_photos_electricity_period_pair_check
    check (
      (category = 'electricity_meter' and electricity_period is not null and electricity_period in ('morning', 'evening') and shift_code is null)
      or (category <> 'electricity_meter' and electricity_period is null)
    );

alter table public.audit_events add column reason text;

create table public.electricity_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  mode text not null check (mode in ('timed', 'continuous')),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create unique index electricity_devices_owner_name_lower_idx
  on public.electricity_devices (owner_id, lower(name));
create index electricity_devices_owner_active_order_idx
  on public.electricity_devices (owner_id, is_active, sort_order, name);

alter table public.electricity_devices enable row level security;
revoke all on public.electricity_devices from anon, authenticated;
grant select on public.electricity_devices to authenticated;
create policy "owner or staff reads allowed electricity devices"
  on public.electricity_devices for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (is_active and owner_id = (select private.staff_owner_id()))
  );
create trigger set_updated_at before update on public.electricity_devices
  for each row execute function private.touch_updated_at();
create trigger audit_row_change after insert or update on public.electricity_devices
  for each row execute function private.audit_row_change();

create table public.daily_electricity_device_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  business_date date not null,
  period text not null check (period in ('morning', 'evening')),
  device_id uuid not null,
  device_name_snapshot text not null check (length(trim(device_name_snapshot)) between 2 and 80),
  device_mode_snapshot text not null check (device_mode_snapshot in ('timed', 'continuous')),
  operating_status text not null check (operating_status in ('not_running', 'running')),
  started_at time,
  ended_at time,
  ends_next_day boolean not null default false,
  ran_from_previous_night boolean,
  remains_on_after_close boolean,
  note text check (note is null or length(note) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, business_date)
    references public.daily_records (owner_id, business_date) on delete cascade,
  foreign key (owner_id, device_id)
    references public.electricity_devices (owner_id, id) on delete restrict,
  unique (owner_id, business_date, period, device_id),
  constraint daily_electricity_device_log_period_flags_check
    check (
      (period = 'morning' and remains_on_after_close is null)
      or (period = 'evening' and ran_from_previous_night is null)
    ),
  constraint daily_electricity_device_log_state_check
    check (
      (operating_status = 'not_running'
        and started_at is null and ended_at is null and not ends_next_day
        and ran_from_previous_night is distinct from true
        and remains_on_after_close is distinct from true)
      or (operating_status = 'running' and device_mode_snapshot = 'timed'
        and (started_at is not null or (period = 'morning' and ran_from_previous_night is true))
        and (ended_at is not null or (period = 'evening' and remains_on_after_close is true))
        and (not ends_next_day or ended_at is not null))
      or (operating_status = 'running' and device_mode_snapshot = 'continuous'
        and started_at is null and ended_at is null and not ends_next_day)
    )
);

create index daily_electricity_device_logs_owner_date_period_idx
  on public.daily_electricity_device_logs (owner_id, business_date desc, period);

alter table public.daily_electricity_device_logs enable row level security;
revoke all on public.daily_electricity_device_logs from anon, authenticated;
grant select on public.daily_electricity_device_logs to authenticated;
create policy "owner or current-week staff reads electricity device logs"
  on public.daily_electricity_device_logs for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (owner_id = (select private.staff_owner_id())
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );
create trigger set_updated_at before update on public.daily_electricity_device_logs
  for each row execute function private.touch_updated_at();
create trigger audit_row_change after insert or update or delete on public.daily_electricity_device_logs
  for each row execute function private.audit_row_change();

create or replace function private.seed_default_electricity_devices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.electricity_devices (owner_id, name, mode, sort_order)
  values
    (new.user_id, 'Điều hòa', 'timed', 10),
    (new.user_id, 'Máy làm đá', 'timed', 20),
    (new.user_id, 'Tủ mát / tủ đông', 'continuous', 30)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.seed_default_electricity_devices() from public, anon, authenticated;
create trigger seed_default_electricity_devices
  after insert on public.owner_profiles
  for each row execute function private.seed_default_electricity_devices();

insert into public.electricity_devices (owner_id, name, mode, sort_order)
select profile.user_id, seed.name, seed.mode, seed.sort_order
from public.owner_profiles as profile
cross join (values
  ('Điều hòa', 'timed', 10),
  ('Máy làm đá', 'timed', 20),
  ('Tủ mát / tủ đông', 'continuous', 30)
) as seed(name, mode, sort_order)
on conflict do nothing;

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
  audit_reason text := nullif(current_setting('app.audit_reason', true), '');
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
  if row_owner is null then raise exception 'Invalid owner for audit event'; end if;

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
  if record_key is null then raise exception 'Cannot audit row without a record key'; end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data, reason
  ) values (
    row_owner, current_actor, current_actor_type, tg_table_name, record_key, tg_op, old_row, new_row, audit_reason
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.audit_row_change() from public, anon;
grant execute on function private.audit_row_change() to authenticated;

create or replace function private.save_electricity_period(
  p_owner_id uuid,
  p_actor_mode text,
  p_business_date date,
  p_period text,
  p_status text,
  p_recorded_at time,
  p_meter_kwh numeric,
  p_unavailable_reason text,
  p_note text,
  p_device_logs jsonb,
  p_checklist jsonb,
  p_reset_reason text,
  p_edit_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid;
  normalized_unavailable_reason text := nullif(trim(p_unavailable_reason), '');
  normalized_note text := nullif(trim(p_note), '');
  normalized_reset_reason text := nullif(trim(p_reset_reason), '');
  normalized_edit_reason text := nullif(trim(p_edit_reason), '');
  item jsonb;
  seen_ids uuid[] := array[]::uuid[];
  logged_ids uuid[] := array[]::uuid[];
  device_id_value uuid;
  device_name_value text;
  device_mode_value text;
  saved_device_name text;
  saved_device_mode text;
  saved_device_log boolean;
  client_device_mode text;
  device_active boolean;
  operating_status_value text;
  started_at_value time;
  ended_at_value time;
  ends_next_day_value boolean;
  ran_from_previous_night_value boolean;
  remains_on_after_close_value boolean;
  device_note_value text;
  target_slot integer;
  old_target_kwh numeric;
  old_reset_reason text;
  meter_value_changed boolean := false;
  reset_reason_changed boolean := false;
  previous_kwh numeric;
  next_kwh numeric;
  target_kwh numeric;
  target_reset_reason text;
  next_reset_reason text;
begin
  if p_actor_mode = 'owner' then
    if (select auth.uid()) is null or not private.is_store_owner()
      or p_owner_id is distinct from (select auth.uid()) then
      raise exception 'Owner authorization required';
    end if;
    current_owner_id := p_owner_id;
  elsif p_actor_mode = 'staff' then
    current_owner_id := (select private.staff_owner_id());
    if current_owner_id is null or p_owner_id is distinct from current_owner_id then
      raise exception 'Active staff authorization required';
    end if;
    if p_business_date is distinct from private.current_business_date_vn() then
      raise exception 'Staff can edit today only';
    end if;
  else
    raise exception 'Invalid electricity actor';
  end if;

  if p_business_date is null or p_business_date < date '2026-09-01'
    or p_period is null or p_period not in ('morning', 'evening') then
    raise exception 'Invalid electricity date or period';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_owner_id::text, 0));
  if p_status is not null and p_status not in ('recorded', 'unable') then
    raise exception 'Invalid meter status';
  end if;
  if p_status = 'recorded' then
    if p_recorded_at is null or p_meter_kwh is null or p_meter_kwh < 0
      or p_meter_kwh > 99999999999.999 or p_meter_kwh <> round(p_meter_kwh, 3)
      or normalized_unavailable_reason is not null then
      raise exception 'Recorded meter status needs time and a valid kWh value';
    end if;
  elsif p_status = 'unable' then
    if p_recorded_at is not null or p_meter_kwh is not null
      or normalized_unavailable_reason is null
      or length(normalized_unavailable_reason) not between 2 and 240 then
      raise exception 'Unavailable meter status needs a reason and no meter value';
    end if;
  elsif p_recorded_at is not null or p_meter_kwh is not null or normalized_unavailable_reason is not null then
    raise exception 'Unrecorded meter status cannot contain a reading or unavailable reason';
  end if;
  if normalized_note is not null and length(normalized_note) > 500 then
    raise exception 'Electricity note is too long';
  end if;
  if p_device_logs is not null and jsonb_typeof(p_device_logs) <> 'array' then
    raise exception 'Device logs must be an array';
  end if;
  if p_device_logs is not null and jsonb_array_length(p_device_logs) > 50 then
    raise exception 'Too many device logs';
  end if;
  if p_period = 'morning' and p_checklist is not null then
    raise exception 'The evening checklist can only be saved with the evening period';
  end if;
  if p_checklist is not null and jsonb_typeof(p_checklist) <> 'object' then
    raise exception 'Invalid evening checklist';
  end if;
  if p_checklist is not null and exists (
    select 1 from jsonb_each(p_checklist) as field(key, value)
    where field.key not in ('turned_off_unneeded', 'checked_cooler_doors', 'meter_photo_confirmed')
      or jsonb_typeof(field.value) not in ('boolean', 'null')
  ) then
    raise exception 'Invalid evening checklist value';
  end if;
  if p_actor_mode = 'owner' and p_business_date < private.current_business_date_vn()
    and (normalized_edit_reason is null or length(normalized_edit_reason) not between 5 and 500) then
    raise exception 'A reason is required to edit historical electricity';
  end if;
  perform set_config('app.audit_reason', coalesce(normalized_edit_reason, ''), true);

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;

  target_slot := case when p_period = 'morning' then 0 else 1 end;
  select case when p_period = 'morning' then daily.electricity_morning_kwh else daily.electricity_evening_kwh end
    into old_target_kwh
  from public.daily_records as daily
  where daily.owner_id = current_owner_id and daily.business_date = p_business_date;
  select details.electricity_reset_reason into old_reset_reason
  from public.daily_admin_details as details
  where details.owner_id = current_owner_id and details.business_date = p_business_date;

  if p_status = 'recorded' and old_target_kwh is distinct from p_meter_kwh then
    select point.kwh into previous_kwh
    from (
      select daily.business_date, 0 as slot, daily.electricity_morning_kwh as kwh
      from public.daily_records as daily where daily.owner_id = current_owner_id
      union all
      select daily.business_date, 1 as slot, daily.electricity_evening_kwh as kwh
      from public.daily_records as daily where daily.owner_id = current_owner_id
    ) as point
    where point.kwh is not null
      and (point.business_date < p_business_date or (point.business_date = p_business_date and point.slot < target_slot))
    order by point.business_date desc, point.slot desc
    limit 1;

    if previous_kwh is not null and p_meter_kwh < previous_kwh then
      if p_actor_mode = 'staff' then
        raise exception 'Meter decrease needs owner review';
      end if;
      if normalized_reset_reason is null or length(normalized_reset_reason) not between 2 and 240 then
        raise exception 'A reset reason is required when the meter decreases';
      end if;
    end if;
  end if;

  if p_actor_mode = 'owner' and normalized_reset_reason is distinct from old_reset_reason then
    insert into public.daily_admin_details (owner_id, business_date, electricity_reset_reason)
    values (current_owner_id, p_business_date, normalized_reset_reason)
    on conflict (owner_id, business_date) do update
      set electricity_reset_reason = excluded.electricity_reset_reason;
    reset_reason_changed := true;
  end if;

  if p_period = 'morning' then
    update public.daily_records set
      electricity_morning_status = case when p_status is null then electricity_morning_status else p_status end,
      electricity_morning_recorded_at = case when p_status is null then electricity_morning_recorded_at when p_status = 'recorded' then p_recorded_at else null end,
      electricity_morning_kwh = case when p_status is null then electricity_morning_kwh when p_status = 'recorded' then p_meter_kwh else null end,
      electricity_morning_unavailable_reason = case when p_status is null then electricity_morning_unavailable_reason when p_status = 'unable' then normalized_unavailable_reason else null end,
      electricity_morning_note = normalized_note,
      updated_at = now()
    where owner_id = current_owner_id and business_date = p_business_date;
  else
    update public.daily_records set
      electricity_evening_status = case when p_status is null then electricity_evening_status else p_status end,
      electricity_evening_recorded_at = case when p_status is null then electricity_evening_recorded_at when p_status = 'recorded' then p_recorded_at else null end,
      electricity_evening_kwh = case when p_status is null then electricity_evening_kwh when p_status = 'recorded' then p_meter_kwh else null end,
      electricity_evening_unavailable_reason = case when p_status is null then electricity_evening_unavailable_reason when p_status = 'unable' then normalized_unavailable_reason else null end,
      electricity_evening_note = normalized_note,
      electricity_evening_turned_off_unneeded = case when jsonb_typeof(p_checklist -> 'turned_off_unneeded') is distinct from 'boolean' then electricity_evening_turned_off_unneeded else (p_checklist ->> 'turned_off_unneeded')::boolean end,
      electricity_evening_checked_cooler_doors = case when jsonb_typeof(p_checklist -> 'checked_cooler_doors') is distinct from 'boolean' then electricity_evening_checked_cooler_doors else (p_checklist ->> 'checked_cooler_doors')::boolean end,
      electricity_evening_meter_photo_confirmed = case when jsonb_typeof(p_checklist -> 'meter_photo_confirmed') is distinct from 'boolean' then electricity_evening_meter_photo_confirmed else (p_checklist ->> 'meter_photo_confirmed')::boolean end,
      updated_at = now()
    where owner_id = current_owner_id and business_date = p_business_date;
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_device_logs, '[]'::jsonb)) as entry(value)
  loop
    begin
      device_id_value := (item ->> 'device_id')::uuid;
    exception when others then
      raise exception 'Invalid electricity device id';
    end;
    if device_id_value = any(seen_ids) then raise exception 'Duplicate electricity device'; end if;
    seen_ids := array_append(seen_ids, device_id_value);

    select device.name, device.mode, device.is_active
      into device_name_value, device_mode_value, device_active
    from public.electricity_devices as device
    where device.id = device_id_value and device.owner_id = current_owner_id
    for share;
    if not found then raise exception 'Electricity device is unavailable'; end if;
    if not device_active then continue; end if;

    select log.device_name_snapshot, log.device_mode_snapshot
      into saved_device_name, saved_device_mode
    from public.daily_electricity_device_logs as log
    where log.owner_id = current_owner_id and log.business_date = p_business_date
      and log.period = p_period and log.device_id = device_id_value
    for update;
    saved_device_log := found;
    if saved_device_log then
      device_name_value := saved_device_name;
      device_mode_value := saved_device_mode;
    end if;
    if item ->> 'device_mode' is distinct from device_mode_value then
      raise exception 'Electricity device settings or saved history changed; reload the page';
    end if;
    operating_status_value := item ->> 'operating_status';
    if operating_status_value = 'unrecorded' then continue; end if;
    if operating_status_value not in ('not_running', 'running') then
      raise exception 'Invalid electricity device status';
    end if;
    begin
      started_at_value := nullif(item ->> 'started_at', '')::time;
      ended_at_value := nullif(item ->> 'ended_at', '')::time;
      ends_next_day_value := coalesce(nullif(item ->> 'ends_next_day', '')::boolean, false);
      ran_from_previous_night_value := nullif(item ->> 'ran_from_previous_night', '')::boolean;
      remains_on_after_close_value := nullif(item ->> 'remains_on_after_close', '')::boolean;
    exception when others then
      raise exception 'Invalid electricity device time or flag';
    end;
    device_note_value := nullif(trim(item ->> 'note'), '');
    if device_note_value is not null and length(device_note_value) > 240 then
      raise exception 'Electricity device note is too long';
    end if;
    if (p_period = 'morning' and remains_on_after_close_value is not null)
      or (p_period = 'evening' and ran_from_previous_night_value is not null) then
      raise exception 'Electricity device flags do not match the period';
    end if;
    if operating_status_value = 'not_running'
      and (started_at_value is not null or ended_at_value is not null or ends_next_day_value
        or ran_from_previous_night_value is true or remains_on_after_close_value is true) then
      raise exception 'A device marked not running cannot contain operating times';
    end if;
    if device_mode_value = 'continuous'
      and (started_at_value is not null or ended_at_value is not null or ends_next_day_value) then
      raise exception 'Continuous devices do not use on/off times';
    end if;
    if device_mode_value = 'timed' and operating_status_value = 'running'
      and (started_at_value is null or ended_at_value is null) then
      raise exception 'Timed devices need both start and stop times';
    end if;
    if ends_next_day_value and (ended_at_value is null or p_period <> 'evening') then
      raise exception 'Next-day stop time is only valid in the evening';
    end if;

    logged_ids := array_append(logged_ids, device_id_value);
    insert into public.daily_electricity_device_logs (
      owner_id, business_date, period, device_id, device_name_snapshot, device_mode_snapshot,
      operating_status, started_at, ended_at, ends_next_day,
      ran_from_previous_night, remains_on_after_close, note
    ) values (
      current_owner_id, p_business_date, p_period, device_id_value, device_name_value, device_mode_value,
      operating_status_value, started_at_value, ended_at_value, ends_next_day_value,
      ran_from_previous_night_value, remains_on_after_close_value, device_note_value
    )
    on conflict (owner_id, business_date, period, device_id) do update set
      operating_status = excluded.operating_status,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      ends_next_day = excluded.ends_next_day,
      ran_from_previous_night = excluded.ran_from_previous_night,
      remains_on_after_close = excluded.remains_on_after_close,
      note = excluded.note,
      updated_at = now();
  end loop;

  delete from public.daily_electricity_device_logs as log
  where log.owner_id = current_owner_id and log.business_date = p_business_date and log.period = p_period
    and exists (
      select 1 from public.electricity_devices as device
      where device.id = log.device_id and device.owner_id = current_owner_id and device.is_active
    )
    and not (log.device_id = any(logged_ids));

  select case when p_period = 'morning' then daily.electricity_morning_kwh else daily.electricity_evening_kwh end
    into target_kwh
  from public.daily_records as daily
  where daily.owner_id = current_owner_id and daily.business_date = p_business_date;
  meter_value_changed := old_target_kwh is distinct from target_kwh;

  if meter_value_changed or reset_reason_changed then
  select point.kwh, point.reset_reason into target_kwh, target_reset_reason
  from (
    select daily.business_date, 0 as slot, daily.electricity_morning_kwh as kwh, details.electricity_reset_reason as reset_reason
    from public.daily_records as daily
    left join public.daily_admin_details as details using (owner_id, business_date)
    where daily.owner_id = current_owner_id and daily.business_date = p_business_date
    union all
    select daily.business_date, 1 as slot, daily.electricity_evening_kwh as kwh, details.electricity_reset_reason as reset_reason
    from public.daily_records as daily
    left join public.daily_admin_details as details using (owner_id, business_date)
    where daily.owner_id = current_owner_id and daily.business_date = p_business_date
  ) as point
  where point.slot = target_slot;

  select point.kwh into previous_kwh
  from (
    select daily.business_date, 0 as slot, daily.electricity_morning_kwh as kwh
    from public.daily_records as daily where daily.owner_id = current_owner_id
    union all
    select daily.business_date, 1 as slot, daily.electricity_evening_kwh as kwh
    from public.daily_records as daily where daily.owner_id = current_owner_id
  ) as point
  where point.kwh is not null
    and (point.business_date < p_business_date or (point.business_date = p_business_date and point.slot < target_slot))
  order by point.business_date desc, point.slot desc
  limit 1;

  select point.kwh, point.reset_reason into next_kwh, next_reset_reason
  from (
    select daily.business_date, 0 as slot, daily.electricity_morning_kwh as kwh, details.electricity_reset_reason as reset_reason
    from public.daily_records as daily
    left join public.daily_admin_details as details using (owner_id, business_date)
    where daily.owner_id = current_owner_id
    union all
    select daily.business_date, 1 as slot, daily.electricity_evening_kwh as kwh, details.electricity_reset_reason as reset_reason
    from public.daily_records as daily
    left join public.daily_admin_details as details using (owner_id, business_date)
    where daily.owner_id = current_owner_id
  ) as point
  where point.kwh is not null
    and (point.business_date > p_business_date or (point.business_date = p_business_date and point.slot > target_slot))
  order by point.business_date, point.slot
  limit 1;

  if target_kwh is not null and previous_kwh is not null and target_kwh < previous_kwh then
    if p_actor_mode = 'staff' then
      raise exception 'Meter decrease needs owner review';
    end if;
    if nullif(trim(target_reset_reason), '') is null then
      raise exception 'A reset reason is required when the meter decreases';
    end if;
  end if;
  if next_kwh is not null then
    if target_kwh is not null and next_kwh < target_kwh and nullif(trim(next_reset_reason), '') is null then
      raise exception 'This correction makes a later meter value decrease; correct that later period with a reason first';
    elsif target_kwh is null and previous_kwh is not null and next_kwh < previous_kwh
      and nullif(trim(next_reset_reason), '') is null then
      raise exception 'This correction makes a later meter value decrease; correct that later period with a reason first';
    end if;
  end if;

  if reset_reason_changed and normalized_reset_reason is null and exists (
    with meter_points as (
      select daily.business_date, 0 as slot, daily.electricity_morning_kwh as kwh
      from public.daily_records as daily where daily.owner_id = current_owner_id
      union all
      select daily.business_date, 1 as slot, daily.electricity_evening_kwh as kwh
      from public.daily_records as daily where daily.owner_id = current_owner_id
    ), ordered_points as (
      select business_date, slot, kwh, lag(kwh) over (order by business_date, slot) as prior_point_kwh
      from meter_points where kwh is not null
    )
    select 1 from ordered_points
    where business_date = p_business_date and prior_point_kwh is not null and kwh < prior_point_kwh
  ) then
    raise exception 'A reset reason is required while a meter reading on this day is lower than its previous reading';
  end if;
  end if;
end;
$$;

revoke all on function private.save_electricity_period(uuid, text, date, text, text, time, numeric, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;

create function public.staff_save_electricity_period(
  p_business_date date,
  p_period text,
  p_status text,
  p_recorded_at time,
  p_meter_kwh numeric,
  p_unavailable_reason text,
  p_note text,
  p_device_logs jsonb,
  p_checklist jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.save_electricity_period(
    private.staff_owner_id(), 'staff', p_business_date, p_period, p_status, p_recorded_at,
    p_meter_kwh, p_unavailable_reason, p_note, p_device_logs, p_checklist, null, null
  );
end;
$$;
revoke all on function public.staff_save_electricity_period(date, text, text, time, numeric, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.staff_save_electricity_period(date, text, text, time, numeric, text, text, jsonb, jsonb) to authenticated;

create function public.owner_save_electricity_period(
  p_business_date date,
  p_period text,
  p_status text,
  p_recorded_at time,
  p_meter_kwh numeric,
  p_unavailable_reason text,
  p_note text,
  p_device_logs jsonb,
  p_checklist jsonb,
  p_reset_reason text,
  p_edit_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.save_electricity_period(
    auth.uid(), 'owner', p_business_date, p_period, p_status, p_recorded_at,
    p_meter_kwh, p_unavailable_reason, p_note, p_device_logs, p_checklist, p_reset_reason, p_edit_reason
  );
end;
$$;
revoke all on function public.owner_save_electricity_period(date, text, text, time, numeric, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.owner_save_electricity_period(date, text, text, time, numeric, text, text, jsonb, jsonb, text, text) to authenticated;

create function public.owner_save_electricity_device(
  p_device_id uuid,
  p_name text,
  p_mode text,
  p_sort_order integer,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  normalized_name text := nullif(trim(p_name), '');
  saved_id uuid;
begin
  if current_owner_id is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  if normalized_name is null or length(normalized_name) not between 2 and 80
    or p_mode not in ('timed', 'continuous') or p_sort_order is null or p_sort_order < 0
    or p_active is null then
    raise exception 'Invalid electricity device settings';
  end if;
  perform set_config('app.audit_reason', '', true);
  if p_device_id is null then
    insert into public.electricity_devices (owner_id, name, mode, sort_order, is_active)
    values (current_owner_id, normalized_name, p_mode, p_sort_order, p_active)
    returning id into saved_id;
  else
    update public.electricity_devices set name = normalized_name, mode = p_mode, sort_order = p_sort_order, is_active = p_active
    where id = p_device_id and owner_id = current_owner_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Electricity device not found'; end if;
  end if;
  return saved_id;
end;
$$;
revoke all on function public.owner_save_electricity_device(uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.owner_save_electricity_device(uuid, text, text, integer, boolean) to authenticated;

-- The legacy owner revenue RPC remains callable by older UI versions, but it
-- must never write either meter value or the reset reason. Dedicated period
-- writes are now the only path that can change those fields.
create or replace function public.save_owner_daily_record(
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
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
begin
  if current_owner_id is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  if p_business_date is null or p_business_date < date '2026-09-01' then raise exception 'Business date is outside the ledger'; end if;

  insert into public.daily_records (
    owner_id, business_date, shift_06_10_vnd, shift_10_14_vnd, shift_14_18_vnd,
    shift_18_22_vnd, grab_vnd, shopee_vnd
  ) values (
    current_owner_id, p_business_date, p_shift_06_10_vnd, p_shift_10_14_vnd, p_shift_14_18_vnd,
    p_shift_18_22_vnd, p_grab_vnd, p_shopee_vnd
  )
  on conflict (owner_id, business_date) do update set
    shift_06_10_vnd = excluded.shift_06_10_vnd,
    shift_10_14_vnd = excluded.shift_10_14_vnd,
    shift_14_18_vnd = excluded.shift_14_18_vnd,
    shift_18_22_vnd = excluded.shift_18_22_vnd,
    grab_vnd = excluded.grab_vnd,
    shopee_vnd = excluded.shopee_vnd;

  insert into public.daily_admin_details (
    owner_id, business_date, business_status, cleaning_done, arrangement_done, note,
    reconciliation_status, bluebook_total_vnd, reconciliation_difference_vnd, reconciliation_note
  ) values (
    current_owner_id, p_business_date, p_business_status, p_cleaning_done, p_arrangement_done,
    p_note, p_reconciliation_status, p_bluebook_total_vnd, p_reconciliation_difference_vnd, p_reconciliation_note
  )
  on conflict (owner_id, business_date) do update set
    business_status = excluded.business_status,
    cleaning_done = excluded.cleaning_done,
    arrangement_done = excluded.arrangement_done,
    note = excluded.note,
    reconciliation_status = excluded.reconciliation_status,
    bluebook_total_vnd = excluded.bluebook_total_vnd,
    reconciliation_difference_vnd = excluded.reconciliation_difference_vnd,
    reconciliation_note = excluded.reconciliation_note;
end;
$$;
revoke all on function public.save_owner_daily_record(date, text, bigint, bigint, bigint, bigint, bigint, bigint, numeric, numeric, boolean, boolean, text, text, bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.save_owner_daily_record(date, text, bigint, bigint, bigint, bigint, bigint, bigint, numeric, numeric, boolean, boolean, text, text, bigint, bigint, text, text) to authenticated;

revoke all on function public.staff_set_meter_readings(date, numeric, numeric) from public, anon, authenticated;

-- Add explicit meter-photo metadata while preserving shift_code for the four
-- revenue periods. These overloads are used by the current R2 upload flow and
-- by its recovery path when a storage delete fails.
create function public.owner_create_day_photo_r2(
  p_business_date date,
  p_category text,
  p_shift_code text,
  p_electricity_period text,
  p_object_path text,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  photo_id uuid;
  normalized_shift text := nullif(trim(p_shift_code), '');
  normalized_period text := nullif(trim(p_electricity_period), '');
  normalized_caption text := nullif(trim(p_caption), '');
begin
  if current_owner_id is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  if p_business_date is null or p_business_date < date '2026-09-01' then raise exception 'Invalid business date'; end if;
  if p_category is null or p_category not in ('bluebook', 'cleaning', 'arrangement', 'other', 'electricity_meter') then raise exception 'Invalid photo category'; end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift code'; end if;
  if (p_category = 'electricity_meter' and (normalized_period is null or normalized_period not in ('morning', 'evening') or normalized_shift is not null))
    or (p_category <> 'electricity_meter' and normalized_period is not null) then raise exception 'Invalid electricity photo period'; end if;
  if p_object_path is null or length(p_object_path) > 360
    or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3)
    or split_part(p_object_path, '/', 4) <> ''
    or split_part(p_object_path, '/', 3) !~* '^[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Invalid evidence path';
  end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then raise exception 'Caption too long'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;

  insert into public.day_photos (owner_id, business_date, shift_code, category, electricity_period, object_path, caption, storage_provider)
  values (current_owner_id, p_business_date, normalized_shift, p_category, normalized_period, p_object_path, normalized_caption, 'r2')
  on conflict (object_path) do nothing
  returning id into photo_id;
  if photo_id is null then
    select id into photo_id from public.day_photos
    where object_path = p_object_path and owner_id = current_owner_id and business_date = p_business_date
      and storage_provider = 'r2' and category = p_category
      and shift_code is not distinct from normalized_shift
      and electricity_period is not distinct from normalized_period
      and caption is not distinct from normalized_caption;
    if photo_id is null then raise exception 'Evidence path is already in use with different metadata'; end if;
  end if;
  return photo_id;
end;
$$;
revoke all on function public.owner_create_day_photo_r2(date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.owner_create_day_photo_r2(date, text, text, text, text, text) to authenticated;

create function public.staff_create_day_photo_r2(
  p_business_date date,
  p_category text,
  p_shift_code text,
  p_electricity_period text,
  p_object_path text,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
  photo_id uuid;
  normalized_shift text := nullif(trim(p_shift_code), '');
  normalized_period text := nullif(trim(p_electricity_period), '');
  normalized_caption text := nullif(trim(p_caption), '');
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_category is null or p_category not in ('bluebook', 'cleaning', 'arrangement', 'other', 'electricity_meter') then raise exception 'Invalid photo category'; end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift code'; end if;
  if (p_category = 'electricity_meter' and (normalized_period is null or normalized_period not in ('morning', 'evening') or normalized_shift is not null))
    or (p_category <> 'electricity_meter' and normalized_period is not null) then raise exception 'Invalid electricity photo period'; end if;
  if p_object_path is null or length(p_object_path) > 360
    or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3)
    or split_part(p_object_path, '/', 4) <> ''
    or split_part(p_object_path, '/', 3) !~* '^[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Invalid evidence path';
  end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then raise exception 'Caption too long'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.day_photos (owner_id, business_date, shift_code, category, electricity_period, object_path, caption, storage_provider)
  values (current_owner_id, p_business_date, normalized_shift, p_category, normalized_period, p_object_path, normalized_caption, 'r2')
  on conflict (object_path) do nothing
  returning id into photo_id;
  if photo_id is null then
    select id into photo_id from public.day_photos
    where object_path = p_object_path and owner_id = current_owner_id and business_date = p_business_date
      and storage_provider = 'r2' and category = p_category
      and shift_code is not distinct from normalized_shift
      and electricity_period is not distinct from normalized_period
      and caption is not distinct from normalized_caption;
    if photo_id is null then raise exception 'Evidence path is already in use with different metadata'; end if;
  end if;
  return photo_id;
end;
$$;
revoke all on function public.staff_create_day_photo_r2(date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.staff_create_day_photo_r2(date, text, text, text, text, text) to authenticated;

create function public.owner_create_day_photo(
  p_business_date date,
  p_category text,
  p_shift_code text,
  p_electricity_period text,
  p_object_path text,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  photo_id uuid;
  normalized_shift text := nullif(trim(p_shift_code), '');
  normalized_period text := nullif(trim(p_electricity_period), '');
  normalized_caption text := nullif(trim(p_caption), '');
begin
  if current_owner_id is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  if p_business_date is null or p_business_date < date '2026-09-01' then raise exception 'Invalid business date'; end if;
  if p_category is null or p_category not in ('bluebook', 'cleaning', 'arrangement', 'other', 'electricity_meter') then raise exception 'Invalid photo category'; end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift code'; end if;
  if (p_category = 'electricity_meter' and (normalized_period is null or normalized_period not in ('morning', 'evening') or normalized_shift is not null))
    or (p_category <> 'electricity_meter' and normalized_period is not null) then raise exception 'Invalid electricity photo period'; end if;
  if p_object_path is null or length(p_object_path) > 360
    or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3)
    or split_part(p_object_path, '/', 4) <> ''
    or split_part(p_object_path, '/', 3) !~* '^[0-9a-f-]{36}\.(jpg|png|webp)$' then raise exception 'Invalid evidence path'; end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then raise exception 'Caption too long'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.day_photos (owner_id, business_date, shift_code, category, electricity_period, object_path, caption)
  values (current_owner_id, p_business_date, normalized_shift, p_category, normalized_period, p_object_path, normalized_caption)
  on conflict (object_path) do nothing
  returning id into photo_id;
  if photo_id is null then
    select id into photo_id from public.day_photos
    where object_path = p_object_path and owner_id = current_owner_id and business_date = p_business_date
      and category = p_category and shift_code is not distinct from normalized_shift
      and electricity_period is not distinct from normalized_period and caption is not distinct from normalized_caption;
    if photo_id is null then raise exception 'Evidence path is already in use with different metadata'; end if;
  end if;
  return photo_id;
end;
$$;
revoke all on function public.owner_create_day_photo(date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.owner_create_day_photo(date, text, text, text, text, text) to authenticated;

create function public.staff_create_day_photo(
  p_business_date date,
  p_category text,
  p_shift_code text,
  p_electricity_period text,
  p_object_path text,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
  photo_id uuid;
  normalized_shift text := nullif(trim(p_shift_code), '');
  normalized_period text := nullif(trim(p_electricity_period), '');
  normalized_caption text := nullif(trim(p_caption), '');
begin
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_category is null or p_category not in ('bluebook', 'cleaning', 'arrangement', 'other', 'electricity_meter') then raise exception 'Invalid photo category'; end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift code'; end if;
  if (p_category = 'electricity_meter' and (normalized_period is null or normalized_period not in ('morning', 'evening') or normalized_shift is not null))
    or (p_category <> 'electricity_meter' and normalized_period is not null) then raise exception 'Invalid electricity photo period'; end if;
  if p_object_path is null or length(p_object_path) > 360
    or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3)
    or split_part(p_object_path, '/', 4) <> ''
    or split_part(p_object_path, '/', 3) !~* '^[0-9a-f-]{36}\.(jpg|png|webp)$' then raise exception 'Invalid evidence path'; end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then raise exception 'Caption too long'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.day_photos (owner_id, business_date, shift_code, category, electricity_period, object_path, caption)
  values (current_owner_id, p_business_date, normalized_shift, p_category, normalized_period, p_object_path, normalized_caption)
  on conflict (object_path) do nothing
  returning id into photo_id;
  if photo_id is null then
    select id into photo_id from public.day_photos
    where object_path = p_object_path and owner_id = current_owner_id and business_date = p_business_date
      and category = p_category and shift_code is not distinct from normalized_shift
      and electricity_period is not distinct from normalized_period and caption is not distinct from normalized_caption;
    if photo_id is null then raise exception 'Evidence path is already in use with different metadata'; end if;
  end if;
  return photo_id;
end;
$$;
revoke all on function public.staff_create_day_photo(date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.staff_create_day_photo(date, text, text, text, text, text) to authenticated;

-- Prevent old staff clients from replacing both readings with a stale form.
revoke all on function public.staff_set_meter_readings(date, numeric, numeric) from public, anon, authenticated;
