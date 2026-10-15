-- Merge only edited electricity fields so multiple staff using one login do
-- not overwrite newer meter/device values from a stale page. The explicit
-- "unrecorded" status clears a legacy or previously saved meter reading.

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
    else
      case when jsonb_typeof(submitted.value -> 'note') = 'string' then submitted.value
        else submitted.value || jsonb_build_object('note', coalesce(saved.note, ''))
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
      'note', missing_device.note
    ));
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
