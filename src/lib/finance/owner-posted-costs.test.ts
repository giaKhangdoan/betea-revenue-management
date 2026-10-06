import { describe, expect, it } from "vitest";
import { sumOwnerPostedCostsInDateRange, type OwnerProfitPosting } from "./owner-posted-costs";

describe("owner-posted profit costs", () => {
  it("counts each explicit posting once and applies reversals in their recorded month", () => {
    const events: OwnerProfitPosting[] = [
      { id: "post-1", posting_type: "post", accounting_month: "2026-09-01", amount_vnd: "3100" },
      { id: "reversal-1", posting_type: "reversal", accounting_month: "2026-10-01", amount_vnd: 900 },
    ];

    expect(sumOwnerPostedCostsInDateRange(events, "2026-09-01", "2026-09-30")).toBe(3_100);
    expect(sumOwnerPostedCostsInDateRange(events, "2026-10-01", "2026-10-31")).toBe(-900);
  });

  it("allocates month postings across actual days and respects week/custom date boundaries", () => {
    const events: OwnerProfitPosting[] = [
      { id: "post-september", posting_type: "post", accounting_month: "2026-09-01", amount_vnd: 3_001 },
      { id: "post-october", posting_type: "post", accounting_month: "2026-10-01", amount_vnd: 310 },
    ];

    expect(sumOwnerPostedCostsInDateRange(events, "2026-09-01", "2026-09-30")).toBe(3_001);
    expect(sumOwnerPostedCostsInDateRange(events, "2026-09-28", "2026-10-04")).toBe(340);
    expect(sumOwnerPostedCostsInDateRange(events, "2026-10-01", "2026-10-04")).toBe(40);
  });

  it("preserves exact VND totals for leap-year months and rejects corrupt or duplicated events", () => {
    const posting: OwnerProfitPosting = {
      id: "leap-post",
      posting_type: "post",
      accounting_month: "2024-02-01",
      amount_vnd: 1_001,
    };
    expect(sumOwnerPostedCostsInDateRange([posting], "2024-02-01", "2024-02-29")).toBe(1_001);
    expect(() => sumOwnerPostedCostsInDateRange([posting, posting], "2024-02-01", "2024-02-29")).toThrow(RangeError);
    expect(() => sumOwnerPostedCostsInDateRange([
      { ...posting, accounting_month: "2024-02-02" },
    ], "2024-02-01", "2024-02-29")).toThrow(RangeError);
    expect(() => sumOwnerPostedCostsInDateRange([
      { ...posting, amount_vnd: "not-money" },
    ], "2024-02-01", "2024-02-29")).toThrow(RangeError);
  });
});
