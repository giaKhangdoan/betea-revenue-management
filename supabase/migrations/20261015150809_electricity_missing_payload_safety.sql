-- Preserve existing electricity values when an authenticated client omits an
-- optional payload. Only explicit form changes may clear notes/reset reasons,
-- and only an explicit "unrecorded" device status may remove that device log.

alter function private.save_electricity_period(
  uuid, text, date, text, text, time, numeric, text, text, jsonb, jsonb, text, text
) rename to save_electricity_period_legacy;

create function private.save_electricity_period(
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
  if p_device_logs is not null and jsonb_typeof(p_device_logs) <> 'array' then
    raise exception 'Device logs must be an array';
  end if;
  if p_device_logs is not null and jsonb_array_length(p_device_logs) > 50 then
    raise exception 'Too many device logs';
  end if;

  -- Coordinate catalog changes with daily saves before filling omitted devices.
  perform pg_advisory_xact_lock(hashtextextended(current_owner_id::text, 0));

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

  -- A missing/null device note means preserve the latest saved value. An empty
  -- string remains an explicit clear request.
  select coalesce(jsonb_agg(
    case when jsonb_typeof(submitted.value -> 'note') = 'string' then submitted.value
      else submitted.value || jsonb_build_object('note', coalesce(saved.note, ''))
    end order by submitted.ordinality
  ), '[]'::jsonb)
  into effective_device_logs
  from jsonb_array_elements(coalesce(p_device_logs, '[]'::jsonb)) with ordinality as submitted(value, ordinality)
  left join public.daily_electricity_device_logs as saved
    on saved.owner_id = current_owner_id
    and saved.business_date = p_business_date
    and saved.period = p_period
    and saved.device_id::text = (submitted.value ->> 'device_id');

  -- Merge any omitted active device from current storage. This makes a null or
  -- partial payload non-destructive; sending status "unrecorded" is the clear.
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
      'note', missing_device.note
    ));
  end loop;

  perform private.save_electricity_period_legacy(
    p_owner_id, p_actor_mode, p_business_date, p_period, p_status, p_recorded_at,
    p_meter_kwh, p_unavailable_reason, effective_note, effective_device_logs,
    p_checklist, effective_reset_reason, p_edit_reason
  );
end;
$$;
revoke all on function private.save_electricity_period(uuid, text, date, text, text, time, numeric, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function private.save_electricity_period_legacy(uuid, text, date, text, text, time, numeric, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;

create or replace function public.owner_save_electricity_device(
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
  perform pg_advisory_xact_lock(hashtextextended(current_owner_id::text, 0));
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
