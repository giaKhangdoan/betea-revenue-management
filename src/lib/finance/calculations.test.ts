import { describe, expect, it } from "vitest";
import {
  allocateMonthlyAmountByDay,
  calculateDailyExpenses,
  calculateDailyRevenue,
  calculateMonthlyElectricity,
  calculateProfitVnd,
  daysInMonth,
  weekRangeContaining,
  type DailyRevenueInput,
  type MonthlyCostInput,
} from "./calculations";

const completeOpenDay: DailyRevenueInput = {
  businessStatus: "open",
  shiftSalesVnd: [100_000, 200_000, 300_000, 400_000],
  grabSalesVnd: 50_000,
  shopeeSalesVnd: 25_000,
};

describe("financial calculations", () => {
  it("adds the four shifts and daily Grab and Shopee totals", () => {
    expect(calculateDailyRevenue(completeOpenDay)).toEqual({
      complete: true,
      totalVnd: 1_075_000,
      missingFields: [],
    });
  });

  it("keeps a missing channel incomplete, while a closed day is known zero", () => {
    expect(
      calculateDailyRevenue({ ...completeOpenDay, grabSalesVnd: null }),
    ).toEqual({ complete: false, totalVnd: null, missingFields: ["grab"] });

    expect(
      calculateDailyRevenue({
        businessStatus: "no_business",
        shiftSalesVnd: [null, null, null, null],
        grabSalesVnd: null,
        shopeeSalesVnd: null,
      }),
    ).toEqual({ complete: true, totalVnd: 0, missingFields: [] });
  });

  it("uses Monday through Sunday for a week that crosses a month boundary", () => {
    expect(weekRangeContaining("2026-09-03")).toEqual({
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    });
  });

  it("recognizes leap February and distributes every monthly VND exactly", () => {
    expect(daysInMonth("2024-02")).toBe(29);
    const daily = allocateMonthlyAmountByDay(1_001, "2024-02");
    expect(daily).toHaveLength(29);
    expect(daily.slice(0, 15).every((day) => day.amountVnd === 35)).toBe(true);
    expect(daily.slice(15).every((day) => day.amountVnd === 34)).toBe(true);
    expect(daily.reduce((sum, day) => sum + day.amountVnd, 0)).toBe(1_001);
  });

  it("allocates monthly rent, wages, water, and the billed electricity by actual calendar days", () => {
    const costs: MonthlyCostInput = {
      month: "2024-02",
      rentVnd: 10_000_000,
      wagesVnd: 2_900_000,
      waterBillVnd: 290_000,
      electricity: {
        firstDayMorningKwh: 100,
        lastDayEveningKwh: 200,
        billAmountVnd: 347_100,
      },
      cogsVnd: 1_000_000,
    };
    const daily = calculateDailyExpenses("2024-02-29", costs, [{ amountVnd: 25_000, reason: "Mua đá" }]);
    expect(daily).toMatchObject({
      rentVnd: 344_827,
      wagesVnd: 100_000,
      waterVnd: 10_000,
      electricityVnd: 11_968,
      incidentalVnd: 25_000,
      totalVnd: 491_795,
    });
  });

  it("uses the bill as actual electricity cost and retains the estimate and signed variance", () => {
    expect(
      calculateMonthlyElectricity({
        firstDayMorningKwh: 100,
        lastDayEveningKwh: 200,
        billAmountVnd: 360_000,
      }),
    ).toEqual({
      status: "complete",
      usageKwh: 100,
      estimatedVnd: 347_100,
      billVnd: 360_000,
      expenseVnd: 360_000,
      differenceVnd: 12_900,
      differencePercent: (12_900 / 347_100) * 100,
    });
  });

  it("marks negative meter usage invalid and rejects a negative meter reading", () => {
    expect(
      calculateMonthlyElectricity({
        firstDayMorningKwh: 200,
        lastDayEveningKwh: 100,
        billAmountVnd: 50_000,
      }),
    ).toMatchObject({ status: "negative_consumption", usageKwh: null, estimatedVnd: null, expenseVnd: 50_000 });
    expect(() =>
      calculateMonthlyElectricity({
        firstDayMorningKwh: -1,
        lastDayEveningKwh: 100,
        billAmountVnd: null,
      }),
    ).toThrow(RangeError);
  });

  it("returns no variance percent when the meter estimate is zero", () => {
    expect(
      calculateMonthlyElectricity({
        firstDayMorningKwh: 50,
        lastDayEveningKwh: 50,
        billAmountVnd: 10_000,
      }),
    ).toMatchObject({ estimatedVnd: 0, differenceVnd: 10_000, differencePercent: null });
  });

  it("subtracts COGS only from monthly/yearly profit", () => {
    expect(calculateProfitVnd({ periodKind: "month", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: 3_000 })).toBe(5_000);
    expect(calculateProfitVnd({ periodKind: "year", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: 3_000 })).toBe(5_000);
    expect(calculateProfitVnd({ periodKind: "week", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: 3_000 })).toBe(8_000);
    expect(calculateProfitVnd({ periodKind: "custom", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: null })).toBe(8_000);
    expect(calculateProfitVnd({ periodKind: "month", revenueVnd: 10_000, expensesVnd: 2_000 })).toBeNull();
  });
});
