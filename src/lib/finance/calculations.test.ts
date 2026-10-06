import { describe, expect, it } from "vitest";
import {
  allocateMonthlyAmountByDay,
  allocateSignedMonthlyAmountByDay,
  calculateDailyExpenses,
  calculateDailyRevenue,
  calculateDailyElectricityUsage,
  calculateMonthlyElectricity,
  calculateReconciliationDifferenceVnd,
  hasMeterResetWithinMonth,
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

  it("calculates a signed Bluebook difference from the two daily totals", () => {
    expect(calculateReconciliationDifferenceVnd(1_050_000, 1_075_000)).toBe(-25_000);
    expect(calculateReconciliationDifferenceVnd(1_100_000, 1_075_000)).toBe(25_000);
    expect(calculateReconciliationDifferenceVnd(1_075_000, 1_075_000)).toBe(0);
  });

  it("splits daily electricity between trading hours and the overnight interval", () => {
    expect(calculateDailyElectricityUsage({ morningKwh: 100, eveningKwh: 108.2, nextMorningKwh: 109.5 })).toEqual({
      status: "complete",
      shiftKwh: 8.2,
      overnightKwh: 1.3,
      fullDayKwh: 9.5,
    });
  });

  it("shows available shift use while the next morning reading is still missing", () => {
    expect(calculateDailyElectricityUsage({ morningKwh: 100, eveningKwh: 108, nextMorningKwh: null })).toEqual({
      status: "missing_reading",
      shiftKwh: 8,
      overnightKwh: null,
      fullDayKwh: null,
    });
  });

  it("does not count a meter decrease as overnight electricity use", () => {
    expect(calculateDailyElectricityUsage({ morningKwh: 100, eveningKwh: 108, nextMorningKwh: 107.5 })).toEqual({
      status: "meter_decrease",
      shiftKwh: 8,
      overnightKwh: null,
      fullDayKwh: null,
    });
  });

  it("treats an absent delivery channel as zero, while a closed day is known zero", () => {
    expect(
      calculateDailyRevenue({ ...completeOpenDay, grabSalesVnd: null }),
    ).toEqual({ complete: true, totalVnd: 1_025_000, missingFields: [] });

    expect(
      calculateDailyRevenue({ ...completeOpenDay, grabSalesVnd: 50_000, shopeeSalesVnd: null }),
    ).toEqual({ complete: true, totalVnd: 1_050_000, missingFields: [] });

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
    const negative = allocateSignedMonthlyAmountByDay(-1_001, "2024-02");
    expect(negative.reduce((sum, day) => sum + day.amountVnd, 0)).toBe(-1_001);
    expect(negative.slice(0, 15).every((day) => day.amountVnd === -35)).toBe(true);
    expect(negative.slice(15).every((day) => day.amountVnd === -34)).toBe(true);
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
      adjustmentsVnd: -2_900,
    };
    const daily = calculateDailyExpenses("2024-02-29", costs, [{ amountVnd: 25_000, reason: "Mua đá" }]);
    expect(daily).toMatchObject({
      rentVnd: 344_827,
      wagesVnd: 100_000,
      waterVnd: 10_000,
      electricityVnd: 11_968,
      incidentalVnd: 25_000,
      adjustmentVnd: -100,
      totalVnd: 491_695,
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

  it("handles variance percent when the meter estimate is zero", () => {
    expect(
      calculateMonthlyElectricity({
        firstDayMorningKwh: 50,
        lastDayEveningKwh: 50,
        billAmountVnd: 10_000,
      }),
    ).toMatchObject({ estimatedVnd: 0, differenceVnd: 10_000, differencePercent: null });

    expect(
      calculateMonthlyElectricity({
        firstDayMorningKwh: 50,
        lastDayEveningKwh: 50,
        billAmountVnd: 0,
      }),
    ).toMatchObject({ estimatedVnd: 0, differenceVnd: 0, differencePercent: 0 });
  });

  it("does not estimate electricity across an in-month meter reset, but uses the bill when available", () => {
    const readings = [
      { businessDate: "2026-09-01", morningKwh: 100, eveningKwh: 120 },
      { businessDate: "2026-09-15", morningKwh: 20, eveningKwh: 30 },
      { businessDate: "2026-09-30", morningKwh: 80, eveningKwh: 95 },
    ];
    expect(hasMeterResetWithinMonth(readings)).toBe(true);
    expect(hasMeterResetWithinMonth(readings.slice(0, 1))).toBe(false);
    expect(hasMeterResetWithinMonth([
      { businessDate: "2026-10-01", morningKwh: 20, eveningKwh: 22, resetReason: "Thay đồng hồ đầu tháng" },
      { businessDate: "2026-10-31", morningKwh: 80, eveningKwh: 95 },
    ])).toBe(true);
    expect(calculateMonthlyElectricity({
      firstDayMorningKwh: 100,
      lastDayEveningKwh: 95,
      billAmountVnd: null,
      meterResetDetected: true,
    })).toMatchObject({ status: "meter_reset", usageKwh: null, estimatedVnd: null, expenseVnd: null });
    expect(calculateMonthlyElectricity({
      firstDayMorningKwh: 100,
      lastDayEveningKwh: 95,
      billAmountVnd: 500_000,
      meterResetDetected: true,
    })).toMatchObject({ status: "meter_reset", estimatedVnd: null, billVnd: 500_000, expenseVnd: 500_000 });
  });

  it("subtracts COGS only from monthly/yearly profit", () => {
    expect(calculateProfitVnd({ periodKind: "month", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: 3_000 })).toBe(5_000);
    expect(calculateProfitVnd({ periodKind: "year", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: 3_000 })).toBe(5_000);
    expect(calculateProfitVnd({ periodKind: "week", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: 3_000 })).toBe(8_000);
    expect(calculateProfitVnd({ periodKind: "custom", revenueVnd: 10_000, expensesVnd: 2_000, cogsVnd: null })).toBe(8_000);
    expect(calculateProfitVnd({ periodKind: "month", revenueVnd: 10_000, expensesVnd: 2_000 })).toBeNull();
  });

  it("subtracts explicitly posted owner costs once and fails closed when their read is unavailable", () => {
    expect(calculateProfitVnd({
      periodKind: "month",
      revenueVnd: 100_000,
      expensesVnd: 20_000,
      ownerPostedCostsVnd: 5_000,
      cogsVnd: 30_000,
    })).toBe(45_000);
    expect(calculateProfitVnd({
      periodKind: "month",
      revenueVnd: 100_000,
      expensesVnd: 20_000,
      ownerPostedCostsVnd: -2_000,
      cogsVnd: 30_000,
    })).toBe(52_000);
    expect(calculateProfitVnd({
      periodKind: "month",
      revenueVnd: 100_000,
      expensesVnd: 20_000,
      ownerPostedCostsVnd: null,
      cogsVnd: 30_000,
    })).toBeNull();
  });

  it("keeps Bluebook gross revenue unchanged when daily shop-paid expenses are deducted from profit", () => {
    const grossRevenue = calculateDailyRevenue(completeOpenDay).totalVnd;
    const profit = calculateProfitVnd({
      periodKind: "week",
      revenueVnd: grossRevenue,
      expensesVnd: 20_000,
    });

    expect(grossRevenue).toBe(1_075_000);
    expect(profit).toBe(1_055_000);
    expect(calculateDailyRevenue(completeOpenDay).totalVnd).toBe(grossRevenue);
  });
});
