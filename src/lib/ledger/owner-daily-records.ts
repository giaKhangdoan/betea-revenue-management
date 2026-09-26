import type { SupabaseClient } from "@supabase/supabase-js";

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

type DateRange = { start?: string; end?: string };

export async function loadOwnerDailyRecords(
  supabase: SupabaseClient,
  ownerId: string,
  range: DateRange = {},
) {
  let dailyQuery = supabase.from("daily_records").select(DAILY_FIELDS).eq("owner_id", ownerId);
  let adminQuery = supabase.from("daily_admin_details").select(ADMIN_FIELDS).eq("owner_id", ownerId);
  if (range.start) {
    dailyQuery = dailyQuery.gte("business_date", range.start);
    adminQuery = adminQuery.gte("business_date", range.start);
  }
  if (range.end) {
    dailyQuery = dailyQuery.lte("business_date", range.end);
    adminQuery = adminQuery.lte("business_date", range.end);
  }

  const [{ data: dailyRows, error: dailyError }, { data: adminRows, error: adminError }] = await Promise.all([
    dailyQuery.order("business_date"),
    adminQuery.order("business_date"),
  ]);
  const error = dailyError ?? adminError;
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
