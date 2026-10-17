-- Enforce electricity time semantics for changed device logs without rewriting legacy entries.

create or replace function private.electricity_device_time_error(
  p_period text,
  p_device_mode text,
  p_status text,
  p_started_at time,
  p_ended_at time,
  p_ends_next_day boolean,
  p_ran_from_previous_night boolean,
  p_remains_on_after_close boolean
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_status <> 'running' or p_device_mode <> 'timed' then return null; end if;
  if p_period = 'morning' then
    if p_ended_at is null then return 'Nhập giờ tắt của thiết bị trong ca sáng.'; end if;
    if p_started_at is null then
      if p_ran_from_previous_night is true then return null; end if;
      return 'Nhập giờ bật, hoặc chọn “Đã chạy từ đêm hôm trước” nếu thiết bị đã bật từ tối qua.';
    end if;
    if p_started_at > p_ended_at and p_ran_from_previous_night is distinct from true then
      return 'Giờ bật muộn hơn giờ tắt. Xác nhận thiết bị chạy từ đêm hôm trước.';
    end if;
    if p_started_at <= p_ended_at and p_ran_from_previous_night is true then
      return 'Trạng thái chạy từ đêm hôm trước không khớp với giờ bật và giờ tắt.';
    end if;
    return null;
  end if;
  if p_period = 'evening' then
    if p_started_at is null then return 'Nhập giờ bật của thiết bị.'; end if;
    if p_ended_at is null then
      if p_remains_on_after_close is true and not coalesce(p_ends_next_day, false) then return null; end if;
      return 'Nhập giờ tắt, hoặc xác nhận thiết bị vẫn chạy sau khi đóng cửa.';
    end if;
    if coalesce(p_ends_next_day, false) and p_ended_at > p_started_at then
      return 'Nếu giờ tắt thuộc ngày hôm sau, giờ tắt phải sớm hơn giờ bật.';
    end if;
    if not coalesce(p_ends_next_day, false) and p_ended_at < p_started_at then
      return 'Giờ tắt sớm hơn giờ bật. Xác nhận thiết bị tắt sau nửa đêm.';
    end if;
    return null;
  end if;
  return 'Kỳ ghi nhận điện không hợp lệ.';
end;
$$;
revoke all on function private.electricity_device_time_error(text, text, text, time, time, boolean, boolean, boolean)
  from public, anon, authenticated;
create or replace function private.save_electricity_period_legacy(
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
      and ((started_at_value is null and not (p_period = 'morning' and ran_from_previous_night_value is true))
        or (ended_at_value is null and not (p_period = 'evening' and remains_on_after_close_value is true))) then
      raise exception 'Timed devices need a start time and a stop time unless they remain on after close';
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
  effective_note text := p_note;
  effective_reset_reason text := p_reset_reason;
  effective_device_logs jsonb;
  missing_device record;
  validation_item jsonb;
  device_time_error text;
  legacy_status text := p_status;
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
  if p_status is not null and p_status not in ('recorded', 'unable', 'unrecorded') then
    raise exception 'Invalid electricity status';
  end if;
  if p_status = 'unrecorded' and (p_recorded_at is not null or p_meter_kwh is not null or p_unavailable_reason is not null) then
    raise exception 'Unrecorded meter status cannot contain a reading or unavailable reason';
  end if;
  if p_device_logs is not null and jsonb_typeof(p_device_logs) <> 'array' then
    raise exception 'Device logs must be an array';
  end if;
  if p_device_logs is not null and jsonb_array_length(p_device_logs) > 50 then
    raise exception 'Too many device logs';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_device_logs, '[]'::jsonb)) as submitted(value)
    where submitted.value ? 'changed_fields'
      and jsonb_typeof(submitted.value -> 'changed_fields') <> 'array'
  ) then
    raise exception 'Device changed fields must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_device_logs, '[]'::jsonb)) as submitted(value)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(submitted.value -> 'changed_fields') = 'array'
        then submitted.value -> 'changed_fields' else '[]'::jsonb end
    ) as changed(field)
    where changed.field not in (
      'operating_status', 'started_at', 'ended_at', 'ends_next_day',
      'ran_from_previous_night', 'remains_on_after_close', 'note'
    )
  ) then
    raise exception 'Invalid device changed field';
  end if;

  -- Serialize catalog changes and saves for this owner.
  perform pg_advisory_xact_lock(hashtextextended(current_owner_id::text, 0));

  -- Older clients send full device snapshots without changed_fields. Allow
  -- those only when they still match storage; a stale page must reload instead
  -- of restoring a row another session just cleared or overwriting its edits.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_device_logs, '[]'::jsonb)) as submitted(value)
    left join public.daily_electricity_device_logs as saved
      on saved.owner_id = current_owner_id
      and saved.business_date = p_business_date
      and saved.period = p_period
      and saved.device_id::text = (submitted.value ->> 'device_id')
    where not (submitted.value ? 'changed_fields')
      and (
        (saved.id is null and coalesce(submitted.value ->> 'operating_status', 'unrecorded') <> 'unrecorded')
        or (saved.id is not null and (
          coalesce(submitted.value ->> 'operating_status', 'unrecorded') is distinct from saved.operating_status
          or nullif(submitted.value ->> 'started_at', '')::time is distinct from saved.started_at
          or nullif(submitted.value ->> 'ended_at', '')::time is distinct from saved.ended_at
          or coalesce(nullif(submitted.value ->> 'ends_next_day', '')::boolean, false) is distinct from saved.ends_next_day
          or nullif(submitted.value ->> 'ran_from_previous_night', '')::boolean is distinct from saved.ran_from_previous_night
          or nullif(submitted.value ->> 'remains_on_after_close', '')::boolean is distinct from saved.remains_on_after_close
          or (jsonb_typeof(submitted.value -> 'note') = 'string'
            and coalesce(nullif(trim(submitted.value ->> 'note'), ''), '') is distinct from coalesce(saved.note, ''))
        ))
      )
  ) then
    raise exception 'Device log changed; reload the page';
  end if;

  if p_note is null then
    select case when p_period = 'morning' then daily.electricity_morning_note else daily.electricity_evening_note end
      into effective_note
    from public.daily_records as daily
    where daily.owner_id = current_owner_id and daily.business_date = p_business_date;
  end if;
  if p_actor_mode = 'owner' and p_reset_reason is null then
    select details.electricity_reset_reason into effective_reset_reason
    from public.daily_admin_details as details
    where details.owner_id = current_owner_id and details.business_date = p_business_date;
  end if;

  -- New clients send changed_fields for a partial device update. Start from
  -- current storage (not the stale form), then overlay only explicitly edited
  -- fields. Older clients without changed_fields retain the prior full-payload
  -- behavior while null device notes remain non-destructive.
  select coalesce(jsonb_agg(
    case when submitted.value ? 'changed_fields' then
      jsonb_build_object(
        'device_id', submitted.value -> 'device_id',
        'device_mode', coalesce(saved.device_mode_snapshot, submitted.value ->> 'device_mode'),
        'operating_status', coalesce(saved.operating_status, 'unrecorded'),
        'started_at', case when saved.id is not null then to_jsonb(saved.started_at) else 'null'::jsonb end,
        'ended_at', case when saved.id is not null then to_jsonb(saved.ended_at) else 'null'::jsonb end,
        'ends_next_day', case when saved.id is not null then to_jsonb(saved.ends_next_day) else 'false'::jsonb end,
        'ran_from_previous_night', case when saved.id is not null then to_jsonb(saved.ran_from_previous_night) else 'null'::jsonb end,
        'remains_on_after_close', case when saved.id is not null then to_jsonb(saved.remains_on_after_close) else 'null'::jsonb end,
        'note', case when saved.id is not null then coalesce(to_jsonb(saved.note), '""'::jsonb) else '""'::jsonb end
      )
      || case when (submitted.value -> 'changed_fields') ? 'operating_status' then jsonb_build_object('operating_status', submitted.value -> 'operating_status') else '{}'::jsonb end
      || case when (submitted.value -> 'changed_fields') ? 'started_at' then jsonb_build_object('started_at', submitted.value -> 'started_at') else '{}'::jsonb end
      || case when (submitted.value -> 'changed_fields') ? 'ended_at' then jsonb_build_object('ended_at', submitted.value -> 'ended_at') else '{}'::jsonb end
      || case when (submitted.value -> 'changed_fields') ? 'ends_next_day' then jsonb_build_object('ends_next_day', submitted.value -> 'ends_next_day') else '{}'::jsonb end
      || case when (submitted.value -> 'changed_fields') ? 'ran_from_previous_night' then jsonb_build_object('ran_from_previous_night', submitted.value -> 'ran_from_previous_night') else '{}'::jsonb end
      || case when (submitted.value -> 'changed_fields') ? 'remains_on_after_close' then jsonb_build_object('remains_on_after_close', submitted.value -> 'remains_on_after_close') else '{}'::jsonb end
      || case when (submitted.value -> 'changed_fields') ? 'note' then jsonb_build_object('note', submitted.value -> 'note') else '{}'::jsonb end
      || jsonb_build_object('_validate_time_window',
        (submitted.value -> 'changed_fields') ?| array[
          'operating_status', 'started_at', 'ended_at', 'ends_next_day',
          'ran_from_previous_night', 'remains_on_after_close'
        ])
    else
      case when jsonb_typeof(submitted.value -> 'note') = 'string'
        then submitted.value || jsonb_build_object('_validate_time_window', true)
        else submitted.value || jsonb_build_object('note', coalesce(saved.note, ''), '_validate_time_window', true)
      end
    end order by submitted.ordinality
  ), '[]'::jsonb)
  into effective_device_logs
  from jsonb_array_elements(coalesce(p_device_logs, '[]'::jsonb)) with ordinality as submitted(value, ordinality)
  left join public.daily_electricity_device_logs as saved
    on saved.owner_id = current_owner_id
    and saved.business_date = p_business_date
    and saved.period = p_period
    and saved.device_id::text = (submitted.value ->> 'device_id');

  -- Missing active devices are read from current storage so a form opened by
  -- another employee cannot reset them just by saving a different field.
  for missing_device in
    select device.id as device_id,
      coalesce(saved.device_mode_snapshot, device.mode) as device_mode,
      coalesce(saved.operating_status, 'unrecorded') as operating_status,
      saved.started_at,
      saved.ended_at,
      coalesce(saved.ends_next_day, false) as ends_next_day,
      saved.ran_from_previous_night,
      saved.remains_on_after_close,
      coalesce(saved.note, '') as note
    from public.electricity_devices as device
    left join public.daily_electricity_device_logs as saved
      on saved.owner_id = current_owner_id
      and saved.business_date = p_business_date
      and saved.period = p_period
      and saved.device_id = device.id
    where device.owner_id = current_owner_id and device.is_active
      and not exists (
        select 1 from jsonb_array_elements(effective_device_logs) as submitted(value)
        where submitted.value ->> 'device_id' = device.id::text
      )
    order by device.sort_order, device.name
  loop
    effective_device_logs := effective_device_logs || jsonb_build_array(jsonb_build_object(
      'device_id', missing_device.device_id,
      'device_mode', missing_device.device_mode,
      'operating_status', missing_device.operating_status,
      'started_at', missing_device.started_at,
      'ended_at', missing_device.ended_at,
      'ends_next_day', missing_device.ends_next_day,
      'ran_from_previous_night', missing_device.ran_from_previous_night,
      'remains_on_after_close', missing_device.remains_on_after_close,
      'note', missing_device.note,
      '_validate_time_window', false
    ));
  end loop;

  for validation_item in
    select submitted.value
    from jsonb_array_elements(effective_device_logs) as submitted(value)
    where coalesce((submitted.value ->> '_validate_time_window')::boolean, true)
  loop
    device_time_error := private.electricity_device_time_error(
      p_period,
      validation_item ->> 'device_mode',
      validation_item ->> 'operating_status',
      nullif(validation_item ->> 'started_at', '')::time,
      nullif(validation_item ->> 'ended_at', '')::time,
      coalesce(nullif(validation_item ->> 'ends_next_day', '')::boolean, false),
      nullif(validation_item ->> 'ran_from_previous_night', '')::boolean,
      nullif(validation_item ->> 'remains_on_after_close', '')::boolean
    );
    if device_time_error is not null then raise exception '%', device_time_error; end if;
  end loop;

  if p_status = 'unrecorded' then legacy_status := null; end if;
  perform private.save_electricity_period_legacy(
    p_owner_id, p_actor_mode, p_business_date, p_period, legacy_status, p_recorded_at,
    p_meter_kwh, p_unavailable_reason, effective_note, effective_device_logs,
    p_checklist, effective_reset_reason, p_edit_reason
  );

  -- The old helper treats NULL as "preserve". Keep that contract for a form
  -- that was not edited, while this explicit sentinel means clear this period.
  if p_status = 'unrecorded' and p_period = 'morning' then
    update public.daily_records set
      electricity_morning_status = null,
      electricity_morning_recorded_at = null,
      electricity_morning_kwh = null,
      electricity_morning_unavailable_reason = null,
      updated_at = now()
    where owner_id = current_owner_id and business_date = p_business_date;
  elsif p_status = 'unrecorded' and p_period = 'evening' then
    update public.daily_records set
      electricity_evening_status = null,
      electricity_evening_recorded_at = null,
      electricity_evening_kwh = null,
      electricity_evening_unavailable_reason = null,
      updated_at = now()
    where owner_id = current_owner_id and business_date = p_business_date;
  end if;
end;
$$;
revoke all on function private.save_electricity_period(uuid, text, date, text, text, time, numeric, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function private.save_electricity_period_legacy(uuid, text, date, text, text, time, numeric, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;
