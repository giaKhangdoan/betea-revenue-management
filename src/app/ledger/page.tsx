import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { addDays, currentBusinessDate, formatBusinessDate, formatVnd, weekStart } from "@/lib/finance/format";
import { calculateDailyRevenue } from "@/lib/finance/calculations";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const today = currentBusinessDate();
  const queryDate = params.date;
  const parsedQueryDate = queryDate ? new Date(`${queryDate}T12:00:00Z`) : null;
  const selectedDate = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) && parsedQueryDate && Number.isFinite(parsedQueryDate.getTime()) && parsedQueryDate.toISOString().slice(0, 10) === queryDate && queryDate >= "2026-09-01" ? queryDate : today;
  const start = weekStart(selectedDate);
  const end = addDays(start, 6);
  const visibleStart = start < "2026-09-01" ? "2026-09-01" : start;
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const { data } = await owner.supabase.from("daily_records").select("*")
    .eq("owner_id", owner.ownerId).gte("business_date", visibleStart).lte("business_date", end).order("business_date");
  const records = new Map((data ?? []).map((item) => [item.business_date, item]));
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const dueDays = days.filter((day) => day >= "2026-09-01" && day <= today);
  const totals = dueDays.map((day) => {
    const record = records.get(day);
    if (!record) return null;
    return calculateDailyRevenue({
      businessStatus: record.business_status === "no_business" ? "no_business" : "open",
      shiftSalesVnd: [record.shift_06_10_vnd, record.shift_10_14_vnd, record.shift_14_18_vnd, record.shift_18_22_vnd],
      grabSalesVnd: record.grab_vnd,
      shopeeSalesVnd: record.shopee_vnd,
    }).totalVnd;
  });
  const completedRevenue = totals.flatMap((value) => value === null ? [] : [value]).reduce((sum, value) => sum + value, 0);
  const incompleteCount = totals.filter((value) => value === null).length;
  const previousWeek = addDays(start, -7);
  const nextWeek = addDays(start, 7);

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">SỔ DOANH THU</p><h1>Tuần {formatBusinessDate(start, { day: "numeric", month: "long" })} – {formatBusinessDate(end, { day: "numeric", month: "long", year: "numeric" })}</h1><p>Tuần được tính từ Thứ 2 đến Chủ nhật; mở một ngày để nhập hoặc đối chiếu.</p></div>
        <Link className="button" href={`/ledger/${selectedDate}`}>Nhập ngày {selectedDate === today ? "hôm nay" : "đang chọn"}</Link>
      </div>
      <section className="summary-strip surface" aria-label="Tổng hợp tuần">
        <div><span>Doanh thu các ngày đã đủ dữ liệu</span><strong>{formatVnd(completedRevenue)}</strong></div>
        <div><span>Ngày cần nhập hoặc chốt</span><strong>{incompleteCount} / {dueDays.length}</strong></div>
        <p>Tổng ngày cộng bốn ca với Grab và Shopee. Ngày chưa nhập đủ được đánh dấu riêng, không tính thành 0.</p>
      </section>
      <section className="surface week-card">
        <div className="week-toolbar">
          <Link className="button button-secondary" href={`/ledger?date=${previousWeek}`}>Tuần trước</Link>
          <form className="date-jump" action="/ledger"><label htmlFor="week-date">Đi đến ngày</label><input id="week-date" type="date" name="date" min="2026-09-01" defaultValue={selectedDate} /><button className="button button-secondary" type="submit">Xem tuần</button></form>
          <Link className="button button-secondary" href={`/ledger?date=${nextWeek}`}>Tuần sau</Link>
        </div>
        <div className="week-grid">
          {days.map((date) => {
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
            return (
              <Link className={`week-day ${date === selectedDate ? "week-day-selected" : ""} ${isBeforeStart ? "week-day-muted" : ""}`} href={isBeforeStart ? "/ledger" : `/ledger/${date}`} key={date} aria-label={`${formatBusinessDate(date)}, ${status}`}>
                <div className="week-day-top"><span>{formatBusinessDate(date, { weekday: "short" })}</span><span className={`status ${status === "Đã chốt" || status === "Đủ số liệu" ? "status-success" : status === "Còn thiếu" || status === "Chưa nhập" ? "status-warning" : "status-neutral"}`}>{status}</span></div>
                <strong className="week-day-date">{formatBusinessDate(date, { day: "numeric", month: "short" })}</strong>
                {isBeforeStart || future ? <span className="week-day-total">—</span> : record?.business_status === "no_business" ? <span className="week-day-total">0 ₫</span> : !revenue?.complete ? <span className="week-day-total muted">Chưa đủ dữ liệu</span> : <span className="week-day-total">{formatVnd(revenue.totalVnd)}</span>}
                {record && !isBeforeStart && !future ? <span className="week-day-sources">Ca {formatVnd(shifts)} · G/S {formatVnd(delivery)}</span> : <span className="week-day-sources">Mở sổ ngày</span>}
              </Link>
            );
          })}
        </div>
        <p className="form-note week-footnote">G/S là Grab và Shopee. Hai kênh được ghi tổng theo ngày, tách riêng khỏi bốn ca để kiểm tra đối chiếu.</p>
      </section>
    </>
  );
}
