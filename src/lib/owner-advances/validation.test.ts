import { describe, expect, it } from "vitest";
import {
  parseProfitPostingInput,
  parsePurchaseLineInput,
  parseReimbursementInput,
  parseVoucherDraftInput,
} from "./validation";

const validVoucher = {
  purchaseDate: "2026-10-06",
  vendor: "  Nhà cung cấp  ",
  invoiceTotalVnd: "250000",
  note: "Mua trà và ly",
};

const stockLine = {
  description: "Trà đen",
  costClass: "raw_material",
  inventoryClass: "stock",
  inventoryItemId: "98000000-0000-4000-8000-000000000001",
  largeQuantity: "1",
  looseQuantity: "0",
  conversionFactor: "1000",
  smallUnit: "g",
  convertedQuantity: "1000",
  lineAmountVnd: "200000",
};

describe("owner purchase input validation", () => {
  it("accepts a valid voucher draft and requires a real business date on or after 2026-09-01", () => {
    expect(parseVoucherDraftInput(validVoucher).success).toBe(true);
    expect(parseVoucherDraftInput({ ...validVoucher, purchaseDate: "2026-08-31" }).success).toBe(false);
    expect(parseVoucherDraftInput({ ...validVoucher, purchaseDate: "2026-02-30" }).success).toBe(false);
  });

  it("rejects zero, fractional, unsafe, or malformed invoice totals before the RPC boundary", () => {
    for (const invoiceTotalVnd of ["0", "-1", "1.5", "1e6", "9007199254740992", ""]) {
      expect(parseVoucherDraftInput({ ...validVoucher, invoiceTotalVnd }).success).toBe(false);
    }
    expect(parseVoucherDraftInput({ ...validVoucher, invoiceTotalVnd: "250000" }).success).toBe(true);
  });

  it("accepts explicitly classified stock and non-stock rows without inferring cost class", () => {
    expect(parsePurchaseLineInput(stockLine).success).toBe(true);
    expect(parsePurchaseLineInput({
      description: "Sửa máy dập nắp",
      costClass: "non_ingredient",
      inventoryClass: "non_stock",
      unit: "lần",
      quantity: "1",
      lineAmountVnd: "50000",
    }).success).toBe(true);

    // Cost classification is an explicit choice; inventory/category labels are
    // not enough to silently change a line into an ingredient or service.
    expect(parsePurchaseLineInput({ ...stockLine, costClass: undefined }).success).toBe(false);
    expect(parsePurchaseLineInput({ ...stockLine, costClass: "equipment" }).success).toBe(false);
  });

  it("rejects stock lines without an item snapshot or usable conversion and rejects contradictory non-stock data", () => {
    expect(parsePurchaseLineInput({ ...stockLine, inventoryItemId: "" }).success).toBe(false);
    expect(parsePurchaseLineInput({ ...stockLine, conversionFactor: "0" }).success).toBe(false);
    expect(parsePurchaseLineInput({ ...stockLine, convertedQuantity: "0" }).success).toBe(false);
    expect(parsePurchaseLineInput({
      description: "Sửa máy",
      costClass: "non_ingredient",
      inventoryClass: "non_stock",
      inventoryItemId: "tea-item",
      unit: "lần",
      quantity: "1",
    }).success).toBe(false);
  });

  it("accepts positive whole-VND partial repayments but rejects malformed or out-of-range amounts", () => {
    expect(parseReimbursementInput({ businessDate: "2026-10-06", amountVnd: "30000", note: "Hoàn một phần" }).success).toBe(true);
    for (const amountVnd of ["0", "-1", "2.5", "1e4", "9007199254740992"]) {
      expect(parseReimbursementInput({ businessDate: "2026-10-06", amountVnd }).success).toBe(false);
    }
    expect(parseReimbursementInput({ businessDate: "2026-08-31", amountVnd: "1000" }).success).toBe(false);
  });

  it("requires explicit profit confirmation, a first-of-month date, unique line IDs, and an idempotency key", () => {
    const request = {
      voucherId: "94000000-0000-4000-8000-000000000001",
      lineIds: ["95000000-0000-4000-8000-000000000001"],
      accountingMonth: "2026-10-01",
      idempotencyKey: "96000000-0000-4000-8000-000000000001",
      confirmed: true,
    };
    expect(parseProfitPostingInput(request).success).toBe(true);
    expect(parseProfitPostingInput({ ...request, confirmed: false }).success).toBe(false);
    expect(parseProfitPostingInput({ ...request, accountingMonth: "2026-10-06" }).success).toBe(false);
    expect(parseProfitPostingInput({ ...request, lineIds: [...request.lineIds, ...request.lineIds] }).success).toBe(false);
    expect(parseProfitPostingInput({ ...request, idempotencyKey: "" }).success).toBe(false);
  });
});
