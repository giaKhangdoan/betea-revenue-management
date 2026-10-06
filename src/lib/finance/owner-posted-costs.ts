import {
  allocateSignedMonthlyAmountByDay,
  monthKeyOf,
  type DateOnly,
  type MonthKey,
} from "./calculations";

export type OwnerProfitPosting = {
  id: string;
  posting_type: "post" | "reversal";
  accounting_month: string;
  amount_vnd: number | string;
};

/**
 * Applies explicitly posted owner-purchase costs to a date range.
 * Month-based postings are allocated by calendar day, matching other monthly costs.
 */
export function sumOwnerPostedCostsInDateRange(
  postings: readonly OwnerProfitPosting[],
  startDate: string,
  endDate: string,
): number {
  monthKeyOf(startDate as DateOnly);
  monthKeyOf(endDate as DateOnly);
  if (endDate < startDate) throw new RangeError("End date cannot be before start date");

  let total = 0;
  const seen = new Set<string>();
  for (const posting of postings) {
    if (!posting.id || seen.has(posting.id)) throw new RangeError("Profit posting IDs must be present and unique");
    seen.add(posting.id);

    const accountingMonthDate = posting.accounting_month;
    const monthKey = monthKeyOf(accountingMonthDate as DateOnly);
    if (accountingMonthDate !== `${monthKey}-01`) {
      throw new RangeError("Profit posting accounting month must be the first day of a month");
    }
    const amount = Number(posting.amount_vnd);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new RangeError("Profit posting amount must be a positive integer VND amount");
    }
    if (posting.posting_type !== "post" && posting.posting_type !== "reversal") {
      throw new RangeError("Unknown profit posting event type");
    }

    const signedAmount = posting.posting_type === "post" ? amount : -amount;
    const dailyAmounts = allocateSignedMonthlyAmountByDay(signedAmount, monthKey as MonthKey);
    for (const day of dailyAmounts) {
      if (day.date < startDate || day.date > endDate) continue;
      total += day.amountVnd;
      if (!Number.isSafeInteger(total)) throw new RangeError("Owner-posted cost total exceeds the safe integer range");
    }
  }
  return total;
}

