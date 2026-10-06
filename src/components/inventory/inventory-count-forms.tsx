"use client";

import { createContext, useActionState, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { finalizeInventoryCountAction, openInventoryCountAction, saveInventoryCountDraftAction, type InventoryCountActionState } from "@/app/(private)/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import type { InventoryCountItem } from "@/lib/inventory/counts";
import { collectInventoryDraftChanges, queueInventorySave } from "@/lib/inventory/autosave";
import { formatCombinedQuantity, milli, preventInvalidQuantityKey, preventInvalidQuantityPaste, quantityAllowsFractional } from "@/lib/inventory/quantity-input";

type InventoryCountNavigation = {
  registerFlush: (flush: (() => Promise<boolean>) | null) => void;
  leave: () => void;
  discardAndLeave: () => void;
  pending: boolean;
  failed: boolean;
};

const inventoryCountNavigation = createContext<InventoryCountNavigation | null>(null);

export function InventoryCountNavigationProvider({ destination, children }: { destination: string; children: ReactNode }) {
  const router = useRouter();
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const registerFlush = useCallback((flush: (() => Promise<boolean>) | null) => { flushRef.current = flush; }, []);
  const discardAndLeave = useCallback(() => router.push(destination), [destination, router]);
  const leave = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      const saved = await (flushRef.current?.() ?? Promise.resolve(true));
      if (saved) router.push(destination);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [destination, router]);
  const value = useMemo(() => ({ registerFlush, leave, discardAndLeave, pending, failed }), [registerFlush, leave, discardAndLeave, pending, failed]);

  return <inventoryCountNavigation.Provider value={value}>{children}</inventoryCountNavigation.Provider>;
}

export function InventoryCountDashboardBackButton() {
  const navigation = useContext(inventoryCountNavigation);
  if (!navigation) return null;

  return <div className="inventory-dashboard-back">
    <button className="button button-secondary" type="button" aria-label="Về Dashboard" title="Về Dashboard" onClick={navigation.leave} disabled={navigation.pending}>
      ←
    </button>
    {navigation.failed ? <div className="inventory-back-failure" role="alert">
      <p>Chưa lưu được bản kiểm. Hãy thử lại hoặc bỏ thay đổi chưa lưu.</p>
      <button className="button button-secondary" type="button" onClick={navigation.leave} disabled={navigation.pending}>Thử lưu lại</button>
      <button className="button button-secondary" type="button" onClick={navigation.discardAndLeave}>Bỏ thay đổi và về Dashboard</button>
    </div> : null}
  </div>;
}

function useRegisterInventoryCountFlush(flush: () => Promise<boolean>) {
  const navigation = useContext(inventoryCountNavigation);
  useEffect(() => {
    navigation?.registerFlush(flush);
    return () => navigation?.registerFlush(null);
  }, [flush, navigation]);
}

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

function formatMicro(value: bigint): string {
  const scale = BigInt(1_000_000);
  const whole = value / scale;
  const fraction = String(value % scale).padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("vi-VN")}${fraction ? `,${fraction}` : ""}`;
}

function isCounted(item: InventoryCountItem, value: { large: string; small: string }) {
  if (item.large_unit && item.conversion_factor != null && item.count_large_unit_only) return value.large !== "";
  return item.large_unit ? value.large !== "" || value.small !== "" : value.small !== "";
}

type CountField = "large" | "small";
type CountQuantities = Record<string, { large: string; small: string }>;
type DirtyCountFields = Record<string, Partial<Record<CountField, true>>>;

export function InventoryCountEditor({ countId, items, editable, finalized = false, needsRecountItemIds = [] }: { countId: string; items: InventoryCountItem[]; editable: boolean; finalized?: boolean; needsRecountItemIds?: string[] }) {
  const initial = Object.fromEntries(items.map((item) => [item.item_id, {
    large: item.large_quantity == null ? "" : String(item.large_quantity),
    small: item.small_quantity == null ? "" : String(item.small_quantity),
  }])) as CountQuantities;
  const [quantities, setQuantities] = useState(initial);
  const quantitiesRef = useRef(initial);
  const savedQuantitiesRef = useRef(initial);
  const [dirty, setDirty] = useState<DirtyCountFields>({});
  const dirtyRef = useRef<DirtyCountFields>({});
  const [pendingSaves, setPendingSaves] = useState(0);
  const pendingSavesRef = useRef(0);
  const [saveError, setSaveError] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const recountItemIdsRef = useRef(new Set<string>());
  const categoryRefs = useRef(new Map<string, HTMLDetailsElement>());
  const needsRecountItems = new Set(needsRecountItemIds);
  const missingItems = items.filter((item) => !isCounted(item, quantities[item.item_id]));
  const categories = [...items.reduce((groups, item) => {
    const category = item.category || "Chưa phân loại";
    const group = groups.get(category);
    if (group) group.push(item);
    else groups.set(category, [item]);
    return groups;
  }, new Map<string, InventoryCountItem[]>())];

  function collapseSavedCategories() {
    for (const [category, categoryItems] of categories) {
      const counted = categoryItems.every((item) => isCounted(item, quantitiesRef.current[item.item_id]));
      const saved = categoryItems.every((item) => !dirtyRef.current[item.item_id]
        || (!dirtyRef.current[item.item_id]?.large && !dirtyRef.current[item.item_id]?.small));
      if (counted && saved) {
        const group = categoryRefs.current.get(category);
        if (group) group.open = false;
      }
    }
  }

  function setItemQuantity(item: InventoryCountItem, next: { large: string; small: string }) {
    const nextQuantities = { ...quantitiesRef.current, [item.item_id]: next };
    quantitiesRef.current = nextQuantities;
    setQuantities(nextQuantities);
  }

  function markDirty(itemId: string, field: CountField) {
    const nextDirty = {
      ...dirtyRef.current,
      [itemId]: { ...dirtyRef.current[itemId], [field]: true },
    };
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
    setSaveStatus("unsaved");
  }

  function collectDirtyQuantities() {
    const result = collectInventoryDraftChanges({
      current: quantitiesRef.current,
      saved: savedQuantitiesRef.current,
      dirty: dirtyRef.current,
      recountItemIds: recountItemIdsRef.current,
    });
    dirtyRef.current = result.dirty;
    setDirty(result.dirty);
    return result.changes;
  }

  function confirmItemRecount(itemId: string) {
    recountItemIdsRef.current.add(itemId);
    void flushChanges();
  }

  function flushChanges() {
    pendingSavesRef.current += 1;
    setPendingSaves(pendingSavesRef.current);
    setSaveStatus("saving");

    const save = queueInventorySave(saveQueueRef.current, async () => {
      const changes = collectDirtyQuantities();
      if (changes.length === 0) {
        collapseSavedCategories();
        return true;
      }

      const formData = new FormData();
      formData.set("count_id", countId);
      for (const change of changes) {
        if (change.large_quantity !== undefined) formData.set(`large_quantity_${change.item_id}`, change.large_quantity ?? "");
        if (change.small_quantity !== undefined) formData.set(`small_quantity_${change.item_id}`, change.small_quantity ?? "");
      }

      try {
        const result = await saveInventoryCountDraftAction(undefined, formData);
        if (result?.error) {
          setSaveError(result.error);
          return false;
        }
      } catch {
        const error = "Không thể lưu bản kiểm. Kiểm tra kết nối và thử lại.";
        setSaveError(error);
        return false;
      }

      const nextSaved = { ...savedQuantitiesRef.current };
      const nextDirty = Object.fromEntries(Object.entries(dirtyRef.current).map(([itemId, fields]) => [itemId, { ...fields }])) as DirtyCountFields;
      for (const change of changes) {
        recountItemIdsRef.current.delete(change.item_id);
        const saved = { ...nextSaved[change.item_id] };
        const fields = nextDirty[change.item_id];
        if (change.large_quantity !== undefined) {
          saved.large = change.large_quantity ?? "";
          if (quantitiesRef.current[change.item_id].large === saved.large && fields) delete fields.large;
        }
        if (change.small_quantity !== undefined) {
          saved.small = change.small_quantity ?? "";
          if (quantitiesRef.current[change.item_id].small === saved.small && fields) delete fields.small;
        }
        nextSaved[change.item_id] = saved;
        if (fields && !fields.large && !fields.small) delete nextDirty[change.item_id];
      }
      savedQuantitiesRef.current = nextSaved;
      dirtyRef.current = nextDirty;
      setDirty(nextDirty);
      setSaveError(undefined);
      collapseSavedCategories();
      return true;
    });

    const trackedSave = save.catch(() => false).finally(() => {
      pendingSavesRef.current -= 1;
      setPendingSaves(pendingSavesRef.current);
      if (pendingSavesRef.current === 0) {
        setSaveStatus(Object.keys(dirtyRef.current).length ? "unsaved" : "saved");
      }
    });
    saveQueueRef.current = trackedSave;
    return trackedSave;
  }

  useRegisterInventoryCountFlush(flushChanges);

  const hasUnsavedChanges = Object.keys(dirty).length > 0 || pendingSaves > 0 || Boolean(saveError);
  useEffect(() => {
    if (!editable || !hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editable, hasUnsavedChanges]);

  return <>
    <p className="inventory-count-progress">Đã kiểm {items.length - missingItems.length}/{items.length} mặt hàng.</p>
    <form className="inventory-count-form" onSubmit={(event) => { event.preventDefault(); void flushChanges(); }}>
      <ul className="inventory-count-list">
        {categories.map(([category, categoryItems]) => {
          const categoryCounted = categoryItems.filter((item) => isCounted(item, quantities[item.item_id])).length;
          return <li className="inventory-count-category" key={category}>
          <details className="inventory-count-group" ref={(element) => {
            if (element) categoryRefs.current.set(category, element);
            else categoryRefs.current.delete(category);
          }}>
            <summary><strong>{category}</strong><span>{categoryCounted}/{categoryItems.length} đã kiểm</span></summary>
            <ul className="inventory-count-group-items">
        {categoryItems.map((item) => {
          const value = quantities[item.item_id];
          const hasPackage = Boolean(item.large_unit);
          const hasConversion = hasPackage && item.conversion_factor != null;
          const countLargeUnitOnly = hasConversion && Boolean(item.count_large_unit_only);
          const oneToOneUnits = hasConversion && !countLargeUnitOnly && Number(item.conversion_factor) === 1
            && item.large_unit!.trim().toLocaleLowerCase("vi-VN") === item.small_unit.trim().toLocaleLowerCase("vi-VN");
          const factor = hasConversion ? milli(String(item.conversion_factor)) : null;
          const large = milli(value.large);
          const small = milli(value.small);
          const counted = isCounted(item, value);
          const needsRecount = needsRecountItems.has(item.item_id);
          const total = factor === null || large === null || small === null ? null : large * factor + small * BigInt(1000);
          const fractional = quantityAllowsFractional(item.small_unit);
          return <li className={`inventory-count-item${counted ? " inventory-count-item-counted" : ""}`} key={item.item_id}>
            <div className="inventory-count-item-name"><strong>{item.item_name}</strong><small>{oneToOneUnits ? `Đơn vị: ${item.small_unit}` : hasConversion && !countLargeUnitOnly ? `1 ${item.large_unit} = ${Number(item.conversion_factor).toLocaleString("vi-VN", { maximumFractionDigits: 3 })} ${item.small_unit}` : hasPackage && !countLargeUnitOnly ? "Ghi riêng từng đơn vị, không tự cộng." : item.category}</small></div>
            {oneToOneUnits ? <label className="field inventory-count-unit-small"><span>Số lượng ({item.small_unit})</span><input type="number" min="0" max="999999999999.999" step={fractional ? "0.001" : "1"} inputMode={fractional ? "decimal" : "numeric"} value={formatCombinedQuantity(value.large, value.small)} disabled={!editable} onKeyDown={(event) => preventInvalidQuantityKey(event, fractional)} onPaste={(event) => preventInvalidQuantityPaste(event, fractional)} onBlur={() => { void flushChanges(); }} onChange={(event) => {
              const quantity = event.currentTarget.value;
              setItemQuantity(item, { large: "", small: quantity });
              markDirty(item.item_id, "large");
              markDirty(item.item_id, "small");
            }} /></label> : null}
            {hasConversion && countLargeUnitOnly ? <label className="field inventory-count-unit-large"><span>{item.large_unit}</span><input type="number" min="0" max="999999999999.999" step="1" inputMode="numeric" value={value.large} disabled={!editable} onKeyDown={(event) => preventInvalidQuantityKey(event, false)} onPaste={(event) => preventInvalidQuantityPaste(event, false)} onBlur={() => { void flushChanges(); }} onChange={(event) => {
              const quantity = event.currentTarget.value;
              setItemQuantity(item, { ...quantities[item.item_id], large: quantity });
              markDirty(item.item_id, "large");
            }} /></label> : null}
            {hasPackage && !countLargeUnitOnly && !oneToOneUnits ? <label className="field inventory-count-unit-large"><span>{item.large_unit}</span><input type="number" min="0" max="999999999999.999" step="1" inputMode="numeric" value={value.large} disabled={!editable} onKeyDown={(event) => preventInvalidQuantityKey(event, false)} onPaste={(event) => preventInvalidQuantityPaste(event, false)} onBlur={() => { void flushChanges(); }} onChange={(event) => {
              const quantity = event.currentTarget.value;
              setItemQuantity(item, { ...quantities[item.item_id], large: quantity });
              markDirty(item.item_id, "large");
            }} /></label> : null}
            {(!hasPackage || !countLargeUnitOnly) && !oneToOneUnits ? <label className="field inventory-count-unit-small"><span>{item.small_unit}</span><input type="number" min="0" max="999999999999.999" step={fractional ? "0.001" : "1"} inputMode={fractional ? "decimal" : "numeric"} value={value.small} disabled={!editable} onKeyDown={(event) => preventInvalidQuantityKey(event, fractional)} onPaste={(event) => preventInvalidQuantityPaste(event, fractional)} onBlur={() => { void flushChanges(); }} onChange={(event) => {
              const quantity = event.currentTarget.value;
              setItemQuantity(item, { ...quantities[item.item_id], small: quantity });
              markDirty(item.item_id, "small");
            }} /></label> : null}
            <div className="inventory-count-total"><span>Trạng thái</span><strong>{needsRecount ? "Cần kiểm lại" : counted ? "Đã kiểm" : "Chưa kiểm"}</strong>
              {counted && hasConversion && !countLargeUnitOnly && total !== null ? <small>Tổng: {formatMicro(total)} {item.small_unit}</small> : null}
            </div>
            {needsRecount ? <div className="inventory-count-recheck">
              <p>Có phiếu nhập sau lần kiểm. Hãy kiểm tra thực tế rồi xác nhận số lượng hiện tại.</p>
              {editable ? <button className="button button-secondary" type="button" disabled={pendingSaves > 0} onClick={() => confirmItemRecount(item.item_id)}>
                {pendingSaves > 0 ? "Đang lưu…" : "Tôi đã kiểm lại"}
              </button> : null}
            </div> : null}
          </li>;
        })}
            </ul>
          </details>
          </li>;
        })}
      </ul>
      {editable ? <>
        <ActionMessage error={saveError ? `Chưa lưu được: ${saveError}` : undefined} />
        {saveError ? <button className="button button-secondary" type="button" disabled={pendingSaves > 0} onClick={() => { void flushChanges(); }}>Thử lưu lại</button> : <p className="form-note" role="status" aria-live="polite">{saveStatus === "saving" ? "Đang lưu…" : saveStatus === "unsaved" ? "Chưa lưu thay đổi." : "Đã lưu."}</p>}
      </> : <p className="form-note">{finalized ? "Bản đã chốt." : "Chỉ có thể sửa bản nháp của ngày hôm nay."}</p>}
    </form>
    {editable ? <FinalizeInventoryCountForm
      countId={countId}
      complete={missingItems.length === 0 && needsRecountItemIds.length === 0 && pendingSaves === 0 && Object.keys(dirty).length === 0}
    /> : null}
  </>;
}
