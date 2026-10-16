"use client";

import { startTransition, useActionState, useCallback, useMemo, useState } from "react";
import { saveOwnerElectricityDeviceAction, saveOwnerElectricityPeriod, type EntryActionState } from "@/app/(private)/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { ElectricityBatchNavigation, ElectricityBatchProgress, ElectricityClosingChecklist, ElectricityPeriodTabs, useElectricityDeviceBatch } from "@/components/ledger/electricity-entry-controls";
import { ElectricityDeviceFields, ElectricityMeterFields, electricityDeviceInput, type ElectricityDeviceInput as DeviceInput } from "@/components/ledger/electricity-input-fields";
import { normalizeElectricityTime } from "@/lib/electricity/time-input";
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

type ElectricityDeviceField = "operating_status" | "started_at" | "ended_at" | "ends_next_day" | "ran_from_previous_night" | "remains_on_after_close" | "note";

type ChecklistValue = { value: boolean | null; touched: boolean };
type ChecklistState = {
  turned_off_unneeded: ChecklistValue;
  checked_cooler_doors: ChecklistValue;
  meter_photo_confirmed: ChecklistValue;
};

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
  const activeDevices = useMemo(() => devices.filter((device) => device.is_active), [devices]);
  const deviceBatch = useElectricityDeviceBatch(activeDevices);
  const [deviceInputs, setDeviceInputs] = useState<Record<string, DeviceInput>>(() => Object.fromEntries(activeDevices.map((device) => [device.id, electricityDeviceInput(logMap.get(device.id))])));
  const [checklist, setChecklist] = useState<ChecklistState>(() => ({
    turned_off_unneeded: parseChecklistValue(record.electricity_evening_turned_off_unneeded),
    checked_cooler_doors: parseChecklistValue(record.electricity_evening_checked_cooler_doors),
    meter_photo_confirmed: parseChecklistValue(record.electricity_evening_meter_photo_confirmed),
  }));
  const [meterFieldsTouched, setMeterFieldsTouched] = useState(false);
  const saveAndResetTouchedState = useCallback(async (previousState: EntryActionState, formData: FormData) => {
    try {
      const result = await saveOwnerElectricityPeriod(previousState, formData);
      if (result?.success) {
        setMeterFieldsTouched(false);
        setNoteTouched(false);
        setResetReasonTouched(false);
        setDeviceInputs((current) => Object.fromEntries(Object.entries(current).map(([id, input]) => [id, deviceBatch.deviceIds.includes(id) ? { ...input, changed_fields: [] } : input])));
        if (deviceBatch.isLast) setChecklist((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, touched: false }])) as ChecklistState);
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
  }, [deviceBatch, onSavePendingChange, setResetReasonTouched]);
  const [state, action, pending] = useActionState<EntryActionState, FormData>(saveAndResetTouchedState, undefined);
  const updateDevice = (deviceId: string, patch: Partial<DeviceInput>) => {
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
  const canEdit = !loadError && savingCount === 0 && !pending;
  const legacyReadingNeedsReview = status === "" && initialStatus == null && initialKwh != null;

  return <form className="staff-single-form electricity-period-form" onSubmit={(event) => {
    event.preventDefault();
    if (!canEdit) return;
    // Dispatch manually so a failed save cannot reset the controlled draft fields.
    const formData = new FormData(event.currentTarget);
    onSavePendingChange(1);
    startTransition(() => action(formData));
  }}>
    <input type="hidden" name="business_date" value={date} />
    <input type="hidden" name="period" value={period} />
    <input type="hidden" name="reset_reason" value={resetReason} />
    <input type="hidden" name="reset_reason_changed" value={resetReasonTouched ? "true" : "false"} />
    <input type="hidden" name="note_changed" value={noteTouched ? "true" : "false"} />
    <input type="hidden" name="meter_fields_changed" value={meterFieldsTouched ? "true" : "false"} />
    <input type="hidden" name="device_logs_json" value={serializedLogs} />
    <input type="hidden" name="checklist_json" value={serializedChecklist} />
    <ElectricityMeterFields period={period} value={{ status, recordedAt, meterKwh, unavailableReason }} changed={meterFieldsTouched} disabled={!canEdit} allowCurrentTime={!isHistorical} onChange={(value) => {
      setStatus(value.status); setRecordedAt(value.recordedAt); setMeterKwh(value.meterKwh); setUnavailableReason(value.unavailableReason); setMeterFieldsTouched(true);
    }} />
    {legacyReadingNeedsReview && !meterFieldsTouched ? <p className="form-note">Chỉ số cũ chưa có giờ ghi. Bổ sung giờ nếu cần; không thay đổi để giữ nguyên số liệu.</p> : null}

    <section className="staff-entry-group">
      <div className="section-heading"><div><h4>Thiết bị trong {period === "morning" ? "ca sáng" : "ca tối"}</h4><p>Chọn thiết bị có dùng, rồi nhập giờ bật / tắt thực tế.</p></div></div>
      <ElectricityBatchProgress batch={deviceBatch} />
      {activeDevices.length === 0 ? <p className="form-note">Chưa có thiết bị đang theo dõi. Thêm thiết bị trong mục quản lý phía dưới.</p> : <div className="electricity-device-list">{deviceBatch.visibleDevices.map((device) => {
        const input = deviceInputs[device.id] ?? electricityDeviceInput(logMap.get(device.id));
        const saved = logMap.get(device.id);
        const effectiveName = saved?.device_name_snapshot ?? device.name;
        const effectiveMode = saved?.device_mode_snapshot ?? device.mode;
        return input ? <ElectricityDeviceFields key={device.id} name={effectiveName} catalogName={device.name} mode={effectiveMode} period={period} value={input} disabled={!canEdit} onChange={(patch) => updateDevice(device.id, patch)} /> : null;
      })}</div>}
      {savedLogs.some((log) => !activeDevices.some((device) => device.id === log.device_id)) ? <div className="expense-list"><strong>Thiết bị đã ngừng theo dõi</strong>{savedLogs.filter((log) => !activeDevices.some((device) => device.id === log.device_id)).map((log) => <div className="expense-row" key={log.device_id}><span>{log.device_name_snapshot} · {log.operating_status === "running" ? "Có hoạt động" : "Không hoạt động"}</span><small>Đã lưu</small></div>)}</div> : null}
    </section>

    {period === "evening" && deviceBatch.isLast ? <ElectricityClosingChecklist values={checklist} disabled={!canEdit} onChange={(key, checked) => setChecklist((current) => ({ ...current, [key]: { value: checked, touched: true } }))} /> : null}
    <details className="electricity-note-disclosure"><summary>{note ? "Xem / sửa ghi chú ca" : "Ghi chú ca / bất thường (nếu có)"}</summary><label className="field"><span>Ghi chú ca</span><textarea name="note" rows={2} maxLength={500} placeholder="Thiết bị quên tắt, máy chạy bất thường…" value={note} onChange={(event) => { setNote(event.currentTarget.value); setNoteTouched(true); }} disabled={!canEdit} /></label></details>
    {isHistorical ? <label className="field electricity-edit-reason"><span>Lý do cập nhật ngày cũ <small>· bắt buộc</small></span><textarea name="edit_reason" rows={2} minLength={5} maxLength={500} value={editReason} onChange={(event) => { event.currentTarget.setCustomValidity(""); setEditReason(event.currentTarget.value); }} onInvalid={(event) => event.currentTarget.setCustomValidity("Nhập lý do cập nhật từ 5 ký tự để lưu ngày cũ.")} required disabled={!canEdit} placeholder="Ví dụ: Bổ sung giờ hoạt động từ Bluebook" /><small>Admin được sửa ngày cũ. Nhập lý do từ 5 ký tự để lưu lịch sử.</small></label> : null}
    <ElectricityBatchNavigation batch={deviceBatch} period={period} canSave={!loadError} busy={savingCount > 0 || pending} />
    <ActionMessage error={state?.error} success={state?.success} />
  </form>;
}

function ElectricityDeviceForm({ device, date, disabled = false }: { device: OwnerElectricityDevice | null; date: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<EntryActionState, FormData>(saveOwnerElectricityDeviceAction, undefined);
  const [mode, setMode] = useState(device?.mode ?? "timed");
  const busy = disabled || pending;
  return <form className="staff-single-form electricity-settings-form" action={action}>
    <input type="hidden" name="business_date" value={date} />
    <input type="hidden" name="device_id" value={device?.id ?? ""} />
    <div className="electricity-settings-grid">
      <label className="field"><span>Tên thiết bị</span><input name="name" defaultValue={device?.name ?? ""} required minLength={2} maxLength={80} placeholder="Ví dụ: Điều hòa quầy 1" disabled={busy} /><small>Đặt tên riêng để nhân viên nhận biết đúng thiết bị.</small></label>
      <label className="field"><span>Nhân viên cần ghi gì?</span><select name="mode" value={mode} onChange={(event) => setMode(event.currentTarget.value as "timed" | "continuous")} disabled={busy}><option value="timed">Giờ bật / tắt trong ca</option><option value="continuous">Xác nhận thiết bị chạy liên tục</option></select><small>{mode === "timed" ? "Dùng cho điều hòa, quạt, đèn…" : "Dùng cho tủ mát, tủ đông… Không yêu cầu nhập giờ."}</small></label>
    </div>
    <details className="electricity-note-disclosure"><summary>Thứ tự và trạng thái theo dõi</summary><div className="electricity-settings-grid">
      <label className="field"><span>Thứ tự hiển thị</span><input name="sort_order" type="number" min="0" step="1" defaultValue={device?.sort_order ?? 40} inputMode="numeric" disabled={busy} /></label>
      <label className="field"><span>Trạng thái</span><select name="active" defaultValue={device?.is_active === false ? "false" : "true"} disabled={busy}><option value="true">Đang theo dõi</option><option value="false">Ngừng theo dõi</option></select></label>
    </div></details>
    <button className="button button-secondary" type="submit" disabled={busy}>{pending ? "Đang lưu…" : device ? "Lưu thiết bị" : "Thêm thiết bị"}</button>
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
    <details className="electricity-note-disclosure" open={usage.status === "meter_decrease" || Boolean(values.electricity_reset_reason)}><summary>Thay / reset công tơ (nếu có)</summary><label className="field electricity-reset-reason"><span>Lý do thay hoặc reset công tơ</span><input value={resetReason} maxLength={240} onChange={(event) => { setResetReason(event.currentTarget.value); setResetReasonTouched(true); }} placeholder="Ví dụ: thay công tơ ngày…" disabled={loadError || savingCount > 0} /><small>Bắt buộc nếu chỉ số giảm so với lần ghi trước. Lưu cùng nhật ký ca.</small></label></details>
    <ElectricityPeriodTabs disabled={savingCount > 0}
      morning={<ElectricityPeriodForm date={date} period="morning" record={values} devices={devices} savedLogs={deviceLogs.filter((log) => log.period === "morning")} resetReason={resetReason} resetReasonTouched={resetReasonTouched} setResetReasonTouched={setResetReasonTouched} savingCount={savingCount} onSavePendingChange={onSavePendingChange} isHistorical={isHistorical} loadError={loadError} />}
      evening={<ElectricityPeriodForm date={date} period="evening" record={values} devices={devices} savedLogs={deviceLogs.filter((log) => log.period === "evening")} resetReason={resetReason} resetReasonTouched={resetReasonTouched} setResetReasonTouched={setResetReasonTouched} savingCount={savingCount} onSavePendingChange={onSavePendingChange} isHistorical={isHistorical} loadError={loadError} />}
    />
    <details className="surface compact-disclosure">
      <summary><strong>Quản lý thiết bị</strong><span>{activeDevices} thiết bị đang theo dõi</span></summary>
      <div className="compact-disclosure-content">
        <details className="electricity-catalog-add"><summary>Thêm thiết bị mới</summary><ElectricityDeviceForm date={date} device={null} disabled={loadError || savingCount > 0} /></details>
        {devices.length ? <div className="electricity-catalog-list">{devices.map((device) => <details className="electricity-catalog-item" key={device.id}><summary><span><strong>{device.name}</strong><small>{device.mode === "timed" ? "Ghi giờ bật / tắt" : "Chạy liên tục"} · {device.is_active ? "Đang theo dõi" : "Đã ngừng theo dõi"}</small></span><span className="electricity-catalog-edit-label">Chỉnh sửa</span></summary><ElectricityDeviceForm date={date} device={device} disabled={loadError || savingCount > 0} /></details>)}</div> : <p className="empty-inline">Chưa có thiết bị. Thêm thiết bị để nhân viên bắt đầu ghi nhận.</p>}
        <p className="form-note">Ngừng theo dõi sẽ ẩn thiết bị khỏi lượt nhập mới và giữ nhật ký đã lưu.</p>
      </div>
    </details>
  </section>;
}
