begin;
select plan(35);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'electricity-staff@example.test', '{}', '{}');

do $$
declare
  owner_id uuid;
begin
  select profile.user_id into owner_id from public.owner_profiles as profile limit 1;
  if owner_id is null then
    owner_id := 'a1000000-0000-4000-8000-000000000001';
    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (owner_id, 'authenticated', 'authenticated', 'electricity-owner@example.test', '{}', '{}');
    insert into public.owner_profiles (user_id) values (owner_id);
  end if;
  perform set_config('test.electricity_owner', owner_id::text, true);
end;
$$;

insert into public.store_memberships (owner_id, user_id, email, display_name, active)
values (current_setting('test.electricity_owner')::uuid, 'a1000000-0000-4000-8000-000000000002', 'electricity-staff@example.test', 'Electricity staff', true);
insert into auth.sessions (id, user_id)
values ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002');

select set_config('test.electricity_today', private.current_business_date_vn()::text, true);
select set_config('test.electricity_device', (
  select id::text from public.electricity_devices
  where owner_id = current_setting('test.electricity_owner')::uuid and name = 'Điều hòa'
), true);
select set_config('test.electricity_second_device', (
  select id::text from public.electricity_devices
  where owner_id = current_setting('test.electricity_owner')::uuid and name = 'Máy làm đá'
), true);

-- This older day deliberately contains a decrease without reset metadata. It
-- represents legacy data and must not prevent an unrelated unchanged reading
-- from being saved on the current day.
insert into public.daily_records (owner_id, business_date, electricity_morning_kwh, electricity_evening_kwh)
values (
  current_setting('test.electricity_owner')::uuid,
  private.current_business_date_vn() - 1,
  200,
  100
);
insert into public.daily_records (owner_id, business_date)
values (current_setting('test.electricity_owner')::uuid, private.current_business_date_vn() - 2);
insert into public.daily_records (owner_id, business_date, electricity_morning_kwh)
values (current_setting('test.electricity_owner')::uuid, private.current_business_date_vn(), 50);

select ok((select electricity_morning_kwh = 200 and electricity_evening_kwh = 100
    from public.daily_records
    where owner_id = current_setting('test.electricity_owner')::uuid
      and business_date = current_setting('test.electricity_today')::date - 1)
  and not exists (select 1 from public.daily_admin_details
    where owner_id = current_setting('test.electricity_owner')::uuid
      and business_date = current_setting('test.electricity_today')::date - 1
      and electricity_reset_reason is not null),
  'test fixture contains an unrelated, unmarked legacy meter decrease');
select ok(to_regclass('public.electricity_devices') is not null, 'electricity device catalog exists');
select ok(to_regclass('public.daily_electricity_device_logs') is not null, 'daily device log table exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid = any(array[
  'public.electricity_devices'::regclass,
  'public.daily_electricity_device_logs'::regclass
])), 'device catalog and logs use RLS');
select ok(not has_table_privilege('authenticated', 'public.electricity_devices', 'INSERT')
  and not has_table_privilege('authenticated', 'public.electricity_devices', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.electricity_devices', 'DELETE')
  and not has_table_privilege('authenticated', 'public.daily_electricity_device_logs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.daily_electricity_device_logs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.daily_electricity_device_logs', 'DELETE'),
  'authenticated clients cannot write devices or logs directly');
select ok(has_function_privilege('authenticated', 'public.staff_save_electricity_period(date,text,text,time,numeric,text,text,jsonb,jsonb)', 'EXECUTE'), 'staff can reach the guarded electricity RPC');
select ok(has_function_privilege('authenticated', 'public.owner_save_electricity_period(date,text,text,time,numeric,text,text,jsonb,jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.owner_save_electricity_device(uuid,text,text,integer,boolean)', 'EXECUTE'),
  'owner can reach guarded electricity and device RPCs');
select ok(not has_function_privilege('anon', 'public.staff_save_electricity_period(date,text,text,time,numeric,text,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.owner_save_electricity_period(date,text,text,time,numeric,text,text,jsonb,jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.owner_save_electricity_device(uuid,text,text,integer,boolean)', 'EXECUTE'),
  'anonymous users cannot execute electricity RPCs');
select ok(not has_function_privilege('authenticated', 'public.staff_set_meter_readings(date,numeric,numeric)', 'EXECUTE'), 'legacy staff meter RPC is revoked');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'a1000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'session_id', 'a2000000-0000-4000-8000-000000000001',
  'iat', extract(epoch from now())::bigint
)::text, true);

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', 'recorded', time '07:00', 50, null, null, '[]'::jsonb, null
  );
end;
$$;
select pass('staff can save a current-day meter reading');
select ok((select electricity_morning_kwh = 50
    and electricity_morning_status = 'recorded'
    and electricity_morning_recorded_at = time '07:00'
  from public.daily_records
  where owner_id = current_setting('test.electricity_owner')::uuid
    and business_date = current_setting('test.electricity_today')::date),
  'saving a reading persists its kWh, status and recorded time');

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, 'Cập nhật ghi chú thiết bị',
    jsonb_build_array(jsonb_build_object(
      'device_id', current_setting('test.electricity_device'),
      'device_mode', 'timed',
      'operating_status', 'running',
      'started_at', '06:00',
      'ended_at', '07:00',
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', 'Đã kiểm tra',
      'changed_fields', jsonb_build_array('operating_status', 'started_at', 'ended_at', 'note')
    ), jsonb_build_object(
      'device_id', current_setting('test.electricity_second_device'),
      'device_mode', 'timed',
      'operating_status', 'not_running',
      'started_at', null,
      'ended_at', null,
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', 'Đã kiểm tra máy đá',
      'changed_fields', jsonb_build_array('operating_status', 'note')
    )),
    null
  );
end;
$$;
select pass('staff can save a note and device log without resubmitting the unchanged reading despite an unrelated legacy decrease');
select ok((select daily.electricity_morning_kwh = 50
    and daily.electricity_morning_note = 'Cập nhật ghi chú thiết bị'
    and log.operating_status = 'running'
    and log.device_name_snapshot = 'Điều hòa'
    and log.device_mode_snapshot = 'timed'
    and (select count(*) = 2 from public.daily_electricity_device_logs as all_logs
      where all_logs.owner_id = daily.owner_id and all_logs.business_date = daily.business_date and all_logs.period = 'morning')
    and exists (select 1 from public.daily_electricity_device_logs as ice_log
      where ice_log.owner_id = daily.owner_id and ice_log.business_date = daily.business_date
        and ice_log.period = 'morning' and ice_log.device_id = current_setting('test.electricity_second_device')::uuid
        and ice_log.note = 'Đã kiểm tra máy đá')
  from public.daily_records as daily
  join public.daily_electricity_device_logs as log
    on log.owner_id = daily.owner_id and log.business_date = daily.business_date and log.period = 'morning'
      and log.device_id = current_setting('test.electricity_device')::uuid
  where daily.owner_id = current_setting('test.electricity_owner')::uuid
    and daily.business_date = current_setting('test.electricity_today')::date),
  'the unchanged legacy reading stays intact while note and snapshot-based device log are saved');

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, null,
    jsonb_build_array(jsonb_build_object(
      'device_id', current_setting('test.electricity_device'),
      'device_mode', 'timed',
      'operating_status', 'running',
      'started_at', '06:00',
      'ended_at', '07:00',
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', null
    )), null
  );
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, null, null, null
  );
end;
$$;
select ok((select daily.electricity_morning_note = 'Cập nhật ghi chú thiết bị'
    and (select count(*) = 2 from public.daily_electricity_device_logs as all_logs
      where all_logs.owner_id = daily.owner_id and all_logs.business_date = daily.business_date and all_logs.period = 'morning')
    and exists (select 1 from public.daily_electricity_device_logs as ac_log
      where ac_log.owner_id = daily.owner_id and ac_log.business_date = daily.business_date
        and ac_log.period = 'morning' and ac_log.device_id = current_setting('test.electricity_device')::uuid
        and ac_log.note = 'Đã kiểm tra')
    and exists (select 1 from public.daily_electricity_device_logs as ice_log
      where ice_log.owner_id = daily.owner_id and ice_log.business_date = daily.business_date
        and ice_log.period = 'morning' and ice_log.device_id = current_setting('test.electricity_second_device')::uuid
        and ice_log.note = 'Đã kiểm tra máy đá')
  from public.daily_records as daily
  where daily.owner_id = current_setting('test.electricity_owner')::uuid
    and daily.business_date = current_setting('test.electricity_today')::date),
  'null and partial payloads preserve period notes, device logs and device notes');

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, null,
    jsonb_build_array(jsonb_build_object(
      'device_id', current_setting('test.electricity_device'),
      'device_mode', 'timed',
      'operating_status', 'unrecorded',
      'started_at', null,
      'ended_at', null,
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', 'Nhân viên B cập nhật ghi chú',
      'changed_fields', jsonb_build_array('note')
    )), null
  );
end;
$$;
select pass('a partial device-note update merges against the latest saved log');
select ok((select daily.electricity_morning_kwh = 50
    and ac.operating_status = 'running'
    and ac.started_at = time '06:00'
    and ac.ended_at = time '07:00'
    and ac.note = 'Nhân viên B cập nhật ghi chú'
    and ice.operating_status = 'not_running'
    and ice.note = 'Đã kiểm tra máy đá'
  from public.daily_records as daily
  join public.daily_electricity_device_logs as ac
    on ac.owner_id = daily.owner_id and ac.business_date = daily.business_date
      and ac.period = 'morning' and ac.device_id = current_setting('test.electricity_device')::uuid
  join public.daily_electricity_device_logs as ice
    on ice.owner_id = daily.owner_id and ice.business_date = daily.business_date
      and ice.period = 'morning' and ice.device_id = current_setting('test.electricity_second_device')::uuid
  where daily.owner_id = current_setting('test.electricity_owner')::uuid
    and daily.business_date = current_setting('test.electricity_today')::date),
  'an unrelated stale device status and meter reading cannot overwrite newer saved values');

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, null,
    jsonb_build_array(jsonb_build_object(
      'device_id', current_setting('test.electricity_device'),
      'device_mode', 'timed',
      'operating_status', 'unrecorded',
      'started_at', null,
      'ended_at', null,
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', null,
      'changed_fields', jsonb_build_array('operating_status')
    )), null
  );
end;
$$;
select pass('staff can explicitly clear a saved device log');
select ok(not exists (select 1 from public.daily_electricity_device_logs
      where owner_id = current_setting('test.electricity_owner')::uuid
        and business_date = current_setting('test.electricity_today')::date
        and period = 'morning' and device_id = current_setting('test.electricity_device')::uuid)
    and exists (select 1 from public.daily_electricity_device_logs
      where owner_id = current_setting('test.electricity_owner')::uuid
        and business_date = current_setting('test.electricity_today')::date
        and period = 'morning' and device_id = current_setting('test.electricity_second_device')::uuid),
  'clearing one device removes only that device log');

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, null,
    jsonb_build_array(jsonb_build_object(
      'device_id', current_setting('test.electricity_device'),
      'device_mode', 'timed',
      'operating_status', 'running',
      'started_at', '06:00',
      'ended_at', '07:00',
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', 'Ghi chú gửi từ biểu mẫu cũ',
      'changed_fields', jsonb_build_array('note')
    )), null
  );
end;
$$;
select pass('staff can save a note after the device log was cleared by another session');
select ok(not exists (select 1 from public.daily_electricity_device_logs
      where owner_id = current_setting('test.electricity_owner')::uuid
        and business_date = current_setting('test.electricity_today')::date
        and period = 'morning' and device_id = current_setting('test.electricity_device')::uuid)
    and exists (select 1 from public.daily_electricity_device_logs
      where owner_id = current_setting('test.electricity_owner')::uuid
        and business_date = current_setting('test.electricity_today')::date
        and period = 'morning' and device_id = current_setting('test.electricity_second_device')::uuid
        and note = 'Đã kiểm tra máy đá'),
  'a stale note-only update cannot resurrect the cleared device or disturb other devices');

select throws_ok(
  $$select public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', null, null, null, null, null,
    jsonb_build_array(jsonb_build_object(
      'device_id', current_setting('test.electricity_device'),
      'device_mode', 'timed',
      'operating_status', 'running',
      'started_at', '06:00',
      'ended_at', '07:00',
      'ends_next_day', false,
      'ran_from_previous_night', null,
      'remains_on_after_close', null,
      'note', 'Dữ liệu từ tab cũ'
    )), null
  )$$,
  'P0001', 'Device log changed; reload the page',
  'a legacy full-snapshot client must reload instead of restoring a cleared log'
);
select ok(not exists (select 1 from public.daily_electricity_device_logs
      where owner_id = current_setting('test.electricity_owner')::uuid
        and business_date = current_setting('test.electricity_today')::date
        and period = 'morning' and device_id = current_setting('test.electricity_device')::uuid)
    and exists (select 1 from public.daily_electricity_device_logs
      where owner_id = current_setting('test.electricity_owner')::uuid
        and business_date = current_setting('test.electricity_today')::date
        and period = 'morning' and device_id = current_setting('test.electricity_second_device')::uuid),
  'the rejected legacy snapshot leaves the latest device logs intact');

do $$
begin
  perform public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', 'unrecorded', null, null, null, null, null, null
  );
end;
$$;
select pass('staff can explicitly clear a meter reading and return it to unrecorded');
select ok((select electricity_morning_status is null
    and electricity_morning_recorded_at is null
    and electricity_morning_kwh is null
    and electricity_morning_unavailable_reason is null
  from public.daily_records
  where owner_id = current_setting('test.electricity_owner')::uuid
    and business_date = current_setting('test.electricity_today')::date),
  'explicit unrecorded status clears the old period values');

select throws_ok(
  $$select public.staff_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', 'recorded', time '07:05', 99, null, null, '[]'::jsonb, null
  )$$,
  'P0001', 'Meter decrease needs owner review',
  'staff cannot change the reading to a value below the previous meter point'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.electricity_owner'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.electricity_owner'), 'role', 'authenticated')::text, true);

select throws_ok(
  $$select public.owner_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', 'recorded', time '07:10', 90, null, null, '[]'::jsonb, null, null, null
  )$$,
  'P0001', 'A reset reason is required when the meter decreases',
  'owner must provide a reason when lowering the reading below the prior point'
);

do $$
begin
  perform public.owner_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', 'recorded', time '07:10', 90, null, null, '[]'::jsonb, null,
    'Đã thay công tơ', null
  );
end;
$$;
select pass('owner can record a decreasing reading with a reset reason');
select ok((select electricity_reset_reason = 'Đã thay công tơ'
  from public.daily_admin_details
  where owner_id = current_setting('test.electricity_owner')::uuid
    and business_date = current_setting('test.electricity_today')::date),
  'owner reset reason is recorded alongside the day');

do $$
begin
  perform public.owner_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'morning', 'recorded', time '07:10', 150, null, null, '[]'::jsonb, null, '', null
  );
end;
$$;
select pass('owner can correct the reading to a monotonic value and explicitly clear the reset reason');
select ok((select daily.electricity_morning_kwh = 150
    and details.electricity_reset_reason is null
  from public.daily_records as daily
  join public.daily_admin_details as details using (owner_id, business_date)
  where daily.owner_id = current_setting('test.electricity_owner')::uuid
    and daily.business_date = current_setting('test.electricity_today')::date),
  'monotonic correction clears the reset marker');

do $$
begin
  perform public.owner_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'evening', 'recorded', time '22:00', 140, null, null, '[]'::jsonb, '{"turned_off_unneeded":true,"checked_cooler_doors":false,"meter_photo_confirmed":true}'::jsonb,
    'Ghi nhận công tơ có giảm', null
  );
end;
$$;
select pass('owner can record a same-day decrease with its reason');

do $$
begin
  perform public.owner_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'evening', null, null, null, null, null, '[]'::jsonb,
    '{"turned_off_unneeded":null,"checked_cooler_doors":null,"meter_photo_confirmed":null}'::jsonb,
    'Ghi nhận công tơ có giảm', null
  );
end;
$$;
select ok((select electricity_evening_turned_off_unneeded is true
    and electricity_evening_checked_cooler_doors is false
    and electricity_evening_meter_photo_confirmed is true
  from public.daily_records
  where owner_id = current_setting('test.electricity_owner')::uuid
    and business_date = current_setting('test.electricity_today')::date),
  'omitted checklist values preserve saved answers');

select throws_ok(
  $$select public.owner_save_electricity_period(
    current_setting('test.electricity_today')::date,
    'evening', 'recorded', time '22:00', 140, null, null, '[]'::jsonb, '{"turned_off_unneeded":null,"checked_cooler_doors":null,"meter_photo_confirmed":null}'::jsonb,
    '', null
  )$$,
  'P0001', 'A reset reason is required when the meter decreases',
  'owner cannot clear the reset marker while the same-day decrease remains'
);
select ok((select electricity_reset_reason = 'Ghi nhận công tơ có giảm'
  from public.daily_admin_details
  where owner_id = current_setting('test.electricity_owner')::uuid
    and business_date = current_setting('test.electricity_today')::date),
  'failed reset-marker clear leaves the prior reason intact');

select throws_ok(
  $$select public.owner_save_electricity_period(
    (current_setting('test.electricity_today')::date - 2),
    'morning', null, null, null, null, 'Sửa ngày cũ', '[]'::jsonb, null, null, null
  )$$,
  'P0001', 'A reason is required to edit historical electricity',
  'owner must include a reason when editing historical electricity'
);

select * from finish();
rollback;
