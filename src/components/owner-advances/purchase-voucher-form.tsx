"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelPurchaseVoucher, correctPurchaseVoucher, createPurchaseVoucher, updatePurchaseVoucher, type AdvanceActionState } from "@/app/(private)/advances/actions";
import type { InventoryItemChoice, OwnerPurchaseLineRow, OwnerPurchaseVoucherRow } from "@/lib/owner-advances/types";

type EditorLine = {
  id?: string;
  description: string;
  costClass: "raw_material" | "non_ingredient";
  inventoryClass: "stock" | "non_stock";
  inventoryItemId: string;
  largeQuantity: string;
  looseQuantity: string;
  unit: string;
  quantity: string;
  lineAmountVnd: string;
};

function defaultLine(items: InventoryItemChoice[]): EditorLine {
  const item = items[0];
  return {
    description: item?.name ?? "",
    costClass: "raw_material",
    inventoryClass: "stock",
    inventoryItemId: item?.id ?? "",
    largeQuantity: item?.large_unit ? "1" : "0",
    looseQuantity: item?.large_unit ? "0" : "1",
    unit: "lần",
    quantity: "1",
    lineAmountVnd: "",
  };
}

function fromSavedLines(lines: OwnerPurchaseLineRow[], items: InventoryItemChoice[]): EditorLine[] {
  const active = lines.filter(({ active }) => active);
  return active.length ? active.map((line) => ({
    id: line.id,
    description: line.description,
    costClass: line.cost_class,
    inventoryClass: line.inventory_class,
    inventoryItemId: line.inventory_item_id ?? "",
    largeQuantity: String(line.large_quantity ?? "0"),
    looseQuantity: String(line.loose_quantity ?? "0"),
    unit: line.unit_snapshot ?? "lần",
    quantity: String(line.quantity_snapshot ?? "1"),
    lineAmountVnd: line.line_amount_vnd === null ? "" : String(line.line_amount_vnd),
  })) : [defaultLine(items)];
}

function scaledThousandths(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const scaled = Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0") || "0");
  return Number.isSafeInteger(scaled) ? scaled : null;
}

function formatScaledThousandths(value: number): string {
  const whole = Math.floor(value / 1000);
  const fraction = String(value % 1000).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function conversionPreview(line: EditorLine, item: InventoryItemChoice | undefined): string {
  if (!item) return "Chọn nguyên liệu có đơn vị quy đổi hợp lệ.";
  const loose = scaledThousandths(line.looseQuantity);
  if (loose === null) return "Nhập số lượng nhỏ hợp lệ.";
  if (!item.large_unit) return `${formatScaledThousandths(loose)} ${item.small_unit}`;
  const large = /^(\d+)$/.test(line.largeQuantity) ? Number(line.largeQuantity) : null;
  const factor = scaledThousandths(String(item.conversion_factor ?? ""));
  if (large === null || !Number.isSafeInteger(large) || factor === null || factor <= 0) return "Kiểm tra hệ số và số lượng quy đổi của nguyên liệu.";
  const total = large * factor + loose;
  if (!Number.isSafeInteger(total)) return "Số lượng sau quy đổi quá lớn để tính chính xác.";
  return `${formatScaledThousandths(total)} ${item.small_unit}`;
}

export function PurchaseVoucherForm({
  items,
  voucher,
  lines,
  mode,
}: {
  items: InventoryItemChoice[];
  voucher?: OwnerPurchaseVoucherRow;
  lines?: OwnerPurchaseLineRow[];
  mode?: "draft" | "correction";
}) {
  const router = useRouter();
  const isEditing = Boolean(voucher);
  const correctionMode = mode === "correction";
  const saveAction = correctionMode ? correctPurchaseVoucher : isEditing ? updatePurchaseVoucher : createPurchaseVoucher;
  const [state, formAction, pending] = useActionState<AdvanceActionState | undefined, FormData>(saveAction, undefined);
  const [editorLines, setEditorLines] = useState(() => voucher ? fromSavedLines(lines ?? [], items) : [defaultLine(items)]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dateDefault = voucher?.purchase_date ?? today;
  const serializedLines = useMemo(() => JSON.stringify(editorLines.map((line) => {
    const item = items.find(({ id }) => id === line.inventoryItemId);
    return line.inventoryClass === "stock" ? {
      id: line.id,
      description: line.description,
      costClass: line.costClass,
      inventoryClass: line.inventoryClass,
      inventoryItemId: line.inventoryItemId,
      largeQuantity: line.largeQuantity,
      looseQuantity: line.looseQuantity,
      conversionFactor: item?.conversion_factor == null ? undefined : String(item.conversion_factor),
      smallUnit: item?.small_unit,
      convertedQuantity: item ? conversionPreview(line, item).replace(` ${item.small_unit}`, "") : undefined,
      lineAmountVnd: line.lineAmountVnd,
    } : {
      id: line.id,
      description: line.description,
      costClass: line.costClass,
      inventoryClass: line.inventoryClass,
      unit: line.unit,
      quantity: line.quantity,
      lineAmountVnd: line.lineAmountVnd,
    };
  })), [editorLines, items]);

  useEffect(() => {
    if (!state?.voucherId) return;
    if (isEditing) router.refresh();
    else router.push(`/advances/${state.voucherId}`);
  }, [isEditing, router, state?.voucherId]);

  function updateLine(index: number, updates: Partial<EditorLine>) {
    setEditorLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...updates } : line));
  }

  function changeInventoryClass(index: number, inventoryClass: EditorLine["inventoryClass"]) {
    const line = editorLines[index];
    if (!line) return;
    if (inventoryClass === "non_stock") {
      updateLine(index, { inventoryClass, inventoryItemId: "", largeQuantity: "0", looseQuantity: "0", unit: "lần", quantity: "1" });
      return;
    }
    const item = items.find(({ id }) => id === line.inventoryItemId) ?? items[0];
    updateLine(index, {
      inventoryClass,
      inventoryItemId: item?.id ?? "",
      description: item?.name ?? line.description,
      largeQuantity: item?.large_unit ? "1" : "0",
      looseQuantity: item?.large_unit ? "0" : "1",
    });
  }

  return <form className="owner-purchase-form" action={formAction}>
    {voucher ? <input type="hidden" name="voucher_id" value={voucher.id} /> : null}
    {correctionMode && voucher?.linked_inventory_receipt_id ? <input type="hidden" name="existing_receipt_id" value={voucher.linked_inventory_receipt_id} /> : null}
    {correctionMode ? <input type="hidden" name="receipt_line_links" value="[]" /> : null}
    <input type="hidden" name="lines" value={serializedLines} />
    <div className="owner-purchase-form-fields">
      <div className="field"><label htmlFor={`${voucher?.id ?? "new"}-purchase-date`}>Ngày mua</label><input id={`${voucher?.id ?? "new"}-purchase-date`} name="purchase_date" type="date" min="2026-09-01" max={today} required defaultValue={dateDefault} /></div>
      <div className="field"><label htmlFor={`${voucher?.id ?? "new"}-purchase-vendor`}>Nơi mua / nhà cung cấp</label><input id={`${voucher?.id ?? "new"}-purchase-vendor`} name="vendor" maxLength={160} defaultValue={voucher?.vendor ?? ""} placeholder="Ví dụ: Nhà cung cấp trà" /></div>
      <div className="field"><label htmlFor={`${voucher?.id ?? "new"}-purchase-total`}>Tổng tiền hóa đơn</label><input id={`${voucher?.id ?? "new"}-purchase-total`} name="invoice_total_vnd" type="text" inputMode="numeric" autoComplete="off" required defaultValue={voucher?.invoice_total_vnd ?? ""} placeholder="Ví dụ: 250000" /></div>
    </div>
    <div className="field"><label htmlFor={`${voucher?.id ?? "new"}-purchase-note`}>Ghi chú phiếu mua</label><textarea id={`${voucher?.id ?? "new"}-purchase-note`} name="note" rows={2} maxLength={4000} defaultValue={voucher?.note ?? ""} placeholder="Thông tin cần nhớ khi đối chiếu" /></div>

    <section className="owner-purchase-lines-editor" aria-labelledby={`${voucher?.id ?? "new"}-lines-heading`}>
      <div className="section-heading"><div><h3 id={`${voucher?.id ?? "new"}-lines-heading`}>Mặt hàng và dịch vụ</h3><p>Tổng hóa đơn là số tiền chuẩn; giá dòng chỉ nhập khi muốn phân bổ lợi nhuận.</p></div><button className="button button-secondary" type="button" onClick={() => setEditorLines((current) => [...current, defaultLine(items)])}>Thêm dòng</button></div>
      {!items.length ? <p className="inventory-history-warning">Chưa có nguyên liệu đang hoạt động trong kho. Có thể thêm dòng ngoài kho hoặc tạo nguyên liệu trong mục Kho trước.</p> : null}
      <div className="owner-purchase-editor-lines">
        {editorLines.map((line, index) => {
          const item = items.find(({ id }) => id === line.inventoryItemId);
          const prefix = `${voucher?.id ?? "new"}-line-${index}`;
          return <fieldset className="owner-purchase-editor-line" key={line.id ?? index}>
            <legend>Dòng {index + 1}</legend>
            <div className="owner-purchase-editor-grid">
              <div className="field"><label htmlFor={`${prefix}-description`}>Tên mặt hàng / nội dung</label><input id={`${prefix}-description`} required maxLength={240} value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></div>
              <div className="field"><label htmlFor={`${prefix}-cost-class`}>Loại chi phí</label><select id={`${prefix}-cost-class`} value={line.costClass} onChange={(event) => updateLine(index, { costClass: event.target.value as EditorLine["costClass"] })}><option value="raw_material">Nguyên liệu · không cộng lại vào lợi nhuận</option><option value="non_ingredient">Không phải nguyên liệu · có thể chọn ghi nhận lợi nhuận</option></select></div>
              <div className="field"><label htmlFor={`${prefix}-inventory-class`}>Theo dõi kho</label><select id={`${prefix}-inventory-class`} value={line.inventoryClass} onChange={(event) => changeInventoryClass(index, event.target.value as EditorLine["inventoryClass"])}><option value="stock">Có nhập kho</option><option value="non_stock">Không nhập kho</option></select></div>
              {line.inventoryClass === "stock" ? <>
                <div className="field"><label htmlFor={`${prefix}-item`}>Nguyên liệu trong danh mục</label><select id={`${prefix}-item`} value={line.inventoryItemId} required onChange={(event) => { const selected = items.find(({ id }) => id === event.target.value); updateLine(index, { inventoryItemId: event.target.value, description: selected?.name ?? line.description, largeQuantity: selected?.large_unit ? "1" : "0", looseQuantity: selected?.large_unit ? "0" : "1" }); }}><option value="">Chọn nguyên liệu</option>{items.map((choice) => <option key={choice.id} value={choice.id}>{choice.name} · {choice.category}</option>)}</select></div>
                {item?.large_unit ? <div className="field"><label htmlFor={`${prefix}-large`}>Số {item.large_unit}</label><input id={`${prefix}-large`} type="text" inputMode="numeric" value={line.largeQuantity} onChange={(event) => updateLine(index, { largeQuantity: event.target.value })} /></div> : null}
                <div className="field"><label htmlFor={`${prefix}-loose`}>Số {item?.small_unit ?? "đơn vị"} lẻ</label><input id={`${prefix}-loose`} type="text" inputMode="decimal" value={line.looseQuantity} onChange={(event) => updateLine(index, { looseQuantity: event.target.value })} /></div>
                <p className="owner-purchase-conversion">Sau quy đổi: <strong>{conversionPreview(line, item)}</strong></p>
              </> : <>
                <div className="field"><label htmlFor={`${prefix}-quantity`}>Số lượng</label><input id={`${prefix}-quantity`} type="text" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></div>
                <div className="field"><label htmlFor={`${prefix}-unit`}>Đơn vị</label><input id={`${prefix}-unit`} maxLength={80} value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} /></div>
                <p className="owner-purchase-conversion">Dòng này không tạo biến động kho.</p>
              </>}
              <div className="field"><label htmlFor={`${prefix}-amount`}>Tiền phân bổ cho dòng (không bắt buộc)</label><input id={`${prefix}-amount`} type="text" inputMode="numeric" value={line.lineAmountVnd} onChange={(event) => updateLine(index, { lineAmountVnd: event.target.value })} placeholder="Để trống nếu chưa cần" /></div>
              <button className="button button-plain owner-purchase-remove-line" type="button" disabled={editorLines.length <= 1} onClick={() => setEditorLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Xóa dòng</button>
            </div>
          </fieldset>;
        })}
      </div>
    </section>

    {isEditing ? <div className="field"><label htmlFor={`${voucher!.id}-edit-reason`}>{correctionMode ? "Lý do hiệu chỉnh phiếu đã chốt" : "Lý do cập nhật bản nháp"}</label><input id={`${voucher!.id}-edit-reason`} name="reason" required minLength={2} maxLength={500} placeholder={correctionMode ? "Ví dụ: Đối chiếu lại số lượng trên hóa đơn" : "Ví dụ: Bổ sung số lượng trên hóa đơn"} /></div> : null}
    {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state?.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <div className="owner-purchase-form-actions"><button className="button" type="submit" disabled={pending}>{pending ? "Đang lưu…" : correctionMode ? "Lưu hiệu chỉnh có lịch sử" : isEditing ? "Lưu bản nháp" : "Lưu bản nháp phiếu mua"}</button><span className="form-note">{correctionMode ? "Hiệu chỉnh tạo sự kiện mới và giữ nguyên ảnh, lần hoàn, lịch sử kho." : "Bản nháp chưa làm thay đổi kho, tiền hoàn hoặc lợi nhuận."}</span></div>
  </form>;
}

export function CancelPurchaseDraftForm({ voucherId }: { voucherId: string }) {
  const [state, action, pending] = useActionState<AdvanceActionState | undefined, FormData>(cancelPurchaseVoucher, undefined);
  return <form action={action} className="owner-purchase-cancel-form">
    <input type="hidden" name="voucher_id" value={voucherId} />
    <div className="field"><label htmlFor={`${voucherId}-cancel-reason`}>Lý do hủy bản nháp</label><input id={`${voucherId}-cancel-reason`} name="reason" required minLength={2} maxLength={500} placeholder="Nhập lý do để lưu lịch sử" /></div>
    {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state?.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <button className="button button-danger" type="submit" disabled={pending}>{pending ? "Đang hủy…" : "Hủy bản nháp"}</button>
  </form>;
}
