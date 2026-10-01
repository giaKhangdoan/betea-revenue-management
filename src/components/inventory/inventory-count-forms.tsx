"use client";

import { useActionState, useRef, useState } from "react";
import { finalizeInventoryCountAction, openInventoryCountAction, saveInventoryCountDraftAction, type InventoryCountActionState } from "@/app/(private)/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import type { InventoryCountItem } from "@/lib/inventory/counts";

export function OpenInventoryCountForm({ date }: { date: string }) {
  const [state, action, pending] = useActionState<InventoryCountActionState, FormData>(openInventoryCountAction, undefined);
  return <form className="inventory-open-form" action={action}>
    <input type="hidden" name="business_date" value={date} />
    <p>Danh sách mặt hàng đang hoạt động sẽ được cố định cho ngày này.</p>
    <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Đang mở…" : "Bắt đầu kiểm"}</button>
    <ActionMessage error={state?.error} success={state?.success} />
  </form>;
}

export function FinalizeInventoryCountForm({ countId, complete }: { countId: string; complete: boolean }) {
  const [state, action, pending] = useActionState<InventoryCountActionState, FormData>(finalizeInventoryCountAction, undefined);
  return <form className="inventory-open-form" action={action}>
    <input type="hidden" name="count_id" value={countId} />
    <p>Chốt sẽ lưu mốc tồn kho và khóa bản kiểm này.</p>
    <button className="button button-primary" type="submit" disabled={pending || !complete}>
      {pending ? "Đang chốt…" : "Chốt bản kiểm"}
    </button>
    <ActionMessage error={state?.error} success={state?.success} />
  </form>;
}

function milli(value: string): bigint | null {
  if (value === "") return BigInt(0);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
}

function formatMicro(value: bigint): string {
  const scale = BigInt(1_000_000);
  const whole = value / scale;
  const fraction = String(value % scale).padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("vi-VN")}${fraction ? `,${fraction}` : ""}`;
}

export function InventoryCountEditor({ countId, items, editable, finalized = false }: { countId: string; items: InventoryCountItem[]; editable: boolean; finalized?: boolean }) {
  const [state, action, pending] = useActionState<InventoryCountActionState, FormData>(saveInventoryCountDraftAction, undefined);
  const initial = Object.fromEntries(items.map((item) => [item.item_id, {
    large: item.large_quantity == null ? "" : String(item.large_quantity),
    small: item.small_quantity == null ? "" : String(item.small_quantity),
  }]));
  const [quantities, setQuantities] = useState(initial);
  const [dirty, setDirty] = useState<Record<string, { large?: boolean; small?: boolean }>>({});
  const [submitted, setSubmitted] = useState(false);
  const handledSuccess = useRef<InventoryCountActionState>(undefined);
  const missingItems = items.filter((item) => {
    const value = quantities[item.item_id];
    return value.large === "" && value.small === "";
  });

  function markDirty(itemId: string, field: "large" | "small") {
    const newSuccess = Boolean(state?.success && state !== handledSuccess.current);
    if (newSuccess) handledSuccess.current = state;
    setDirty((current) => ({
      ...(newSuccess ? {} : current),
      [itemId]: { ...(newSuccess ? {} : current[itemId]), [field]: true },
    }));
    setSubmitted(false);
  }

  return <>
    <p className="inventory-count-progress">Đã kiểm {items.length - missingItems.length}/{items.length} mặt hàng.</p>
    <form className="inventory-count-form" action={action} onSubmit={() => setSubmitted(true)}>
      <input type="hidden" name="count_id" value={countId} />
      <ul className="inventory-count-list">
        {items.map((item) => {
          const value = quantities[item.item_id];
          const factor = milli(String(item.conversion_factor));
          const large = milli(value.large);
          const small = milli(value.small);
          const counted = value.large !== "" || value.small !== "";
          const total = factor === null || large === null || small === null ? null : large * factor + small * BigInt(1000);
          const fractional = ["gr", "g", "mg", "ml", "kg", "l", "lít"].includes(item.small_unit.trim().toLocaleLowerCase());
          return <li className="inventory-count-item" key={item.item_id}>
            <div className="inventory-count-item-name"><strong>{item.item_name}</strong><span>{item.category}</span><small>1 {item.large_unit} = {Number(item.conversion_factor).toLocaleString("vi-VN", { maximumFractionDigits: 3 })} {item.small_unit}</small></div>
            <label className="field"><span>{item.large_unit}</span><input type="number" min="0" max="999999999999.999" step={fractional ? "0.001" : "1"} inputMode={fractional ? "decimal" : "numeric"} value={value.large} disabled={!editable || pending} onChange={(event) => {
              setQuantities((current) => ({ ...current, [item.item_id]: { ...current[item.item_id], large: event.currentTarget.value } }));
              markDirty(item.item_id, "large");
            }} /></label>
            <label className="field"><span>{item.small_unit}</span><input type="number" min="0" max="999999999999.999" step={fractional ? "0.001" : "1"} inputMode={fractional ? "decimal" : "numeric"} value={value.small} disabled={!editable || pending} onChange={(event) => {
              setQuantities((current) => ({ ...current, [item.item_id]: { ...current[item.item_id], small: event.currentTarget.value } }));
              markDirty(item.item_id, "small");
            }} /></label>
            <div className="inventory-count-total"><span>{counted ? "Tổng đơn vị gốc" : "Trạng thái"}</span><strong>{counted && total !== null ? `${formatMicro(total)} ${item.small_unit}` : counted ? "Số lượng chưa hợp lệ" : "Chưa kiểm"}</strong></div>
            {dirty[item.item_id]?.large ? <input type="hidden" name={`large_quantity_${item.item_id}`} value={value.large} /> : null}
            {dirty[item.item_id]?.small ? <input type="hidden" name={`small_quantity_${item.item_id}`} value={value.small} /> : null}
          </li>;
        })}
      </ul>
      {editable ? <>
        <button className="button button-primary" type="submit" disabled={pending || Object.keys(dirty).length === 0 || (submitted && Boolean(state?.success))}>{pending ? "Đang lưu…" : "Lưu bản nháp"}</button>
        <ActionMessage error={state?.error} success={state?.success} />
      </> : <p className="form-note">{finalized ? "Bản đã chốt, không thể sửa." : "Chỉ có thể sửa bản nháp của ngày hôm nay."}</p>}
    </form>
    {editable ? <FinalizeInventoryCountForm
      countId={countId}
      complete={missingItems.length === 0 && !pending && (Object.keys(dirty).length === 0 || (submitted && Boolean(state?.success)))}
    /> : null}
    <section className="inventory-missing" aria-live="polite">
      <h3>Còn thiếu: {missingItems.length} mặt hàng</h3>
      {missingItems.length ? <ul>{missingItems.map((item) => <li key={item.item_id}>{item.item_name}</li>)}</ul> : <p>Đã nhập số lượng cho tất cả mặt hàng.</p>}
    </section>
  </>;
}
