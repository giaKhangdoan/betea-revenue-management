import type { DailyExpenseCandidateRow, OwnerPurchaseLineRow, OwnerPurchaseVoucherRow } from "./types";

export function normalizePurchaseText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (letter) => letter === "Đ" ? "D" : "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sameMeaning(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 4 && (` ${longer} `).includes(` ${shorter} `);
}

export type DuplicateExpenseMatch = DailyExpenseCandidateRow & {
  matchedText: string;
  matchedAmountVnd: number;
  matchKind: "invoice" | "line";
  paymentSource: "shop_cash";
};

export function findMatchingDailyExpenses(
  voucher: Pick<OwnerPurchaseVoucherRow, "purchase_date" | "invoice_total_vnd" | "note" | "vendor">,
  lines: readonly Pick<OwnerPurchaseLineRow, "description" | "line_amount_vnd">[],
  expenses: readonly DailyExpenseCandidateRow[],
): DuplicateExpenseMatch[] {
  const invoiceAmount = Number(voucher.invoice_total_vnd);
  const candidates = new Map<string, DuplicateExpenseMatch>();
  for (const expense of expenses) {
    if (expense.business_date !== voucher.purchase_date) continue;
    const expenseAmount = Number(expense.amount_vnd);
    if (!Number.isSafeInteger(expenseAmount) || expenseAmount <= 0) continue;
    const normalizedReason = normalizePurchaseText(expense.reason);
    if (!normalizedReason) continue;

    const matchedLine = lines.find((line) => {
      const lineAmount = line.line_amount_vnd === null ? null : Number(line.line_amount_vnd);
      return lineAmount === expenseAmount && sameMeaning(normalizePurchaseText(line.description), normalizedReason);
    });
    const matchedHeaderText = [voucher.note, voucher.vendor]
      .map(normalizePurchaseText)
      .find((text) => sameMeaning(text, normalizedReason));
    const matchesInvoice = expenseAmount === invoiceAmount && Boolean(matchedHeaderText);
    if (!matchedLine && !matchesInvoice) continue;

    candidates.set(expense.id, {
      ...expense,
      matchedText: matchedLine?.description ?? (voucher.note?.trim() || voucher.vendor || expense.reason),
      matchedAmountVnd: expenseAmount,
      matchKind: matchedLine ? "line" : "invoice",
      paymentSource: "shop_cash",
    });
  }
  return [...candidates.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function getDuplicateExpenseAmounts(
  invoiceTotalVnd: number,
  lines: readonly { lineAmountVnd: number | null }[],
): number[] {
  return [...new Set([invoiceTotalVnd, ...lines.map(({ lineAmountVnd }) => lineAmountVnd).filter((value): value is number => value !== null)])]
    .filter((amount) => Number.isSafeInteger(amount) && amount > 0);
}
