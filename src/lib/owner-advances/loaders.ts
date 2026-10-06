import type { createClient } from "@/lib/supabase/server";
import { getVoucherMonthBounds, getVoucherPageRange } from "./filters";
import { findMatchingDailyExpenses } from "./duplicate-matching";
import type { DailyExpenseCandidateRow, InventoryItemChoice, OwnerPurchaseEvidenceRow, OwnerPurchaseLineRow, OwnerPurchaseVoucherRow } from "./types";

type OwnerSupabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;
const PAGE_SIZE = 20;

export async function loadOwnerPurchaseMonthPage(
  supabase: OwnerSupabase,
  ownerId: string,
  month: string,
  page: number,
) {
  const bounds = getVoucherMonthBounds(month);
  const range = getVoucherPageRange(page, PAGE_SIZE);
  const { data, error, count } = await supabase.from("owner_purchase_vouchers")
    .select("id,owner_id,purchase_date,vendor,invoice_total_vnd,note,status,created_by,created_at,updated_by,updated_at,finalized_by,finalized_at,canceled_by,canceled_at,cancel_reason,linked_inventory_receipt_id,inventory_receipt_created", { count: "exact" })
    .eq("owner_id", ownerId)
    .gte("purchase_date", bounds.startDate)
    .lt("purchase_date", bounds.endDateExclusive)
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  if (error) return { vouchers: [] as OwnerPurchaseVoucherRow[], count: 0, pageSize: PAGE_SIZE, error: true };

  const vouchers = (data ?? []) as OwnerPurchaseVoucherRow[];
  const ids = vouchers.map(({ id }) => id);
  if (ids.length === 0) return { vouchers, count: count ?? 0, pageSize: PAGE_SIZE, error: false };
  const { data: lineRows, error: linesError } = await supabase.from("owner_purchase_lines")
    .select("id,voucher_id,line_number,active,description,cost_class,inventory_class,item_name_snapshot,converted_quantity,small_unit_snapshot,line_amount_vnd")
    .eq("owner_id", ownerId).eq("active", true).in("voucher_id", ids).order("line_number");
  if (linesError) return { vouchers: [] as OwnerPurchaseVoucherRow[], count: 0, pageSize: PAGE_SIZE, error: true };

  const linesByVoucher = new Map<string, Array<Record<string, unknown>>>();
  for (const line of lineRows ?? []) {
    const lineVoucherId = String(line.voucher_id);
    linesByVoucher.set(lineVoucherId, [...(linesByVoucher.get(lineVoucherId) ?? []), line as Record<string, unknown>]);
  }
  return {
    vouchers: vouchers.map((voucher) => Object.assign(voucher, { lines: linesByVoucher.get(voucher.id) ?? [] })),
    count: count ?? vouchers.length,
    pageSize: PAGE_SIZE,
    error: false,
  };
}

export async function loadOwnerPurchaseVoucher(supabase: OwnerSupabase, ownerId: string, voucherId: string) {
  const { data: voucher, error: voucherError } = await supabase.from("owner_purchase_vouchers")
    .select("*").eq("owner_id", ownerId).eq("id", voucherId).maybeSingle();
  if (voucherError) return { data: null, error: true };
  if (!voucher) return { data: null, error: false };

  const [linesResult, reimbursementResult, evidenceResult, eventsResult, postingsResult, sourceResult] = await Promise.all([
    supabase.from("owner_purchase_lines").select("*").eq("owner_id", ownerId).eq("voucher_id", voucherId).order("line_number"),
    supabase.from("owner_purchase_reimbursements").select("*").eq("owner_id", ownerId).eq("voucher_id", voucherId).order("business_date").order("created_at"),
    supabase.from("owner_purchase_evidence").select("id,reimbursement_id,file_name,caption,mime_type,byte_size,created_at").eq("owner_id", ownerId).eq("voucher_id", voucherId).order("created_at", { ascending: false }).range(0, 99),
    supabase.from("owner_purchase_events").select("id,event_type,actor_id,occurred_at,reason,related_id,before_state,after_state").eq("owner_id", ownerId).eq("voucher_id", voucherId).order("occurred_at", { ascending: false }).range(0, 99),
    supabase.from("owner_purchase_profit_postings").select("id,source_line_id,posting_type,accounting_month,amount_vnd,reverses_posting_id,created_at").eq("owner_id", ownerId).eq("voucher_id", voucherId).order("created_at", { ascending: false }),
    supabase.from("owner_purchase_source_links").select("id,daily_expense_id,resolution,created_at,before_state,result_payload").eq("owner_id", ownerId).eq("voucher_id", voucherId),
  ]);
  const anyError = [linesResult, reimbursementResult, evidenceResult, eventsResult, postingsResult, sourceResult].some((result) => result.error);
  if (anyError) return { data: null, error: true };

  const lines = (linesResult.data ?? []) as OwnerPurchaseLineRow[];
  let receiptLines: Array<Record<string, unknown>> = [];
  let receiptHeader: Record<string, unknown> | null = null;
  if (voucher.linked_inventory_receipt_id) {
    const [receiptResult, receiptLinesResult] = await Promise.all([
      supabase.from("inventory_receipts").select("id,receipt_code,received_at")
        .eq("owner_id", ownerId).eq("id", voucher.linked_inventory_receipt_id).maybeSingle(),
      supabase.from("inventory_receipt_lines").select("id,item_id,item_name,converted_quantity,small_unit")
        .eq("owner_id", ownerId).eq("receipt_id", voucher.linked_inventory_receipt_id).order("line_number"),
    ]);
    if (receiptResult.error || receiptLinesResult.error) return { data: null, error: true };
    receiptHeader = receiptResult.data as Record<string, unknown> | null;
    receiptLines = receiptLinesResult.data ?? [];
  }
  return {
    data: {
      voucher: voucher as OwnerPurchaseVoucherRow,
      lines,
      reimbursements: reimbursementResult.data ?? [],
      evidence: (evidenceResult.data ?? []) as OwnerPurchaseEvidenceRow[],
      evidenceTruncated: (evidenceResult.data?.length ?? 0) === 100,
      events: eventsResult.data ?? [],
      postings: postingsResult.data ?? [],
      sourceLinks: sourceResult.data ?? [],
      receiptHeader,
      receiptLines,
    },
    error: false,
  };
}

export async function loadActiveInventoryChoices(supabase: OwnerSupabase, ownerId: string) {
  const { data, error } = await supabase.from("inventory_items")
    .select("id,name,category,large_unit,conversion_factor,small_unit,count_large_unit_only")
    .eq("owner_id", ownerId).eq("active", true).order("sort_order").order("category").order("name");
  return { items: (data ?? []) as InventoryItemChoice[], error: Boolean(error) };
}

export async function loadPurchaseDuplicateCandidates(
  supabase: OwnerSupabase,
  ownerId: string,
  voucher: Pick<OwnerPurchaseVoucherRow, "purchase_date" | "invoice_total_vnd" | "note" | "vendor">,
  lines: readonly OwnerPurchaseLineRow[],
) {
  const { findMatchingDailyExpenses, getDuplicateExpenseAmounts } = await import("./duplicate-matching");
  const amounts = getDuplicateExpenseAmounts(Number(voucher.invoice_total_vnd), lines.map((line) => ({
    lineAmountVnd: line.line_amount_vnd === null ? null : Number(line.line_amount_vnd),
  })));
  if (amounts.length === 0) return { candidates: [], error: false };
  const { data, error } = await supabase.from("daily_expenses")
    .select("id,business_date,amount_vnd,reason,created_at")
    .eq("owner_id", ownerId).eq("business_date", voucher.purchase_date)
    .in("amount_vnd", amounts).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(1000);
  if (error) return { candidates: [], error: true };
  if ((data ?? []).length === 1000) return { candidates: [], error: true };
  return {
    candidates: findMatchingDailyExpenses(voucher, lines, (data ?? []) as DailyExpenseCandidateRow[]),
    error: false,
  };
}

export type FinalizedPurchaseExpenseMatch = {
  voucherId: string;
  purchaseDate: string;
  vendor: string | null;
  note: string | null;
  invoiceTotalVnd: number;
  matchedText: string;
  matchKind: "invoice" | "line";
};

export async function loadFinalizedExpenseMatches(
  supabase: OwnerSupabase,
  ownerId: string,
  businessDate: string,
  amountVnd: number,
  reason: string,
) {
  const { data: vouchers, error: voucherError } = await supabase.from("owner_purchase_vouchers")
    .select("id,owner_id,purchase_date,vendor,invoice_total_vnd,note,status,created_by,created_at,updated_by,updated_at,finalized_by,finalized_at,canceled_by,canceled_at,cancel_reason,linked_inventory_receipt_id,inventory_receipt_created")
    .eq("owner_id", ownerId).eq("status", "finalized").eq("purchase_date", businessDate)
    .order("created_at", { ascending: false }).limit(1000);
  if (voucherError || (vouchers ?? []).length === 1000) return { candidates: [], error: true };
  const headers = (vouchers ?? []) as OwnerPurchaseVoucherRow[];
  if (!headers.length) return { candidates: [], error: false };
  const voucherIds = headers.map(({ id }) => id);
  const { data: lineRows, error: lineError } = await supabase.from("owner_purchase_lines")
    .select("id,voucher_id,line_number,active,description,cost_class,inventory_class,item_name_snapshot,converted_quantity,small_unit_snapshot,line_amount_vnd")
    .eq("owner_id", ownerId).eq("active", true).eq("line_amount_vnd", amountVnd)
    .in("voucher_id", voucherIds).order("line_number").limit(5000);
  if (lineError || (lineRows ?? []).length === 5000) return { candidates: [], error: true };

  type MatchLine = Pick<OwnerPurchaseLineRow, "description" | "line_amount_vnd">;
  const linesByVoucher = new Map<string, MatchLine[]>();
  for (const line of lineRows ?? []) {
    const voucherId = String(line.voucher_id);
    linesByVoucher.set(voucherId, [...(linesByVoucher.get(voucherId) ?? []), {
      description: String(line.description),
      line_amount_vnd: line.line_amount_vnd as number | string | null,
    }]);
  }
  const attemptedExpense: DailyExpenseCandidateRow = {
    id: "unsubmitted-expense",
    business_date: businessDate,
    amount_vnd: amountVnd,
    reason,
    created_at: "",
  };
  const candidates = headers.flatMap((voucher) => {
    const match = findMatchingDailyExpenses(voucher, linesByVoucher.get(voucher.id) ?? [], [attemptedExpense])[0];
    return match ? [{
      voucherId: voucher.id,
      purchaseDate: voucher.purchase_date,
      vendor: voucher.vendor,
      note: voucher.note,
      invoiceTotalVnd: Number(voucher.invoice_total_vnd),
      matchedText: match.matchedText,
      matchKind: match.matchKind,
    } satisfies FinalizedPurchaseExpenseMatch] : [];
  });
  return { candidates, error: false };
}

export async function loadReceiptLinkCandidates(
  supabase: OwnerSupabase,
  ownerId: string,
  purchaseDate: string,
  stockLines: readonly OwnerPurchaseLineRow[],
) {
  if (!stockLines.length) return { candidates: [], error: false };
  const nextDate = new Date(`${purchaseDate}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateOnly = nextDate.toISOString().slice(0, 10);
  const { data: receipts, error: receiptsError } = await supabase.from("inventory_receipts")
    .select("id,receipt_code,received_at")
    .eq("owner_id", ownerId)
    .gte("received_at", `${purchaseDate}T00:00:00+07:00`)
    .lt("received_at", `${nextDateOnly}T00:00:00+07:00`)
    .order("received_at", { ascending: false }).limit(50);
  if (receiptsError) return { candidates: [], error: true };
  const receiptIds = (receipts ?? []).map(({ id }) => String(id));
  if (!receiptIds.length) return { candidates: [], error: false };

  const [linesResult, linksResult] = await Promise.all([
    supabase.from("inventory_receipt_lines").select("id,receipt_id,item_id,converted_quantity").eq("owner_id", ownerId).in("receipt_id", receiptIds),
    supabase.from("owner_purchase_stock_links").select("receipt_line_id").eq("owner_id", ownerId).in("receipt_id", receiptIds),
  ]);
  if (linesResult.error || linksResult.error) return { candidates: [], error: true };
  const linked = new Set((linksResult.data ?? []).map(({ receipt_line_id }) => String(receipt_line_id)));
  const linesByReceipt = new Map<string, Array<Record<string, unknown>>>();
  for (const line of linesResult.data ?? []) {
    if (linked.has(String(line.id))) continue;
    const receiptId = String(line.receipt_id);
    linesByReceipt.set(receiptId, [...(linesByReceipt.get(receiptId) ?? []), line as Record<string, unknown>]);
  }
  const candidates = (receipts ?? []).flatMap((receipt) => {
    const receiptLines = linesByReceipt.get(String(receipt.id)) ?? [];
    const links: Array<{ purchase_line_id: string; receipt_line_id: string }> = [];
    const usedLineIds = new Set<string>();
    const quantityKey = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : null;
    };
    for (const purchaseLine of stockLines) {
      const match = receiptLines.find((receiptLine) => String(receiptLine.item_id) === purchaseLine.inventory_item_id
        && quantityKey(receiptLine.converted_quantity) !== null
        && quantityKey(receiptLine.converted_quantity) === quantityKey(purchaseLine.converted_quantity)
        && !usedLineIds.has(String(receiptLine.id)));
      if (!match) return [];
      usedLineIds.add(String(match.id));
      links.push({ purchase_line_id: purchaseLine.id, receipt_line_id: String(match.id) });
    }
    return [{ id: String(receipt.id), receiptCode: String(receipt.receipt_code), links }];
  });
  return { candidates, error: false };
}
