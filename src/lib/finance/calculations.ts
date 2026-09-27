export type DateOnly = `${number}-${number}-${number}`;
export type MonthKey = `${number}-${number}`;
export type VndAmount = number;

export type DailyRevenueInput = {
  businessStatus: "open" | "no_business";
  shiftSalesVnd: readonly [VndAmount | null, VndAmount | null, VndAmount | null, VndAmount | null];
  grabSalesVnd: VndAmount | null;
  shopeeSalesVnd: VndAmount | null;
};

export type DailyRevenueResult = {
  complete: boolean;
  totalVnd: VndAmount | null;
  missingFields: string[];
};

export type DailyIncidentalCost = {
  amountVnd: VndAmount;
  reason: string;
};

export type ElectricityInput = {
  firstDayMorningKwh: number | null;
  lastDayEveningKwh: number | null;
  billAmountVnd: VndAmount | null;
  meterResetDetected?: boolean;
};

export type ElectricityMeterReading = {
  businessDate: string;
  morningKwh: number | string | null;
  eveningKwh: number | string | null;
  resetReason?: string | null;
};

export type ElectricityCalculation = {
  status: "complete" | "missing_reading" | "negative_consumption" | "meter_reset";
  usageKwh: number | null;
  estimatedVnd: VndAmount | null;
  billVnd: VndAmount | null;
  expenseVnd: VndAmount | null;
  differenceVnd: number | null;
  differencePercent: number | null;
};

export type DailyElectricityUsage = {
  status: "complete" | "missing_reading" | "meter_decrease";
  shiftKwh: number | null;
  overnightKwh: number | null;
  fullDayKwh: number | null;
};

export type MonthlyCostInput = {
  month: MonthKey;
  rentVnd: VndAmount | null;
  wagesVnd: VndAmount | null;
  waterBillVnd: VndAmount | null;
  electricity: ElectricityInput;
  cogsVnd: VndAmount | null;
  adjustmentsVnd?: number;
};

export type DailyExpenseCalculation = {
  date: DateOnly;
  rentVnd: VndAmount | null;
  wagesVnd: VndAmount | null;
  waterVnd: VndAmount | null;
  electricityVnd: VndAmount | null;
  adjustmentVnd: number;
  incidentalVnd: VndAmount;
  totalVnd: VndAmount | null;
  missingCosts: string[];
};

export type ProfitPeriodKind = "week" | "custom" | "month" | "year";

const ELECTRICITY_VND_PER_KWH = 3_471;

export function hasMeterResetWithinMonth(readings: readonly ElectricityMeterReading[]): boolean {
  if (readings.some((reading) => reading.resetReason?.trim())) return true;
  const sorted = [...readings].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  let previous: number | null = null;
  for (const reading of sorted) {
    for (const value of [reading.morningKwh, reading.eveningKwh]) {
      if (value === null || String(value).trim() === "") continue;
      const current = Number(value);
      if (!Number.isFinite(current) || current < 0) continue;
      if (previous !== null && current < previous) return true;
      previous = current;
    }
  }
  return false;
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Expected a YYYY-MM-DD date, received: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

function asDateOnly(year: number, month: number, day: number): DateOnly {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as DateOnly;
}

function assertVnd(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer VND amount`);
  }
}

function assertSignedVnd(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be an integer VND amount`);
}

function sumVnd(values: readonly number[]): VndAmount {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError("VND total exceeds the safe integer range");
  return total;
}

export function monthKeyOf(date: DateOnly): MonthKey {
  const { year, month } = parseDate(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` as MonthKey;
}

export function daysInMonth(month: MonthKey): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new RangeError(`Expected a YYYY-MM month, received: ${month}`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1000 || monthNumber < 1 || monthNumber > 12) {
    throw new RangeError(`Invalid calendar month: ${month}`);
  }
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function calculateDailyRevenue(input: DailyRevenueInput): DailyRevenueResult {
  if (input.businessStatus === "no_business") {
    return { complete: true, totalVnd: 0, missingFields: [] };
  }

  const missingFields: string[] = [];
  const values: number[] = [];
  input.shiftSalesVnd.forEach((amount, index) => {
    const field = `shift${index + 1}`;
    if (amount === null) missingFields.push(field);
    else {
      assertVnd(amount, field);
      values.push(amount);
    }
  });

  for (const [field, amount] of [
    ["grab", input.grabSalesVnd],
    ["shopee", input.shopeeSalesVnd],
  ] as const) {
    // Delivery channels are optional. An empty channel means there were no
    // orders and contributes zero; the four in-store shifts remain required.
    if (amount === null) {
      values.push(0);
      continue;
    }
    assertVnd(amount, field);
    values.push(amount);
  }

  if (missingFields.length > 0) return { complete: false, totalVnd: null, missingFields };
  return { complete: true, totalVnd: sumVnd(values), missingFields: [] };
}

export function calculateReconciliationDifferenceVnd(bluebookTotalVnd: VndAmount, websiteTotalVnd: VndAmount): number {
  assertVnd(bluebookTotalVnd, "Bluebook revenue");
  assertVnd(websiteTotalVnd, "Website revenue");
  const difference = bluebookTotalVnd - websiteTotalVnd;
  if (!Number.isSafeInteger(difference)) throw new RangeError("Reconciliation difference exceeds the safe integer range");
  return difference;
}

/** Splits meter use during operating hours and overnight, using the next morning's reading. */
export function calculateDailyElectricityUsage(input: {
  morningKwh: number | null;
  eveningKwh: number | null;
  nextMorningKwh: number | null;
}): DailyElectricityUsage {
  for (const [label, value] of [
    ["Morning meter", input.morningKwh],
    ["Evening meter", input.eveningKwh],
    ["Next morning meter", input.nextMorningKwh],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`${label} must be a non-negative meter reading`);
    }
  }

  const decreasedDuringShift = input.morningKwh !== null && input.eveningKwh !== null && input.eveningKwh < input.morningKwh;
  const decreasedOvernight = input.eveningKwh !== null && input.nextMorningKwh !== null && input.nextMorningKwh < input.eveningKwh;
  const decreasedAcrossDay = input.morningKwh !== null && input.nextMorningKwh !== null && input.nextMorningKwh < input.morningKwh;
  const roundKwh = (value: number) => Number(value.toFixed(3));

  return {
    status: decreasedDuringShift || decreasedOvernight || decreasedAcrossDay
      ? "meter_decrease"
      : input.morningKwh === null || input.eveningKwh === null || input.nextMorningKwh === null
        ? "missing_reading"
        : "complete",
    shiftKwh: input.morningKwh === null || input.eveningKwh === null || decreasedDuringShift
      ? null
      : roundKwh(input.eveningKwh - input.morningKwh),
    overnightKwh: input.eveningKwh === null || input.nextMorningKwh === null || decreasedOvernight
      ? null
      : roundKwh(input.nextMorningKwh - input.eveningKwh),
    fullDayKwh: input.morningKwh === null || input.nextMorningKwh === null || decreasedAcrossDay || decreasedDuringShift || decreasedOvernight
      ? null
      : roundKwh(input.nextMorningKwh - input.morningKwh),
  };
}

export function weekRangeContaining(date: DateOnly): { startDate: DateOnly; endDate: DateOnly } {
  const parts = parseDate(date);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (utcDate.getUTCDay() + 6) % 7;
  const monday = new Date(utcDate);
  monday.setUTCDate(utcDate.getUTCDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    startDate: asDateOnly(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    endDate: asDateOnly(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
  };
}

/** Distributes any remainder from the first day forward, preserving the exact monthly total. */
export function allocateMonthlyAmountByDay(
  totalVnd: VndAmount,
  month: MonthKey,
): Array<{ date: DateOnly; amountVnd: VndAmount }> {
  assertVnd(totalVnd, "Monthly amount");
  const { year, month: monthNumber } = (() => {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) throw new RangeError(`Expected a YYYY-MM month, received: ${month}`);
    return { year: Number(match[1]), month: Number(match[2]) };
  })();
  const days = daysInMonth(month);
  const base = Math.floor(totalVnd / days);
  const remainder = totalVnd - base * days;

  return Array.from({ length: days }, (_, index) => ({
    date: asDateOnly(year, monthNumber, index + 1),
    amountVnd: base + (index < remainder ? 1 : 0),
  }));
}

/** Distributes positive or negative monthly adjustments while preserving the exact signed total. */
export function allocateSignedMonthlyAmountByDay(
  totalVnd: number,
  month: MonthKey,
): Array<{ date: DateOnly; amountVnd: number }> {
  assertSignedVnd(totalVnd, "Monthly adjustment");
  const sign = totalVnd < 0 ? -1 : 1;
  return allocateMonthlyAmountByDay(Math.abs(totalVnd), month).map((day) => ({
    date: day.date,
    amountVnd: day.amountVnd * sign,
  }));
}

export function calculateMonthlyElectricity(input: ElectricityInput): ElectricityCalculation {
  if (input.billAmountVnd !== null) assertVnd(input.billAmountVnd, "Electricity bill");

  for (const [label, value] of [
    ["First-day morning meter", input.firstDayMorningKwh],
    ["Last-day evening meter", input.lastDayEveningKwh],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`${label} must be a non-negative meter reading`);
    }
  }

  const billVnd = input.billAmountVnd;
  if (input.meterResetDetected) {
    return {
      status: "meter_reset",
      usageKwh: null,
      estimatedVnd: null,
      billVnd,
      expenseVnd: billVnd,
      differenceVnd: null,
      differencePercent: null,
    };
  }

  if (input.firstDayMorningKwh === null || input.lastDayEveningKwh === null) {
    return {
      status: "missing_reading",
      usageKwh: null,
      estimatedVnd: null,
      billVnd,
      expenseVnd: billVnd,
      differenceVnd: null,
      differencePercent: null,
    };
  }

  const usageKwh = input.lastDayEveningKwh - input.firstDayMorningKwh;
  if (usageKwh < 0) {
    return {
      status: "negative_consumption",
      usageKwh: null,
      estimatedVnd: null,
      billVnd,
      expenseVnd: billVnd,
      differenceVnd: null,
      differencePercent: null,
    };
  }

  const estimatedVnd = Math.round(usageKwh * ELECTRICITY_VND_PER_KWH);
  const differenceVnd = billVnd === null ? null : billVnd - estimatedVnd;
  return {
    status: "complete",
    usageKwh,
    estimatedVnd,
    billVnd,
    expenseVnd: billVnd ?? estimatedVnd,
    differenceVnd,
    differencePercent:
      differenceVnd === null
        ? null
        : estimatedVnd === 0
          ? billVnd === 0 ? 0 : null
          : (differenceVnd / estimatedVnd) * 100,
  };
}

export function calculateDailyExpenses(
  date: DateOnly,
  monthlyCosts: MonthlyCostInput,
  incidentals: readonly DailyIncidentalCost[] = [],
): DailyExpenseCalculation {
  const month = monthKeyOf(date);
  if (month !== monthlyCosts.month) {
    throw new RangeError(`Monthly costs for ${monthlyCosts.month} cannot be allocated to ${date}`);
  }

  const electricity = calculateMonthlyElectricity(monthlyCosts.electricity);
  const monthlyAmounts: Array<[string, number | null]> = [
    ["rent", monthlyCosts.rentVnd],
    ["wages", monthlyCosts.wagesVnd],
    ["water", monthlyCosts.waterBillVnd],
    ["electricity", electricity.expenseVnd],
  ];
  const daily: Record<string, number | null> = {};
  const missingCosts: string[] = [];

  for (const [name, amount] of monthlyAmounts) {
    if (amount === null) {
      daily[name] = null;
      missingCosts.push(name);
      continue;
    }
    const allocated = allocateMonthlyAmountByDay(amount, month);
    daily[name] = allocated[parseDate(date).day - 1]?.amountVnd ?? 0;
  }

  incidentals.forEach((item, index) => assertVnd(item.amountVnd, `Incidental cost ${index + 1}`));
  const monthlyAdjustment = monthlyCosts.adjustmentsVnd ?? 0;
  assertSignedVnd(monthlyAdjustment, "Monthly adjustment");
  const dailyAdjustment = allocateSignedMonthlyAmountByDay(monthlyAdjustment, month)[parseDate(date).day - 1]?.amountVnd ?? 0;
  const incidentalVnd = sumVnd(incidentals.map((item) => item.amountVnd));
  const knownAmounts = Object.values(daily).filter((amount): amount is number => amount !== null);
  const knownDailyCost = sumVnd([...knownAmounts, incidentalVnd]);
  const adjustedDailyCost = knownDailyCost + dailyAdjustment;
  if (!Number.isSafeInteger(adjustedDailyCost)) throw new RangeError("Daily cost exceeds the safe integer range");
  const totalVnd = missingCosts.length > 0 ? null : adjustedDailyCost;

  return {
    date,
    rentVnd: daily.rent,
    wagesVnd: daily.wages,
    waterVnd: daily.water,
    electricityVnd: daily.electricity,
    adjustmentVnd: dailyAdjustment,
    incidentalVnd,
    totalVnd,
    missingCosts,
  };
}

/** Monthly and yearly profit include COGS; weekly/custom periods remain explicitly pre-COGS. */
export function calculateProfitVnd(input: {
  periodKind: ProfitPeriodKind;
  revenueVnd: VndAmount | null;
  expensesVnd: VndAmount | null;
  cogsVnd?: VndAmount | null;
}): VndAmount | null {
  if (input.revenueVnd === null || input.expensesVnd === null) return null;
  assertVnd(input.revenueVnd, "Revenue");
  assertVnd(input.expensesVnd, "Expenses");

  const includesCogs = input.periodKind === "month" || input.periodKind === "year";
  if (!includesCogs) return input.revenueVnd - input.expensesVnd;
  if (input.cogsVnd === null || input.cogsVnd === undefined) return null;
  assertVnd(input.cogsVnd, "COGS");
  return input.revenueVnd - input.expensesVnd - input.cogsVnd;
}
