"use client";

import { startTransition, useActionState, useCallback, useState } from "react";
import { saveStaffElectricityPeriodAction, saveStaffEntryAction, type StaffEntryActionState } from "@/app/(staff)/staff/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { ElectricityBatchNavigation, ElectricityBatchProgress, ElectricityClosingChecklist, ElectricityPeriodTabs, useElectricityDeviceBatch } from "@/components/ledger/electricity-entry-controls";
import { ElectricityDeviceFields, ElectricityMeterFields, electricityDeviceInput, type ElectricityDeviceInput } from "@/components/ledger/electricity-input-fields";
import { normalizeElectricityTime } from "@/lib/electricity/time-input";
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
  onSavePendingChange,
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
  onSavePendingChange: (delta: number) => void;
}) {
  const [status, setStatus] = useState<"" | "recorded" | "unable">(initialStatus ?? "");
  const [recordedAt, setRecordedAt] = useState(initialRecordedAt?.slice(0, 5) ?? "");
  const [meterKwh, setMeterKwh] = useState(initialMeterKwh == null ? "" : String(initialMeterKwh));
  const [unavailableReason, setUnavailableReason] = useState(initialUnavailableReason ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [noteTouched, setNoteTouched] = useState(false);
  const logMap = new Map(savedLogs.map((log) => [log.device_id, log]));
  const deviceBatch = useElectricityDeviceBatch(devices);
  const [deviceInputs, setDeviceInputs] = useState<Record<string, ElectricityDeviceInput>>(() => Object.fromEntries(devices.map((device) => [device.id, electricityDeviceInput(logMap.get(device.id))])));
  const [checklist, setChecklist] = useState<ElectricityChecklist>(() => ({
    turned_off_unneeded: { value: checklistValues.turnedOffUnneeded, touched: false },
    checked_cooler_doors: { value: checklistValues.checkedCoolerDoors, touched: false },
    meter_photo_confirmed: { value: checklistValues.meterPhotoConfirmed, touched: false },
  }));
  const [meterFieldsTouched, setMeterFieldsTouched] = useState(false);
  const saveAndResetTouchedState = useCallback(async (previousState: StaffEntryActionState, formData: FormData) => {
    try {
      const result = await saveStaffElectricityPeriodAction(previousState, formData);
      if (result?.success) {
        setMeterFieldsTouched(false);
        setNoteTouched(false);
        setDeviceInputs((current) => Object.fromEntries(Object.entries(current).map(([id, input]) => [id, deviceBatch.deviceIds.includes(id) ? { ...input, changed_fields: [] } : input])));
        if (deviceBatch.isLast) setChecklist((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, touched: false }])) as ElectricityChecklist);
        else {
          deviceBatch.next();
          return { success: "Đã lưu nhóm thiết bị. Tiếp tục nhập nhóm kế tiếp." };
        }
      }
      return result;
    } catch {
      return { error: "Chưa lưu được nhật ký điện. Dữ liệu vừa nhập vẫn được giữ để bạn thử lại." };
    } finally {
      onSavePendingChange(-1);
    }
  }, [deviceBatch, onSavePendingChange]);
  const [state, action, pending] = useActionState<StaffEntryActionState, FormData>(saveAndResetTouchedState, undefined);
  const canEdit = editable && !pending;

  const updateDevice = (deviceId: string, patch: Partial<ElectricityDeviceInput>) => {
    setDeviceInputs((current) => {
      const previous = current[deviceId] ?? electricityDeviceInput(logMap.get(deviceId));
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
  const serializedLogs = JSON.stringify(deviceBatch.visibleDevices.filter((device) => (deviceInputs[device.id]?.changed_fields.length ?? 0) > 0).map((device) => {
    const input = deviceInputs[device.id];
    const saved = logMap.get(device.id);
    const effectiveMode = saved?.device_mode_snapshot ?? device.mode;
    const isRunning = input?.operating_status === "running";
    return {
      device_id: device.id,
      device_mode: effectiveMode,
      operating_status: input?.operating_status ?? "unrecorded",
      started_at: effectiveMode === "timed" && isRunning ? normalizeElectricityTime(input?.started_at ?? "") ?? (input?.started_at || null) : null,
      ended_at: effectiveMode === "timed" && isRunning ? normalizeElectricityTime(input?.ended_at ?? "") ?? (input?.ended_at || null) : null,
      ends_next_day: period === "evening" && effectiveMode === "timed" && isRunning ? input?.ends_next_day ?? false : false,
      ran_from_previous_night: period === "morning" && isRunning && input?.ran_from_previous_night !== "" ? input?.ran_from_previous_night === "true" : null,
      remains_on_after_close: period === "evening" && isRunning && input?.remains_on_after_close !== "" ? input?.remains_on_after_close === "true" : null,
      note: input?.changed_fields.includes("note") ? input.note.trim() : null,
      changed_fields: input?.changed_fields ?? [],
    };
  }));
  const serializedChecklist = JSON.stringify(Object.fromEntries(Object.entries(checklist).map(([key, value]) => [key, deviceBatch.isLast && value.touched ? value.value : null])));

  return <form className="staff-single-form electricity-period-form" onSubmit={(event) => {
    event.preventDefault();
    if (!canEdit) return;
    // Dispatch manually so a failed save cannot reset the controlled draft fields.
    const formData = new FormData(event.currentTarget);
    onSavePendingChange(1);
    startTransition(() => action(formData));
  }}>
    <input type="hidden" name="business_date" value={date} />
    <input type="hidden" name="kind" value="electricity_period" />
    <input type="hidden" name="period" value={period} />
    <input type="hidden" name="device_logs_json" value={serializedLogs} />
    <input type="hidden" name="checklist_json" value={serializedChecklist} />
    <input type="hidden" name="note_changed" value={noteTouched ? "true" : "false"} />
    <input type="hidden" name="meter_fields_changed" value={meterFieldsTouched ? "true" : "false"} />
    <ElectricityMeterFields period={period} value={{ status, recordedAt, meterKwh, unavailableReason }} changed={meterFieldsTouched} disabled={!canEdit} onChange={(value) => {
      setStatus(value.status); setRecordedAt(value.recordedAt); setMeterKwh(value.meterKwh); setUnavailableReason(value.unavailableReason); setMeterFieldsTouched(true);
    }} />
    {initialMeterKwh !== null && initialStatus == null && !meterFieldsTouched ? <p className="form-note">Chỉ số cũ chưa có giờ ghi. Bổ sung giờ nếu cần; không thay đổi để giữ nguyên số liệu.</p> : null}
    <section className="staff-entry-group">
      <div className="section-heading"><div><h3>Thiết bị trong {period === "morning" ? "ca sáng" : "ca tối"}</h3><p>Chọn thiết bị có dùng, rồi nhập giờ bật / tắt thực tế.</p></div></div>
      <ElectricityBatchProgress batch={deviceBatch} />
      {devices.length === 0 ? <p className="form-note">Chưa có thiết bị đang theo dõi.</p> : <div className="electricity-device-list">{deviceBatch.visibleDevices.map((device) => {
        const input = deviceInputs[device.id] ?? electricityDeviceInput(logMap.get(device.id));
        const saved = logMap.get(device.id);
        const effectiveName = saved?.device_name_snapshot ?? device.name;
        const effectiveMode = saved?.device_mode_snapshot ?? device.mode;
        return input ? <ElectricityDeviceFields key={device.id} name={effectiveName} catalogName={device.name} mode={effectiveMode} period={period} value={input} disabled={!canEdit} onChange={(patch) => updateDevice(device.id, patch)} /> : null;
      })}</div>}
    </section>
    {period === "evening" && deviceBatch.isLast ? <ElectricityClosingChecklist values={checklist} disabled={!canEdit} onChange={(key, checked) => setChecklist((current) => ({ ...current, [key]: { value: checked, touched: true } }))} /> : null}
    <details className="electricity-note-disclosure"><summary>{note ? "Xem / sửa ghi chú ca" : "Ghi chú ca / bất thường (nếu có)"}</summary><label className="field"><span>Ghi chú ca</span><textarea name="note" rows={2} maxLength={500} placeholder="Thiết bị quên tắt, máy chạy bất thường…" value={note} onChange={(event) => { setNote(event.currentTarget.value); setNoteTouched(true); }} disabled={!canEdit} /></label></details>
    <ElectricityBatchNavigation batch={deviceBatch} period={period} canSave={editable} busy={pending} />
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
  const [electricitySavingCount, setElectricitySavingCount] = useState(0);
  const onElectricitySavePendingChange = useCallback((delta: number) => setElectricitySavingCount((current) => Math.max(0, current + delta)), []);
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
    <div className="staff-entry-group"><h3>Nhật ký điện theo ca</h3><p className="form-note">Mỗi lượt nhập 2 thiết bị; lưu để chuyển sang nhóm tiếp theo.</p>{electricityLoadError ? <p className="form-error" role="alert">Chưa tải đủ dữ liệu ca và nhật ký thiết bị. Doanh thu vẫn nhập được; hãy tải lại trang trước khi lưu phần điện.</p> : null}<ElectricityPeriodTabs disabled={electricitySavingCount > 0}
      morning={<ElectricityPeriodForm date={date} period="morning" devices={electricityDevices} savedLogs={electricityDeviceLogs.filter((log) => log.period === "morning")} status={shiftValues.electricity_morning_status ?? null} recordedAt={shiftValues.electricity_morning_recorded_at ?? null} meterKwh={shiftValues.electricity_morning_kwh} unavailableReason={shiftValues.electricity_morning_unavailable_reason ?? null} note={shiftValues.electricity_morning_note ?? null} checklistValues={{ turnedOffUnneeded: null, checkedCoolerDoors: null, meterPhotoConfirmed: null }} editable={electricityEditable && !electricityLoadError} onSavePendingChange={onElectricitySavePendingChange} />}
      evening={<ElectricityPeriodForm date={date} period="evening" devices={electricityDevices} savedLogs={electricityDeviceLogs.filter((log) => log.period === "evening")} status={shiftValues.electricity_evening_status ?? null} recordedAt={shiftValues.electricity_evening_recorded_at ?? null} meterKwh={shiftValues.electricity_evening_kwh} unavailableReason={shiftValues.electricity_evening_unavailable_reason ?? null} note={shiftValues.electricity_evening_note ?? null} checklistValues={{ turnedOffUnneeded: shiftValues.electricity_evening_turned_off_unneeded ?? null, checkedCoolerDoors: shiftValues.electricity_evening_checked_cooler_doors ?? null, meterPhotoConfirmed: shiftValues.electricity_evening_meter_photo_confirmed ?? null }} editable={electricityEditable && !electricityLoadError} onSavePendingChange={onElectricitySavePendingChange} />}
    /></div>
  </section>;
}
