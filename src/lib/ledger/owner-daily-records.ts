import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/supabase/read-pages";

const DAILY_FIELDS = [
  "id", "owner_id", "business_date", "shift_06_10_vnd", "shift_10_14_vnd",
  "shift_14_18_vnd", "shift_18_22_vnd", "grab_vnd", "shopee_vnd",
  "grab_order_count", "shopee_order_count", "total_bill_count",
  "electricity_morning_kwh", "electricity_evening_kwh", "created_at", "updated_at",
].join(",");

const ADMIN_FIELDS = [
  "business_date", "business_status", "cleaning_done", "arrangement_done", "note",
  "reconciliation_status", "bluebook_total_vnd", "reconciliation_difference_vnd",
  "reconciliation_note", "electricity_reset_reason",
].join(",");

const ELECTRICITY_DETAIL_FIELDS = [
  "electricity_morning_status", "electricity_morning_recorded_at",
  "electricity_morning_unavailable_reason", "electricity_morning_note",
  "electricity_evening_status", "electricity_evening_recorded_at",
  "electricity_evening_unavailable_reason", "electricity_evening_note",
  "electricity_evening_turned_off_unneeded", "electricity_evening_checked_cooler_doors",
  "electricity_evening_meter_photo_confirmed",
].join(",");

export type OwnerDailyRecord = {
  id: string;
  owner_id: string;
  business_date: string;
  shift_06_10_vnd: number | null;
  shift_10_14_vnd: number | null;
  shift_14_18_vnd: number | null;
  shift_18_22_vnd: number | null;
  grab_vnd: number | null;
  shopee_vnd: number | null;
  grab_order_count: number;
  shopee_order_count: number;
  total_bill_count: number | null;
  electricity_morning_kwh: number | null;
  electricity_evening_kwh: number | null;
  created_at: string;
  updated_at: string;
  business_status: "open" | "closed" | "no_business";
  cleaning_done: boolean | null;
  arrangement_done: boolean | null;
  note: string | null;
  reconciliation_status: "unreconciled" | "pending" | "matched" | "discrepancy";
  bluebook_total_vnd: number | null;
  reconciliation_difference_vnd: number | null;
  reconciliation_note: string | null;
  electricity_reset_reason: string | null;
  electricity_morning_status?: "recorded" | "unable" | null;
  electricity_morning_recorded_at?: string | null;
  electricity_morning_unavailable_reason?: string | null;
  electricity_morning_note?: string | null;
  electricity_evening_status?: "recorded" | "unable" | null;
  electricity_evening_recorded_at?: string | null;
  electricity_evening_unavailable_reason?: string | null;
  electricity_evening_note?: string | null;
  electricity_evening_turned_off_unneeded?: boolean | null;
  electricity_evening_checked_cooler_doors?: boolean | null;
  electricity_evening_meter_photo_confirmed?: boolean | null;
};

type AdminDetails = Pick<OwnerDailyRecord,
  | "business_date"
  | "business_status"
  | "cleaning_done"
  | "arrangement_done"
  | "note"
  | "reconciliation_status"
  | "bluebook_total_vnd"
  | "reconciliation_difference_vnd"
  | "reconciliation_note"
  | "electricity_reset_reason"
>;

type DateRange = { start?: string; end?: string; includeElectricityDetails?: boolean };

export async function loadOwnerDailyRecords(
  supabase: SupabaseClient,
  ownerId: string,
  range: DateRange = {},
) {
  const dailyFields = range.includeElectricityDetails ? `${DAILY_FIELDS},${ELECTRICITY_DETAIL_FIELDS}` : DAILY_FIELDS;
  let dailyQuery = supabase.from("daily_records").select(dailyFields).eq("owner_id", ownerId);
  let adminQuery = supabase.from("daily_admin_details").select(ADMIN_FIELDS).eq("owner_id", ownerId);
  if (range.start) {
    dailyQuery = dailyQuery.gte("business_date", range.start);
    adminQuery = adminQuery.gte("business_date", range.start);
  }
  if (range.end) {
    dailyQuery = dailyQuery.lte("business_date", range.end);
    adminQuery = adminQuery.lte("business_date", range.end);
  }

  const [dailyResult, adminResult] = await Promise.all([
    readAllPages((from, to) => dailyQuery.order("business_date").range(from, to)),
    readAllPages((from, to) => adminQuery.order("business_date").range(from, to)),
  ]);
  const dailyRows = dailyResult.data;
  const adminRows = adminResult.data;
  const error = dailyResult.error ?? adminResult.error;
  if (error) return { data: [] as OwnerDailyRecord[], error };

  const typedAdminRows = (adminRows ?? []) as unknown as AdminDetails[];
  type DailyBase = Omit<OwnerDailyRecord, keyof AdminDetails> & Pick<OwnerDailyRecord, "business_date">;
  const typedDailyRows = (dailyRows ?? []) as unknown as DailyBase[];
  const adminByDate = new Map<string, AdminDetails>(typedAdminRows.map((row) => [row.business_date, row]));
  const data = typedDailyRows.map((row) => {
    const admin = adminByDate.get(row.business_date);
    return {
      ...row,
      business_status: admin?.business_status ?? "open",
      cleaning_done: admin?.cleaning_done ?? null,
      arrangement_done: admin?.arrangement_done ?? null,
      note: admin?.note ?? null,
      reconciliation_status: admin?.reconciliation_status ?? "unreconciled",
      bluebook_total_vnd: admin?.bluebook_total_vnd ?? null,
      reconciliation_difference_vnd: admin?.reconciliation_difference_vnd ?? null,
      reconciliation_note: admin?.reconciliation_note ?? null,
      electricity_reset_reason: admin?.electricity_reset_reason ?? null,
    } as OwnerDailyRecord;
  });

  return { data, error: null };
}
