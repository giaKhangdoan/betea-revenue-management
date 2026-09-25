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
};

export type ElectricityCalculation = {
  status: "complete" | "missing_reading" | "negative_consumption";
  usageKwh: number | null;
  estimatedVnd: VndAmount | null;
  billVnd: VndAmount | null;
  expenseVnd: VndAmount | null;
  differenceVnd: number | null;
  differencePercent: number | null;
};

export type MonthlyCostInput = {
  month: MonthKey;
  rentVnd: VndAmount | null;
  wagesVnd: VndAmount | null;
  waterBillVnd: VndAmount | null;
  electricity: ElectricityInput;
  cogsVnd: VndAmount | null;
};

export type DailyExpenseCalculation = {
  date: DateOnly;
  rentVnd: VndAmount | null;
  wagesVnd: VndAmount | null;
  waterVnd: VndAmount | null;
  electricityVnd: VndAmount | null;
  incidentalVnd: VndAmount;
  totalVnd: VndAmount | null;
  missingCosts: string[];
};

export type ProfitPeriodKind = "week" | "custom" | "month" | "year";

const ELECTRICITY_VND_PER_KWH = 3_471;

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
    if (amount === null) missingFields.push(field);
    else {
      assertVnd(amount, field);
      values.push(amount);
    }
  }

  if (missingFields.length > 0) return { complete: false, totalVnd: null, missingFields };
  return { complete: true, totalVnd: sumVnd(values), missingFields: [] };
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
      differenceVnd === null || estimatedVnd === 0
        ? null
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
  const incidentalVnd = sumVnd(incidentals.map((item) => item.amountVnd));
  const knownAmounts = Object.values(daily).filter((amount): amount is number => amount !== null);
  const totalVnd = missingCosts.length > 0 ? null : sumVnd([...knownAmounts, incidentalVnd]);

  return {
    date,
    rentVnd: daily.rent,
    wagesVnd: daily.wages,
    waterVnd: daily.water,
    electricityVnd: daily.electricity,
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
