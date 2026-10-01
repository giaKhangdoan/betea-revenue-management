"use client";

import { useState, useActionState } from "react";
import { saveInventoryReceiptAction, type InventoryReceiptActionState } from "@/app/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { currentBusinessDate } from "@/lib/finance/format";
import type { InventoryItem } from "@/lib/inventory/catalog";
import type { InventoryReceipt } from "@/lib/inventory/receipts";

type ReceiptDraftLine = {
  item_id: string;
  item_name: string;
  large_unit: string;
  conversion_factor: number | string;
  small_unit: string;
  large_quantity: string;
  loose_quantity: string;
};

function blankReceiptLine(): ReceiptDraftLine {
  return { item_id: "", item_name: "", large_unit: "", conversion_factor: 1, small_unit: "", large_quantity: "0", loose_quantity: "0" };
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
  const [lines, setLines] = useState<ReceiptDraftLine[]>(() => receipt?.lines.map((line) => ({
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
      <p>{receipt ? "Nhập lý do; phiên bản trước sẽ được lưu trong lịch sử hiệu chỉnh." : "Đơn vị và hệ số quy đổi được lưu theo danh mục tại thời điểm ghi phiếu."}</p>
    </div>
    {lines.map((line, index) => {
      const selectedItem = items.find((item) => item.id === line.item_id);
      const item = selectedItem ?? line;
      const hasLooseUnit = item.large_unit !== item.small_unit || Number(item.conversion_factor) !== 1;
      const looseUnitIsDivisible = ["gr", "ml"].includes(item.small_unit.trim().toLowerCase());
      return <div className="inventory-receipt-line-form" key={`${receipt?.id ?? "new"}-${index}`}>
        <label className="field inventory-receipt-product"><span>Mặt hàng</span><select name="item_id" required value={line.item_id} onChange={(event) => {
          const next = items.find((candidate) => candidate.id === event.currentTarget.value);
          updateLine(index, {
            item_id: event.currentTarget.value,
            item_name: next?.name ?? "",
            large_unit: next?.large_unit ?? "",
            conversion_factor: next?.conversion_factor ?? 1,
            small_unit: next?.small_unit ?? "",
            loose_quantity: "0",
          });
        }}>
          <option value="" disabled>Chọn mặt hàng</option>
          {receipt?.lines[index] && !selectedItem ? <option value={line.item_id}>{line.item_name} (không còn trong danh mục)</option> : null}
          {items.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
        </select></label>
        {item.large_unit ? <p className="inventory-conversion-hint">1 {item.large_unit} = {formatQuantity(item.conversion_factor)} {item.small_unit}</p> : null}
        <label className="field"><span>Số {item.large_unit || "đơn vị lớn"}</span><input type="number" min="0" step="1" inputMode="numeric" name="large_quantity" value={line.large_quantity} onChange={(event) => updateLine(index, { large_quantity: event.currentTarget.value })} required /></label>
        {hasLooseUnit ? <label className="field"><span>Số {item.small_unit || "đơn vị lẻ"}</span><input type="number" min="0" step={looseUnitIsDivisible ? "any" : "1"} inputMode="decimal" name="loose_quantity" value={line.loose_quantity} onChange={(event) => updateLine(index, { loose_quantity: event.currentTarget.value })} required /></label>
          : <input type="hidden" name="loose_quantity" value="0" />}
        {lines.length > 1 ? <button className="text-button text-button-danger inventory-remove-line" type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Bỏ dòng</button> : null}
      </div>;
    })}
    {items.length > 0 ? <button className="text-button inventory-add-line" type="button" onClick={() => setLines((current) => [...current, blankReceiptLine()])}>+ Thêm mặt hàng</button> : <p className="empty-inline">Chưa có mặt hàng đang hoạt động.</p>}
    {receipt ? <label className="field inventory-correction-reason"><span>Lý do chỉnh sửa</span><textarea name="reason" required maxLength={500} rows={2} /></label> : null}
    <div className="staff-inline-actions">
      <button className="button button-secondary" type="submit" disabled={pending || (!receipt && items.length === 0)}>{pending ? "Đang lưu…" : !receipt ? "Tạo phiếu nhập" : ownerCorrection ? "Lưu hiệu chỉnh" : "Lưu phiếu"}</button>
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
        return <article className="inventory-receipt" key={receipt.id}>
          <div className="inventory-receipt-heading"><div><h3>{receipt.receipt_code}</h3><p>{formatReceiptDate(receipt.received_at)} · {receipt.created_by_label}</p></div>{canEdit ? <button className="text-button" type="button" onClick={() => setEditingId(editingId === receipt.id ? null : receipt.id)}>{editingId === receipt.id ? "Đóng sửa" : owner ? "Hiệu chỉnh" : "Sửa phiếu"}</button> : null}</div>
          {editingId === receipt.id ? <ReceiptForm key={`${receipt.id}-edit`} items={items} receipt={receipt} ownerCorrection={owner} onCancel={() => setEditingId(null)} /> : <ul className="inventory-receipt-lines">{receipt.lines.map((line) => <li key={line.id}><div><strong>{line.item_name}</strong><span>{formatQuantity(line.large_quantity)} {line.large_unit}{Number(line.loose_quantity) ? ` + ${formatQuantity(line.loose_quantity)} ${line.small_unit}` : ""}</span></div><strong>{formatQuantity(line.converted_quantity)} {line.small_unit}</strong></li>)}</ul>}
          {owner && receipt.corrections.length > 0 ? <details className="inventory-receipt-audit"><summary>Lịch sử hiệu chỉnh ({receipt.corrections.length})</summary>{receipt.corrections.map((correction) => <div className="inventory-receipt-correction" key={correction.id}><p>{formatReceiptDate(correction.corrected_at)} · {correction.corrected_by_label}</p><p>Lý do: {correction.reason}</p><ul className="inventory-receipt-lines">{correction.prior_lines.map((line) => <li key={line.id}><div><strong>{line.item_name}</strong><span>{formatQuantity(line.large_quantity)} {line.large_unit}{Number(line.loose_quantity) ? ` + ${formatQuantity(line.loose_quantity)} ${line.small_unit}` : ""}</span></div><strong>{formatQuantity(line.converted_quantity)} {line.small_unit}</strong></li>)}</ul></div>)}</details> : null}
        </article>;
      })}</div>}
    </>}
  </section>;
}
