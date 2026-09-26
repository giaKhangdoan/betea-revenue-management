import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DailyEntryForm } from "@/components/ledger/daily-entry-form";
import { DailyExpenseForm } from "@/components/ledger/daily-expense-form";
import { PhotoManager } from "@/components/ledger/photo-manager";
import { addDays, formatBusinessDate, formatVnd } from "@/lib/finance/format";
import { requireOwnerClient } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function LedgerDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const parsedDate = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || date < "2026-09-01") notFound();
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const [dayResult, nextDayResult, expensesResult, photosResult] = await Promise.all([
    owner.supabase.from("daily_records").select("*").eq("owner_id", owner.ownerId).eq("business_date", date).maybeSingle(),
    owner.supabase.from("daily_records").select("electricity_morning_kwh").eq("owner_id", owner.ownerId).eq("business_date", addDays(date, 1)).maybeSingle(),
    owner.supabase.from("daily_expenses").select("id,amount_vnd,reason,created_at").eq("owner_id", owner.ownerId).eq("business_date", date).order("created_at", { ascending: false }),
    owner.supabase.from("day_photos").select("id,category,shift_code,object_path,caption,created_at").eq("owner_id", owner.ownerId).eq("business_date", date).order("created_at", { ascending: false }),
  ]);
  const record = dayResult.data;
  const expenses = expensesResult.data ?? [];
  const photos = await Promise.all((photosResult.data ?? []).map(async (photo) => {
    const { data } = await owner.supabase.storage.from("betea-evidence").createSignedUrl(photo.object_path, 300);
    return data?.signedUrl ? { ...photo, signed_url: data.signedUrl } : null;
  }));
  const totalExpense = expenses.reduce((sum, item) => sum + Number(item.amount_vnd), 0);

  return (
    <>
      <div className="page-heading day-heading">
        <div><p className="eyebrow">SỔ NGÀY</p><h1>{formatBusinessDate(date)}</h1><p>Thông tin doanh thu, công tơ và đối soát vận hành.</p></div>
        <Link className="button button-secondary" href={`/ledger?date=${date}`}>Về tuần này</Link>
      </div>
      <div className="day-layout">
        <div className="day-primary">
          <DailyEntryForm key={date} date={date} record={record} nextMorningKwh={nextDayResult.data?.electricity_morning_kwh == null ? null : Number(nextDayResult.data.electricity_morning_kwh)} />
          <DailyExpenseForm date={date} />
          <section className="surface table-card">
            <div className="section-heading"><div><h2>Chi phí đã ghi</h2><p>{expenses.length} khoản trong ngày</p></div><strong>{formatVnd(totalExpense)}</strong></div>
            {expenses.length === 0 ? <p className="empty-inline">Chưa có chi phí phát sinh.</p> : (
              <div className="expense-list">
                {expenses.map((item) => <div className="expense-row" key={item.id}><span>{item.reason}</span><strong>{formatVnd(item.amount_vnd)}</strong></div>)}
              </div>
            )}
          </section>
        </div>
        <aside className="day-secondary">
          <PhotoManager date={date} initialPhotos={photos.filter((photo): photo is NonNullable<typeof photo> => photo !== null)} />
          <section className="surface day-note-card">
            <h2>Đối chiếu điện theo tháng</h2>
            <p>Chỉ số sáng và tối được lưu ở sổ ngày. Mức dùng điện tháng lấy chỉ số tối ngày cuối tháng trừ chỉ số sáng ngày đầu tháng.</p>
            <Link className="text-link" href={`/costs?month=${date.slice(0, 7)}`}>Xem chi phí tháng</Link>
          </section>
        </aside>
      </div>
    </>
  );
}
