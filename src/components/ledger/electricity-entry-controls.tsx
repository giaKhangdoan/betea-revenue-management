"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

export type ElectricityChecklistKey = "turned_off_unneeded" | "checked_cooler_doors" | "meter_photo_confirmed";

export function ElectricityClosingChecklist({ values, disabled, onChange }: {
  values: Record<ElectricityChecklistKey, { value: boolean | null }>;
  disabled: boolean;
  onChange: (key: ElectricityChecklistKey, checked: boolean) => void;
}) {
  return <section className="staff-entry-group electricity-closing-checklist">
    <h3>Xác nhận trước khi đóng cửa</h3>
    {([
      ["turned_off_unneeded", "Đã tắt thiết bị không cần thiết"],
      ["checked_cooler_doors", "Đã kiểm tra cửa tủ mát / tủ đông"],
      ["meter_photo_confirmed", "Đã chụp ảnh công tơ"],
    ] as const).map(([key, label]) => <label className="inventory-checkbox" key={key}>
      <input type="checkbox" checked={values[key].value === true} disabled={disabled} onChange={(event) => {
        // React clears currentTarget after the handler. Pass the primitive value
        // so a queued state updater never reads the expired event.
        const checked = event.currentTarget.checked;
        onChange(key, checked);
      }} />
      <span className="electricity-checklist-copy"><span>{label}</span><small>{values[key].value === null ? "Chưa xác nhận" : values[key].value ? "Đã xác nhận" : "Chưa hoàn tất"}</small></span>
    </label>)}
  </section>;
}

export function ElectricityPeriodTabs({ morning, evening, disabled = false }: { morning: ReactNode; evening: ReactNode; disabled?: boolean }) {
  const [active, setActive] = useState<"morning" | "evening">("morning");
  const id = useId();
  const buttons = useRef<Partial<Record<"morning" | "evening", HTMLButtonElement | null>>>({});
  return <div className="electricity-period-tabs">
    <div className="electricity-period-selector" role="tablist" aria-label="Chọn ca ghi nhận điện">
      {(["morning", "evening"] as const).map((period) => <button key={period} ref={(button) => { buttons.current[period] = button; }} type="button" role="tab" id={`${id}-${period}-tab`} aria-controls={`${id}-${period}-panel`} aria-selected={active === period} tabIndex={active === period ? 0 : -1} disabled={disabled} onClick={() => setActive(period)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "morning" : event.key === "End" ? "evening" : period === "morning" ? "evening" : "morning";
        setActive(next);
        buttons.current[next]?.focus();
      }}>{period === "morning" ? "Ca sáng" : "Ca tối"}</button>)}
    </div>
    {(["morning", "evening"] as const).map((period) => <div className="electricity-period-panel" role="tabpanel" key={period} id={`${id}-${period}-panel`} aria-labelledby={`${id}-${period}-tab`} hidden={active !== period}>{period === "morning" ? morning : evening}</div>)}
  </div>;
}

export function useElectricityDeviceBatch<T extends { id: string }>(devices: T[]) {
  const [requestedPage, setPage] = useState(0);
  return useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(devices.length / 2));
    const pageIndex = Math.min(requestedPage, pageCount - 1);
    const visibleDevices = devices.slice(pageIndex * 2, pageIndex * 2 + 2);
    return {
      pageIndex, pageCount, visibleDevices, deviceIds: visibleDevices.map((device) => device.id),
      totalDevices: devices.length, isLast: pageIndex === pageCount - 1,
      previous: () => setPage(Math.max(0, pageIndex - 1)),
      next: () => setPage(Math.min(pageCount - 1, pageIndex + 1)),
    };
  }, [devices, requestedPage]);
}

type DeviceBatch = ReturnType<typeof useElectricityDeviceBatch>;

export function ElectricityBatchProgress({ batch }: { batch: DeviceBatch }) {
  const heading = useRef<HTMLParagraphElement>(null);
  const previousPage = useRef(batch.pageIndex);
  useEffect(() => {
    if (previousPage.current === batch.pageIndex) return;
    previousPage.current = batch.pageIndex;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [batch.pageIndex]);
  if (!batch.totalDevices) return null;
  return <p className="electricity-batch-progress" ref={heading} tabIndex={-1} aria-live="polite">
    <strong>Thiết bị {batch.pageIndex * 2 + 1}–{Math.min(batch.totalDevices, batch.pageIndex * 2 + 2)} / {batch.totalDevices}</strong>
    <span>Nhóm {batch.pageIndex + 1} / {batch.pageCount}</span>
  </p>;
}

export function ElectricityBatchNavigation({ batch, period, canSave, busy, saveDisabled = false }: {
  batch: DeviceBatch;
  period: "morning" | "evening";
  canSave: boolean;
  busy: boolean;
  saveDisabled?: boolean;
}) {
  return <div className="electricity-batch-actions">
    {batch.pageCount > 1 ? <button className="button button-secondary" type="button" disabled={busy || batch.pageIndex === 0} onClick={batch.previous}>Quay lại</button> : null}
    {canSave ? <button className="button" type="submit" disabled={busy || saveDisabled}>{busy ? "Đang lưu…" : batch.isLast ? `Lưu ca ${period === "morning" ? "sáng" : "tối"}` : "Lưu và tiếp tục"}</button>
      : !batch.isLast ? <button className="button button-secondary" type="button" disabled={busy} onClick={batch.next}>Xem nhóm tiếp</button> : null}
  </div>;
}
