import { addDays, currentBusinessDate } from "@/lib/finance/format";
import { calculateDailyElectricityUsage } from "@/lib/finance/calculations";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIRST_BUSINESS_DATE = "2026-09-01";
const MAX_RANGE_DAYS = 31;
const NO_CACHE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type MeterRow = {
  business_date: string;
  electricity_morning_kwh: number | string | null;
  electricity_evening_kwh: number | string | null;
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_CACHE_HEADERS });
}

function isDateOnly(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function meterValue(value: MeterRow["electricity_morning_kwh"]): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestedRange(request: Request) {
  const params = new URL(request.url).searchParams;
  const fromDate = params.get("fromDate");
  const toDate = params.get("toDate");

  if (!isDateOnly(fromDate) || !isDateOnly(toDate)) return null;
  return { from: fromDate, to: toDate };
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

  // Include the following morning's reading so the last requested day can include
  // overnight usage. Only electricity columns are selected from the sales table.
  const { data: records, error: recordsError } = await admin
    .from("daily_records")
    .select("business_date,electricity_morning_kwh,electricity_evening_kwh")
    .eq("owner_id", owner.user_id)
    .gte("business_date", range.from)
    .lte("business_date", addDays(range.to, 1))
    .order("business_date", { ascending: true });
  if (recordsError) return response({ error: "Could not read electricity records." }, 503);

  const byDate = new Map<string, MeterRow>(
    ((records ?? []) as MeterRow[]).map((record) => [record.business_date, record] as const),
  );
  const items = Array.from({ length: rangeDays }, (_, index) => {
    const date = addDays(range.from, index);
    const current = byDate.get(date);
    const nextMorning = byDate.get(addDays(date, 1));
    const morningKwh = meterValue(current?.electricity_morning_kwh ?? null);
    const eveningKwh = meterValue(current?.electricity_evening_kwh ?? null);
    const nextMorningKwh = meterValue(nextMorning?.electricity_morning_kwh ?? null);

    if (!current) {
      return {
        date,
        status: "no_record",
        readingsKwh: { morning: null, evening: null, nextMorning: nextMorningKwh },
        usageKwh: { operatingHours: null, overnight: null, total: null },
      };
    }

    const usage = calculateDailyElectricityUsage({ morningKwh, eveningKwh, nextMorningKwh });
    return {
      date,
      status: usage.status,
      readingsKwh: { morning: morningKwh, evening: eveningKwh, nextMorning: nextMorningKwh },
      usageKwh: {
        operatingHours: usage.shiftKwh,
        overnight: usage.overnightKwh,
        total: usage.fullDayKwh,
      },
    };
  });

  return response({
    timezone: "Asia/Ho_Chi_Minh",
    unit: "kWh",
    fromDate: range.from,
    toDate: range.to,
    generatedAt: new Date().toISOString(),
    items,
  });
}
