import Link from "next/link";
import { redirect } from "next/navigation";
import { MonthlyCostForm } from "@/components/costs/monthly-cost-form";
import { TargetForms } from "@/components/costs/target-forms";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { calculateMonthlyElectricity } from "@/lib/finance/calculations";
import { currentBusinessDate, formatVnd, monthEnd, weekStart } from "@/lib/finance/format";

export const dynamic = "force-dynamic";

function isDateOnly(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ month?: string; week?: string }> }) {
  const params = await searchParams;
  const today = currentBusinessDate();
  const currentMonth = today.slice(0, 7);
  const month = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) && params.month >= "2026-09" ? params.month : currentMonth;
  const start = `${month}-01`;
  const end = monthEnd(start);
  const weekDateValid = isDateOnly(params.week) && params.week >= "2026-09-01";
  const selectedWeekDate = weekDateValid ? params.week! : month === currentMonth ? today : start;
  const selectedWeekStart = weekStart(selectedWeekDate);
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const [costResult, targetResult, weekResult, firstMeterResult, lastMeterResult] = await Promise.all([
    owner.supabase.from("monthly_costs").select("*").eq("owner_id", owner.ownerId).eq("month_start", start).maybeSingle(),
    owner.supabase.from("monthly_targets").select("revenue_target_vnd,profit_target_vnd").eq("owner_id", owner.ownerId).eq("month_start", start).maybeSingle(),
    owner.supabase.from("weekly_targets").select("revenue_target_vnd").eq("owner_id", owner.ownerId).eq("week_start", selectedWeekStart).maybeSingle(),
    owner.supabase.from("daily_records").select("electricity_morning_kwh").eq("owner_id", owner.ownerId).eq("business_date", start).maybeSingle(),
    owner.supabase.from("daily_records").select("electricity_evening_kwh").eq("owner_id", owner.ownerId).eq("business_date", end).maybeSingle(),
  ]);
  const costs = costResult.data;
  const electricity = calculateMonthlyElectricity({
    firstDayMorningKwh: firstMeterResult.data?.electricity_morning_kwh ?? null,
    lastDayEveningKwh: lastMeterResult.data?.electricity_evening_kwh ?? null,
    billAmountVnd: costs?.electricity_bill_vnd ?? null,
  });

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">CHI PHÍ VÀ MỤC TIÊU</p><h1>Quản lý theo tháng</h1><p>COGS từ POS và các khoản chi tháng được nhập riêng, có thể điều chỉnh khi cần.</p></div>
        <form className="month-jump" action="/costs"><label htmlFor="cost-month">Chọn tháng</label><input id="cost-month" type="month" name="month" min="2026-09" defaultValue={month} /><button className="button button-secondary" type="submit">Xem</button></form>
      </div>
      <div className="costs-layout">
        <div className="day-primary">
          <MonthlyCostForm month={month} costs={costs} />
          <section className="surface electricity-card">
            <div className="section-heading"><div><h2>Đối chiếu công tơ điện</h2><p>{start} ca sáng đến {end} ca tối · đơn giá mặc định 3.471 ₫/kWh</p></div></div>
            {electricity.status === "missing_reading" ? <p className="incomplete-callout">Cần chỉ số điện ca sáng ngày đầu tháng và ca tối ngày cuối tháng để tính mức dùng. Bạn có thể nhập bill trước; bill sẽ được dùng làm chi phí tạm thời.</p> : null}
            {electricity.status === "negative_consumption" ? <p className="form-error">Chỉ số tối cuối tháng đang thấp hơn chỉ số sáng đầu tháng. Kiểm tra lại công tơ trước khi chốt.</p> : null}
            <div className="electricity-grid">
              <div><span>Mức dùng tháng</span><strong>{electricity.usageKwh === null ? "Chưa đủ chỉ số" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(electricity.usageKwh)} kWh`}</strong></div>
              <div><span>Tiền điện ước tính</span><strong>{formatVnd(electricity.estimatedVnd)}</strong></div>
              <div><span>Tiền điện bill dùng tính</span><strong>{formatVnd(electricity.expenseVnd)}</strong></div>
              <div><span>Chênh so với ước tính</span><strong>{electricity.differenceVnd === null ? "—" : `${formatVnd(electricity.differenceVnd)} · ${electricity.differencePercent === null ? "không tính được %" : `${electricity.differencePercent > 0 ? "+" : ""}${electricity.differencePercent.toFixed(1)}%`}`}</strong></div>
            </div>
            <p className="form-note">Nhập chỉ số từng ngày trong <Link className="text-link" href={`/ledger/${start}`}>sổ ngày đầu tháng</Link> và <Link className="text-link" href={`/ledger/${end}`}>sổ ngày cuối tháng</Link>. Bill điện có thể thay số ước tính, đồng thời vẫn giữ chênh lệch để đối chiếu.</p>
          </section>
        </div>
        <div className="day-secondary">
          <TargetForms month={month} weekDate={selectedWeekDate} weekStart={selectedWeekStart} monthTarget={targetResult.data} weekTarget={weekResult.data} />
          <aside className="surface day-note-card"><h2>Cách tính lợi nhuận</h2><ul><li>Tháng/năm: trừ COGS tháng từ POS.</li><li>Tuần/khoảng ngày: lợi nhuận trước COGS.</li><li>Thuê, lương, điện và nước chia theo số ngày lịch của tháng.</li><li>Ngày thiếu số liệu sẽ được đánh dấu riêng, không coi là 0 đồng.</li></ul><Link className="text-link" href="/reports">Mở báo cáo theo kỳ</Link></aside>
        </div>
      </div>
    </>
  );
}
