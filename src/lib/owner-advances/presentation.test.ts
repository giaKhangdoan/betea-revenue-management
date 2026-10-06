import { describe, expect, it } from "vitest";
import { getEligibleProfitLines, summarizeReimbursements } from "./presentation";

describe("owner purchase financial presentation", () => {
  it("shows every repayment event and calculates net repaid and outstanding after a reversal", () => {
    const events = [
      { id: "payment-1", event_type: "payment", business_date: "2026-10-03", amount_vnd: 80_000, note: "Hoàn lần 1", created_at: "2026-10-03T10:00:00Z" },
      { id: "reversal-1", event_type: "reversal", business_date: "2026-10-04", amount_vnd: 15_000, note: "Điều chỉnh", reverses_event_id: "payment-1", created_at: "2026-10-04T10:00:00Z" },
    ] as const;

    expect(summarizeReimbursements(100_000, events)).toMatchObject({
      reimbursedVnd: 65_000,
      outstandingVnd: 35_000,
      events,
    });
  });

  it("lists only active priced non-ingredient lines for an explicit profit post and explains exclusions", () => {
    const result = getEligibleProfitLines([
      { id: "service", description: "Vận chuyển", active: true, costClass: "non_ingredient", inventoryClass: "non_stock", lineAmountVnd: 25_000 },
      { id: "raw", description: "Trà", active: true, costClass: "raw_material", inventoryClass: "stock", lineAmountVnd: 100_000 },
      { id: "unpriced", description: "Khay nhựa", active: true, costClass: "non_ingredient", inventoryClass: "non_stock", lineAmountVnd: null },
      { id: "inactive", description: "Đồ cũ", active: false, costClass: "non_ingredient", inventoryClass: "non_stock", lineAmountVnd: 10_000 },
    ]);

    expect(result.eligible.map(({ id }) => id)).toEqual(["service"]);
    expect(result.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "raw", reason: "raw_material" }),
      expect.objectContaining({ id: "unpriced", reason: "unpriced" }),
      expect.objectContaining({ id: "inactive", reason: "inactive" }),
    ]));
  });
});
