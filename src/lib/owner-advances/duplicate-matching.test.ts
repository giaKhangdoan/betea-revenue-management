import { describe, expect, it } from "vitest";
import { findMatchingDailyExpenses, getDuplicateExpenseAmounts, normalizePurchaseText } from "./duplicate-matching";

const voucher = {
  purchase_date: "2026-10-06",
  invoice_total_vnd: 249_000,
  vendor: "Cửa hàng đá Bảo",
  note: "Mua đá giao quán",
};

describe("owner purchase duplicate warnings", () => {
  it("normalizes Vietnamese case, accents, punctuation, and spaces", () => {
    expect(normalizePurchaseText("  MUA Đá - giao   QUÁN! ")).toBe("mua da giao quan");
  });

  it("warns only when the date, exact amount, and normalized description match", () => {
    const matches = findMatchingDailyExpenses(voucher, [
      { description: "Mua đá giao quán", line_amount_vnd: 36_000 },
    ], [
      { id: "same", business_date: "2026-10-06", amount_vnd: 36_000, reason: "MUA ĐÁ", created_at: "2026-10-06T12:00:00Z" },
      { id: "wrong-amount", business_date: "2026-10-06", amount_vnd: 35_000, reason: "Mua đá", created_at: "2026-10-06T13:00:00Z" },
      { id: "wrong-date", business_date: "2026-10-05", amount_vnd: 36_000, reason: "Mua đá", created_at: "2026-10-06T14:00:00Z" },
      { id: "wrong-description", business_date: "2026-10-06", amount_vnd: 36_000, reason: "Gửi xe", created_at: "2026-10-06T15:00:00Z" },
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: "same", matchedText: "Mua đá giao quán", matchedAmountVnd: 36_000, matchKind: "line", paymentSource: "shop_cash" });
  });

  it("matches an invoice-level warning using the vendor/note while keeping the source as shop cash", () => {
    const matches = findMatchingDailyExpenses(voucher, [], [
      { id: "invoice-match", business_date: "2026-10-06", amount_vnd: "249000", reason: "Mua đá giao quán", created_at: "2026-10-06T12:00:00Z" },
    ]);

    expect(matches[0]).toMatchObject({ id: "invoice-match", matchedAmountVnd: 249_000, matchKind: "invoice", paymentSource: "shop_cash" });
  });

  it("queries unique positive invoice and line amounts only", () => {
    expect(getDuplicateExpenseAmounts(100_000, [
      { lineAmountVnd: 36_000 },
      { lineAmountVnd: 36_000 },
      { lineAmountVnd: null },
      { lineAmountVnd: -1 },
    ])).toEqual([100_000, 36_000]);
  });
});
