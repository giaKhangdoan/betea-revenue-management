"use client";

import { useActionState, useState } from "react";
import { saveStaffEntryAction, type StaffEntryActionState } from "@/app/(staff)/staff/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatVnd } from "@/lib/finance/format";

type StaffRecord = {
  shift_06_10_vnd: number | null;
  shift_10_14_vnd: number | null;
  shift_14_18_vnd: number | null;
  shift_18_22_vnd: number | null;
  grab_vnd: number | null;
  shopee_vnd: number | null;
  grab_order_count: number;
  shopee_order_count: number;
  total_bill_count: number | null;
  electricity_morning_kwh: number | null;
  electricity_evening_kwh: number | null;
};

const shifts = [
  ["06-10", "06:00–10:00", "shift_06_10_vnd"],
  ["10-14", "10:00–14:00", "shift_10_14_vnd"],
  ["14-18", "14:00–18:00", "shift_14_18_vnd"],
  ["18-22", "18:00–22:00", "shift_18_22_vnd"],
] as const;

function Feedback({ state }: { state: StaffEntryActionState }) {
  return <ActionMessage error={state?.error} success={state?.success} />;
}

function AmountForm({ date, kind, channel, shiftCode, initial, label, editable, state, action, pending }: {
  date: string;
  kind: "shift" | "platform_revenue";
  channel?: string;
  shiftCode?: string;
  initial: number | null;
  label: string;
  editable: boolean;
  state: StaffEntryActionState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState(initial == null ? "" : new Intl.NumberFormat("vi-VN").format(initial));
  return <div className="staff-amount-cell"><form className="staff-entry-form" action={action}>
    <input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value={kind} />
    {channel ? <input type="hidden" name="channel" value={channel} /> : null}{shiftCode ? <input type="hidden" name="shift_code" value={shiftCode} /> : null}
    <label className="field"><span>{label}</span><span className="input-suffix"><input name="amount_vnd" value={value} onChange={(event) => setValue(event.currentTarget.value)} inputMode="numeric" placeholder="0" disabled={!editable} /><span>đ</span></span></label>
    <button className="button button-secondary" type="submit" disabled={!editable || pending}>{pending ? "Đang lưu…" : "Lưu"}</button>
    <Feedback state={state} />
  </form>{kind === "shift" && shiftCode && initial !== null ? <form className="staff-inline-delete" action={action} onSubmit={(event) => { if (!window.confirm(`Xóa doanh thu ${label}? Chủ cửa hàng vẫn có thể xem lịch sử.`)) event.preventDefault(); }}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="shift_delete" /><input type="hidden" name="shift_code" value={shiftCode} /><button className="text-button text-button-danger" type="submit" disabled={!editable || pending}>Xóa ca</button></form> : null}</div>;
}

function OrdersForm({ date, channel, initial, editable, state, action, pending }: { date: string; channel: "grab" | "shopee"; initial: number; editable: boolean; state: StaffEntryActionState; action: (formData: FormData) => void; pending: boolean }) {
  const [mode, setMode] = useState<"increment" | "set">("increment");
  const [count, setCount] = useState("");
  return <div className="staff-order-box"><div className="staff-order-current"><span>{channel === "grab" ? "Grab" : "Shopee"} · số đơn hiện tại</span><strong>{initial}</strong></div><form className="staff-entry-form" action={action}>
    <input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="platform_orders" /><input type="hidden" name="channel" value={channel} /><input type="hidden" name="mode" value={mode} />
    <label className="field"><span>{mode === "increment" ? "Số đơn cộng thêm" : "Số đơn chốt cuối ngày"}</span><input name="count" value={count} onChange={(event) => setCount(event.currentTarget.value)} inputMode="numeric" placeholder="0" disabled={!editable} /></label>
    <div className="staff-order-actions"><select value={mode} onChange={(event) => setMode(event.currentTarget.value as "increment" | "set")} disabled={!editable}><option value="increment">Cộng thêm</option><option value="set">Nhập số chốt</option></select><button className="button button-secondary" type="submit" disabled={!editable || pending}>{pending ? "Đang lưu…" : "Lưu số đơn"}</button></div>
    <Feedback state={state} />
  </form></div>;
}

export function StaffEntryForm({ date, record, editable }: { date: string; record: StaffRecord | null; editable: boolean }) {
  const [state, action, pending] = useActionState<StaffEntryActionState, FormData>(saveStaffEntryAction, undefined);
  const shiftValues = record ?? { shift_06_10_vnd: null, shift_10_14_vnd: null, shift_14_18_vnd: null, shift_18_22_vnd: null, grab_vnd: null, shopee_vnd: null, grab_order_count: 0, shopee_order_count: 0, total_bill_count: null, electricity_morning_kwh: null, electricity_evening_kwh: null };
  const values = [shiftValues.shift_06_10_vnd, shiftValues.shift_10_14_vnd, shiftValues.shift_14_18_vnd, shiftValues.shift_18_22_vnd, shiftValues.grab_vnd, shiftValues.shopee_vnd];
  const complete = values.every((value) => value !== null);
  const total = complete ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
  return <section className="surface staff-entry-card">
    <div className="section-heading"><div><h2>Nhập doanh thu</h2><p>{editable ? "Mỗi ca lưu riêng; Grab và Shopee nhập tổng vào cuối ngày." : "Ngày đã qua chỉ xem lại, không thể sửa."}</p></div>{total === null ? <span className="status status-neutral">Chưa đủ 6 khoản</span> : <strong>{formatVnd(total)}</strong>}</div>
    <div className="staff-entry-group"><h3>Bốn ca tại cửa hàng</h3><div className="staff-shift-grid">{shifts.map(([code, label], index) => <AmountForm key={code} date={date} kind="shift" shiftCode={code} initial={values[index]} label={`Ca ${label}`} editable={editable} state={state} action={action} pending={pending} />)}</div></div>
    <div className="staff-entry-group"><h3>Grab và Shopee · doanh thu cuối ngày</h3><div className="staff-shift-grid"><AmountForm date={date} kind="platform_revenue" channel="grab" initial={shiftValues.grab_vnd} label="Grab · doanh thu" editable={editable} state={state} action={action} pending={pending} /><AmountForm date={date} kind="platform_revenue" channel="shopee" initial={shiftValues.shopee_vnd} label="Shopee · doanh thu" editable={editable} state={state} action={action} pending={pending} /></div></div>
    <div className="staff-entry-group"><h3>Số đơn giao hàng</h3><div className="staff-shift-grid"><OrdersForm date={date} channel="grab" initial={shiftValues.grab_order_count} editable={editable} state={state} action={action} pending={pending} /><OrdersForm date={date} channel="shopee" initial={shiftValues.shopee_order_count} editable={editable} state={state} action={action} pending={pending} /></div></div>
    <div className="staff-entry-group"><h3>Tổng bill cuối ngày</h3><form className="staff-single-form" action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="total_bills" /><label className="field"><span>Tổng số bill của tất cả kênh</span><input name="count" defaultValue={shiftValues.total_bill_count == null ? "" : String(shiftValues.total_bill_count)} inputMode="numeric" placeholder="Nhập số đơn bán được" disabled={!editable} /></label><button className="button button-secondary" type="submit" disabled={!editable || pending}>{pending ? "Đang lưu…" : "Lưu tổng bill"}</button><Feedback state={state} /></form><p className="form-note">Tổng bill là số đơn bán được, bao gồm quầy, Grab và Shopee; hệ thống không tự cộng từ doanh thu.</p></div>
    <div className="staff-entry-group"><h3>Chỉ số điện trong ngày</h3><form className="staff-single-form" action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="meters" /><div className="staff-shift-grid"><label className="field"><span>Ca sáng</span><input name="morning_kwh" defaultValue={shiftValues.electricity_morning_kwh == null ? "" : String(shiftValues.electricity_morning_kwh)} type="number" min="0" step="0.001" inputMode="decimal" disabled={!editable} /></label><label className="field"><span>Ca tối</span><input name="evening_kwh" defaultValue={shiftValues.electricity_evening_kwh == null ? "" : String(shiftValues.electricity_evening_kwh)} type="number" min="0" step="0.001" inputMode="decimal" disabled={!editable} /></label></div><button className="button button-secondary" type="submit" disabled={!editable || pending}>{pending ? "Đang lưu…" : "Lưu chỉ số điện"}</button><Feedback state={state} /></form><p className="form-note">Nhân viên chỉ nhập số công tơ. Phần tiêu thụ, chênh lệch qua đêm và tiền điện do chủ cửa hàng đối chiếu.</p></div>
  </section>;
}
