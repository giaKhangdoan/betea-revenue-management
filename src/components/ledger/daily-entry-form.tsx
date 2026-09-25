"use client";

import { useActionState } from "react";
import { saveDailyRecord, type EntryActionState } from "@/app/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";

type DailyRecord = {
  business_status?: string | null;
  shift_06_10_vnd?: number | null;
  shift_10_14_vnd?: number | null;
  shift_14_18_vnd?: number | null;
  shift_18_22_vnd?: number | null;
  grab_vnd?: number | null;
  shopee_vnd?: number | null;
  electricity_morning_kwh?: number | string | null;
  electricity_evening_kwh?: number | string | null;
  cleaning_done?: boolean | null;
  arrangement_done?: boolean | null;
  note?: string | null;
};

const fields = [
  { name: "shift_06_10_vnd", label: "Ca sáng · 06:00–10:00" },
  { name: "shift_10_14_vnd", label: "Ca 10:00–14:00" },
  { name: "shift_14_18_vnd", label: "Ca 14:00–18:00" },
  { name: "shift_18_22_vnd", label: "Ca tối · 18:00–22:00" },
  { name: "grab_vnd", label: "Grab · tổng ngày" },
  { name: "shopee_vnd", label: "Shopee · tổng ngày" },
] as const;

export function DailyEntryForm({ date, record }: { date: string; record: DailyRecord | null }) {
  const [state, formAction, pending] = useActionState<EntryActionState, FormData>(saveDailyRecord, undefined);

  return (
    <form action={formAction} className="entry-form surface">
      <div className="section-heading">
        <div><h2>Doanh thu trong ngày</h2><p>Nhập doanh thu cuối cùng của từng ca và hai kênh giao hàng.</p></div>
      </div>
      <input type="hidden" name="business_date" value={date} />
      <div className="entry-grid">
        {fields.map((field) => (
          <label className="field" key={field.name}>
            <span>{field.label}</span>
            <span className="input-suffix"><input name={field.name} type="text" inputMode="numeric" placeholder="Ví dụ: 1.250.000" defaultValue={record?.[field.name] == null ? "" : new Intl.NumberFormat("vi-VN").format(record[field.name]!)} aria-label={`${field.label}, đơn vị đồng`} /><span>đ</span></span>
          </label>
        ))}
      </div>
      <div className="field status-field">
        <label htmlFor="business_status">Trạng thái ngày</label>
        <select id="business_status" name="business_status" defaultValue={record?.business_status ?? "open"}>
          <option value="open">Đang nhập</option>
          <option value="closed">Đã chốt · cần đủ 6 khoản doanh thu</option>
          <option value="no_business">Không kinh doanh · doanh thu bằng 0</option>
        </select>
      </div>
      <div className="entry-grid entry-support-grid">
        <label className="field"><span>Chỉ số điện · ca sáng</span><span className="input-suffix"><input name="electricity_morning_kwh" type="number" min="0" step="0.001" inputMode="decimal" placeholder="Nhập số công tơ" defaultValue={record?.electricity_morning_kwh ?? ""} /><span>kWh</span></span></label>
        <label className="field"><span>Chỉ số điện · ca tối</span><span className="input-suffix"><input name="electricity_evening_kwh" type="number" min="0" step="0.001" inputMode="decimal" placeholder="Nhập số công tơ" defaultValue={record?.electricity_evening_kwh ?? ""} /><span>kWh</span></span></label>
        <label className="field"><span>Đã vệ sinh</span><select name="cleaning_done" defaultValue={record?.cleaning_done == null ? "" : record.cleaning_done ? "yes" : "no"}><option value="">Chưa xác nhận</option><option value="yes">Đã vệ sinh</option><option value="no">Chưa vệ sinh</option></select></label>
        <label className="field"><span>Đã sắp xếp</span><select name="arrangement_done" defaultValue={record?.arrangement_done == null ? "" : record.arrangement_done ? "yes" : "no"}><option value="">Chưa xác nhận</option><option value="yes">Đã sắp xếp</option><option value="no">Chưa sắp xếp</option></select></label>
      </div>
      <label className="field"><span>Ghi chú</span><textarea name="note" rows={2} maxLength={1000} placeholder="Ghi chú đối soát, chương trình hoặc diễn biến trong ngày" defaultValue={record?.note ?? ""} /></label>
      <p className="form-note">Các khoản được lưu riêng để dễ đối chiếu. Ngày chưa nhập đủ sẽ không bị tính thành 0.</p>
      <ActionMessage error={state?.error} success={state?.success} />
      <div className="form-actions"><button className="button" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu doanh thu ngày"}</button></div>
    </form>
  );
}
