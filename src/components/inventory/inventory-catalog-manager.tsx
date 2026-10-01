"use client";

import { useActionState } from "react";
import {
  createInventoryItemAction,
  deactivateInventoryItemAction,
  updateInventoryItemAction,
  type InventoryCatalogActionState,
} from "@/app/(private)/inventory/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import type { InventoryCatalogItem } from "@/lib/inventory/catalog";

function CatalogFields({ item }: { item?: InventoryCatalogItem }) {
  return <div className="inventory-catalog-fields">
    <label className="field"><span>Tên mặt hàng</span><input name="name" defaultValue={item?.name} maxLength={120} required /></label>
    <label className="field"><span>Nhóm hàng</span><input name="category" defaultValue={item?.category} maxLength={120} required /></label>
    <label className="field"><span>Đơn vị lớn</span><input name="large_unit" defaultValue={item?.large_unit} maxLength={120} required /></label>
    <label className="field"><span>Hệ số quy đổi</span><input name="conversion_factor" type="number" min="0.001" max="99999999999.999" step="0.001" defaultValue={item ? String(item.conversion_factor) : undefined} required /></label>
    <label className="field"><span>Đơn vị gốc</span><input name="small_unit" defaultValue={item?.small_unit} maxLength={120} required /></label>
  </div>;
}

function CatalogItemRow({ item }: { item: InventoryCatalogItem }) {
  const [state, action, pending] = useActionState<InventoryCatalogActionState, FormData>(updateInventoryItemAction, undefined);
  const [deactivation, deactivate, deactivating] = useActionState<InventoryCatalogActionState, FormData>(deactivateInventoryItemAction, undefined);

  return <li>
    <details className="inventory-catalog-item">
      <summary>
        <span><strong>{item.name}</strong><small>{item.category} · 1 {item.large_unit} = {Number(item.conversion_factor).toLocaleString("vi-VN")} {item.small_unit}</small></span>
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
        </form> : null}
      </div>
    </details>
  </li>;
}

export function InventoryCatalogManager({ items }: { items: InventoryCatalogItem[] }) {
  const [state, action, pending] = useActionState<InventoryCatalogActionState, FormData>(createInventoryItemAction, undefined);

  return <>
    <section className="inventory-catalog-add">
      <div className="section-heading"><div><h2>Thêm mặt hàng</h2><p>Hệ số là số đơn vị gốc trong một đơn vị lớn.</p></div></div>
      <form className="inventory-catalog-form" action={action}>
        <CatalogFields />
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Đang thêm…" : "Thêm mặt hàng"}</button>
        <ActionMessage error={state?.error} success={state?.success} />
      </form>
    </section>
    <section className="inventory-catalog-list-section">
      <div className="section-heading"><div><h2>Danh mục mặt hàng</h2><p>{items.filter((item) => item.active).length} đang dùng · {items.length} tổng cộng</p></div></div>
      <p className="inventory-draft-note">Chỉnh sửa chỉ áp dụng cho bản kiểm và phiếu nhập mới. Lịch sử đã lưu giữ nguyên đơn vị và hệ số lúc ghi.</p>
      {items.length ? <ul className="inventory-catalog-list">{items.map((item) => <CatalogItemRow key={item.id} item={item} />)}</ul> : <p className="empty-inline">Danh mục đang trống.</p>}
    </section>
  </>;
}
