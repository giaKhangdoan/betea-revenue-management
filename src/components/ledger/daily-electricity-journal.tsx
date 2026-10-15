"use client";

import { useActionState, useCallback, useState } from "react";
import { saveOwnerElectricityDeviceAction, saveOwnerElectricityPeriod, type EntryActionState } from "@/app/(private)/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { calculateDailyElectricityUsage } from "@/lib/finance/calculations";

export type OwnerElectricityDevice = {
  id: string;
  name: string;
  mode: "timed" | "continuous";
  sort_order: number;
  is_active: boolean;
};

export type OwnerElectricityDeviceLog = {
  device_id: string;
  period: "morning" | "evening";
  device_name_snapshot: string;
  device_mode_snapshot: "timed" | "continuous";
  operating_status: "not_running" | "running";
  started_at: string | null;
  ended_at: string | null;
  ends_next_day: boolean;
  ran_from_previous_night: boolean | null;
  remains_on_after_close: boolean | null;
  note: string | null;
};

type ElectricityRecord = {
  electricity_morning_kwh?: number | string | null;
  electricity_evening_kwh?: number | string | null;
  electricity_reset_reason?: string | null;
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

type DeviceInput = {
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

type ChecklistValue = { value: boolean | null; touched: boolean };
type ChecklistState = {
  turned_off_unneeded: ChecklistValue;
  checked_cooler_doors: ChecklistValue;
  meter_photo_confirmed: ChecklistValue;
};

function boolSelectValue(value: boolean | null): "" | "true" | "false" {
  return value === null ? "" : value ? "true" : "false";
}

function parseChecklistValue(value: boolean | null | undefined): ChecklistValue {
  return { value: value ?? null, touched: false };
}

function formatKwh(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(parsed)} kWh` : "—";
}

function ElectricityPeriodForm({
  date,
  period,
  record,
  devices,
  savedLogs,
  resetReason,
  resetReasonTouched,
  setResetReasonTouched,
  savingCount,
  onSavePendingChange,
  isHistorical,
  loadError,
}: {
  date: string;
  period: "morning" | "evening";
  record: ElectricityRecord;
  devices: OwnerElectricityDevice[];
  savedLogs: OwnerElectricityDeviceLog[];
  resetReason: string;
  resetReasonTouched: boolean;
  setResetReasonTouched: (touched: boolean) => void;
  savingCount: number;
  onSavePendingChange: (delta: number) => void;
  isHistorical: boolean;
  loadError: boolean;
}) {
  const initialStatus = period === "morning" ? record.electricity_morning_status : record.electricity_evening_status;
  const initialTime = period === "morning" ? record.electricity_morning_recorded_at : record.electricity_evening_recorded_at;
  const initialKwh = period === "morning" ? record.electricity_morning_kwh : record.electricity_evening_kwh;
  const initialUnavailableReason = period === "morning" ? record.electricity_morning_unavailable_reason : record.electricity_evening_unavailable_reason;
  const initialNote = period === "morning" ? record.electricity_morning_note : record.electricity_evening_note;
  const [status, setStatus] = useState<"" | "recorded" | "unable">(initialStatus ?? "");
  const [recordedAt, setRecordedAt] = useState(initialTime?.slice(0, 5) ?? "");
  const [meterKwh, setMeterKwh] = useState(initialKwh == null ? "" : String(initialKwh));
  const [unavailableReason, setUnavailableReason] = useState(initialUnavailableReason ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [noteTouched, setNoteTouched] = useState(false);
  const [editReason, setEditReason] = useState("");
  const logMap = new Map(savedLogs.map((log) => [log.device_id, log]));
  const activeDevices = devices.filter((device) => device.is_active);
  const [deviceInputs, setDeviceInputs] = useState<Record<string, DeviceInput>>(() => Object.fromEntries(activeDevices.map((device) => {
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
  const [checklist, setChecklist] = useState<ChecklistState>(() => ({
    turned_off_unneeded: parseChecklistValue(record.electricity_evening_turned_off_unneeded),
    checked_cooler_doors: parseChecklistValue(record.electricity_evening_checked_cooler_doors),
    meter_photo_confirmed: parseChecklistValue(record.electricity_evening_meter_photo_confirmed),
  }));
  const [meterFieldsTouched, setMeterFieldsTouched] = useState(false);
  const saveAndResetTouchedState = useCallback(async (previousState: EntryActionState, formData: FormData) => {
    onSavePendingChange(1);
    try {
      const result = await saveOwnerElectricityPeriod(previousState, formData);
      if (result?.success) {
        setMeterFieldsTouched(false);
        setNoteTouched(false);
        setResetReasonTouched(false);
        setDeviceInputs((current) => Object.fromEntries(Object.entries(current).map(([id, input]) => [id, { ...input, changed_fields: [] }])));
        setChecklist((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, touched: false }])) as ChecklistState);
      }
      return result;
    } finally {
      onSavePendingChange(-1);
    }
  }, [onSavePendingChange, setResetReasonTouched]);
  const [state, action, pending] = useActionState<EntryActionState, FormData>(saveAndResetTouchedState, undefined);
  const updateDevice = (deviceId: string, patch: Partial<DeviceInput>) => {
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
  const serializedLogs = JSON.stringify(activeDevices.filter((device) => (deviceInputs[device.id]?.changed_fields.length ?? 0) > 0).map((device) => {
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
  const canEdit = !loadError && savingCount === 0;
  const legacyReadingNeedsReview = status === "" && initialStatus == null && initialKwh != null;

  return <form className="staff-single-form" action={action}>
    <input type="hidden" name="business_date" value={date} />
    <input type="hidden" name="period" value={period} />
    <input type="hidden" name="reset_reason" value={resetReason} />
    <input type="hidden" name="reset_reason_changed" value={resetReasonTouched ? "true" : "false"} />
    <input type="hidden" name="note_changed" value={noteTouched ? "true" : "false"} />
    <input type="hidden" name="meter_fields_changed" value={meterFieldsTouched ? "true" : "false"} />
    <input type="hidden" name="device_logs_json" value={serializedLogs} />
    <input type="hidden" name="checklist_json" value={serializedChecklist} />
    <div className="section-heading">
      <div><h3>{period === "morning" ? "Ca sáng" : "Ca tối"}</h3><p>{status === "recorded" ? "Đã ghi chỉ số công tơ" : status === "unable" ? "Cần xử lý · chưa ghi được" : "Chưa ghi nhận"}</p></div>
      <span className={`status ${status === "recorded" ? "status-success" : status === "unable" ? "status-warning" : "status-neutral"}`}>{status === "recorded" ? "Đã ghi" : status === "unable" ? "Cần xử lý" : "Chưa ghi"}</span>
    </div>
    {legacyReadingNeedsReview ? <div className="form-note">Chỉ số cũ đang có nhưng chưa lưu giờ ghi. Không đổi gì để giữ lại; chọn “Đã ghi” để bổ sung giờ, “Không ghi nhận được” để giải thích, hoặc dùng nút dưới đây để xóa.<button className="text-button" type="button" disabled={!canEdit || pending} onClick={() => { setStatus(""); setRecordedAt(""); setMeterKwh(""); setUnavailableReason(""); setMeterFieldsTouched(true); }}>Đưa về “Chưa ghi” và xóa chỉ số</button></div> : null}
    <label className="field"><span>Tình trạng ghi chỉ số</span><select name="status" value={status} disabled={!canEdit} onChange={(event) => {
      const next = event.currentTarget.value as "" | "recorded" | "unable";
      setStatus(next);
      setMeterFieldsTouched(true);
      if (next !== "recorded") { setRecordedAt(""); setMeterKwh(""); }
      if (next !== "unable") setUnavailableReason("");
    }}><option value="">Chưa ghi</option><option value="recorded">Đã ghi</option><option value="unable">Không ghi nhận được</option></select></label>
    {status === "recorded" ? <div className="staff-shift-grid">
      <label className="field"><span>Giờ ghi chỉ số</span><input name="recorded_at" type="time" value={recordedAt} onChange={(event) => { setRecordedAt(event.currentTarget.value); setMeterFieldsTouched(true); }} required disabled={!canEdit} /></label>
      <label className="field"><span>Chỉ số công tơ</span><span className="input-suffix"><input name="meter_kwh" type="number" min="0" step="0.001" inputMode="decimal" placeholder="Ví dụ: 15230.5" value={meterKwh} onChange={(event) => { setMeterKwh(event.currentTarget.value); setMeterFieldsTouched(true); }} required disabled={!canEdit} /><span>kWh</span></span></label>
    </div> : null}
    {status === "unable" ? <label className="field"><span>Lý do không ghi nhận được</span><textarea name="unavailable_reason" rows={2} maxLength={240} placeholder="Ví dụ: không tiếp cận được công tơ" value={unavailableReason} onChange={(event) => { setUnavailableReason(event.currentTarget.value); setMeterFieldsTouched(true); }} required disabled={!canEdit} /></label> : null}
    <label className="field"><span>Ghi chú / bất thường</span><textarea name="note" rows={2} maxLength={500} placeholder="Thiết bị chạy bất thường hoặc sự việc trong ca" value={note} onChange={(event) => { setNote(event.currentTarget.value); setNoteTouched(true); }} disabled={!canEdit} /></label>
    {isHistorical ? <label className="field"><span>Lý do chỉnh sửa ngày cũ · bắt buộc</span><textarea name="edit_reason" rows={2} minLength={5} maxLength={500} value={editReason} onChange={(event) => setEditReason(event.currentTarget.value)} required disabled={!canEdit} placeholder="Ghi lý do để lưu lịch sử chỉnh sửa" /></label> : null}

    <section className="staff-entry-group">
      <div className="section-heading"><div><h4>Thiết bị trong {period === "morning" ? "ca sáng" : "ca tối"}</h4><p>{period === "morning" ? "Ghi thiết bị còn chạy từ đêm trước và hoạt động trong ca." : "Ghi thời gian hoạt động và thiết bị còn chạy sau khi đóng cửa."}</p></div></div>
      {activeDevices.length === 0 ? <p className="form-note">Chưa có thiết bị đang theo dõi. Thêm thiết bị trong mục quản lý phía dưới.</p> : <div className="staff-shift-grid">{activeDevices.map((device) => {
        const input = deviceInputs[device.id];
        const saved = logMap.get(device.id);
        const effectiveName = saved?.device_name_snapshot ?? device.name;
        const effectiveMode = saved?.device_mode_snapshot ?? device.mode;
        return <div className="staff-order-box" key={device.id}>
          <div className="section-heading"><div><strong>{effectiveName}</strong><small>{effectiveMode === "timed" ? "Theo dõi giờ bật và tắt" : "Thiết bị chạy liên tục"}{saved && saved.device_name_snapshot !== device.name ? ` · tên danh mục hiện tại: ${device.name}` : ""}</small></div></div>
          <label className="field"><span>Tình trạng</span><select value={input?.operating_status ?? "unrecorded"} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { operating_status: event.currentTarget.value as DeviceInput["operating_status"] })}><option value="unrecorded">Chưa ghi</option><option value="not_running">Không hoạt động</option><option value="running">Có hoạt động</option></select></label>
          {effectiveMode === "timed" && input?.operating_status === "running" ? <div className="staff-shift-grid">
            <label className="field"><span>Giờ bật</span><input type="time" value={input.started_at} required disabled={!canEdit} onChange={(event) => updateDevice(device.id, { started_at: event.currentTarget.value })} /></label>
            <label className="field"><span>Giờ tắt</span><input type="time" value={input.ended_at} required disabled={!canEdit} onChange={(event) => updateDevice(device.id, { ended_at: event.currentTarget.value })} /></label>
            {period === "evening" ? <label className="inventory-checkbox"><input type="checkbox" checked={input.ends_next_day} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { ends_next_day: event.currentTarget.checked })} /><span>Giờ tắt sang ngày hôm sau</span></label> : null}
          </div> : effectiveMode === "continuous" && input?.operating_status === "running" ? <p className="form-note">Thiết bị được ghi nhận chạy liên tục trong kỳ này.</p> : null}
          {period === "morning" && input?.operating_status === "running" ? <label className="field"><span>Còn hoạt động từ đêm trước?</span><select value={input?.ran_from_previous_night ?? ""} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { ran_from_previous_night: event.currentTarget.value as DeviceInput["ran_from_previous_night"] })}><option value="">Chưa xác nhận</option><option value="true">Có</option><option value="false">Không</option></select></label> : period === "evening" && input?.operating_status === "running" ? <label className="field"><span>Dự kiến còn chạy sau khi đóng cửa?</span><select value={input?.remains_on_after_close ?? ""} disabled={!canEdit} onChange={(event) => updateDevice(device.id, { remains_on_after_close: event.currentTarget.value as DeviceInput["remains_on_after_close"] })}><option value="">Chưa xác nhận</option><option value="true">Có</option><option value="false">Không</option></select></label> : null}
          <label className="field"><span>Ghi chú thiết bị</span><input value={input?.note ?? ""} maxLength={240} placeholder="Không bắt buộc" disabled={!canEdit} onChange={(event) => updateDevice(device.id, { note: event.currentTarget.value })} /></label>
        </div>;
      })}</div>}
      {savedLogs.some((log) => !activeDevices.some((device) => device.id === log.device_id)) ? <div className="expense-list"><strong>Thiết bị đã ngừng theo dõi</strong>{savedLogs.filter((log) => !activeDevices.some((device) => device.id === log.device_id)).map((log) => <div className="expense-row" key={log.device_id}><span>{log.device_name_snapshot} · {log.operating_status === "running" ? "Có hoạt động" : "Không hoạt động"}</span><small>Đã lưu</small></div>)}</div> : null}
    </section>

    {period === "evening" ? <div className="staff-entry-group"><h4>Checklist chốt ca</h4>{([
      ["turned_off_unneeded", "Đã tắt thiết bị không cần thiết"],
      ["checked_cooler_doors", "Đã kiểm tra cửa tủ mát / tủ đông"],
      ["meter_photo_confirmed", "Đã tự xác nhận chụp ảnh công tơ"],
    ] as const).map(([key, label]) => <label className="inventory-checkbox" key={key}><input type="checkbox" checked={checklist[key].value === true} disabled={!canEdit} onChange={(event) => setChecklist((current) => ({ ...current, [key]: { value: event.currentTarget.checked, touched: true } }))} /><span>{label}<small>{checklist[key].value === null ? "Chưa xác nhận" : checklist[key].value ? "Đã xác nhận" : "Chưa hoàn tất"}</small></span></label>)}</div> : null}
    {!loadError ? <button className="button button-secondary" type="submit" disabled={!canEdit || pending || (isHistorical && editReason.trim().length < 5)}>{pending ? "Đang lưu…" : `Lưu ghi nhận ${period === "morning" ? "ca sáng" : "ca tối"}`}</button> : null}
    <ActionMessage error={state?.error} success={state?.success} />
  </form>;
}

function ElectricityDeviceForm({ device, date, disabled = false }: { device: OwnerElectricityDevice | null; date: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<EntryActionState, FormData>(saveOwnerElectricityDeviceAction, undefined);
  return <form className="staff-single-form" action={action}>
    <input type="hidden" name="business_date" value={date} />
    <input type="hidden" name="device_id" value={device?.id ?? ""} />
    <div className="staff-shift-grid">
      <label className="field"><span>Tên thiết bị</span><input name="name" defaultValue={device?.name ?? ""} required minLength={2} maxLength={80} placeholder="Ví dụ: Quạt trần" disabled={disabled} /></label>
      <label className="field"><span>Cách theo dõi</span><select name="mode" defaultValue={device?.mode ?? "timed"} disabled={disabled}><option value="timed">Ghi giờ bật và tắt</option><option value="continuous">Chạy liên tục</option></select></label>
      <label className="field"><span>Thứ tự hiển thị</span><input name="sort_order" type="number" min="0" step="1" defaultValue={device?.sort_order ?? 40} inputMode="numeric" disabled={disabled} /></label>
      <label className="field"><span>Trạng thái</span><select name="active" defaultValue={device?.is_active === false ? "false" : "true"} disabled={disabled}><option value="true">Đang theo dõi</option><option value="false">Ngừng theo dõi</option></select></label>
    </div>
    <button className="button button-secondary" type="submit" disabled={disabled || pending}>{pending ? "Đang lưu…" : device ? "Lưu thiết bị" : "Thêm thiết bị"}</button>
    <ActionMessage error={state?.error} success={state?.success} />
  </form>;
}

export function DailyElectricityJournal({ date, record, nextMorningKwh, devices, deviceLogs, loadError = false, isHistorical = false }: {
  date: string;
  record: ElectricityRecord | null;
  nextMorningKwh: number | null;
  devices: OwnerElectricityDevice[];
  deviceLogs: OwnerElectricityDeviceLog[];
  loadError?: boolean;
  isHistorical?: boolean;
}) {
  const values = record ?? {};
  const morningKwh = values.electricity_morning_kwh == null ? null : Number(values.electricity_morning_kwh);
  const eveningKwh = values.electricity_evening_kwh == null ? null : Number(values.electricity_evening_kwh);
  const usage = calculateDailyElectricityUsage({ morningKwh, eveningKwh, nextMorningKwh });
  const activeDevices = devices.filter((device) => device.is_active).length;
  const [resetReason, setResetReason] = useState(values.electricity_reset_reason ?? "");
  const [resetReasonTouched, setResetReasonTouched] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const onSavePendingChange = useCallback((delta: number) => {
    setSavingCount((current) => Math.max(0, current + delta));
  }, []);
  const statusCopy = usage.status === "complete" ? `Dùng trong ngày: ${formatKwh(usage.fullDayKwh)} · qua đêm: ${formatKwh(usage.overnightKwh)}`
    : usage.status === "meter_decrease" ? "Có chỉ số giảm giữa các lần ghi. Kiểm tra lý do thay/reset công tơ."
      : "Chưa đủ ba chỉ số (sáng, tối và sáng hôm sau) để tính mức dùng trong ngày.";

  return <section className="surface electricity-card">
    <div className="section-heading"><div><h2>Nhật ký điện</h2><p>Ghi riêng chỉ số công tơ theo ca; lưu phần này không ảnh hưởng doanh thu.</p></div><span className="status status-neutral">{isHistorical ? "Ngày cũ · cần lý do khi sửa" : "Sáng và tối"}</span></div>
    {loadError ? <p className="form-error" role="alert">Chưa tải được dữ liệu nhật ký điện hoặc danh mục thiết bị. Doanh thu vẫn có thể lưu; tải lại trang rồi thử lưu phần điện.</p> : null}
    <div className="electricity-daily-summary"><div className="section-heading"><div><h3>Mức dùng điện trong ngày</h3><p>{statusCopy}</p></div></div><div className="electricity-grid"><div><span>Chỉ số ca sáng</span><strong>{formatKwh(morningKwh)}</strong></div><div><span>Chỉ số ca tối</span><strong>{formatKwh(eveningKwh)}</strong></div><div><span>Sáng ngày kế tiếp</span><strong>{formatKwh(nextMorningKwh)}</strong></div></div></div>
    <label className="field electricity-reset-reason"><span>Lý do thay hoặc reset công tơ <small>(bắt buộc nếu chỉ số giảm so với lần ghi trước)</small></span><input value={resetReason} maxLength={240} onChange={(event) => { setResetReason(event.currentTarget.value); setResetReasonTouched(true); }} placeholder="Ví dụ: đã thay công tơ ngày…" disabled={loadError || savingCount > 0} /><small>Lý do hiện có được điền sẵn. Xóa nếu đã nhập nhầm và ngày này không còn lần ghi giảm; nội dung được lưu khi lưu một trong hai ca.</small></label>
    <div className="staff-shift-grid">
      <section className="staff-entry-group"><ElectricityPeriodForm date={date} period="morning" record={values} devices={devices} savedLogs={deviceLogs.filter((log) => log.period === "morning")} resetReason={resetReason} resetReasonTouched={resetReasonTouched} setResetReasonTouched={setResetReasonTouched} savingCount={savingCount} onSavePendingChange={onSavePendingChange} isHistorical={isHistorical} loadError={loadError} /></section>
      <section className="staff-entry-group"><ElectricityPeriodForm date={date} period="evening" record={values} devices={devices} savedLogs={deviceLogs.filter((log) => log.period === "evening")} resetReason={resetReason} resetReasonTouched={resetReasonTouched} setResetReasonTouched={setResetReasonTouched} savingCount={savingCount} onSavePendingChange={onSavePendingChange} isHistorical={isHistorical} loadError={loadError} /></section>
    </div>
    <details className="surface compact-disclosure">
      <summary><strong>Quản lý thiết bị</strong><span>{activeDevices} thiết bị đang theo dõi</span></summary>
      <div className="compact-disclosure-content">
        <p className="form-note">Ngừng theo dõi sẽ lưu trữ thiết bị và giữ nguyên nhật ký cũ. Thiết bị đã lưu trữ có thể bật lại; không xóa lịch sử.</p>
        <ElectricityDeviceForm date={date} device={null} disabled={loadError || savingCount > 0} />
        {devices.length ? <div className="expense-list">{devices.map((device) => <div className="expense-row electricity-device-row" key={device.id}><div><strong>{device.name}</strong><span>{device.mode === "timed" ? "Theo dõi giờ bật/tắt" : "Chạy liên tục"} · {device.is_active ? "Đang theo dõi" : "Đã lưu trữ"}</span></div><details className="compact-disclosure electricity-device-edit"><summary><strong>Chỉnh sửa</strong></summary><div className="compact-disclosure-content"><ElectricityDeviceForm date={date} device={device} disabled={loadError || savingCount > 0} /></div></details></div>)}</div> : <p className="empty-inline">Chưa có thiết bị trong danh mục.</p>}
      </div>
    </details>
  </section>;
}
