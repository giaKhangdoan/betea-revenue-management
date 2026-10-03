"use client";

import { useState, useActionState } from "react";
import { saveInventoryReceiptAction, type InventoryReceiptActionState } from "@/app/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { currentBusinessDate } from "@/lib/finance/format";
import type { InventoryItem } from "@/lib/inventory/catalog";
import type { InventoryReceipt } from "@/lib/inventory/receipts";
import { preventInvalidQuantityKey, preventInvalidQuantityPaste, quantityAllowsFractional } from "@/lib/inventory/quantity-input";

type ReceiptDraftLine = {
  category: string;
  item_id: string;
  item_name: string;
  large_unit: string | null;
  conversion_factor: number | string | null;
  small_unit: string;
  large_quantity: string;
  loose_quantity: string;
};

function blankReceiptLine(): ReceiptDraftLine {
  return { category: "", item_id: "", item_name: "", large_unit: null, conversion_factor: null, small_unit: "", large_quantity: "0", loose_quantity: "0" };
}

function formatQuantity(value: string | number) {
  const [whole = "0", fraction = ""] = String(value).split(".");
  if (!/^\d+$/.test(whole)) return String(value);
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const formattedFraction = fraction.replace(/0+$/, "");
  return formattedFraction ? `${formattedWhole},${formattedFraction}` : formattedWhole;
}

function formatReceiptDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

function receiptUnitsChanged(receipt: InventoryReceipt, items: InventoryItem[]) {
  return receipt.lines.some((line) => {
    const current = items.find((item) => item.id === line.item_id);
    return current && (
      line.large_unit !== current.large_unit
      || line.small_unit !== current.small_unit
      || (line.conversion_factor == null
        ? current.conversion_factor != null
        : current.conversion_factor == null || Number(line.conversion_factor) !== Number(current.conversion_factor))
    );
  });
}

function ReceiptLines({ lines }: { lines: InventoryReceipt["lines"] }) {
  return <ul className="inventory-receipt-lines">{lines.map((line) => <li key={line.id}><div><strong>{line.item_name}</strong><span>{line.large_unit ? `${formatQuantity(line.large_quantity)} ${line.large_unit} + ${formatQuantity(line.loose_quantity)} ${line.small_unit}` : `${formatQuantity(line.loose_quantity)} ${line.small_unit}`}</span></div><strong>{line.converted_quantity == null ? "Ghi riêng từng đơn vị" : `${formatQuantity(line.converted_quantity)} ${line.small_unit}`}</strong></li>)}</ul>;
}

function ReceiptForm({
  items,
  receipt,
  ownerCorrection = false,
  onCancel,
}: {
  items: InventoryItem[];
  receipt?: InventoryReceipt;
  ownerCorrection?: boolean;
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState<InventoryReceiptActionState, FormData>(saveInventoryReceiptAction, undefined);
  const categories = [...new Set([
    ...items.map((item) => item.category),
    ...(receipt?.lines.map((line) => line.category) ?? []),
  ].filter(Boolean))];
  const [lines, setLines] = useState<ReceiptDraftLine[]>(() => receipt?.lines.map((line) => ({
    category: items.find((item) => item.id === line.item_id)?.category ?? line.category,
    item_id: line.item_id,
    item_name: line.item_name,
    large_unit: line.large_unit,
    conversion_factor: line.conversion_factor,
    small_unit: line.small_unit,
    large_quantity: String(line.large_quantity),
    loose_quantity: String(line.loose_quantity),
  })) ?? [blankReceiptLine()]);

  function updateLine(index: number, update: Partial<ReceiptDraftLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line));
  }

  return <form className="inventory-receipt-form" action={action}>
    <input type="hidden" name="mode" value={receipt ? ownerCorrection ? "owner-correct" : "update" : "create"} />
    {receipt ? <input type="hidden" name="receipt_id" value={receipt.id} /> : null}
    <div className="inventory-receipt-form-heading">
      <h3>{receipt ? `${ownerCorrection ? "Hiệu chỉnh" : "Sửa"} ${receipt.receipt_code}` : "Ghi lần giao hàng"}</h3>
      <p>{receipt ? "Nhập lý do; phiên bản trước sẽ được lưu trong lịch sử hiệu chỉnh." : "Đơn vị được lưu theo danh mục; khi không có hệ số, hai số lượng được giữ riêng."}</p>
    </div>
    {lines.map((line, index) => {
      const selectedItem = items.find((item) => item.id === line.item_id);
      const item = selectedItem ?? line;
      const receiptLine = receipt?.lines[index];
      const categoryItems = items.filter((candidate) => candidate.category === line.category);
      const hasPackage = Boolean(item.large_unit);
      const hasConversion = hasPackage && item.conversion_factor != null;
      const stockUnitIsDivisible = quantityAllowsFractional(item.small_unit);
      return <div className="inventory-receipt-line-form" key={`${receipt?.id ?? "new"}-${index}`}>
        <label className="field inventory-receipt-category"><span>Danh mục</span><select required value={line.category} onChange={(event) => updateLine(index, {
          category: event.currentTarget.value,
          item_id: "",
          item_name: "",
          large_unit: null,
          conversion_factor: null,
          small_unit: "",
          large_quantity: "0",
          loose_quantity: "0",
        })}>
          <option value="" disabled>Chọn danh mục</option>
          {categories.map((category) => <option value={category} key={category}>{category}</option>)}
        </select></label>
        <label className="field inventory-receipt-product"><span>Mặt hàng</span><select name="item_id" required disabled={!line.category} value={line.item_id} onChange={(event) => {
          const next = items.find((candidate) => candidate.id === event.currentTarget.value);
          updateLine(index, {
            item_id: event.currentTarget.value,
            item_name: next?.name ?? "",
            category: next?.category ?? line.category,
            large_unit: next?.large_unit ?? null,
            conversion_factor: next?.conversion_factor ?? null,
            small_unit: next?.small_unit ?? "",
            large_quantity: "0",
            loose_quantity: "0",
          });
        }}>
          <option value="" disabled>{line.category ? "Chọn mặt hàng" : "Chọn danh mục trước"}</option>
          {receiptLine && !selectedItem && line.category === receiptLine.category ? <option value={line.item_id}>{line.item_name} (không còn trong danh mục)</option> : null}
          {categoryItems.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
        </select></label>
        {hasConversion ? <p className="inventory-conversion-hint">1 {item.large_unit} = {formatQuantity(item.conversion_factor!)} {item.small_unit}</p> : hasPackage ? <p className="inventory-conversion-hint">Hai đơn vị được lưu riêng, không tự cộng.</p> : null}
        {!line.item_id ? <>
          <input type="hidden" name="large_quantity" value="0" />
          <input type="hidden" name="loose_quantity" value="0" />
          <p className="inventory-quantity-prompt">Chọn mặt hàng để nhập số lượng.</p>
        </> : hasPackage ? <>
          <label className="field inventory-count-unit-large"><span>Số {item.large_unit}</span><input type="number" min="0" step="1" inputMode="numeric" name="large_quantity" value={line.large_quantity} onKeyDown={(event) => preventInvalidQuantityKey(event, false)} onPaste={(event) => preventInvalidQuantityPaste(event, false)} onChange={(event) => updateLine(index, { large_quantity: event.currentTarget.value })} required /></label>
          <label className="field inventory-count-unit-small"><span>Số {item.small_unit}</span><input type="number" min="0" step={stockUnitIsDivisible ? "0.001" : "1"} inputMode={stockUnitIsDivisible ? "decimal" : "numeric"} name="loose_quantity" value={line.loose_quantity} onKeyDown={(event) => preventInvalidQuantityKey(event, stockUnitIsDivisible)} onPaste={(event) => preventInvalidQuantityPaste(event, stockUnitIsDivisible)} onChange={(event) => updateLine(index, { loose_quantity: event.currentTarget.value })} required /></label>
        </> : <>
          <input type="hidden" name="large_quantity" value="0" />
          <label className="field inventory-count-unit-small"><span>Số lượng nhập{item.small_unit ? ` (${item.small_unit})` : ""}</span><input type="number" min="0" step={stockUnitIsDivisible ? "0.001" : "1"} inputMode={stockUnitIsDivisible ? "decimal" : "numeric"} name="loose_quantity" value={line.loose_quantity} onKeyDown={(event) => preventInvalidQuantityKey(event, stockUnitIsDivisible)} onPaste={(event) => preventInvalidQuantityPaste(event, stockUnitIsDivisible)} onChange={(event) => updateLine(index, { loose_quantity: event.currentTarget.value })} required /></label>
        </>}
        {lines.length > 1 ? <button className="text-button text-button-danger inventory-remove-line" type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Bỏ dòng</button> : null}
      </div>;
    })}
    {items.length > 0 ? <button className="text-button inventory-add-line" type="button" onClick={() => setLines((current) => [...current, blankReceiptLine()])}>+ Thêm mặt hàng</button> : <p className="empty-inline">Chưa có mặt hàng đang hoạt động.</p>}
    {receipt ? <label className="field inventory-correction-reason"><span>Lý do chỉnh sửa</span><textarea name="reason" required maxLength={500} rows={2} /></label> : null}
    <div className="staff-inline-actions">
      <button className="button button-secondary" type="submit" disabled={pending || items.length === 0 || lines.some((line) => !line.item_id)}>{pending ? "Đang lưu…" : !receipt ? "Tạo phiếu nhập" : ownerCorrection ? "Lưu hiệu chỉnh" : "Lưu phiếu"}</button>
      {onCancel ? <button className="text-button" type="button" onClick={onCancel}>Hủy</button> : null}
    </div>
    <ActionMessage error={state?.error} success={state?.success} />
  </form>;
}

export function InventoryReceivingPanel({
  items,
  receipts,
  canCreate,
  owner,
  receivingError,
  today,
}: {
  items: InventoryItem[];
  receipts: InventoryReceipt[];
  canCreate: boolean;
  owner: boolean;
  receivingError: boolean;
  today: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return <section className="surface inventory-panel">
    {receivingError ? <div className="empty-state"><h2>Chưa tải được phiếu nhập</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : <>
      <div className="section-heading"><div><h2>Phiếu nhập</h2><p>{canCreate ? "Mỗi lần giao hàng ghi thành một phiếu riêng." : "Phiếu được sắp xếp theo thời điểm giao."}</p></div><strong>{receipts.length} phiếu</strong></div>
      {canCreate ? <ReceiptForm items={items} /> : null}
      {receipts.length === 0 ? <p className="empty-inline">Chưa có phiếu nhập.</p> : <div className="inventory-receipt-list">{receipts.map((receipt) => {
        const canEdit = owner || (canCreate && receipt.staff_editable && currentBusinessDate(new Date(receipt.received_at)) === today);
        const unitsChanged = receiptUnitsChanged(receipt, items);
        return <article className="inventory-receipt" key={receipt.id}>
          <div className="inventory-receipt-heading"><div><h3>{receipt.receipt_code}</h3><p>{formatReceiptDate(receipt.received_at)} · {receipt.created_by_label}</p></div>{canEdit && !unitsChanged ? <button className="text-button" type="button" onClick={() => setEditingId(editingId === receipt.id ? null : receipt.id)}>{editingId === receipt.id ? "Đóng sửa" : owner ? "Hiệu chỉnh" : "Sửa phiếu"}</button> : null}</div>
          {canEdit && unitsChanged ? <p className="form-note">Không thể sửa phiếu này vì đơn vị hoặc quy cách đã đổi trong danh mục.</p> : null}
          {editingId === receipt.id ? <ReceiptForm key={`${receipt.id}-edit`} items={items} receipt={receipt} ownerCorrection={owner} onCancel={() => setEditingId(null)} /> : <ReceiptLines lines={receipt.lines} />}
          {owner && receipt.corrections.length > 0 ? <details className="inventory-receipt-audit"><summary>Lịch sử hiệu chỉnh ({receipt.corrections.length})</summary>{receipt.corrections.map((correction, index) => {
            // Each newer correction's prior_lines is this event's after snapshot; current lines follow the latest event.
            const afterLines = index === 0 ? receipt.lines : receipt.corrections[index - 1].prior_lines;
            return <div className="inventory-receipt-correction" key={correction.id}>
              <p>{formatReceiptDate(correction.corrected_at)} · {correction.corrected_by_label}</p><p>Lý do: {correction.reason}</p>
              <p>Trước khi sửa</p><ReceiptLines lines={correction.prior_lines} />
              <p>Sau khi sửa</p><ReceiptLines lines={afterLines} />
            </div>;
          })}</details> : null}
        </article>;
      })}</div>}
    </>}
  </section>;
}
