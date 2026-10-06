import type { createClient } from "@/lib/supabase/server";
import { currentBusinessDate } from "@/lib/finance/format";
import { monthKeyOf, type DateOnly } from "@/lib/finance/calculations";
import { sumOwnerPostedCostsInDateRange, type OwnerProfitPosting } from "@/lib/finance/owner-posted-costs";
import { getVoucherMonthBounds } from "./filters";
import type { OwnerPurchaseVoucherRow } from "./types";

type OwnerSupabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;
const POSTING_PAGE_SIZE = 500;

export type OwnerPurchaseOverviewSummary = {
  monthAdvancedVnd: number;
  monthReimbursedVnd: number;
  monthOutstandingVnd: number;
  currentOutstandingVnd: number;
  finalizedCount: number;
  monthCutoffDate: string;
};

export type RecentOwnerPurchase = Pick<
  OwnerPurchaseVoucherRow,
  "id" | "purchase_date" | "vendor" | "invoice_total_vnd" | "note"
>;

function safeNonNegativeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError("Invalid purchase overview total");
  return parsed;
}

function parseOverviewSummary(data: unknown): OwnerPurchaseOverviewSummary {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new RangeError("Missing purchase overview summary");
  const row = data as Record<string, unknown>;
  if (typeof row.month_cutoff_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.month_cutoff_date)) {
    throw new RangeError("Invalid purchase overview cutoff date");
  }
  monthKeyOf(row.month_cutoff_date as DateOnly);
  return {
    monthAdvancedVnd: safeNonNegativeNumber(row.month_advanced_vnd),
    monthReimbursedVnd: safeNonNegativeNumber(row.month_reimbursed_vnd),
    monthOutstandingVnd: safeNonNegativeNumber(row.month_outstanding_vnd),
    currentOutstandingVnd: safeNonNegativeNumber(row.current_outstanding_vnd),
    finalizedCount: safeNonNegativeNumber(row.finalized_count),
    monthCutoffDate: row.month_cutoff_date,
  };
}

/** Loads purchase-cohort balances via an owner-checked aggregate RPC and only five recent headers. */
export async function loadOwnerPurchaseOverview(
  supabase: OwnerSupabase,
  ownerId: string,
  month: string,
) {
  const bounds = getVoucherMonthBounds(month);
  const asOfDate = currentBusinessDate();
  const [summaryResult, recentResult] = await Promise.all([
    supabase.rpc("owner_purchase_overview_summary", {
      p_month_start: bounds.startDate,
      p_as_of: asOfDate,
    }),
    supabase.from("owner_purchase_vouchers")
      .select("id,purchase_date,vendor,invoice_total_vnd,note")
      .eq("owner_id", ownerId)
      .eq("status", "finalized")
      .lte("purchase_date", asOfDate)
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  let summary: OwnerPurchaseOverviewSummary | null = null;
  let summaryError = Boolean(summaryResult.error);
  if (!summaryError) {
    try {
      summary = parseOverviewSummary(summaryResult.data);
    } catch {
      summaryError = true;
    }
  }

  return {
    summary,
    summaryError,
    recentPurchases: recentResult.error ? [] : (recentResult.data ?? []) as RecentOwnerPurchase[],
    recentError: Boolean(recentResult.error),
  };
}

/** Reads month-scoped profit events in bounded pages; query failures never become zero costs. */
export async function loadOwnerPostedProfitCostsInDateRange(
  supabase: OwnerSupabase,
  ownerId: string,
  startDate: string,
  endDate: string,
): Promise<{ amountVnd: number | null; error: boolean }> {
  if (endDate < startDate) return { amountVnd: 0, error: false };

  try {
    const startMonth = monthKeyOf(startDate as DateOnly);
    const endMonth = monthKeyOf(endDate as DateOnly);
    const rows: OwnerProfitPosting[] = [];
    for (let from = 0; ; from += POSTING_PAGE_SIZE) {
      const { data, error } = await supabase.from("owner_purchase_profit_postings")
        .select("id,posting_type,accounting_month,amount_vnd")
        .eq("owner_id", ownerId)
        .gte("accounting_month", `${startMonth}-01`)
        .lte("accounting_month", `${endMonth}-01`)
        .order("accounting_month", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + POSTING_PAGE_SIZE - 1);
      if (error) return { amountVnd: null, error: true };
      rows.push(...(data ?? []) as OwnerProfitPosting[]);
      if ((data?.length ?? 0) < POSTING_PAGE_SIZE) break;
    }
    return {
      amountVnd: sumOwnerPostedCostsInDateRange(rows, startDate, endDate),
      error: false,
    };
  } catch {
    return { amountVnd: null, error: true };
  }
}
