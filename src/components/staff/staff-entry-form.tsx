"use client";

import { useActionState, useCallback, useState } from "react";
import { saveStaffElectricityPeriodAction, saveStaffEntryAction, type StaffEntryActionState } from "@/app/(staff)/staff/actions";
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
  electricity_morning_status?: "recorded" | "unable" | null;
  electricity_morning_recorded_at?: string | null;
  electricity_morning_unavailable_reason?: string | null;
  electricity_morning_note?: string | null;
  electricity_evening_status?: "recorded" | "unable" | null;
  electricity_evening_recorded_at?: string | null;
  electricity_evening_unavailable_reason?: string | null;
  electricity_evening_note?: string | null;
  electricity_evening_turned_off_unneeded?: boolean | null;
  electricity_evening_checked_cooler_doors?: boolean | null;
  electricity_evening_meter_photo_confirmed?: boolean | null;
};

export type StaffElectricityDevice = {
  id: string;
  name: string;
  mode: "timed" | "continuous";
  sort_order: number;
};

export type StaffElectricityDeviceLog = {
  device_id: string;
  period: "morning" | "evening";
  device_name_snapshot: string;
  device_mode_snapshot: "timed" | "continuous";
  operating_status: "unrecorded" | "not_running" | "running";
  started_at: string | null;
  ended_at: string | null;
  ends_next_day: boolean;
  ran_from_previous_night: boolean | null;
  remains_on_after_close: boolean | null;
  note: string | null;
};

type ElectricityDeviceInput = {
  operating_status: "unrecorded" | "not_running" | "running";
  started_at: string;
  ended_at: string;
  ends_next_day: boolean;
  ran_from_previous_night: "" | "true" | "false";
  remains_on_after_close: "" | "true" | "false";
  note: string;
  changed_fields: ElectricityDeviceField[];
};

type ElectricityDeviceField = "operating_status" | "started_at" | "ended_at" | "ends_next_day" | "ran_from_previous_night" | "remains_on_after_close" | "note";

type ElectricityChecklistValue = { value: boolean | null; touched: boolean };
type ElectricityChecklist = {
  turned_off_unneeded: ElectricityChecklistValue;
  checked_cooler_doors: ElectricityChecklistValue;
  meter_photo_confirmed: ElectricityChecklistValue;
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

function AmountForm({ date, kind, channel, shiftCode, initial, label, optional, editable, state, action, pending }: {
  date: string;
  kind: "shift" | "platform_revenue";
  channel?: string;
  shiftCode?: string;
  initial: number | null;
  label: string;
  optional?: boolean;
  editable: boolean;
  state: StaffEntryActionState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState(initial == null ? "" : new Intl.NumberFormat("vi-VN").format(initial));
  return <div className="staff-amount-cell"><form className="staff-entry-form" action={action}>
    <input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value={kind} />
    {channel ? <input type="hidden" name="channel" value={channel} /> : null}{shiftCode ? <input type="hidden" name="shift_code" value={shiftCode} /> : null}
    <label className="field"><span>{label}</span><span className="input-suffix"><input name="amount_vnd" value={value} onChange={(event) => setValue(event.currentTarget.value)} inputMode="numeric" placeholder="0" disabled={!editable} /><span>đ</span></span>{optional ? <small className="field-helper">Không phát sinh thì để trống · tính 0 ₫.</small> : null}</label>
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

function boolSelectValue(value: boolean | null): "" | "true" | "false" {
  return value === null ? "" : value ? "true" : "false";
}

function ElectricityPeriodForm({
  date,
  period,
  devices,
  savedLogs,
  status: initialStatus,
  recordedAt: initialRecordedAt,
  meterKwh: initialMeterKwh,
  unavailableReason: initialUnavailableReason,
  note: initialNote,
  checklistValues,
  editable,
}: {
  date: string;
  period: "morning" | "evening";
  devices: StaffElectricityDevice[];
  savedLogs: StaffElectricityDeviceLog[];
  status: "recorded" | "unable" | null;
  recordedAt: string | null;
  meterKwh: number | null;
  unavailableReason: string | null;
  note: string | null;
  checklistValues: { turnedOffUnneeded: boolean | null; checkedCoolerDoors: boolean | null; meterPhotoConfirmed: boolean | null };
  editable: boolean;
}) {
  const [status, setStatus] = useState<"" | "recorded" | "unable">(initialStatus ?? "");
  const [recordedAt, setRecordedAt] = useState(initialRecordedAt?.slice(0, 5) ?? "");
  const [meterKwh, setMeterKwh] = useState(initialMeterKwh == null ? "" : String(initialMeterKwh));
  const [unavailableReason, setUnavailableReason] = useState(initialUnavailableReason ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [noteTouched, setNoteTouched] = useState(false);
  const logMap = new Map(savedLogs.map((log) => [log.device_id, log]));
  const [deviceInputs, setDeviceInputs] = useState<Record<string, ElectricityDeviceInput>>(() => Object.fromEntries(devices.map((device) => {
    const saved = logMap.get(device.id);
    return [device.id, {
      operating_status: saved?.operating_status ?? "unrecorded",
      started_at: saved?.started_at?.slice(0, 5) ?? "",
      ended_at: saved?.ended_at?.slice(0, 5) ?? "",
      ends_next_day: saved?.ends_next_day ?? false,
      ran_from_previous_night: boolSelectValue(saved?.ran_from_previous_night ?? null),
      remains_on_after_close: boolSelectValue(saved?.remains_on_after_close ?? null),
      note: saved?.note ?? "",
      changed_fields: [],
    }];
  })));
  const [checklist, setChecklist] = useState<ElectricityChecklist>(() => ({
    turned_off_unneeded: { value: checklistValues.turnedOffUnneeded, touched: false },
    checked_cooler_doors: { value: checklistValues.checkedCoolerDoors, touched: false },
    meter_photo_confirmed: { value: checklistValues.meterPhotoConfirmed, touched: false },
  }));
  const [meterFieldsTouched, setMeterFieldsTouched] = useState(false);
  const saveAndResetTouchedState = useCallback(async (previousState: StaffEntryActionState, formData: FormData) => {
    const result = await saveStaffElectricityPeriodAction(previousState, formData);
    if (result?.success) {
      setMeterFieldsTouched(false);
      setNoteTouched(false);
      setDeviceInputs((current) => Object.fromEntries(Object.entries(current).map(([id, input]) => [id, { ...input, changed_fields: [] }])));
      setChecklist((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, touched: false }])) as ElectricityChecklist);
    }
    return result;
  }, []);
  const [state, action, pending] = useActionState<StaffEntryActionState, FormData>(saveAndResetTouchedState, undefined);
  const canEdit = editable && !pending;

  const updateDevice = (deviceId: string, patch: Partial<ElectricityDeviceInput>) => {
    setDeviceInputs((current) => {
      const previous = current[deviceId];
      if (!previous) return current;
      const nextStatus = patch.operating_status;
      const fields = new Set<ElectricityDeviceField>([...previous.changed_fields, ...(Object.keys(patch) as ElectricityDeviceField[])]);
      const clearingTimes = nextStatus !== undefined && nextStatus !== "running";
      if (clearingTimes) {
        fields.add("started_at");
        fields.add("ended_at");
        fields.add("ends_next_day");
        fields.add(period === "morning" ? "ran_from_previous_night" : "remains_on_after_close");
      }
      return { ...current, [deviceId]: {
        ...previous,
        ...patch,
        ...(clearingTimes ? { started_at: "", ended_at: "", ends_next_day: false, ran_from_previous_night: "", remains_on_after_close: "" } : {}),
        changed_fields: [...fields],
      } };
    });
  };
  const serializedLogs = JSON.stringify(devices.filter((device) => (deviceInputs[device.id]?.changed_fields.length ?? 0) > 0).map((device) => {
    const input = deviceInputs[device.id];
    const saved = logMap.get(device.id);
    const effectiveMode = saved?.device_mode_snapshot ?? device.mode;
    const isRunning = input?.operating_status === "running";
    return {
      device_id: device.id,
      device_mode: effectiveMode,
      operating_status: input?.operating_status ?? "unrecorded",
      started_at: effectiveMode === "timed" && isRunning ? input?.started_at || null : null,
      ended_at: effectiveMode === "timed" && isRunning ? input?.ended_at || null : null,
      ends_next_day: period === "evening" && effectiveMode === "timed" && isRunning ? input?.ends_next_day ?? false : false,
      ran_from_previous_night: period === "morning" && isRunning && input?.ran_from_previous_night !== "" ? input?.ran_from_previous_night === "true" : null,
      remains_on_after_close: period === "evening" && isRunning && input?.remains_on_after_close !== "" ? input?.remains_on_after_close === "true" : null,
      note: input?.changed_fields.includes("note") ? input.note.trim() : null,
      changed_fields: input?.changed_fields ?? [],
    };
  }));
  const serializedChecklist = JSON.stringify(Object.fromEntries(Object.entries(checklist).map(([key, value]) => [key, value.touched ? value.value : null])));

  return <form className="staff-single-form electricity-period-form" action={action}>
    <input type="hidden" name="business_date" value={date} />
    <input type="hidden" name="kind" value="electricity_period" />
    <input type="hidden" name="period" value={period} />
    <input type="hidden" name="device_logs_json" value={serializedLogs} />
    <input type="hidden" name="checklist_json" value={serializedChecklist} />
    <input type="hidden" name="note_changed" value={noteTouched ? "true" : "false"} />
    <input type="hidden" name="meter_fields_changed" value={meterFieldsTouched ? "true" : "false"} />
    <div className="section-heading">
      <div><h4>{period === "morning" ? "Ca sáng" : "Ca tối"}</h4><p>{status === "recorded" ? "Đã ghi chỉ số" : status === "unable" ? "Cần xử lý · chưa ghi được" : "Chưa ghi nhận"}</p></div>
      <span className={`status ${status === "recorded" ? "status-success" : status === "unable" ? "status-warning" : "status-neutral"}`}>{status === "recorded" ? "Đã ghi" : status === "unable" ? "Cần xử lý" : "Chưa ghi"}</span>
    </div>
    <label className="field"><span>Tình trạng ghi chỉ số</span><select name="status" value={status} disabled={!canEdit} onChange={(event) => {
      const next = event.currentTarget.value as "" | "recorded" | "unable";
      setStatus(next);
      setMeterFieldsTouched(true);
      if (next !== "recorded") { setRecordedAt(""); setMeterKwh(""); }
      if (next !== "unable") setUnavailableReason("");
    }}><option value="">Chưa ghi</option><option value="recorded">Đã ghi</option><option value="unable">Không ghi nhận được</option></select></label>
    {status === "recorded" ? <div className="electricity-reading-grid">
      <label className="field"><span>Giờ ghi chỉ số</span><input name="recorded_at" type="time" value={recordedAt} onChange={(event) => { setRecordedAt(event.currentTarget.value); setMeterFieldsTouched(true); }} required disabled={!canEdit} /></label>
      <label className="field"><span>Chỉ số công tơ</span><span className="input-suffix"><input name="meter_kwh" type="number" min="0" step="0.001" inputMode="decimal" placeholder="Ví dụ: 15230.5" value={meterKwh} onChange={(event) => { setMeterKwh(event.currentTarget.value); setMeterFieldsTouched(true); }} required disabled={!canEdit} /><span>kWh</span></span></label>
    </div> : null}
    {status === "unable" ? <label className="field"><span>Lý do không ghi nhận được</span><textarea name="unavailable_reason" rows={2} maxLength={240} placeholder="Ví dụ: không tiếp cận được công tơ" value={unavailableReason} onChange={(event) => { setUnavailableReason(event.currentTarget.value); setMeterFieldsTouched(true); }} required disabled={!canEdit} /></label> : null}
    {initialMeterKwh !== null ? <div className="form-note">Đang có chỉ số cũ {new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(initialMeterKwh)} kWh. Không đổi gì để giữ lại; dùng nút dưới đây nếu muốn xóa chỉ số.<button className="text-button" type="button" disabled={!canEdit} onClick={() => { setStatus(""); setRecordedAt(""); setMeterKwh(""); setUnavailableReason(""); setMeterFieldsTouched(true); }}>Đưa về “Chưa ghi” và xóa chỉ số</button></div> : null}
    <section className="staff-entry-group">
      <div className="section-heading"><div><h3>Thiết bị trong {period === "morning" ? "ca sáng" : "ca tối"}</h3><p>{period === "morning" ? "Ghi nhận thiết bị còn chạy từ đêm trước và hoạt động trong ca." : "Ghi nhận thời gian hoạt động và thiết bị dự kiến để chạy qua đêm."}</p></div></div>
      {devices.length === 0 ? <p className="form-note">Chưa có thiết bị đang theo dõi.</p> : <div className="electricity-device-list">{devices.map((device) => {
        const input = deviceInputs[device.id];
        const saved = logMap.get(device.id);
        const effectiveName = saved?.device_name_snapshot ?? device.name;
        const effectiveMode = saved?.device_mode_snapshot ?? device.mode;
        return <div className="electricity-device-card" key={device.id} role="group" aria-label={effectiveName}>
          <div className="electricity-device-heading"><strong>{effectiveName}</strong><small>{effectiveMode === "timed" ? "Theo dõi giờ bật và tắt" : "Thiết bị chạy liên tục"}{saved && saved.device_name_snapshot !== device.name ? ` · tên danh mục hiện tại: ${device.name}` : ""}</small></div>
          <label className="field"><span>Trạng thái thiết bị</span><select value={input?.operating_status ?? "unrecorded"} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { operating_status: event.currentTarget.value as ElectricityDeviceInput["operating_status"] })}>
            <option value="unrecorded">Chưa ghi</option><option value="not_running">Không hoạt động</option><option value="running">Có hoạt động</option>
          </select></label>
          {effectiveMode === "timed" && input?.operating_status === "running" ? <div className="electricity-time-grid">
            <label className="field"><span>Giờ bật</span><input type="time" value={input.started_at} required disabled={!canEdit} onChange={(event) => updateDevice(device.id, { started_at: event.currentTarget.value })} /></label>
            <label className="field"><span>Giờ tắt</span><input type="time" value={input.ended_at} required disabled={!canEdit} onChange={(event) => updateDevice(device.id, { ended_at: event.currentTarget.value })} /></label>
            {period === "evening" ? <label className="inventory-checkbox"><input type="checkbox" checked={input.ends_next_day} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { ends_next_day: event.currentTarget.checked })} /><span>Giờ tắt sang ngày hôm sau</span></label> : null}
          </div> : effectiveMode === "continuous" && input?.operating_status === "running" ? <p className="form-note">Thiết bị được ghi nhận đang chạy liên tục trong kỳ này.</p> : null}
          {period === "morning" && input?.operating_status === "running" ? <label className="field"><span>Còn hoạt động từ đêm hôm trước?</span><select value={input?.ran_from_previous_night ?? ""} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { ran_from_previous_night: event.currentTarget.value as ElectricityDeviceInput["ran_from_previous_night"] })}><option value="">Chưa xác nhận</option><option value="true">Có</option><option value="false">Không</option></select></label> : period === "evening" && input?.operating_status === "running" ? <label className="field"><span>Dự kiến còn chạy sau khi đóng cửa?</span><select value={input?.remains_on_after_close ?? ""} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { remains_on_after_close: event.currentTarget.value as ElectricityDeviceInput["remains_on_after_close"] })}><option value="">Chưa xác nhận</option><option value="true">Có</option><option value="false">Không</option></select></label> : null}
          <label className="field"><span>Ghi chú thiết bị</span><input value={input?.note ?? ""} maxLength={240} placeholder="Không bắt buộc" disabled={!canEdit} onChange={(event) => updateDevice(device.id, { note: event.currentTarget.value })} /></label>
        </div>;
      })}</div>}
    </section>
    {period === "evening" ? <div className="staff-entry-group"><h3>Checklist chốt ca</h3>{([
      ["turned_off_unneeded", "Đã tắt thiết bị không cần thiết"],
      ["checked_cooler_doors", "Đã kiểm tra cửa tủ mát / tủ đông"],
      ["meter_photo_confirmed", "Đã chụp ảnh công tơ"],
    ] as const).map(([key, label]) => <label className="inventory-checkbox" key={key}><input type="checkbox" checked={checklist[key].value === true} disabled={!canEdit} onChange={(event) => setChecklist((current) => ({ ...current, [key]: { value: event.currentTarget.checked, touched: true } }))} /><span>{label}<small>{checklist[key].value === null ? "Chưa xác nhận" : checklist[key].value ? "Đã xác nhận" : "Chưa hoàn tất"}</small></span></label>)}</div> : null}
    <label className="field"><span>Ghi chú / bất thường</span><textarea name="note" rows={2} maxLength={500} placeholder="Thiết bị quên tắt, máy chạy bất thường, sự kiện trong ca…" value={note} onChange={(event) => { setNote(event.currentTarget.value); setNoteTouched(true); }} disabled={!canEdit} /></label>
    {editable ? <button className="button button-secondary" type="submit" disabled={!canEdit || pending}>{pending ? "Đang lưu…" : `Lưu ghi nhận ${period === "morning" ? "ca sáng" : "ca tối"}`}</button> : null}
    <Feedback state={state} />
  </form>;
}

export function StaffEntryForm({ date, record, editable, electricityEditable = editable, electricityDevices = [], electricityDeviceLogs = [], electricityLoadError = false }: {
  date: string;
  record: StaffRecord | null;
  editable: boolean;
  electricityEditable?: boolean;
  electricityDevices?: StaffElectricityDevice[];
  electricityDeviceLogs?: StaffElectricityDeviceLog[];
  electricityLoadError?: boolean;
}) {
  const [state, action, pending] = useActionState<StaffEntryActionState, FormData>(saveStaffEntryAction, undefined);
  const shiftValues = record ?? { shift_06_10_vnd: null, shift_10_14_vnd: null, shift_14_18_vnd: null, shift_18_22_vnd: null, grab_vnd: null, shopee_vnd: null, grab_order_count: 0, shopee_order_count: 0, total_bill_count: null, electricity_morning_kwh: null, electricity_evening_kwh: null };
  const shiftValuesOnly = [shiftValues.shift_06_10_vnd, shiftValues.shift_10_14_vnd, shiftValues.shift_14_18_vnd, shiftValues.shift_18_22_vnd];
  const complete = shiftValuesOnly.every((value) => value !== null);
  const total = complete ? [...shiftValuesOnly, shiftValues.grab_vnd ?? 0, shiftValues.shopee_vnd ?? 0].reduce((sum, value) => sum + (value ?? 0), 0) : null;
  return <section className="surface staff-entry-card">
    <div className="section-heading"><div><h2>Nhập doanh thu</h2><p>{editable ? "Mỗi ca lưu riêng; Grab và Shopee nhập cuối ngày nếu có phát sinh." : "Ngày đã qua chỉ xem lại, không thể sửa."}</p></div>{total === null ? <span className="status status-neutral">Chưa đủ 4 ca</span> : <strong>{formatVnd(total)}</strong>}</div>
    <div className="staff-entry-group"><h3>Bốn ca tại cửa hàng</h3><div className="staff-shift-grid">{shifts.map(([code, label], index) => <AmountForm key={code} date={date} kind="shift" shiftCode={code} initial={shiftValuesOnly[index]} label={`Ca ${label}`} editable={editable} state={state} action={action} pending={pending} />)}</div></div>
    <div className="staff-entry-group"><h3>Grab và Shopee · doanh thu cuối ngày</h3><div className="staff-shift-grid"><AmountForm date={date} kind="platform_revenue" channel="grab" initial={shiftValues.grab_vnd} label="Grab · doanh thu" optional editable={editable} state={state} action={action} pending={pending} /><AmountForm date={date} kind="platform_revenue" channel="shopee" initial={shiftValues.shopee_vnd} label="Shopee · doanh thu" optional editable={editable} state={state} action={action} pending={pending} /></div></div>
    <div className="staff-entry-group"><h3>Số đơn giao hàng</h3><div className="staff-shift-grid"><OrdersForm date={date} channel="grab" initial={shiftValues.grab_order_count} editable={editable} state={state} action={action} pending={pending} /><OrdersForm date={date} channel="shopee" initial={shiftValues.shopee_order_count} editable={editable} state={state} action={action} pending={pending} /></div></div>
    <div className="staff-entry-group"><h3>Tổng bill cuối ngày</h3><form className="staff-single-form" action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="total_bills" /><label className="field"><span>Tổng số bill của tất cả kênh</span><input name="count" defaultValue={shiftValues.total_bill_count == null ? "" : String(shiftValues.total_bill_count)} inputMode="numeric" placeholder="Nhập số đơn bán được" disabled={!editable} /></label><button className="button button-secondary" type="submit" disabled={!editable || pending}>{pending ? "Đang lưu…" : "Lưu tổng bill"}</button><Feedback state={state} /></form><p className="form-note">Tổng bill là số đơn bán được, bao gồm quầy, Grab và Shopee; hệ thống không tự cộng từ doanh thu.</p></div>
    <div className="staff-entry-group"><h3>Nhật ký điện theo ca</h3><p className="form-note">Thiếu thông tin điện không ảnh hưởng đến việc lưu doanh thu.</p>{electricityLoadError ? <p className="form-error" role="alert">Chưa tải đủ dữ liệu ca và nhật ký thiết bị. Doanh thu vẫn nhập được; hãy tải lại trang trước khi lưu phần điện.</p> : null}<div className="electricity-period-grid">
      <ElectricityPeriodForm date={date} period="morning" devices={electricityDevices} savedLogs={electricityDeviceLogs.filter((log) => log.period === "morning")} status={shiftValues.electricity_morning_status ?? null} recordedAt={shiftValues.electricity_morning_recorded_at ?? null} meterKwh={shiftValues.electricity_morning_kwh} unavailableReason={shiftValues.electricity_morning_unavailable_reason ?? null} note={shiftValues.electricity_morning_note ?? null} checklistValues={{ turnedOffUnneeded: null, checkedCoolerDoors: null, meterPhotoConfirmed: null }} editable={electricityEditable && !electricityLoadError} />
      <ElectricityPeriodForm date={date} period="evening" devices={electricityDevices} savedLogs={electricityDeviceLogs.filter((log) => log.period === "evening")} status={shiftValues.electricity_evening_status ?? null} recordedAt={shiftValues.electricity_evening_recorded_at ?? null} meterKwh={shiftValues.electricity_evening_kwh} unavailableReason={shiftValues.electricity_evening_unavailable_reason ?? null} note={shiftValues.electricity_evening_note ?? null} checklistValues={{ turnedOffUnneeded: shiftValues.electricity_evening_turned_off_unneeded ?? null, checkedCoolerDoors: shiftValues.electricity_evening_checked_cooler_doors ?? null, meterPhotoConfirmed: shiftValues.electricity_evening_meter_photo_confirmed ?? null }} editable={electricityEditable && !electricityLoadError} />
    </div></div>
  </section>;
}
