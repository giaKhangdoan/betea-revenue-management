import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StaffEntryForm, type StaffElectricityDevice, type StaffElectricityDeviceLog } from "@/components/staff/staff-entry-form";
import { StaffExpenseManager } from "@/components/staff/staff-expense-manager";
import { PhotoManager } from "@/components/ledger/photo-manager";
import { addDays, currentBusinessDate, formatBusinessDate, weekStart } from "@/lib/finance/format";
import { requireStaff } from "@/lib/auth/require-staff";
import { createEvidencePhotoUrl } from "@/lib/storage/photo-url";

export const dynamic = "force-dynamic";

function validDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date >= "2026-09-01";
}

export default async function StaffEntryPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!validDate(date)) notFound();
  const staff = await requireStaff();
  if (!staff) redirect("/login");
  const today = currentBusinessDate();
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  if (date < monday || date > sunday) redirect("/staff/dashboard");

  const [recordResult, expensesResult, photosResult, devicesResult, electricityLogsResult] = await Promise.all([
    staff.supabase.from("daily_records").select("business_date,shift_06_10_vnd,shift_10_14_vnd,shift_14_18_vnd,shift_18_22_vnd,grab_vnd,shopee_vnd,grab_order_count,shopee_order_count,total_bill_count,electricity_morning_kwh,electricity_evening_kwh,electricity_morning_status,electricity_morning_recorded_at,electricity_morning_unavailable_reason,electricity_morning_note,electricity_evening_status,electricity_evening_recorded_at,electricity_evening_unavailable_reason,electricity_evening_note,electricity_evening_turned_off_unneeded,electricity_evening_checked_cooler_doors,electricity_evening_meter_photo_confirmed").eq("owner_id", staff.ownerId).eq("business_date", date).maybeSingle(),
    staff.supabase.from("daily_expenses").select("id,amount_vnd,reason,created_at").eq("owner_id", staff.ownerId).eq("business_date", date).is("deleted_at", null).order("created_at", { ascending: false }),
    staff.supabase.from("day_photos").select("id,category,shift_code,electricity_period,object_path,storage_provider,caption,created_at").eq("owner_id", staff.ownerId).eq("business_date", date).order("created_at", { ascending: false }),
    staff.supabase.from("electricity_devices").select("id,name,mode,sort_order").eq("owner_id", staff.ownerId).eq("is_active", true).order("sort_order", { ascending: true }),
    staff.supabase.from("daily_electricity_device_logs").select("device_id,period,device_name_snapshot,device_mode_snapshot,operating_status,started_at,ended_at,ends_next_day,ran_from_previous_night,remains_on_after_close,note").eq("owner_id", staff.ownerId).eq("business_date", date),
  ]);
  const record = recordResult.data;
  const expenses = expensesResult.data;
  const photoRows = photosResult.data;
  const electricityLoadError = Boolean(recordResult.error || devicesResult.error || electricityLogsResult.error);
  const editable = date === today;
  const photos = await Promise.all((photoRows ?? []).map(async (photo) => {
    const signedUrl = await createEvidencePhotoUrl(staff.supabase, photo);
    return signedUrl ? { ...photo, signed_url: signedUrl } : null;
  }));

  return <>
    <div className="page-heading staff-page-heading"><div><p className="eyebrow">SỔ NGÀY NHÂN VIÊN</p><h1>{formatBusinessDate(date)}</h1><p>{editable ? "Nhập từng ca ngay sau khi bàn giao." : "Số liệu của ngày này chỉ được xem lại."}</p></div><Link className="button button-secondary" href="/staff/dashboard">Về tuần hiện tại</Link></div>
    {!editable ? <div className="login-config" role="status">Ngày đã qua hoặc chưa đến. Nhân viên không thể thay đổi số liệu của ngày này.</div> : null}
    <div className="staff-entry-layout"><div><StaffEntryForm date={date} record={record as never} editable={editable} electricityEditable={editable} electricityDevices={(devicesResult.data ?? []) as StaffElectricityDevice[]} electricityDeviceLogs={(electricityLogsResult.data ?? []) as StaffElectricityDeviceLog[]} electricityLoadError={electricityLoadError} /><StaffExpenseManager date={date} expenses={(expenses ?? []) as never} editable={editable} /><PhotoManager ownerId={staff.ownerId} date={date} initialPhotos={photos.filter((photo): photo is NonNullable<typeof photo> => photo !== null)} canDelete={false} canUpload={editable} /></div><aside className="staff-entry-aside"><section className="surface staff-help-card"><h2>Cách nhập nhanh</h2><ol><li>Nhập doanh thu ngay sau mỗi ca.</li><li>Grab và Shopee nhập doanh thu, số đơn vào cuối ngày.</li><li>Tổng bill là số đơn của tất cả kênh.</li><li>Chỉ số điện nhập theo ca sáng và ca tối.</li></ol></section><section className="surface staff-help-card"><h2>Quyền của ngày</h2><p>{editable ? "Bạn có thể nhập và bổ sung dữ liệu trong ngày hôm nay." : "Ngày này chỉ xem lại. Chỉ chủ cửa hàng mới có thể chỉnh sửa sau khi ngày đã qua."}</p></section></aside></div>
  </>;
}
