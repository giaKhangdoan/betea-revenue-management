"use client";

import { useId, useState } from "react";
import { electricityDurationMinutes, normalizeElectricityTime } from "@/lib/electricity/time-input";

export type ElectricityDeviceValue = {
  operating_status: "unrecorded" | "not_running" | "running";
  started_at: string;
  ended_at: string;
  ends_next_day: boolean;
  ran_from_previous_night: "" | "true" | "false";
  remains_on_after_close: "" | "true" | "false";
  note: string;
};

export type ElectricityDeviceInput = ElectricityDeviceValue & { changed_fields: (keyof ElectricityDeviceValue)[] };

export function electricityDeviceInput(saved?: {
  operating_status: ElectricityDeviceValue["operating_status"];
  started_at: string | null;
  ended_at: string | null;
  ends_next_day: boolean;
  ran_from_previous_night: boolean | null;
  remains_on_after_close: boolean | null;
  note: string | null;
}): ElectricityDeviceInput {
  const bool = (value: boolean | null | undefined): "" | "true" | "false" => value == null ? "" : value ? "true" : "false";
  return {
    operating_status: saved?.operating_status ?? "unrecorded",
    started_at: saved?.started_at?.slice(0, 5) ?? "",
    ended_at: saved?.ended_at?.slice(0, 5) ?? "",
    ends_next_day: saved?.ends_next_day ?? false,
    ran_from_previous_night: bool(saved?.ran_from_previous_night),
    remains_on_after_close: bool(saved?.remains_on_after_close),
    note: saved?.note ?? "",
    changed_fields: [],
  };
}

type MeterValue = {
  status: "" | "recorded" | "unable";
  recordedAt: string;
  meterKwh: string;
  unavailableReason: string;
};

function ElectricityTimeField({ label, name, value, disabled, required = false, placeholder, onChange }: {
  label: string;
  name?: string;
  value: string;
  disabled: boolean;
  required?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [showError, setShowError] = useState(false);
  const normalized = normalizeElectricityTime(value);
  const invalid = showError && ((!value && required) || Boolean(value && !normalized));
  return <label className="field electricity-clock-field" htmlFor={id}>
    <span>{label}</span>
    {name ? <input type="hidden" name={name} value={normalized ?? value} /> : null}
    <input id={id} type="text" inputMode="numeric" autoComplete="off" maxLength={5}
      pattern="(?:[01]?[0-9]|2[0-3])(?::?[0-5][0-9])?" title="Giờ 24 giờ, ví dụ 08:00 hoặc 0800"
      value={value} placeholder={placeholder} disabled={disabled} required={required}
      aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => { setShowError(false); onChange(event.currentTarget.value); }}
      onBlur={() => { setShowError(Boolean(value && !normalized)); if (normalized && normalized !== value) onChange(normalized); }}
      onInvalid={() => setShowError(true)} />
    {invalid ? <small className="form-error" id={`${id}-error`}>Nhập giờ từ 00:00 đến 23:59, ví dụ 0800.</small> : null}
  </label>;
}

export function ElectricityMeterFields({ period, value, changed, disabled, allowCurrentTime = true, onChange }: {
  period: "morning" | "evening";
  value: MeterValue;
  changed: boolean;
  disabled: boolean;
  allowCurrentTime?: boolean;
  onChange: (value: MeterValue) => void;
}) {
  const { status, recordedAt, meterKwh, unavailableReason } = value;
  const updateReading = (patch: Partial<MeterValue>) => onChange({ ...value, status: "recorded", unavailableReason: "", ...patch });
  return <section className="electricity-meter-section" aria-label={`Công tơ ca ${period === "morning" ? "sáng" : "tối"}`}>
    <div className="section-heading"><div><h3>Chỉ số công tơ</h3><p>{period === "morning" ? "Ghi khi mở cửa." : "Ghi trước khi đóng cửa."} Nhập số trên công tơ, không phải lượng điện đã dùng.</p></div><span className={`status ${changed ? "status-warning" : status === "recorded" ? "status-success" : "status-neutral"}`}>{changed ? "Chưa lưu" : status === "recorded" ? "Đã lưu" : status === "unable" ? "Chưa ghi được" : "Chưa nhập"}</span></div>
    <input type="hidden" name="status" value={status} />
    <div className="electricity-meter-mode" role="group" aria-label="Cách ghi nhận công tơ">
      <button type="button" aria-pressed={status !== "unable"} disabled={disabled} onClick={() => {
        if (status === "unable") onChange({ status: "", recordedAt: "", meterKwh: "", unavailableReason: "" });
      }}>Nhập chỉ số</button>
      <button type="button" aria-pressed={status === "unable"} disabled={disabled} onClick={() => onChange({ status: "unable", recordedAt: "", meterKwh: "", unavailableReason })}>Không ghi được</button>
    </div>
    {status === "unable" ? <label className="field"><span>Lý do không ghi được <small>· bắt buộc</small></span><textarea name="unavailable_reason" rows={2} maxLength={240} value={unavailableReason} disabled={disabled} required placeholder="Ví dụ: không tiếp cận được công tơ" onChange={(event) => onChange({ ...value, unavailableReason: event.currentTarget.value })} /></label> : <>
      <div className="electricity-reading-grid">
        <div className="electricity-reading-time"><ElectricityTimeField name="recorded_at" label="Giờ đọc công tơ" value={recordedAt} placeholder={period === "morning" ? "Ví dụ 06:30" : "Ví dụ 22:00"} disabled={disabled} required={status === "recorded"} onChange={(recordedAt) => updateReading({ recordedAt })} />
          {allowCurrentTime ? <button className="text-button" type="button" disabled={disabled} onClick={() => {
            const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
            updateReading({ recordedAt: time });
          }}>Điền giờ hiện tại</button> : <small className="form-note">Dùng giờ ghi trong Bluebook.</small>}
        </div>
        <label className="field"><span>Chỉ số điện <small>· kWh</small></span><input name="meter_kwh" type="number" min="0" step="0.001" inputMode="decimal" value={meterKwh} required={status === "recorded"} disabled={disabled} placeholder="Ví dụ 15230.5" onChange={(event) => updateReading({ meterKwh: event.currentTarget.value })} /></label>
      </div>
      <div className="electricity-meter-help"><small>Giờ 24h: 08:00 là 8 giờ sáng, 20:00 là 8 giờ tối.</small>
        {recordedAt || meterKwh ? <button className="text-button" type="button" disabled={disabled} onClick={() => onChange({ status: "", recordedAt: "", meterKwh: "", unavailableReason: "" })}>Xóa lần ghi này</button> : null}
      </div>
    </>}
  </section>;
}

function BooleanChoice({ label, value, disabled, onChange }: {
  label: string;
  value: "" | "true" | "false";
  disabled: boolean;
  onChange: (value: "true" | "false") => void;
}) {
  const id = useId();
  return <fieldset className="electricity-choice-field" disabled={disabled}>
    <legend>{label}</legend>
    <div className="electricity-choice-options">
      {([['false', 'Không'], ['true', 'Có']] as const).map(([option, text]) => <label className="electricity-choice" key={option}><input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} /><span>{text}</span></label>)}
    </div>
  </fieldset>;
}

export function ElectricityDeviceFields({ name, catalogName, mode, period, value, disabled, onChange }: {
  name: string;
  catalogName?: string;
  mode: "timed" | "continuous";
  period: "morning" | "evening";
  value: ElectricityDeviceValue;
  disabled: boolean;
  onChange: (patch: Partial<ElectricityDeviceValue>) => void;
}) {
  const id = useId();
  const running = value.operating_status === "running";
  const start = normalizeElectricityTime(value.started_at);
  const end = normalizeElectricityTime(value.ended_at);
  const fromPreviousNight = period === "morning" && value.ran_from_previous_night === "true" && Boolean(start && end && start > end);
  const duration = mode === "timed" && running ? electricityDurationMinutes(value.started_at, value.ended_at, (period === "evening" && value.ends_next_day) || fromPreviousNight) : null;
  const validTimes = start && end;
  const durationText = duration === null ? null : [Math.floor(duration / 60) ? `${Math.floor(duration / 60)} giờ` : "", duration % 60 ? `${duration % 60} phút` : ""].filter(Boolean).join(" ") || "0 phút";
  return <div className="electricity-device-card" role="group" aria-label={name}>
    <div className="electricity-device-heading"><strong>{name}</strong><small>{mode === "timed" ? "Ghi giờ bật / tắt" : "Thiết bị chạy liên tục"}{catalogName && catalogName !== name ? ` · hiện tại: ${catalogName}` : ""}</small></div>
    <fieldset className="electricity-choice-field" disabled={disabled}>
      <legend>Thiết bị có dùng trong ca?</legend>
      <div className="electricity-choice-options">
        {([['running', 'Có dùng'], ['not_running', 'Không dùng']] as const).map(([option, text]) => <label className="electricity-choice" key={option}><input type="radio" name={`${id}-status`} value={option} checked={value.operating_status === option} onChange={() => onChange({ operating_status: option })} /><span>{text}</span></label>)}
      </div>
    </fieldset>
    {running && mode === "timed" ? <div className="electricity-operating-time">
      <div className="electricity-time-grid">
        <ElectricityTimeField label="Bật lúc" value={value.started_at} placeholder={period === "morning" ? "08:00" : "14:00"} required disabled={disabled} onChange={(started_at) => onChange({ started_at })} />
        <ElectricityTimeField label="Tắt lúc" value={value.ended_at} placeholder={period === "morning" ? "12:00" : "22:00"} required disabled={disabled} onChange={(ended_at) => onChange({ ended_at })} />
      </div>
      <small className="form-note">{period === "morning" ? "Ví dụ: 08:00 → 12:00 là 4 giờ." : "Ví dụ: 14:00 → 22:00 là 8 giờ."} Có thể gõ 0800 để nhập 08:00.</small>
      {period === "evening" ? <label className="inventory-checkbox electricity-next-day"><input type="checkbox" checked={value.ends_next_day} disabled={disabled} onChange={(event) => onChange({ ends_next_day: event.currentTarget.checked })} /><span>Giờ tắt thuộc ngày hôm sau <small>Ví dụ: bật 20:00, tắt 00:30.</small></span></label> : null}
      {durationText ? <p className="electricity-duration" role="status"><span>Khoảng giờ đã nhập</span><strong>{durationText}{value.ends_next_day && period === "evening" ? " · qua ngày" : fromPreviousNight ? " · từ đêm trước" : ""}</strong></p> : validTimes ? <p className="form-error" role="status">Giờ tắt đang sớm hơn giờ bật.{period === "evening" ? " Nếu tắt sau nửa đêm, chọn ngày hôm sau." : " Kiểm tra lại giờ hoặc xác nhận thiết bị chạy từ đêm trước."}</p> : null}
    </div> : running ? <p className="form-note">Không cần nhập giờ bật/tắt cho thiết bị chạy liên tục.</p> : null}
    {running ? <BooleanChoice label={period === "morning" ? "Đã chạy từ đêm hôm trước?" : "Vẫn chạy sau khi đóng cửa?"} value={period === "morning" ? value.ran_from_previous_night : value.remains_on_after_close} disabled={disabled} onChange={(answer) => onChange(period === "morning" ? { ran_from_previous_night: answer } : { remains_on_after_close: answer })} /> : null}
    <details className="electricity-note-disclosure"><summary>{value.note ? "Xem / sửa ghi chú" : "Thêm ghi chú nếu cần"}</summary><label className="field"><span>Ghi chú thiết bị</span><textarea value={value.note} maxLength={240} rows={2} placeholder="Bật/tắt nhiều lần, thiết bị bất thường…" disabled={disabled} onChange={(event) => onChange({ note: event.currentTarget.value })} /></label>
      {value.operating_status !== "unrecorded" ? <button className="text-button electricity-clear-choice" type="button" disabled={disabled} onClick={() => onChange({ operating_status: "unrecorded" })}>Bỏ lựa chọn thiết bị này</button> : null}
    </details>
  </div>;
}
