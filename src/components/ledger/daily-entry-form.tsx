"use client";

import { useActionState, useState } from "react";
import { saveDailyRecord, type EntryActionState } from "@/app/(private)/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatVnd } from "@/lib/finance/format";

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
  reconciliation_status?: string | null;
  bluebook_total_vnd?: number | null;
  reconciliation_difference_vnd?: number | null;
  reconciliation_note?: string | null;
  electricity_reset_reason?: string | null;
};

const fields = [
  { name: "shift_06_10_vnd", label: "Ca sáng · 06:00–10:00" },
  { name: "shift_10_14_vnd", label: "Ca 10:00–14:00" },
  { name: "shift_14_18_vnd", label: "Ca 14:00–18:00" },
  { name: "shift_18_22_vnd", label: "Ca tối · 18:00–22:00" },
  { name: "grab_vnd", label: "Grab · tổng ngày" },
  { name: "shopee_vnd", label: "Shopee · tổng ngày" },
] as const;
const shiftFields = fields.slice(0, 4);
const deliveryFields = fields.slice(4);

export function DailyEntryForm({ date, record }: { date: string; record: DailyRecord | null }) {
  const [state, formAction, pending] = useActionState<EntryActionState, FormData>(saveDailyRecord, undefined);
  const [businessStatus, setBusinessStatus] = useState(record?.business_status ?? "open");
  const [reconciliationStatus, setReconciliationStatus] = useState(record?.reconciliation_status ?? "unreconciled");
  const [bluebookTotalValue, setBluebookTotalValue] = useState(record?.bluebook_total_vnd == null ? "" : new Intl.NumberFormat("vi-VN").format(record.bluebook_total_vnd));
  const [salesValues, setSalesValues] = useState<Record<string, string>>(() => Object.fromEntries(
    fields.map((field) => [field.name, record?.[field.name] == null ? "" : new Intl.NumberFormat("vi-VN").format(record[field.name]!)]),
  ));
  const parsedSales = fields.map((field) => {
    const raw = salesValues[field.name]?.trim() ?? "";
    if (!raw) return null;
    const normalized = raw.replace(/[.,\s]/g, "");
    if (!/^\d+$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isSafeInteger(value) ? value : null;
  });
  const missingSales = parsedSales.filter((value) => value === null).length;
  const partialRevenue = parsedSales.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const revenueIsComplete = businessStatus === "no_business" || missingSales === 0;
  const shownRevenue = businessStatus === "no_business" ? 0 : partialRevenue;
  const parsedBluebookTotal = bluebookTotalValue.trim() && /^\d+$/.test(bluebookTotalValue.replace(/[.,\s]/g, ""))
    ? Number(bluebookTotalValue.replace(/[.,\s]/g, ""))
    : null;
  const liveBluebookDifference = revenueIsComplete && parsedBluebookTotal !== null && Number.isSafeInteger(parsedBluebookTotal)
    ? parsedBluebookTotal - shownRevenue
    : null;

  return (
    <form action={formAction} className="entry-form surface">
      <div className="section-heading">
        <div><h2>Doanh thu trong ngày</h2><p>Nhập doanh thu cuối cùng của từng ca và hai kênh giao hàng.</p></div>
      </div>
      <input type="hidden" name="business_date" value={date} />
      <div className="entry-field-group">
        <h3>Doanh thu tại cửa hàng · bốn ca</h3>
        <div className="entry-grid">
          {shiftFields.map((field) => (
            <label className="field" key={field.name}>
              <span>{field.label}</span>
              <span className="input-suffix">
                <input
                  name={field.name}
                  type="text"
                  inputMode="numeric"
                  placeholder="Ví dụ: 1.250.000"
                  defaultValue={record?.[field.name] == null ? "" : new Intl.NumberFormat("vi-VN").format(record[field.name]!)}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSalesValues((current) => ({ ...current, [field.name]: value }));
                  }}
                  aria-label={`${field.label}, đơn vị đồng`}
                />
                <span>đ</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="entry-field-group">
        <h3>Ứng dụng giao hàng · tổng ngày</h3>
        <div className="entry-grid">
          {deliveryFields.map((field) => (
            <label className="field" key={field.name}>
              <span>{field.label}</span>
              <span className="input-suffix">
                <input
                  name={field.name}
                  type="text"
                  inputMode="numeric"
                  placeholder="Ví dụ: 1.250.000"
                  defaultValue={record?.[field.name] == null ? "" : new Intl.NumberFormat("vi-VN").format(record[field.name]!)}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSalesValues((current) => ({ ...current, [field.name]: value }));
                  }}
                  aria-label={`${field.label}, đơn vị đồng`}
                />
                <span>đ</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="daily-total" aria-live="polite">
        <div><span>{revenueIsComplete ? "Tổng doanh thu ngày" : "Tổng tạm tính · các khoản đã nhập"}</span><strong>{formatVnd(shownRevenue)}</strong></div>
        <small>{businessStatus === "no_business" ? "Ngày không kinh doanh được ghi nhận là 0 ₫." : revenueIsComplete ? "Tổng gồm bốn ca, Grab và Shopee." : `Còn thiếu ${missingSales} trong 6 khoản; tổng ngày sẽ hoàn chỉnh khi nhập đủ.`}</small>
      </div>
      <div className="field status-field">
        <label htmlFor="business_status">Trạng thái ngày</label>
        <select id="business_status" name="business_status" value={businessStatus} onChange={(event) => setBusinessStatus(event.currentTarget.value)}>
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
      <label className="field"><span>Lý do nếu chỉ số điện giảm hoặc reset</span><input name="electricity_reset_reason" type="text" maxLength={240} placeholder="Chỉ cần nhập khi chỉ số thấp hơn lần ghi trước" defaultValue={record?.electricity_reset_reason ?? ""} /><small className="field-helper">Nếu công tơ được thay hoặc reset, hệ thống sẽ yêu cầu ghi lý do và không dùng phép trừ đơn giản để ước tính điện tháng đó.</small></label>
      <section className="reconciliation-section" aria-labelledby="reconciliation-heading">
        <div className="section-heading"><div><h3 id="reconciliation-heading">Đối soát với Bluebook</h3><p>Ghi riêng kết quả kiểm tra so với tổng doanh thu trên website.</p></div></div>
        <label className="field"><span>Trạng thái đối soát</span><select name="reconciliation_status" value={reconciliationStatus} onChange={(event) => setReconciliationStatus(event.currentTarget.value)}><option value="unreconciled">Chưa đối chiếu</option><option value="pending">Chờ kiểm tra</option><option value="matched">Khớp</option><option value="discrepancy">Lệch</option></select></label>
        {reconciliationStatus === "matched" || reconciliationStatus === "discrepancy" ? <div className="entry-grid reconciliation-detail-grid">
          <label className="field"><span>Tổng doanh thu Bluebook</span><span className="input-suffix"><input name="bluebook_total_vnd" type="text" inputMode="numeric" placeholder="Nhập tổng trên Bluebook" value={bluebookTotalValue} onChange={(event) => setBluebookTotalValue(event.currentTarget.value)} /><span>đ</span></span><small className="field-helper">Website tự lấy tổng bốn ca, Grab và Shopee để tính chênh lệch.</small></label>
          <div className="field reconciliation-result"><span>Chênh lệch · Bluebook trừ website</span><strong>{liveBluebookDifference === null ? "Cần nhập đủ doanh thu và tổng Bluebook" : `${liveBluebookDifference > 0 ? "+" : ""}${formatVnd(liveBluebookDifference)}`}</strong><small className="field-helper">{liveBluebookDifference === null ? "Không đánh dấu khớp/lệch khi số liệu còn thiếu." : liveBluebookDifference === 0 ? "Hai tổng đang khớp." : liveBluebookDifference > 0 ? "Bluebook cao hơn website." : "Bluebook thấp hơn website."}</small></div>
          <label className="field reconciliation-note"><span>Ghi chú đối soát (không bắt buộc)</span><input name="reconciliation_note" type="text" maxLength={240} placeholder="Ví dụ: đã kiểm tra lại ca tối" defaultValue={record?.reconciliation_note ?? ""} /></label>
        </div> : null}
      </section>
      <label className="field"><span>Ghi chú</span><textarea name="note" rows={2} maxLength={1000} placeholder="Ghi chú đối soát, chương trình hoặc diễn biến trong ngày" defaultValue={record?.note ?? ""} /></label>
      <p className="form-note">Các khoản được lưu riêng để dễ đối chiếu. Ngày chưa nhập đủ sẽ không bị tính thành 0.</p>
      <ActionMessage error={state?.error} success={state?.success} />
      <div className="form-actions"><button className="button" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu doanh thu ngày"}</button></div>
    </form>
  );
}
