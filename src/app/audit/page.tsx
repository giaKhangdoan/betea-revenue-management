import { redirect } from "next/navigation";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { formatVnd } from "@/lib/finance/format";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  daily_records: "Sổ ngày",
  monthly_costs: "Chi phí tháng",
  daily_expenses: "Chi phí phát sinh",
  weekly_targets: "Mục tiêu tuần",
  monthly_targets: "Mục tiêu tháng",
  day_photos: "Ảnh đối chiếu",
  business_date: "Ngày",
  month_start: "Tháng",
  week_start: "Tuần bắt đầu",
  shift_06_10_vnd: "Ca 06:00–10:00",
  shift_10_14_vnd: "Ca 10:00–14:00",
  shift_14_18_vnd: "Ca 14:00–18:00",
  shift_18_22_vnd: "Ca 18:00–22:00",
  grab_vnd: "Grab",
  shopee_vnd: "Shopee",
  cogs_vnd: "COGS",
  rent_vnd: "Tiền thuê",
  wages_vnd: "Lương nhân viên",
  water_bill_vnd: "Tiền nước",
  electricity_bill_vnd: "Bill điện",
  electricity_morning_kwh: "Công tơ sáng",
  electricity_evening_kwh: "Công tơ tối",
  cleaning_done: "Xác nhận vệ sinh",
  arrangement_done: "Xác nhận sắp xếp",
  business_status: "Trạng thái ngày",
  amount_vnd: "Số tiền",
  reason: "Lý do",
  category: "Loại ảnh",
  shift_code: "Ca",
  caption: "Ghi chú ảnh",
  revenue_target_vnd: "Mục tiêu doanh thu",
  profit_target_vnd: "Mục tiêu lợi nhuận",
  note: "Ghi chú",
};

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Đã xác nhận" : "Chưa xác nhận";
  if (field.endsWith("_vnd") && typeof value === "number") return formatVnd(value);
  if (field.endsWith("_kwh")) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(Number(value))} kWh`;
  if (field === "business_status") return value === "closed" ? "Đã chốt" : value === "no_business" ? "Không kinh doanh" : "Đang nhập";
  if (field === "category") return labels[String(value)] ?? String(value);
  return String(value);
}

export default async function AuditPage() {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");
  const { data, error } = await owner.supabase.from("audit_events").select("id,actor_id,actor_type,table_name,record_id,action,before_data,after_data,occurred_at")
    .eq("owner_id", owner.ownerId).order("occurred_at", { ascending: false }).limit(100);
  const rows = data ?? [];

  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">LỊCH SỬ THAY ĐỔI</p><h1>Đối chiếu thao tác</h1><p>100 thay đổi gần nhất trên doanh thu, chi phí, mục tiêu và ảnh.</p></div></div>
      {error ? <p className="form-error" role="alert">Chưa tải được lịch sử. Kiểm tra kết nối rồi thử lại.</p> : null}
      <section className="surface audit-list">
        {rows.length === 0 ? <p className="empty-inline">Chưa có thay đổi được ghi nhận.</p> : rows.map((row) => {
          const before = (row.before_data ?? {}) as Record<string, unknown>;
          const after = (row.after_data ?? {}) as Record<string, unknown>;
          const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !["id", "owner_id", "created_at", "updated_at"].includes(key));
          const changed = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
          const action = row.action === "INSERT" ? "Đã thêm" : row.action === "DELETE" ? "Đã xóa" : "Đã sửa";
          return <article className="audit-item" key={row.id}>
            <div className="audit-item-heading"><div><span className="status status-neutral">{action}</span><strong>{labels[row.table_name] ?? row.table_name}</strong></div><time dateTime={row.occurred_at}>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(row.occurred_at))}</time></div>
            <p className="audit-actor">{row.actor_type === "system" ? "Quản trị hệ thống" : "Chủ cửa hàng"}</p>
            {changed.length > 0 ? <dl className="audit-diff">{changed.map((field) => <div key={field}><dt>{labels[field] ?? field}</dt><dd>{before[field] === undefined ? "Mới" : displayValue(field, before[field])}<span aria-hidden="true"> → </span>{after[field] === undefined ? "Đã xóa" : displayValue(field, after[field])}</dd></div>)}</dl> : null}
          </article>;
        })}
      </section>
    </>
  );
}
