import { redirect } from "next/navigation";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { allocateMonthlyAmountByDay, calculateDailyRevenue, calculateMonthlyElectricity, calculateProfitVnd, daysInMonth, monthKeyOf, weekRangeContaining, type MonthlyCostInput } from "@/lib/finance/calculations";
import { addDays, currentBusinessDate, formatBusinessDate, formatVnd, monthEnd, weekStart } from "@/lib/finance/format";

export const dynamic = "force-dynamic";

type RecordRow = {
  business_date: string;
  business_status: "open" | "closed" | "no_business";
  shift_06_10_vnd: number | null;
  shift_10_14_vnd: number | null;
  shift_14_18_vnd: number | null;
  shift_18_22_vnd: number | null;
  grab_vnd: number | null;
  shopee_vnd: number | null;
  electricity_morning_kwh: number | null;
  electricity_evening_kwh: number | null;
};

function validDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function monthRange(start: string, end: string): string[] {
  const months: string[] = [];
  let current = `${start.slice(0, 7)}-01`;
  while (current <= `${end.slice(0, 7)}-01`) {
    months.push(current.slice(0, 7));
    current = addDays(`${current.slice(0, 7)}-${String(daysInMonth(current.slice(0, 7) as `${number}-${number}`)).padStart(2, "0")}`, 1);
    current = `${current.slice(0, 7)}-01`;
  }
  return months;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ mode?: string; date?: string; month?: string; year?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const mode = params.mode === "week" || params.mode === "year" || params.mode === "custom" ? params.mode : "month";
  const today = currentBusinessDate();
  let periodStart = `${today.slice(0, 7)}-01`;
  let periodEnd = monthEnd(periodStart);
  let label = "Tháng";
  if (mode === "week") {
    const date = validDate(params.date) ? params.date : today;
    const range = weekRangeContaining(date as `${number}-${number}-${number}`);
    periodStart = range.startDate;
    periodEnd = range.endDate;
    label = "Tuần · Thứ 2–Chủ nhật";
  } else if (mode === "year") {
    const year = /^\d{4}$/.test(params.year ?? "") && params.year! >= "2026" && params.year! <= today.slice(0, 4) ? params.year! : today.slice(0, 4);
    periodStart = `${year}-01-01`;
    periodEnd = `${year}-12-31`;
    label = `Năm ${year}`;
  } else if (mode === "custom") {
    periodStart = validDate(params.from) ? params.from : today;
    periodEnd = validDate(params.to) ? params.to : today;
    label = "Khoảng ngày tự chọn";
  } else {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") && params.month! >= "2026-09" ? params.month! : today.slice(0, 7);
    periodStart = `${month}-01`;
    periodEnd = monthEnd(periodStart);
    label = "Tháng";
  }
  const requestedStart = periodStart;
  const requestedEnd = periodEnd;
  const start = periodStart < "2026-09-01" ? "2026-09-01" : periodStart;
  const end = periodEnd > today ? today : periodEnd;
  const invalidRange = requestedEnd < requestedStart || end < start;
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const queryStart = invalidRange ? "2026-09-01" : `${start.slice(0, 7)}-01`;
  const queryEnd = invalidRange ? "2026-09-01" : monthEnd(`${end.slice(0, 7)}-01`);
  const [recordsResult, costsResult, expensesResult, monthTargetResult, weekTargetResult] = await Promise.all([
    owner.supabase.from("daily_records").select("business_date,business_status,shift_06_10_vnd,shift_10_14_vnd,shift_14_18_vnd,shift_18_22_vnd,grab_vnd,shopee_vnd,electricity_morning_kwh,electricity_evening_kwh")
      .eq("owner_id", owner.ownerId).gte("business_date", queryStart).lte("business_date", queryEnd).order("business_date"),
    owner.supabase.from("monthly_costs").select("*").eq("owner_id", owner.ownerId).gte("month_start", `${queryStart.slice(0, 7)}-01`).lte("month_start", `${queryEnd.slice(0, 7)}-01`),
    owner.supabase.from("daily_expenses").select("business_date,amount_vnd").eq("owner_id", owner.ownerId).gte("business_date", invalidRange ? queryStart : start).lte("business_date", invalidRange ? queryEnd : end),
    owner.supabase.from("monthly_targets").select("revenue_target_vnd,profit_target_vnd").eq("owner_id", owner.ownerId).eq("month_start", `${start.slice(0, 7)}-01`).maybeSingle(),
    owner.supabase.from("weekly_targets").select("revenue_target_vnd").eq("owner_id", owner.ownerId).eq("week_start", weekStart(validDate(params.date) ? params.date : today)).maybeSingle(),
  ]);
  const records = (recordsResult.data ?? []) as RecordRow[];
  const recordMap = new Map(records.map((record) => [record.business_date, record]));
  const costMap = new Map((costsResult.data ?? []).map((cost) => [cost.month_start.slice(0, 7), cost]));
  const expenseMap = new Map<string, number>();
  for (const expense of expensesResult.data ?? []) expenseMap.set(expense.business_date, (expenseMap.get(expense.business_date) ?? 0) + Number(expense.amount_vnd));

  const dateList: string[] = [];
  if (!invalidRange) {
    for (let date = start; date <= end; date = addDays(date, 1)) dateList.push(date);
  }
  const dailyRevenue = new Map<string, number | null>();
  for (const date of dateList) {
    const record = recordMap.get(date);
    if (!record) { dailyRevenue.set(date, null); continue; }
    const calculation = calculateDailyRevenue({
      businessStatus: record.business_status === "no_business" ? "no_business" : "open",
      shiftSalesVnd: [record.shift_06_10_vnd, record.shift_10_14_vnd, record.shift_14_18_vnd, record.shift_18_22_vnd],
      grabSalesVnd: record.grab_vnd,
      shopeeSalesVnd: record.shopee_vnd,
    });
    dailyRevenue.set(date, calculation.totalVnd);
  }
  const incompleteDays = [...dailyRevenue.values()].filter((amount) => amount === null).length;
  const revenueVnd = [...dailyRevenue.values()].reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const revenueComplete = dateList.length > 0 && incompleteDays === 0;

  const monthInputs = new Map<string, MonthlyCostInput>();
  for (const month of invalidRange ? [] : monthRange(start, end)) {
    const firstDate = `${month}-01`;
    const lastDate = monthEnd(firstDate);
    const cost = costMap.get(month);
    monthInputs.set(month, {
      month: month as `${number}-${number}`,
      rentVnd: cost?.rent_vnd == null ? 10000000 : Number(cost.rent_vnd),
      wagesVnd: cost?.wages_vnd == null ? null : Number(cost.wages_vnd),
      waterBillVnd: cost?.water_bill_vnd == null ? null : Number(cost.water_bill_vnd),
      electricity: {
        firstDayMorningKwh: recordMap.get(firstDate)?.electricity_morning_kwh ?? null,
        lastDayEveningKwh: recordMap.get(lastDate)?.electricity_evening_kwh ?? null,
        billAmountVnd: cost?.electricity_bill_vnd == null ? null : Number(cost.electricity_bill_vnd),
      },
      cogsVnd: cost?.cogs_vnd == null ? null : Number(cost.cogs_vnd),
    });
  }

  let operatingCostsVnd = 0;
  let incompleteCostDays = 0;
  for (const date of dateList) {
    const month = monthKeyOf(date as `${number}-${number}-${number}`);
    const input = monthInputs.get(month);
    if (!input) { incompleteCostDays += 1; continue; }
    const electricity = calculateMonthlyElectricity(input.electricity);
    const monthlyAmounts = [input.rentVnd, input.wagesVnd, input.waterBillVnd, electricity.expenseVnd];
    if (monthlyAmounts.some((amount) => amount === null)) { incompleteCostDays += 1; continue; }
    const dateOfMonth = Number(date.slice(8, 10)) - 1;
    const allocated = [input.rentVnd, input.wagesVnd, input.waterBillVnd, electricity.expenseVnd]
      .map((amount) => allocateMonthlyAmountByDay(Number(amount), month as `${number}-${number}`)[dateOfMonth]?.amountVnd ?? 0)
      .reduce((sum, amount) => sum + amount, 0);
    operatingCostsVnd += allocated + (expenseMap.get(date) ?? 0);
  }
  const allPeriodMonths = invalidRange ? [] : monthRange(start, end);
  const cogsComplete = allPeriodMonths.length > 0 && allPeriodMonths.every((month) => monthInputs.get(month)?.cogsVnd !== null && monthInputs.get(month)?.cogsVnd !== undefined);
  const cogsVnd = allPeriodMonths.reduce((sum, month) => sum + (monthInputs.get(month)?.cogsVnd ?? 0), 0);
  const isFullMonth = mode === "month" && requestedStart === start && requestedEnd <= today;
  const isFullYear = mode === "year" && requestedStart === start && requestedEnd <= today;
  const periodKind = mode === "year" ? "year" : mode === "month" ? "month" : mode === "week" ? "week" : "custom";
  const canShowProfit = revenueComplete && incompleteCostDays === 0 && (periodKind === "week" || periodKind === "custom" || isFullMonth || isFullYear) && ((periodKind !== "month" && periodKind !== "year") || cogsComplete);
  const profitVnd = canShowProfit ? calculateProfitVnd({
    periodKind,
    revenueVnd,
    expensesVnd: operatingCostsVnd,
    cogsVnd,
  }) : null;
  const target = mode === "week" ? weekTargetResult.data : monthTargetResult.data;
  const revenueTarget = target?.revenue_target_vnd ?? null;
  const profitTarget = mode === "month" ? monthTargetResult.data?.profit_target_vnd ?? null : null;
  const variance = profitVnd !== null && profitTarget !== null && profitTarget > 0 ? ((profitVnd - profitTarget) / profitTarget) * 100 : null;
  const labelStart = formatBusinessDate(requestedStart, { day: "numeric", month: "long", year: "numeric" });
  const labelEnd = formatBusinessDate(requestedEnd, { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">BÁO CÁO</p><h1>{label}</h1><p>{labelStart} – {labelEnd}{requestedStart < "2026-09-01" ? " · Sổ riêng bắt đầu từ 01/09/2026" : ""}</p></div></div>
      <section className="surface report-filter">
        <form action="/reports" className="report-filter-form">
          <label className="field"><span>Loại kỳ</span><select name="mode" defaultValue={mode}><option value="month">Tháng</option><option value="week">Tuần</option><option value="year">Năm</option><option value="custom">Khoảng ngày</option></select></label>
          <label className="field"><span>Tháng</span><input type="month" name="month" min="2026-09" defaultValue={mode === "month" ? requestedStart.slice(0, 7) : today.slice(0, 7)} /></label>
          <label className="field"><span>Ngày trong tuần</span><input type="date" name="date" min="2026-09-01" defaultValue={mode === "week" ? (validDate(params.date) ? params.date : today) : today} /></label>
          <label className="field"><span>Năm</span><input type="number" name="year" min="2026" max={today.slice(0, 4)} defaultValue={mode === "year" ? requestedStart.slice(0, 4) : today.slice(0, 4)} /></label>
          <label className="field"><span>Từ ngày</span><input type="date" name="from" min="2026-09-01" defaultValue={mode === "custom" ? params.from : today} /></label>
          <label className="field"><span>Đến ngày</span><input type="date" name="to" min="2026-09-01" defaultValue={mode === "custom" ? params.to : today} /></label>
          <button className="button" type="submit">Xem báo cáo</button>
        </form>
      </section>
      {invalidRange ? <p className="form-error report-error" role="alert">Khoảng ngày không hợp lệ hoặc chưa nằm trong phạm vi sổ từ 01/09/2026.</p> : null}
      <section className="report-metrics">
        <article className="surface report-metric"><span>Doanh thu {revenueComplete ? "đủ dữ liệu" : "các ngày đã nhập đủ"}</span><strong>{formatVnd(revenueVnd)}</strong><small>{incompleteDays > 0 ? `Còn ${incompleteDays} ngày chưa đủ dữ liệu.` : `${dateList.length} ngày đã đối chiếu.`}</small>{revenueTarget !== null ? <small>Mục tiêu doanh thu: {formatVnd(revenueTarget)}</small> : null}</article>
        <article className="surface report-metric"><span>{mode === "week" || mode === "custom" ? "Lợi nhuận trước COGS" : "Lợi nhuận sau COGS"}</span><strong>{profitVnd === null ? "Chưa đủ dữ liệu" : formatVnd(profitVnd)}</strong><small>{profitVnd === null ? `Ngày thiếu: ${incompleteDays} · Ngày thiếu chi phí: ${incompleteCostDays}` : mode === "week" || mode === "custom" ? "Đã trừ chi phí phân bổ và khoản phát sinh; chưa trừ COGS." : "Đã trừ COGS POS và các chi phí tháng."}</small>{variance !== null ? <small className={variance >= 0 ? "variance-positive" : "variance-negative"}>{variance >= 0 ? "+" : ""}{variance.toFixed(1)}% so với mục tiêu lợi nhuận</small> : profitTarget !== null ? <small>Mục tiêu lợi nhuận tháng: {formatVnd(profitTarget)}</small> : null}</article>
      </section>
      <section className="surface report-days">
        <div className="section-heading"><div><h2>Chi tiết từng ngày</h2><p>Ngày trống hoặc chưa nhập đủ vẫn được giữ là chưa có dữ liệu.</p></div></div>
        {dateList.length === 0 ? <p className="empty-inline">Chưa có ngày trong khoảng chọn.</p> : <div className="report-day-list">{dateList.map((date) => {
          const value = dailyRevenue.get(date);
          return <div className="report-day-row" key={date}><span>{formatBusinessDate(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span><strong>{value === null ? "Chưa đủ doanh thu" : formatVnd(value)}</strong><span>{expenseMap.has(date) ? `Chi phát sinh ${formatVnd(expenseMap.get(date))}` : ""}</span></div>;
        })}</div>}
      </section>
    </>
  );
}
