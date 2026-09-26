import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { addDays, currentBusinessDate, formatBusinessDate, formatVnd, weekStart } from "@/lib/finance/format";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const staff = await requireStaff();
  if (!staff) return null;
  const today = currentBusinessDate();
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const { data } = await staff.supabase.from("daily_records")
    .select("business_date,shift_06_10_vnd,shift_10_14_vnd,shift_14_18_vnd,shift_18_22_vnd,grab_vnd,shopee_vnd,total_bill_count")
    .eq("owner_id", staff.ownerId).gte("business_date", monday).lte("business_date", sunday).order("business_date");
  const byDate = new Map((data ?? []).map((row) => [row.business_date, row]));
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));

  return <>
    <div className="page-heading staff-page-heading"><div><p className="eyebrow">NHẬP LIỆU NHÂN VIÊN</p><h1>Tuần hiện tại</h1><p>{formatBusinessDate(monday, { day: "numeric", month: "long" })} – {formatBusinessDate(sunday, { day: "numeric", month: "long", year: "numeric" })}</p></div><Link className="button button-primary" href={`/staff/entry/${today}`}>Nhập hôm nay</Link></div>
    <section className="surface staff-week-card"><div className="section-heading"><div><h2>Từng ngày trong tuần</h2><p>Ngày đã qua chỉ xem lại; chỉ ngày hôm nay được nhập hoặc sửa.</p></div></div><div className="staff-day-list">{days.map((date) => {
      const row = byDate.get(date) as Record<string, unknown> | undefined;
      const values: Array<number | string | null> = row ? [
        row.shift_06_10_vnd as number | string | null,
        row.shift_10_14_vnd as number | string | null,
        row.shift_14_18_vnd as number | string | null,
        row.shift_18_22_vnd as number | string | null,
        row.grab_vnd as number | string | null,
        row.shopee_vnd as number | string | null,
      ] : [];
      const complete = values.length === 6 && values.every((value) => value !== null);
      const total: number | null = complete ? values.reduce<number>((sum, value) => sum + Number(value), 0) : null;
      const isToday = date === today;
      const isFuture = date > today;
      return <Link className={`staff-day-row ${isToday ? "staff-day-today" : ""}`} href={`/staff/entry/${date}`} key={date}><div className="staff-day-date"><strong>{formatBusinessDate(date, { weekday: "long", day: "numeric", month: "short" })}</strong><span>{isToday ? "Hôm nay" : isFuture ? "Chưa đến ngày" : "Đã qua · chỉ xem"}</span></div><div className="staff-day-reading"><span>Doanh thu ngày</span><strong>{total === null ? "Chưa đủ dữ liệu" : formatVnd(total)}</strong></div><div className="staff-day-reading"><span>Tổng bill</span><strong>{row?.total_bill_count == null ? "Chưa nhập" : `${Number(row.total_bill_count)} bill`}</strong></div><span className="text-link">{isFuture ? "Xem" : isToday ? "Nhập" : "Xem"}</span></Link>;
    })}</div></section>
  </>;
}
