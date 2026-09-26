import { redirect } from "next/navigation";
import { RevenueChart, type RevenueChartItem } from "@/components/charts/revenue-chart";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { allocateMonthlyAmountByDay, allocateSignedMonthlyAmountByDay, calculateDailyRevenue, calculateMonthlyElectricity, calculateProfitVnd, daysInMonth, hasMeterResetWithinMonth, monthKeyOf, weekRangeContaining, type MonthlyCostInput } from "@/lib/finance/calculations";
import { addDays, currentBusinessDate, formatBusinessDate, formatVnd, monthEnd, weekStart } from "@/lib/finance/format";
import { loadOwnerDailyRecords } from "@/lib/ledger/owner-daily-records";

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
  const [recordsResult, costsResult, expensesResult, adjustmentsResult, monthTargetResult, weekTargetResult] = await Promise.all([
    loadOwnerDailyRecords(owner.supabase, owner.ownerId, { start: queryStart, end: queryEnd }),
    owner.supabase.from("monthly_costs").select("*").eq("owner_id", owner.ownerId).gte("month_start", `${queryStart.slice(0, 7)}-01`).lte("month_start", `${queryEnd.slice(0, 7)}-01`),
    owner.supabase.from("daily_expenses").select("business_date,amount_vnd").eq("owner_id", owner.ownerId).is("deleted_at", null).gte("business_date", invalidRange ? queryStart : start).lte("business_date", invalidRange ? queryEnd : end),
    owner.supabase.from("monthly_cost_adjustments").select("month_start,amount_delta_vnd").eq("owner_id", owner.ownerId).gte("month_start", `${queryStart.slice(0, 7)}-01`).lte("month_start", `${queryEnd.slice(0, 7)}-01`),
    owner.supabase.from("monthly_targets").select("revenue_target_vnd,profit_target_vnd").eq("owner_id", owner.ownerId).eq("month_start", `${start.slice(0, 7)}-01`).maybeSingle(),
    owner.supabase.from("weekly_targets").select("revenue_target_vnd").eq("owner_id", owner.ownerId).eq("week_start", weekStart(validDate(params.date) ? params.date : today)).maybeSingle(),
  ]);
  const records = recordsResult.data as RecordRow[];
  const recordMap = new Map(records.map((record) => [record.business_date, record]));
  const costMap = new Map((costsResult.data ?? []).map((cost) => [cost.month_start.slice(0, 7), cost]));
  const adjustmentMap = new Map<string, number>();
  for (const adjustment of adjustmentsResult.data ?? []) {
    const month = adjustment.month_start.slice(0, 7);
    adjustmentMap.set(month, (adjustmentMap.get(month) ?? 0) + Number(adjustment.amount_delta_vnd));
  }
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
  let revenueChartItems: RevenueChartItem[];
  if (mode === "year") {
    revenueChartItems = (invalidRange ? [] : monthRange(start, end)).map((month) => {
      const days = dateList.filter((date) => date.startsWith(month));
      const values = days.map((date) => dailyRevenue.get(date) ?? null);
      const knownValues = values.filter((value): value is number => value !== null);
      return {
        label: formatBusinessDate(`${month}-01`, { month: "long", year: "numeric" }),
        shortLabel: month.slice(5),
        value: knownValues.length > 0 ? knownValues.reduce((sum, value) => sum + value, 0) : null,
        hasMissingDays: knownValues.length > 0 && knownValues.length < values.length,
      };
    });
  } else if (mode === "custom" && dateList.length > 31) {
    const weeks = new Map<string, { total: number; known: number; missing: number }>();
    for (const date of dateList) {
      const monday = weekStart(date);
      const week = weeks.get(monday) ?? { total: 0, known: 0, missing: 0 };
      const value = dailyRevenue.get(date) ?? null;
      if (value === null) week.missing += 1;
      else { week.known += 1; week.total += value; }
      weeks.set(monday, week);
    }
    revenueChartItems = [...weeks.entries()].map(([monday, week]) => ({
      label: `Tuần từ ${formatBusinessDate(monday, { day: "numeric", month: "long" })}`,
      shortLabel: formatBusinessDate(monday, { day: "numeric", month: "short" }),
      value: week.known > 0 ? week.total : null,
      hasMissingDays: week.missing > 0,
    }));
  } else {
    revenueChartItems = dateList.map((date) => ({
      label: formatBusinessDate(date, { weekday: "long", day: "numeric", month: "long" }),
      shortLabel: date.slice(8),
      value: dailyRevenue.get(date) ?? null,
    }));
  }
  const revenueChartTitle = mode === "year" ? "Doanh thu theo tháng" : mode === "custom" && dateList.length > 31 ? "Doanh thu theo tuần" : "Doanh thu theo ngày";
  const revenueChartDescription = mode === "year"
    ? "Cột xám đánh dấu tháng còn ngày thiếu doanh thu."
    : mode === "custom" && dateList.length > 31
      ? "Tổng theo tuần từ Thứ 2 đến Chủ nhật; cột xám có ngày chưa nhập."
      : "Mỗi cột là tổng doanh thu trong ngày; cột xám là ngày chưa có số liệu.";

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
        meterResetDetected: hasMeterResetWithinMonth(records.filter((record) => record.business_date.startsWith(`${month}-`)).map((record) => ({
          businessDate: record.business_date,
          morningKwh: record.electricity_morning_kwh,
          eveningKwh: record.electricity_evening_kwh,
        }))),
      },
      cogsVnd: cost?.cogs_vnd == null ? null : Number(cost.cogs_vnd),
      adjustmentsVnd: adjustmentMap.get(month) ?? 0,
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
    const allocatedAdjustment = allocateSignedMonthlyAmountByDay(input.adjustmentsVnd ?? 0, month as `${number}-${number}`)[dateOfMonth]?.amountVnd ?? 0;
    operatingCostsVnd += allocated + allocatedAdjustment + (expenseMap.get(date) ?? 0);
  }
  const allPeriodMonths = invalidRange ? [] : monthRange(start, end);
  const cogsComplete = allPeriodMonths.length > 0 && allPeriodMonths.every((month) => monthInputs.get(month)?.cogsVnd !== null && monthInputs.get(month)?.cogsVnd !== undefined);
  const cogsVnd = allPeriodMonths.reduce((sum, month) => sum + (monthInputs.get(month)?.cogsVnd ?? 0), 0);
  // The ledger intentionally starts on 2026-09-01, so a completed 2026 report
  // covers the in-scope months even though January–August are outside this ledger.
  const periodKind = mode === "year" ? "year" : mode === "month" ? "month" : mode === "week" ? "week" : "custom";
  const periodIsOngoing = requestedEnd > today;
  const canShowProfit = revenueComplete && incompleteCostDays === 0 && ((periodKind !== "month" && periodKind !== "year") || cogsComplete);
  const profitVnd = canShowProfit ? calculateProfitVnd({
    periodKind,
    revenueVnd,
    expensesVnd: operatingCostsVnd,
    cogsVnd,
  }) : null;
  const target = mode === "week"
    ? weekTargetResult.data
    : mode === "month"
      ? monthTargetResult.data
      : null;
  const revenueTarget = target?.revenue_target_vnd ?? null;
  const profitTarget = mode === "month" ? monthTargetResult.data?.profit_target_vnd ?? null : null;
  const variance = mode === "month" && !periodIsOngoing && profitVnd !== null && profitTarget !== null && profitTarget > 0 ? ((profitVnd - profitTarget) / profitTarget) * 100 : null;
  const targetPercent = revenueTarget !== null && revenueTarget > 0 && revenueComplete && requestedStart >= "2026-09-01"
    ? (revenueVnd / revenueTarget) * 100
    : null;
  const targetName = mode === "week" ? "mục tiêu tuần" : "mục tiêu tháng";
  const targetDetail = revenueTarget === null
    ? null
    : targetPercent === null
      ? incompleteDays > 0 ? `Còn ${incompleteDays} ngày thiếu doanh thu nên chưa chốt tỷ lệ mục tiêu.` : "Chưa đủ dữ liệu trong phạm vi sổ để tính tỷ lệ mục tiêu."
      : periodIsOngoing
        ? `Tiến độ ${targetPercent.toFixed(0)}% ${targetName} đến ${formatBusinessDate(end, { day: "numeric", month: "short" })}.`
        : `Đạt ${targetPercent.toFixed(0)}% ${targetName}.`;
  const displayStart = invalidRange ? requestedStart : start;
  const displayEnd = invalidRange ? requestedEnd : end;
  const labelStart = formatBusinessDate(displayStart, { day: "numeric", month: "long", year: "numeric" });
  const labelEnd = formatBusinessDate(displayEnd, { day: "numeric", month: "long", year: "numeric" });
  const rangeNotes = [
    !invalidRange && requestedStart < start ? "Sổ riêng bắt đầu từ 01/09/2026" : null,
    !invalidRange && requestedEnd > today
      ? `${mode === "year" ? "Năm đang diễn ra" : "Kỳ đang diễn ra"}; số liệu tính đến ${formatBusinessDate(end, { day: "numeric", month: "long", year: "numeric" })}`
      : null,
  ].filter((note): note is string => note !== null);
  const yearMonthSummaries = mode === "year" ? allPeriodMonths.map((month) => {
    const inScopeDates = dateList.filter((date) => date.startsWith(month));
    const recordedRevenueDays = inScopeDates.filter((date) => dailyRevenue.get(date) !== null).length;
    const missing: string[] = [];
    const input = monthInputs.get(month);

    if (recordedRevenueDays < inScopeDates.length) {
      missing.push(`${inScopeDates.length - recordedRevenueDays} ngày thiếu doanh thu`);
    }
    if (!input || input.wagesVnd === null) missing.push("chưa nhập lương");
    if (!input || input.waterBillVnd === null) missing.push("chưa nhập bill nước");
    if (!input || calculateMonthlyElectricity(input.electricity).expenseVnd === null) {
      missing.push(input?.electricity.meterResetDetected ? "công tơ giảm/reset, chưa nhập bill điện" : "chưa có bill điện hoặc đủ chỉ số công tơ");
    }
    if (!input || input.cogsVnd === null) missing.push("chưa nhập COGS");

    const monthEndDate = monthEnd(`${month}-01`);
    const ongoing = month === today.slice(0, 7) && today < monthEndDate;
    const status = missing.length > 0 ? "Còn thiếu" : ongoing ? "Đang ghi nhận" : "Đủ dữ liệu";
    const detail = `Doanh thu ${recordedRevenueDays}/${inScopeDates.length} ngày trong kỳ${missing.length > 0 ? ` · ${missing.join(" · ")}` : " · Chi phí tháng và COGS đã nhập"}`;
    return { month, status, detail };
  }) : [];

  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">BÁO CÁO</p><h1>{label}</h1><p>{labelStart} – {labelEnd}{rangeNotes.length > 0 ? ` · ${rangeNotes.join(" · ")}` : ""}</p></div></div>
      <section className="surface report-filter">
        <form action="/reports" className="report-filter-form">
          <label className="field"><span>Loại kỳ</span><select name="mode" defaultValue={mode}><option value="month">Tháng</option><option value="week">Tuần</option><option value="year">Năm</option><option value="custom">Khoảng ngày</option></select></label>
          {mode === "month" ? <label className="field"><span>Tháng</span><input type="month" name="month" min="2026-09" defaultValue={requestedStart.slice(0, 7)} /></label> : null}
          {mode === "week" ? <label className="field"><span>Chọn ngày trong tuần</span><input type="date" name="date" min="2026-09-01" defaultValue={validDate(params.date) ? params.date : today} /></label> : null}
          {mode === "year" ? <label className="field"><span>Năm</span><input type="number" name="year" min="2026" max={today.slice(0, 4)} defaultValue={requestedStart.slice(0, 4)} /></label> : null}
          {mode === "custom" ? <><label className="field"><span>Từ ngày</span><input type="date" name="from" min="2026-09-01" defaultValue={params.from ?? today} /></label><label className="field"><span>Đến ngày</span><input type="date" name="to" min="2026-09-01" defaultValue={params.to ?? today} /></label></> : null}
          <button className="button" type="submit">Xem báo cáo</button>
        </form>
      </section>
      {invalidRange ? <p className="form-error report-error" role="alert">Khoảng ngày không hợp lệ hoặc chưa nằm trong phạm vi sổ từ 01/09/2026.</p> : null}
      <section className="report-metrics">
        <article className="surface report-metric"><span>Doanh thu {revenueComplete ? "đủ dữ liệu" : "các ngày đã nhập đủ"}</span><strong>{formatVnd(revenueVnd)}</strong><small>{incompleteDays > 0 ? `Còn ${incompleteDays} ngày chưa đủ dữ liệu.` : `${dateList.length} ngày đã đối chiếu.`}</small>{revenueTarget !== null ? <><small>Mục tiêu doanh thu: {formatVnd(revenueTarget)}</small><small>{targetDetail}</small></> : null}</article>
        <article className="surface report-metric"><span>{mode === "week" || mode === "custom" ? `Lợi nhuận trước COGS${periodIsOngoing ? " · tạm tính" : ""}` : `Lợi nhuận ${mode === "year" ? "năm" : "tháng"}${periodIsOngoing ? " · tạm tính" : ""} sau COGS`}</span><strong>{profitVnd === null ? "Chưa đủ dữ liệu" : formatVnd(profitVnd)}</strong><small>{profitVnd === null ? `Ngày thiếu: ${incompleteDays} · Ngày thiếu chi phí: ${incompleteCostDays}${(mode === "month" || mode === "year") && !cogsComplete ? " · Chưa nhập đủ COGS từng tháng." : ""}` : periodIsOngoing ? `Tạm tính đến ${formatBusinessDate(end, { day: "numeric", month: "long" })}; COGS theo số hiện đã nhập.` : mode === "week" || mode === "custom" ? "Đã trừ chi phí phân bổ và khoản phát sinh; chưa trừ COGS." : "Đã trừ COGS POS và các chi phí tháng."}</small>{variance !== null ? <small className={variance >= 0 ? "variance-positive" : "variance-negative"}>{variance >= 0 ? "+" : ""}{variance.toFixed(1)}% so với mục tiêu lợi nhuận</small> : profitTarget !== null ? <small>Mục tiêu lợi nhuận tháng: {formatVnd(profitTarget)}{periodIsOngoing ? " · đối chiếu sau khi chốt tháng." : ""}</small> : null}</article>
      </section>
      {!invalidRange ? <RevenueChart title={revenueChartTitle} description={revenueChartDescription} items={revenueChartItems} /> : null}
      {mode === "year" ? <section className="surface report-days">
        <div className="section-heading"><div><h2>Tình trạng từng tháng trong sổ</h2><p>Chỉ tính các tháng từ 01/09/2026; tháng hiện tại kiểm tra đến ngày đang xem. Năm đang diễn ra được xem là tạm tính đến ngày đó.</p></div></div>
        {yearMonthSummaries.length === 0 ? <p className="empty-inline">Chưa có tháng nào trong khoảng chọn.</p> : <div className="report-day-list">{yearMonthSummaries.map(({ month, status, detail }) => <div className="report-day-row" key={month}><span>{formatBusinessDate(`${month}-01`, { month: "long", year: "numeric" })}</span><strong>{status}</strong><span>{detail}</span></div>)}</div>}
      </section> : null}
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
