import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { addDays, currentBusinessDate, formatBusinessDate, formatVnd, weekStart } from "@/lib/finance/format";
import { calculateDailyElectricityUsage, calculateDailyRevenue } from "@/lib/finance/calculations";
import { loadOwnerDailyRecords } from "@/lib/ledger/owner-daily-records";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const today = currentBusinessDate();
  const queryDate = params.date;
  const parsedQueryDate = queryDate ? new Date(`${queryDate}T12:00:00Z`) : null;
  const queryDateIsValid = Boolean(queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) && parsedQueryDate && Number.isFinite(parsedQueryDate.getTime()) && parsedQueryDate.toISOString().slice(0, 10) === queryDate && addDays(weekStart(queryDate), 6) >= "2026-09-01");
  const selectedDate = queryDateIsValid ? queryDate! : today;
  const start = weekStart(selectedDate);
  const end = addDays(start, 6);
  const visibleStart = start < "2026-09-01" ? "2026-09-01" : start;
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");
  if (queryDate !== undefined && queryDate !== selectedDate) redirect(`/ledger?date=${selectedDate}`);

  const { data } = await loadOwnerDailyRecords(owner.supabase, owner.ownerId, { start: visibleStart, end: addDays(end, 1) });
  const records = new Map(data.map((item) => [item.business_date, item]));
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const weekDays = days.map((date) => {
    const record = records.get(date);
    const isBeforeStart = date < "2026-09-01";
    const future = date > today;
    const revenue = record ? calculateDailyRevenue({
      businessStatus: record.business_status === "no_business" ? "no_business" : "open",
      shiftSalesVnd: [record.shift_06_10_vnd, record.shift_10_14_vnd, record.shift_14_18_vnd, record.shift_18_22_vnd],
      grabSalesVnd: record.grab_vnd,
      shopeeSalesVnd: record.shopee_vnd,
    }) : null;
    const status = isBeforeStart ? "Ngoài sổ" : future ? "Chưa đến" : !record ? "Chưa nhập" : record.business_status === "no_business" ? "Không kinh doanh" : revenue?.complete && record.business_status === "closed" ? "Đã chốt" : revenue?.complete ? "Đủ số liệu" : "Còn thiếu";
    const shifts = record ? [record.shift_06_10_vnd, record.shift_10_14_vnd, record.shift_14_18_vnd, record.shift_18_22_vnd].reduce<number>((sum, value) => sum + Number(value ?? 0), 0) : null;
    const delivery = record ? Number(record.grab_vnd ?? 0) + Number(record.shopee_vnd ?? 0) : null;
    const reconciliation = record?.reconciliation_status ?? "unreconciled";
    const reconciliationLabel = reconciliation === "matched" ? "Bluebook: Khớp" : reconciliation === "discrepancy" ? "Bluebook: Lệch" : reconciliation === "pending" ? "Bluebook: Chờ kiểm tra" : "Bluebook: Chưa đối chiếu";
    const electricity = calculateDailyElectricityUsage({
      morningKwh: record?.electricity_morning_kwh == null ? null : Number(record.electricity_morning_kwh),
      eveningKwh: record?.electricity_evening_kwh == null ? null : Number(record.electricity_evening_kwh),
      nextMorningKwh: records.get(addDays(date, 1))?.electricity_morning_kwh == null ? null : Number(records.get(addDays(date, 1))!.electricity_morning_kwh),
    });
    return { date, record, isBeforeStart, future, revenue, status, shifts, delivery, reconciliation, reconciliationLabel, electricity };
  });
  const dueDays = weekDays.filter(({ date }) => date >= "2026-09-01" && date <= today);
  const totals = dueDays.map(({ record, revenue }) => !record || !revenue?.complete ? null : revenue.totalVnd);
  const completedRevenue = totals.flatMap((value) => value === null ? [] : [value]).reduce((sum, value) => sum + value, 0);
  const incompleteCount = totals.filter((value) => value === null).length;
  const chartMaximum = Math.max(1, ...weekDays.map(({ date, revenue }) => date >= "2026-09-01" && date <= today && revenue ? revenue.totalVnd ?? 0 : 0));
  const previousWeek = addDays(start, -7);
  const nextWeek = addDays(start, 7);
  const previousWeekIsOutsideLedger = addDays(previousWeek, 6) < "2026-09-01";

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">SỔ DOANH THU</p><h1>Tuần {formatBusinessDate(start, { day: "numeric", month: "long" })} – {formatBusinessDate(end, { day: "numeric", month: "long", year: "numeric" })}</h1><p>Tuần được tính từ Thứ 2 đến Chủ nhật; mở một ngày để nhập hoặc đối chiếu.</p></div>
        <Link className="button" href={`/ledger/${selectedDate}`}>Nhập ngày {selectedDate === today ? "hôm nay" : "đang chọn"}</Link>
      </div>
      <section className="summary-strip surface" aria-label="Tổng hợp tuần">
        <div><span>Doanh thu các ngày đã đủ dữ liệu</span><strong>{formatVnd(completedRevenue)}</strong></div>
        <div><span>Ngày chưa đủ dữ liệu</span><strong>{incompleteCount} / {dueDays.length}</strong></div>
        <p>Tổng ngày cộng bốn ca với Grab và Shopee. Ngày chưa nhập đủ được đánh dấu riêng, không tính thành 0.</p>
      </section>
      <section className="surface week-card">
        <div className="week-toolbar">
          {previousWeekIsOutsideLedger ? <button className="button button-secondary" type="button" disabled>Trước sổ</button> : <Link className="button button-secondary" href={`/ledger?date=${previousWeek}`}>Tuần trước</Link>}
          <form className="date-jump" action="/ledger"><label htmlFor="week-date">Đi đến ngày</label><input id="week-date" type="date" name="date" min="2026-08-31" defaultValue={selectedDate} /><button className="button button-secondary" type="submit">Xem tuần</button></form>
          <Link className="button button-secondary" href={`/ledger?date=${nextWeek}`}>Tuần sau</Link>
        </div>
        <section className="week-revenue-chart" aria-labelledby="week-revenue-title">
          <div className="section-heading week-chart-heading"><div><h2 id="week-revenue-title">Doanh thu theo ngày</h2><p>Thanh dài hơn thể hiện doanh thu cao hơn trong tuần.</p></div></div>
          <div className="week-revenue-list" role="list" aria-label="Biểu đồ doanh thu từng ngày trong tuần">
            {weekDays.map((day) => {
              const chartValue = !day.isBeforeStart && !day.future && day.record ? day.revenue?.totalVnd ?? null : null;
              const barState = day.isBeforeStart || day.future ? "week-chart-bar-neutral" : chartValue === null || !day.revenue?.complete ? "week-chart-bar-incomplete" : "";
              const accessibleValue = chartValue === null ? day.status : `${formatVnd(chartValue)}${day.revenue?.complete ? "" : " · tạm tính"}`;
              return (
                <div className="week-revenue-row" key={day.date} role="listitem">
                  <div className="week-chart-date"><strong>{formatBusinessDate(day.date, { weekday: "short" })}</strong><span>{formatBusinessDate(day.date, { day: "numeric", month: "short" })}</span></div>
                  <div className="week-chart-track" role="img" aria-label={`${formatBusinessDate(day.date, { weekday: "long", day: "numeric", month: "long" })}: ${accessibleValue}`}>
                    <span className={barState} style={{ width: chartValue === null || chartMaximum <= 1 ? "0%" : `${(chartValue / chartMaximum) * 100}%` }} />
                  </div>
                  <div className="week-chart-reading"><strong>{chartValue === null ? day.status : formatVnd(chartValue)}</strong>{chartValue !== null && !day.revenue?.complete ? <span>Tạm tính</span> : null}</div>
                </div>
              );
            })}
          </div>
        </section>
        <div className="week-grid">
          {weekDays.map(({ date, record, isBeforeStart, future, revenue, status, shifts, delivery, reconciliation, reconciliationLabel, electricity }) => {
            const kwh = (value: number | null) => value === null ? "—" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(value)} kWh`;
            const electricityLabel = electricity.status === "meter_decrease"
              ? "Công tơ giảm · cần kiểm tra"
              : electricity.fullDayKwh === null
                ? electricity.shiftKwh === null ? "Chưa đủ chỉ số điện" : `Ca ${kwh(electricity.shiftKwh)} · chờ sáng mai`
                : `24 giờ ${kwh(electricity.fullDayKwh)}`;
            return (
              <Link className={`week-day ${date === selectedDate ? "week-day-selected" : ""} ${isBeforeStart ? "week-day-muted" : ""}`} href={isBeforeStart ? `/ledger?date=${date}` : `/ledger/${date}`} key={date} aria-label={`${formatBusinessDate(date)}, ${status}`}>
                <div className="week-day-top"><span>{formatBusinessDate(date, { weekday: "short" })}</span><span className={`status ${status === "Đã chốt" || status === "Đủ số liệu" ? "status-success" : status === "Còn thiếu" || status === "Chưa nhập" ? "status-warning" : "status-neutral"}`}>{status}</span></div>
                <strong className="week-day-date">{formatBusinessDate(date, { day: "numeric", month: "short" })}</strong>
                {isBeforeStart || future ? <span className="week-day-total">—</span> : record?.business_status === "no_business" ? <span className="week-day-total">0 ₫</span> : !revenue?.complete ? <span className="week-day-total muted">Chưa đủ dữ liệu</span> : <span className="week-day-total">{formatVnd(revenue.totalVnd)}</span>}
                {record && !isBeforeStart && !future ? <span className="week-day-sources">Ca {formatVnd(shifts)} · G/S {formatVnd(delivery)}</span> : <span className="week-day-sources">Mở sổ ngày</span>}
                {record && !isBeforeStart && !future ? <span className="week-day-electricity" title={`Điện ca: ${kwh(electricity.shiftKwh)} · Qua đêm: ${kwh(electricity.overnightKwh)}`}>{electricityLabel}{electricity.shiftKwh !== null && electricity.overnightKwh !== null ? <small>Ca {kwh(electricity.shiftKwh)} · đêm {kwh(electricity.overnightKwh)}</small> : null}</span> : null}
                {record && !isBeforeStart && !future ? reconciliation === "discrepancy" ? <><span className={`week-day-reconciliation reconciliation-${reconciliation}`}>{record.reconciliation_difference_vnd == null ? reconciliationLabel : Number(record.reconciliation_difference_vnd) < 0 ? `Bluebook thiếu ${formatVnd(Math.abs(Number(record.reconciliation_difference_vnd)))}` : `Bluebook cao hơn ${formatVnd(Number(record.reconciliation_difference_vnd))}`}</span><span className="week-day-reconciliation-reason">{record.reconciliation_note ? `Lý do: ${record.reconciliation_note}` : "Chưa ghi lý do chênh lệch"}</span></> : <span className={`week-day-reconciliation reconciliation-${reconciliation}`}>{reconciliationLabel}</span> : null}
              </Link>
            );
          })}
        </div>
        <p className="form-note week-footnote">G/S là Grab và Shopee. Hai kênh được ghi tổng theo ngày, tách riêng khỏi bốn ca để kiểm tra đối chiếu.</p>
      </section>
    </>
  );
}
