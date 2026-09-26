import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { allocateMonthlyAmountByDay, allocateSignedMonthlyAmountByDay, calculateDailyRevenue, calculateMonthlyElectricity, calculateProfitVnd, hasMeterResetWithinMonth } from "@/lib/finance/calculations";
import { addDays, currentBusinessDate, formatBusinessDate, formatVnd, monthEnd, weekStart } from "@/lib/finance/format";

export const dynamic = "force-dynamic";

type DayRow = {
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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const today = currentBusinessDate();
  const defaultMonth = today.slice(0, 7);
  const selectedMonth = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) && params.month >= "2026-09" ? params.month : defaultMonth;
  const start = `${selectedMonth}-01`;
  const end = monthEnd(start);
  const asOf = end > today ? today : end;
  const effectiveStart = start < "2026-09-01" ? "2026-09-01" : start;
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const [daysResult, costResult, targetResult, expenseResult, adjustmentsResult] = await Promise.all([
    owner.supabase.from("daily_records").select("business_date,business_status,shift_06_10_vnd,shift_10_14_vnd,shift_14_18_vnd,shift_18_22_vnd,grab_vnd,shopee_vnd,electricity_morning_kwh,electricity_evening_kwh")
      .eq("owner_id", owner.ownerId).gte("business_date", effectiveStart).lte("business_date", asOf).order("business_date"),
    owner.supabase.from("monthly_costs").select("*").eq("owner_id", owner.ownerId).eq("month_start", start).maybeSingle(),
    owner.supabase.from("monthly_targets").select("revenue_target_vnd,profit_target_vnd").eq("owner_id", owner.ownerId).eq("month_start", start).maybeSingle(),
    owner.supabase.from("daily_expenses").select("amount_vnd").eq("owner_id", owner.ownerId).gte("business_date", effectiveStart).lte("business_date", asOf),
    owner.supabase.from("monthly_cost_adjustments").select("amount_delta_vnd").eq("owner_id", owner.ownerId).eq("month_start", start),
  ]);
  const records = (daysResult.data ?? []) as DayRow[];
  const recordMap = new Map(records.map((record) => [record.business_date, record]));
  const expenses = expenseResult.data ?? [];
  const incidentalsVnd = expenses.reduce((sum, expense) => sum + Number(expense.amount_vnd), 0);
  const monthlyAdjustmentsVnd = (adjustmentsResult.data ?? []).reduce((sum, adjustment) => sum + Number(adjustment.amount_delta_vnd), 0);
  const dayCount = Math.max(0, Math.floor((Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${effectiveStart}T12:00:00Z`)) / 86400000) + (asOf >= effectiveStart ? 1 : 0));
  const dailyRows = Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(effectiveStart, index);
    const record = recordMap.get(date);
    if (!record) return { date, total: null as number | null };
    const result = calculateDailyRevenue({
      businessStatus: record.business_status === "no_business" ? "no_business" : "open",
      shiftSalesVnd: [record.shift_06_10_vnd, record.shift_10_14_vnd, record.shift_14_18_vnd, record.shift_18_22_vnd],
      grabSalesVnd: record.grab_vnd,
      shopeeSalesVnd: record.shopee_vnd,
    });
    return { date, total: result.totalVnd };
  });
  const knownRevenue = dailyRows.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const incompleteDays = dailyRows.filter((row) => row.total === null).length;
  const revenueComplete = dailyRows.length > 0 && incompleteDays === 0;
  const costs = costResult.data;
  const monthlyElectricity = calculateMonthlyElectricity({
    firstDayMorningKwh: recordMap.get(start)?.electricity_morning_kwh ?? null,
    lastDayEveningKwh: recordMap.get(end)?.electricity_evening_kwh ?? null,
    billAmountVnd: costs?.electricity_bill_vnd ?? null,
    meterResetDetected: hasMeterResetWithinMonth(records.map((record) => ({
      businessDate: record.business_date,
      morningKwh: record.electricity_morning_kwh,
      eveningKwh: record.electricity_evening_kwh,
    }))),
  });
  const monthIsFinished = end <= today;
  const costsComplete = Boolean(
    costs && costs.cogs_vnd !== null && costs.wages_vnd !== null && costs.water_bill_vnd !== null && monthlyElectricity.expenseVnd !== null,
  );
  const monthKey = selectedMonth as `${number}-${number}`;
  const preCogsExpensesVnd = costsComplete
    ? dailyRows.reduce((sum, row) => {
      const dayIndex = Number(row.date.slice(8, 10)) - 1;
      const allocatedBaseCosts = [
        Number(costs?.rent_vnd ?? 10000000),
        Number(costs?.wages_vnd ?? 0),
        Number(costs?.water_bill_vnd ?? 0),
        Number(monthlyElectricity.expenseVnd ?? 0),
      ].reduce((daySum, amount) => daySum + (allocateMonthlyAmountByDay(amount, monthKey)[dayIndex]?.amountVnd ?? 0), 0);
      const allocatedAdjustment = allocateSignedMonthlyAmountByDay(monthlyAdjustmentsVnd, monthKey)[dayIndex]?.amountVnd ?? 0;
      return sum + allocatedBaseCosts + allocatedAdjustment;
    }, incidentalsVnd)
    : null;
  const profit = calculateProfitVnd({
    periodKind: "month",
    revenueVnd: revenueComplete ? knownRevenue : null,
    expensesVnd: preCogsExpensesVnd,
    cogsVnd: costs?.cogs_vnd ?? null,
  });
  const target = targetResult.data;
  const revenueTarget = target?.revenue_target_vnd ?? null;
  const profitTarget = target?.profit_target_vnd ?? null;
  const revenuePercent = revenueComplete && revenueTarget && revenueTarget > 0 ? (knownRevenue / revenueTarget) * 100 : null;
  const profitVariance = monthIsFinished && profit !== null && profitTarget !== null && profitTarget > 0 ? ((profit - profitTarget) / profitTarget) * 100 : null;

  const weekGroups = new Map<string, { known: number; missing: number; count: number }>();
  for (const row of dailyRows) {
    const monday = weekStart(row.date);
    const group = weekGroups.get(monday) ?? { known: 0, missing: 0, count: 0 };
    group.count += 1;
    if (row.total === null) group.missing += 1;
    else group.known += row.total;
    weekGroups.set(monday, group);
  }
  const weekRows = [...weekGroups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maximumWeekRevenue = Math.max(1, ...weekRows.map(([, group]) => group.known));
  const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(`${start}T12:00:00+07:00`));

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">TỔNG QUAN THÁNG</p><h1>{monthLabel}</h1><p>Doanh thu theo ca, Grab/Shopee theo ngày và lợi nhuận sau khi trừ chi phí tháng.</p></div>
        <div className="heading-actions"><form className="month-jump" action="/"><label htmlFor="dashboard-month">Chọn tháng</label><input id="dashboard-month" type="month" name="month" min="2026-09" defaultValue={selectedMonth} /><button className="button button-secondary" type="submit">Xem</button></form><Link className="button" href={`/ledger/${today}`}>Nhập hôm nay</Link></div>
      </div>
      <section className="metric-grid" aria-label="Chỉ số tháng">
        <article className="metric-card surface"><div className="metric-label">Doanh thu đã nhập đủ ngày</div><strong className="metric-value">{formatVnd(knownRevenue)}</strong><p>{incompleteDays > 0 ? `Còn ${incompleteDays} ngày cần nhập hoặc chốt` : monthIsFinished ? "Đã đủ doanh thu các ngày trong tháng" : `Đã nhập đủ đến ${formatBusinessDate(asOf, { day: "numeric", month: "short" })}`}</p>{revenueTarget !== null ? <div className="target-progress"><div><span>{monthIsFinished ? "Mục tiêu doanh thu" : "Tiến độ mục tiêu tháng"}</span><strong>{formatVnd(revenueTarget)}</strong></div><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, revenuePercent ?? 0))}%` }} /></div><small>{revenuePercent === null ? incompleteDays > 0 ? "Nhập đủ ngày để xem tỷ lệ mục tiêu." : "Chưa có dữ liệu doanh thu." : `${revenuePercent.toFixed(0)}%${monthIsFinished ? " mục tiêu" : ` mục tiêu đến ${formatBusinessDate(asOf, { day: "numeric", month: "short" })}`}`}</small></div> : <Link className="text-link" href={`/costs?month=${selectedMonth}`}>Đặt mục tiêu tháng</Link>}</article>
        <article className="metric-card surface"><div className="metric-label">{monthIsFinished ? "Lợi nhuận tháng sau COGS" : "Lợi nhuận tạm tính sau COGS"}</div><strong className="metric-value">{profit === null ? "Chưa đủ dữ liệu" : formatVnd(profit)}</strong><p>{profit === null ? monthlyElectricity.status === "meter_reset" && monthlyElectricity.expenseVnd === null ? "Công tơ có mức giảm/reset; hãy nhập bill điện để hoàn tất chi phí." : incompleteDays > 0 ? `Còn ${incompleteDays} ngày thiếu doanh thu.` : "Kiểm tra COGS, lương, nước và bill điện hoặc chỉ số công tơ." : monthIsFinished ? "Đã trừ COGS POS và các chi phí quản lý." : `Tạm tính đến ${formatBusinessDate(asOf, { day: "numeric", month: "long" })}; COGS theo số hiện đã nhập.`}</p>{profitVariance !== null ? <small className={`variance ${profitVariance >= 0 ? "variance-positive" : "variance-negative"}`}>{profitVariance >= 0 ? "+" : ""}{profitVariance.toFixed(1)}% so với mục tiêu lợi nhuận</small> : profitTarget !== null ? <small className="form-note">Mục tiêu lợi nhuận: {formatVnd(profitTarget)}{monthIsFinished ? " · chênh lệch hiện khi đủ dữ liệu." : " · đối chiếu sau khi chốt tháng."}</small> : <Link className="text-link" href={`/costs?month=${selectedMonth}`}>Đặt mục tiêu lợi nhuận</Link>}</article>
      </section>
      <div className="dashboard-columns">
        <section className="surface week-summary-card">
          <div className="section-heading"><div><h2>Doanh thu theo tuần</h2><p>Ngày từ Thứ 2 đến Chủ nhật; tuần nằm trong tháng được nhóm theo lịch.</p></div><Link className="text-link" href={`/ledger?date=${today}`}>Mở sổ tuần</Link></div>
          {weekRows.length === 0 ? <p className="empty-inline">Chưa có ngày nào trong tháng này.</p> : <div className="month-week-list">{weekRows.map(([monday, group]) => <div className="month-week-row" key={monday}><div><strong>{formatBusinessDate(monday, { day: "numeric", month: "short" })}</strong><span>{group.count} ngày · {group.missing ? `${group.missing} ngày thiếu` : "đủ dữ liệu"}</span></div><strong>{formatVnd(group.known)}{group.missing ? <small> phần đã đủ dữ liệu</small> : null}</strong><Link className="text-link" href={`/ledger?date=${monday}`}>Xem tuần</Link><div className="week-revenue-track" role="img" aria-label={`Doanh thu tuần bắt đầu ${formatBusinessDate(monday, { day: "numeric", month: "long" })}: ${formatVnd(group.known)}${group.missing ? `, còn ${group.missing} ngày thiếu dữ liệu` : ""}`}><span style={{ width: `${Math.max(1, (group.known / maximumWeekRevenue) * 100)}%` }} /></div></div>)}</div>}
        </section>
        <section className="surface quick-actions-card">
          <div className="section-heading"><div><h2>Quản lý nhanh</h2><p>Nhập sổ và đối chiếu các khoản cần thiết.</p></div></div>
          <Link className="quick-action" href={`/ledger/${today}`}><strong>Nhập doanh thu hôm nay</strong><span>Bốn ca, Grab/Shopee, công tơ, ghi chú và ảnh.</span></Link>
          <Link className="quick-action" href={`/costs?month=${selectedMonth}`}><strong>Cập nhật chi phí tháng</strong><span>COGS từ POS, thuê, lương, điện, nước và mục tiêu.</span></Link>
          <Link className="quick-action" href="/reports"><strong>Xem báo cáo theo kỳ</strong><span>Tuần, tháng, năm hoặc khoảng ngày tùy chọn.</span></Link>
        </section>
      </div>
    </>
  );
}
