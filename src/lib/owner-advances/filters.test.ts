import { describe, expect, it } from "vitest";
import { getVoucherMonthBounds, getVoucherPageRange } from "./filters";

describe("owner purchase month and page filters", () => {
  it("uses an exclusive next-month bound, including leap February and year rollover", () => {
    expect(getVoucherMonthBounds("2024-02")).toEqual({
      startDate: "2024-02-01",
      endDateExclusive: "2024-03-01",
    });
    expect(getVoucherMonthBounds("2026-12")).toEqual({
      startDate: "2026-12-01",
      endDateExclusive: "2027-01-01",
    });
    expect(() => getVoucherMonthBounds("2026-13")).toThrow();
    expect(() => getVoucherMonthBounds("October 2026")).toThrow();
  });

  it("maps one-based pages to a bounded inclusive database range without loading all vouchers", () => {
    expect(getVoucherPageRange(1, 20)).toEqual({ from: 0, to: 19 });
    expect(getVoucherPageRange(3, 20)).toEqual({ from: 40, to: 59 });
  });
});
