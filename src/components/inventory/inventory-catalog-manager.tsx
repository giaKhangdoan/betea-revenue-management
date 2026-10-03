"use client";

import { useActionState } from "react";
import {
  createInventoryItemAction,
  deactivateInventoryItemAction,
  reactivateInventoryItemAction,
  updateInventoryItemAction,
  type InventoryCatalogActionState,
} from "@/app/(private)/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import type { InventoryCatalogItem } from "@/lib/inventory/catalog";

function CatalogFields({ item }: { item?: InventoryCatalogItem }) {
  return <div className="inventory-catalog-fields">
    <label className="field"><span>Tên mặt hàng</span><input name="name" defaultValue={item?.name} maxLength={120} required /></label>
    <label className="field"><span>Nhóm hàng</span><input name="category" defaultValue={item?.category} maxLength={120} required /></label>
    <label className="field"><span>Đơn vị nhập (nếu có)</span><input name="large_unit" defaultValue={item?.large_unit ?? ""} maxLength={120} /></label>
    <label className="field"><span>Hệ số quy đổi (nếu biết)</span><input name="conversion_factor" type="number" min="0.001" max="99999999999.999" step="0.001" placeholder="Để trống nếu không quy đổi" defaultValue={item?.conversion_factor == null ? "" : String(item.conversion_factor)} /></label>
    <label className="field"><span>Đơn vị tồn / đơn vị thứ hai</span><input name="small_unit" defaultValue={item?.small_unit} maxLength={120} required /></label>
    <label className="inventory-checkbox"><input type="checkbox" name="count_large_unit_only" defaultChecked={item?.count_large_unit_only} /><span>Chỉ kiểm theo đơn vị nhập</span></label>
  </div>;
}

function unitSummary(item: InventoryCatalogItem) {
  if (!item.large_unit) return `Tồn theo ${item.small_unit}`;
  if (item.conversion_factor == null) return `Ghi riêng ${item.large_unit} và ${item.small_unit}`;
  return item.count_large_unit_only
    ? `Chỉ kiểm ${item.large_unit}`
    : `1 ${item.large_unit} = ${Number(item.conversion_factor).toLocaleString("vi-VN")} ${item.small_unit}`;
}

function CatalogItemRow({ item }: { item: InventoryCatalogItem }) {
  const [state, action, pending] = useActionState<InventoryCatalogActionState, FormData>(updateInventoryItemAction, undefined);
  const [deactivation, deactivate, deactivating] = useActionState<InventoryCatalogActionState, FormData>(deactivateInventoryItemAction, undefined);
  const [reactivation, reactivate, reactivating] = useActionState<InventoryCatalogActionState, FormData>(reactivateInventoryItemAction, undefined);

  return <li>
    <details className="inventory-catalog-item">
      <summary>
        <span><strong>{item.name}</strong><small>{item.category} · {unitSummary(item)}</small></span>
        <span className="status status-neutral">{item.active ? "Đang dùng" : "Ngừng dùng"}</span>
      </summary>
      <div className="inventory-catalog-item-content">
        <form className="inventory-catalog-form" action={action}>
          <input type="hidden" name="item_id" value={item.id} />
          <CatalogFields item={item} />
          <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu thay đổi"}</button>
          <ActionMessage error={state?.error} success={state?.success} />
        </form>
        {item.active ? <form action={deactivate}>
          <input type="hidden" name="item_id" value={item.id} />
          <button className="button button-secondary" type="submit" disabled={deactivating}>{deactivating ? "Đang cập nhật…" : "Ngừng dùng mặt hàng"}</button>
          <ActionMessage error={deactivation?.error} success={deactivation?.success} />
        </form> : <form action={reactivate}>
          <input type="hidden" name="item_id" value={item.id} />
          <button className="button button-secondary" type="submit" disabled={reactivating}>{reactivating ? "Đang cập nhật…" : "Dùng lại mặt hàng"}</button>
          <ActionMessage error={reactivation?.error} success={reactivation?.success} />
        </form>}
      </div>
    </details>
  </li>;
}

export function InventoryCatalogManager({ items }: { items: InventoryCatalogItem[] }) {
  const [state, action, pending] = useActionState<InventoryCatalogActionState, FormData>(createInventoryItemAction, undefined);
  const activeItems = items.filter((item) => item.active);
  const inactiveItems = items.filter((item) => !item.active);

  return <>
    <section className="inventory-catalog-add">
      <div className="section-heading"><div><h2>Thêm mặt hàng</h2><p>Để trống đơn vị nhập nếu chỉ kiểm một đơn vị. Có thể nhập hai đơn vị riêng mà không cộng quy đổi.</p></div></div>
      <form className="inventory-catalog-form" action={action}>
        <CatalogFields />
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Đang thêm…" : "Thêm mặt hàng"}</button>
        <ActionMessage error={state?.error} success={state?.success} />
      </form>
    </section>
    <section className="inventory-catalog-list-section">
      <div className="section-heading"><div><h2>Danh mục mặt hàng</h2><p>{activeItems.length} đang dùng · {items.length} tổng cộng</p></div></div>
      <p className="inventory-draft-note">Chỉnh sửa chỉ áp dụng cho bản kiểm và phiếu nhập mới. Lịch sử đã lưu giữ nguyên đơn vị và hệ số lúc ghi.</p>
      {activeItems.length ? <ul className="inventory-catalog-list">{activeItems.map((item) => <CatalogItemRow key={item.id} item={item} />)}</ul> : <p className="empty-inline">Chưa có mặt hàng đang dùng.</p>}
      {inactiveItems.length ? <details className="inventory-inactive-items">
        <summary>Đã ngừng dùng ({inactiveItems.length})</summary>
        <ul className="inventory-catalog-list">{inactiveItems.map((item) => <CatalogItemRow key={item.id} item={item} />)}</ul>
      </details> : null}
    </section>
  </>;
}
