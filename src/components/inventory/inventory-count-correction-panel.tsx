"use client";

import { useActionState, useState } from "react";
import { correctFinalizedInventoryCountAction, getInventoryCountCorrectionsAction, type InventoryCountActionState } from "@/app/(private)/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatInventoryQuantity, type InventoryCount, type InventoryCountItem } from "@/lib/inventory/counts";
import type { InventoryCountCorrection, InventoryCountCorrectionPage } from "@/lib/inventory/count-corrections";
import { quantityAllowsFractional } from "@/lib/inventory/quantity-input";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

function formatInput(item: InventoryCountCorrection["prior_items"][number]) {
  if (!item.large_unit) return `${formatInventoryQuantity(item.small_quantity) ?? "—"} ${item.small_unit}`;
  if (item.conversion_factor == null) return `${formatInventoryQuantity(item.large_quantity) ?? "—"} ${item.large_unit} + ${formatInventoryQuantity(item.small_quantity) ?? "—"} ${item.small_unit}`;
  return `${formatInventoryQuantity(item.large_quantity) ?? "—"} ${item.large_unit} + ${formatInventoryQuantity(item.small_quantity) ?? "—"} ${item.small_unit} = ${formatInventoryQuantity(item.counted_quantity) ?? "Chưa kiểm"} ${item.small_unit}`;
}

function changed(before: InventoryCountCorrection["prior_items"][number], after: InventoryCountCorrection["updated_items"][number]) {
  return String(before.large_quantity) !== String(after.large_quantity)
    || String(before.small_quantity) !== String(after.small_quantity)
    || String(before.counted_quantity) !== String(after.counted_quantity);
}

export function InventoryCountCorrectionPanel({
  count,
  items,
}: {
  count: InventoryCount;
  items: InventoryCountItem[];
}) {
  const [state, action, pending] = useActionState<InventoryCountActionState, FormData>(correctFinalizedInventoryCountAction, undefined);
  const [corrections, setCorrections] = useState<InventoryCountCorrection[]>([]);
  const [historyOpened, setHistoryOpened] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<InventoryCountCorrectionPage["nextCursor"]>(null);

  async function loadHistory(cursor: InventoryCountCorrectionPage["nextCursor"] = null) {
    if (historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const page = await getInventoryCountCorrectionsAction(count.id, cursor);
      if (page.error) {
        setHistoryError(true);
        return;
      }
      setCorrections((current) => cursor ? [...current, ...page.data] : page.data);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setHistoryLoaded(true);
    } catch {
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  }

  return <section className="surface inventory-panel">
    <div className="section-heading"><div><h2>Hiệu chỉnh bản kiểm đã chốt</h2><p>Nhập lý do bắt buộc. Thời điểm chốt và ranh giới kỳ giữ nguyên.</p></div></div>
    <form className="inventory-count-form" action={action}>
      <input type="hidden" name="count_id" value={count.id} />
      <ul className="inventory-count-list">
        {items.map((item) => {
          const fractional = quantityAllowsFractional(item.small_unit);
          const hasPackage = Boolean(item.large_unit);
          const hasConversion = hasPackage && item.conversion_factor != null;
          const countLargeUnitOnly = hasConversion && Boolean(item.count_large_unit_only);
          const savedQuantity = hasPackage && item.conversion_factor == null
            ? `${formatInventoryQuantity(item.large_quantity) ?? "—"} ${item.large_unit} + ${formatInventoryQuantity(item.small_quantity) ?? "—"} ${item.small_unit}`
            : `${formatInventoryQuantity(item.counted_quantity) ?? "—"} ${item.small_unit}`;
          return <li className={`inventory-count-item${!hasPackage || countLargeUnitOnly ? " inventory-count-item-large-only" : ""}`} key={item.item_id}>
            <div className="inventory-count-item-name"><strong>{item.item_name}</strong><span>{item.category}</span><small>Đã lưu: {savedQuantity}</small></div>
            {hasPackage && !countLargeUnitOnly ? <label className="field"><span>{item.large_unit}</span><input type="number" name={`large_quantity_${item.item_id}`} min="0" max="999999999999.999" step="1" inputMode="numeric" defaultValue={item.large_quantity ?? ""} /></label> : null}
            {countLargeUnitOnly ? <label className="field"><span>{item.large_unit}</span><input type="number" name={`large_quantity_${item.item_id}`} min="0" max="999999999999.999" step="1" inputMode="numeric" defaultValue={item.large_quantity ?? ""} /></label> : null}
            {!hasPackage ? <input type="hidden" name={`large_quantity_${item.item_id}`} value="" /> : null}
            {countLargeUnitOnly ? <input type="hidden" name={`small_quantity_${item.item_id}`} value="" /> : <label className="field"><span>{item.small_unit}</span><input type="number" name={`small_quantity_${item.item_id}`} min="0" max="999999999999.999" step={fractional ? "0.001" : "1"} inputMode={fractional ? "decimal" : "numeric"} defaultValue={item.small_quantity ?? ""} /></label>}
          </li>;
        })}
      </ul>
      <label className="field inventory-correction-reason"><span>Lý do hiệu chỉnh</span><textarea name="reason" required maxLength={500} rows={2} /></label>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu hiệu chỉnh"}</button>
      <ActionMessage error={state?.error} success={state?.success} />
    </form>

    <section className="inventory-movement-block">
      <div className="section-heading"><div><h3>Lịch sử hiệu chỉnh{historyLoaded ? ` (${corrections.length}${hasMore ? "+" : ""})` : ""}</h3>
        <p>Lịch sử chỉ được tải khi bạn mở; mỗi lượt hiển thị tối đa 20 lần.</p></div>
        {!historyOpened ? <button className="button button-secondary" type="button" onClick={() => {
          setHistoryOpened(true);
          void loadHistory();
        }}>Mở lịch sử hiệu chỉnh</button> : null}
      </div>
      {!historyOpened ? <p className="empty-inline">Chưa tải lịch sử hiệu chỉnh.</p>
        : historyLoading && !historyLoaded ? <p className="empty-inline" role="status">Đang tải lịch sử hiệu chỉnh…</p>
          : historyError ? <div><p className="empty-inline" role="alert">Chưa tải được lịch sử hiệu chỉnh.</p>
            <button className="button button-secondary" type="button" disabled={historyLoading} onClick={() => void loadHistory()}>{historyLoading ? "Đang tải…" : "Thử tải lại"}</button></div>
            : corrections.length === 0 ? <p className="empty-inline">Chưa có lần hiệu chỉnh.</p>
              : <div className="inventory-period-list">{corrections.map((correction) => {
          const updated = new Map(correction.updated_items.map((item) => [item.item_id, item]));
          const differences = correction.prior_items.flatMap((before) => {
            const after = updated.get(before.item_id);
            return after && changed(before, after) ? [{ before, after }] : [];
          });
          return <details className="inventory-period" key={correction.id}>
            <summary>{formatTimestamp(correction.corrected_at)} · {correction.corrected_by_label}</summary>
            <p>Lý do: {correction.reason}</p>
            {differences.length === 0 ? <p className="empty-inline">Không đổi số lượng mặt hàng.</p> : <ul className="inventory-receipt-lines">{differences.map(({ before, after }) => <li key={before.item_id}>
              <div><strong>{before.item_name}</strong><span>Trước: {formatInput(before)}</span><span>Sau: {formatInput(after)}</span></div>
            </li>)}</ul>}
          </details>;
        })}</div>}
      {historyOpened && historyLoaded && hasMore && !historyError ? <button className="button button-secondary" type="button" disabled={historyLoading}
        onClick={() => void loadHistory(nextCursor)}>{historyLoading ? "Đang tải…" : "Tải thêm lần hiệu chỉnh"}</button> : null}
    </section>
  </section>;
}
