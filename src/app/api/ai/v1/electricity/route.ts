import { addDays, currentBusinessDate } from "@/lib/finance/format";
import { calculateDailyElectricityUsage } from "@/lib/finance/calculations";
import { electricityDurationMinutes } from "@/lib/electricity/time-input";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIRST_BUSINESS_DATE = "2026-09-01";
const MAX_RANGE_DAYS = 31;
const PAGE_SIZE = 500;
const NO_CACHE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type MeterRow = {
  business_date: string;
  electricity_morning_kwh: number | string | null;
  electricity_evening_kwh: number | string | null;
  electricity_morning_status: "recorded" | "unable" | null;
  electricity_morning_recorded_at: string | null;
  electricity_morning_unavailable_reason: string | null;
  electricity_morning_note: string | null;
  electricity_evening_status: "recorded" | "unable" | null;
  electricity_evening_recorded_at: string | null;
  electricity_evening_unavailable_reason: string | null;
  electricity_evening_note: string | null;
  electricity_evening_turned_off_unneeded: boolean | null;
  electricity_evening_checked_cooler_doors: boolean | null;
  electricity_evening_meter_photo_confirmed: boolean | null;
};

type DeviceRow = {
  id: string;
  name: string;
  mode: "timed" | "continuous";
  sort_order: number;
  is_active: boolean;
};

type DeviceLogRow = {
  business_date: string;
  period: "morning" | "evening";
  device_id: string;
  device_name_snapshot: string;
  device_mode_snapshot: "timed" | "continuous";
  operating_status: "not_running" | "running";
  started_at: string | null;
  ended_at: string | null;
  ends_next_day: boolean;
  ran_from_previous_night: boolean | null;
  remains_on_after_close: boolean | null;
  note: string | null;
};

type MeterPhotoRow = {
  business_date: string;
  electricity_period: "morning" | "evening";
  caption: string | null;
  created_at: string;
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_CACHE_HEADERS });
}

function isDateOnly(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function meterValue(value: MeterRow["electricity_morning_kwh"] | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function meterReading(
  status: MeterRow["electricity_morning_status"] | undefined,
  recordedAt: string | null | undefined,
  kwh: number | null,
  unavailableReason: string | null | undefined,
  note: string | null | undefined,
) {
  return {
    status: status ?? (kwh !== null ? "legacy_recorded_without_metadata" : "unrecorded"),
    recordedAt: recordedAt?.slice(0, 5) ?? null,
    kwh,
    unavailableReason: unavailableReason ?? null,
    note: note ?? null,
  };
}

function requestedRange(request: Request) {
  const params = new URL(request.url).searchParams;
  const fromDate = params.get("fromDate");
  const toDate = params.get("toDate");

  if (!isDateOnly(fromDate) || !isDateOnly(toDate)) return null;
  return { from: fromDate, to: toDate };
}

// Device logs can exceed the Data API's default row limit in a 31-day range.
// Keep a stable order in each query so every stored log is included.
async function readAllRows<T>(readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await readPage(from, from + PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function GET(request: Request) {
  const range = requestedRange(request);
  if (!range) {
    return response({ error: "Provide both fromDate=YYYY-MM-DD and toDate=YYYY-MM-DD. For one day, use the same date for both." }, 400);
  }

  const today = currentBusinessDate();
  if (range.from < FIRST_BUSINESS_DATE || range.from > range.to || range.to > today) {
    return response({ error: `Date range must be between ${FIRST_BUSINESS_DATE} and today (${today}).` }, 400);
  }

  const rangeDays = Math.floor((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86_400_000) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    return response({ error: `A request can include up to ${MAX_RANGE_DAYS} days.` }, 400);
  }

  const admin = createAdminClient();
  if (!admin) return response({ error: "Electricity API data source is unavailable." }, 503);

  const { data: owner, error: ownerError } = await admin
    .from("owner_profiles")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  if (ownerError || !owner) return response({ error: "Store owner record is unavailable." }, 503);

  // Only query electricity-specific columns. The additional morning row is used
  // to calculate overnight consumption for the final requested date.
  const [recordsResult, devicesResult, deviceLogsResult, photosResult] = await Promise.all([
    admin.from("daily_records")
      .select("business_date,electricity_morning_kwh,electricity_evening_kwh,electricity_morning_status,electricity_morning_recorded_at,electricity_morning_unavailable_reason,electricity_morning_note,electricity_evening_status,electricity_evening_recorded_at,electricity_evening_unavailable_reason,electricity_evening_note,electricity_evening_turned_off_unneeded,electricity_evening_checked_cooler_doors,electricity_evening_meter_photo_confirmed")
      .eq("owner_id", owner.user_id)
      .gte("business_date", range.from)
      .lte("business_date", addDays(range.to, 1))
      .order("business_date", { ascending: true }),
    readAllRows<DeviceRow>((from, to) => admin.from("electricity_devices")
      .select("id,name,mode,sort_order,is_active")
      .eq("owner_id", owner.user_id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)),
    readAllRows<DeviceLogRow>((from, to) => admin.from("daily_electricity_device_logs")
      .select("business_date,period,device_id,device_name_snapshot,device_mode_snapshot,operating_status,started_at,ended_at,ends_next_day,ran_from_previous_night,remains_on_after_close,note")
      .eq("owner_id", owner.user_id)
      .gte("business_date", range.from)
      .lte("business_date", range.to)
      .order("business_date", { ascending: true })
      .order("period", { ascending: true })
      .order("device_id", { ascending: true })
      .range(from, to)),
    readAllRows<MeterPhotoRow>((from, to) => admin.from("day_photos")
      .select("business_date,electricity_period,caption,created_at")
      .eq("owner_id", owner.user_id)
      .eq("category", "electricity_meter")
      .gte("business_date", range.from)
      .lte("business_date", range.to)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)),
  ]);

  if (recordsResult.error || devicesResult.error || deviceLogsResult.error || photosResult.error) {
    return response({ error: "Could not read electricity monitoring data." }, 503);
  }

  const records = (recordsResult.data ?? []) as MeterRow[];
  const devices = (devicesResult.data ?? []) as DeviceRow[];
  const deviceLogs = (deviceLogsResult.data ?? []) as DeviceLogRow[];
  const meterPhotos = (photosResult.data ?? []) as MeterPhotoRow[];
  const byDate = new Map(records.map((record) => [record.business_date, record] as const));
  const deviceLogsByDate = new Map<string, { morning: ReturnType<typeof serializeDeviceLog>[]; evening: ReturnType<typeof serializeDeviceLog>[] }>();
  for (const log of deviceLogs) {
    const dailyLogs = deviceLogsByDate.get(log.business_date) ?? { morning: [], evening: [] };
    dailyLogs[log.period].push(serializeDeviceLog(log));
    deviceLogsByDate.set(log.business_date, dailyLogs);
  }
  const photosByDate = new Map<string, { morning: ReturnType<typeof serializeMeterPhoto>[]; evening: ReturnType<typeof serializeMeterPhoto>[] }>();
  for (const photo of meterPhotos) {
    if (photo.electricity_period !== "morning" && photo.electricity_period !== "evening") continue;
    const dailyPhotos = photosByDate.get(photo.business_date) ?? { morning: [], evening: [] };
    dailyPhotos[photo.electricity_period].push(serializeMeterPhoto(photo));
    photosByDate.set(photo.business_date, dailyPhotos);
  }

  const items = Array.from({ length: rangeDays }, (_, index) => {
    const date = addDays(range.from, index);
    const current = byDate.get(date);
    const nextMorning = byDate.get(addDays(date, 1));
    const morningKwh = meterValue(current?.electricity_morning_kwh);
    const eveningKwh = meterValue(current?.electricity_evening_kwh);
    const nextMorningKwh = meterValue(nextMorning?.electricity_morning_kwh);
    const usage = current
      ? calculateDailyElectricityUsage({ morningKwh, eveningKwh, nextMorningKwh })
      : null;

    return {
      date,
      recordStatus: current ? "has_record" : "no_record",
      status: usage?.status ?? "no_record",
      readings: {
        morning: meterReading(current?.electricity_morning_status, current?.electricity_morning_recorded_at, morningKwh, current?.electricity_morning_unavailable_reason, current?.electricity_morning_note),
        evening: meterReading(current?.electricity_evening_status, current?.electricity_evening_recorded_at, eveningKwh, current?.electricity_evening_unavailable_reason, current?.electricity_evening_note),
      },
      // Keep the original fields for existing AI clients.
      readingsKwh: { morning: morningKwh, evening: eveningKwh, nextMorning: nextMorningKwh },
      usageKwh: {
        operatingHours: usage?.shiftKwh ?? null,
        overnight: usage?.overnightKwh ?? null,
        total: usage?.fullDayKwh ?? null,
      },
      devices: deviceLogsByDate.get(date) ?? { morning: [], evening: [] },
      closingChecklist: {
        turnedOffUnneeded: current?.electricity_evening_turned_off_unneeded ?? null,
        checkedCoolerDoors: current?.electricity_evening_checked_cooler_doors ?? null,
        meterPhotoConfirmed: current?.electricity_evening_meter_photo_confirmed ?? null,
      },
      meterPhotos: photosByDate.get(date) ?? { morning: [], evening: [] },
    };
  });

  return response({
    apiVersion: "2",
    timezone: "Asia/Ho_Chi_Minh",
    unit: "kWh",
    fromDate: range.from,
    toDate: range.to,
    generatedAt: new Date().toISOString(),
    deviceCatalog: devices.map((device) => ({
      id: device.id,
      name: device.name,
      mode: device.mode,
      sortOrder: device.sort_order,
      isActive: device.is_active,
    })),
    items,
  });
}

function serializeDeviceLog(log: DeviceLogRow) {
  const startedAt = log.started_at?.slice(0, 5) ?? null;
  const endedAt = log.ended_at?.slice(0, 5) ?? null;
  const fromPreviousNight = log.period === "morning" && log.ran_from_previous_night === true
    && startedAt !== null && endedAt !== null && startedAt > endedAt;
  const endsNextDay = log.period === "evening" && log.ends_next_day;
  return {
    deviceId: log.device_id,
    name: log.device_name_snapshot,
    mode: log.device_mode_snapshot,
    status: log.operating_status,
    startedAt,
    endedAt,
    startedOn: startedAt ? addDays(log.business_date, fromPreviousNight ? -1 : 0) : null,
    endedOn: endedAt ? addDays(log.business_date, endsNextDay ? 1 : 0) : null,
    durationMinutes: log.device_mode_snapshot === "timed" && log.operating_status === "running"
      ? electricityDurationMinutes(startedAt ?? "", endedAt ?? "", endsNextDay || fromPreviousNight)
      : null,
    endsNextDay: log.ends_next_day,
    ranFromPreviousNight: log.ran_from_previous_night,
    remainsOnAfterClose: log.remains_on_after_close,
    note: log.note,
  };
}

function serializeMeterPhoto(photo: MeterPhotoRow) {
  return {
    caption: photo.caption,
    uploadedAt: photo.created_at,
  };
}
