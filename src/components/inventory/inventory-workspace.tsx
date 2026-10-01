import Link from "next/link";
import { formatBusinessDate } from "@/lib/finance/format";
import type { InventoryItem } from "@/lib/inventory/catalog";
import type { InventoryCatalogItem } from "@/lib/inventory/catalog";
import type { InventoryReceipt } from "@/lib/inventory/receipts";
import type { InventoryCount, InventoryCountItem } from "@/lib/inventory/counts";
import { InventoryReceivingPanel } from "@/components/inventory/inventory-receiving-panel";
import { InventoryCountEditor, OpenInventoryCountForm } from "@/components/inventory/inventory-count-forms";
import { InventoryCatalogManager } from "@/components/inventory/inventory-catalog-manager";

export function InventoryWorkspace({
  basePath,
  items,
  catalogItems,
  receipts,
  tab,
  error,
  receivingError,
  canCreateReceipts,
  owner,
  date,
  today,
  weekStart,
  weekEnd,
  count,
  countItems,
  countError,
}: {
  basePath: string;
  items: InventoryItem[];
  catalogItems: InventoryCatalogItem[];
  receipts: InventoryReceipt[];
  tab: "stock" | "receiving" | "catalog";
  error: boolean;
  receivingError: boolean;
  canCreateReceipts: boolean;
  owner: boolean;
  date: string;
  today: string;
  weekStart: string;
  weekEnd: string;
  count: InventoryCount | null;
  countItems: InventoryCountItem[];
  countError: boolean;
}) {
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">QUẢN LÝ CỬA HÀNG</p><h1>Kho</h1><p>Danh mục hàng hóa và các đơn vị quy đổi.</p></div>
    </div>

    <nav className="inventory-tabs" aria-label="Kho">
      <Link className="inventory-tab" href={`${basePath}?tab=stock&date=${date}`} aria-current={tab === "stock" ? "page" : undefined}>Tồn kho</Link>
      <Link className="inventory-tab" href={`${basePath}?tab=receiving`} aria-current={tab === "receiving" ? "page" : undefined}>Nhập kho</Link>
      {owner ? <Link className="inventory-tab" href={`${basePath}?tab=catalog`} aria-current={tab === "catalog" ? "page" : undefined}>Danh mục</Link> : null}
    </nav>

    {tab === "catalog" && owner ? <section className="surface inventory-panel">{error
      ? <div className="empty-state"><h2>Chưa tải được danh mục</h2><p>Vui lòng tải lại trang sau ít phút.</p></div>
      : <InventoryCatalogManager items={catalogItems} />}</section> : tab === "stock" ? <>
      <form className="inventory-date-filter" method="get" action={basePath}>
        <input type="hidden" name="tab" value="stock" />
        <label className="field"><span>Ngày kiểm</span><input type="date" name="date" value={date} min={owner ? undefined : weekStart} max={owner ? today : weekEnd} /></label>
        <button className="button button-secondary" type="submit">Xem ngày</button>
        <span>{owner ? "Chủ xem mọi ngày." : "Nhân viên xem trong tuần hiện tại."}</span>
      </form>
      <section className="surface inventory-panel">
        {error ? <div className="empty-state"><h2>Chưa tải được danh mục</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : countError ? <div className="empty-state"><h2>Chưa tải được bản kiểm</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : count ? <>
          <div className="section-heading"><div><h2>Bản kiểm {formatBusinessDate(date, { day: "numeric", month: "long", year: "numeric" })}</h2></div><span className="status status-neutral">{count.status === "finalized" ? "Đã chốt" : "Bản nháp"}</span></div>
          <p className="inventory-draft-note">{count.status === "finalized"
            ? count.finalized_at
              ? `Đã chốt lúc ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(count.finalized_at))}.`
              : "Bản kiểm đã chốt."
            : "Bản nháp chưa phải mốc tồn kho."}</p>
          <InventoryCountEditor key={count.id} countId={count.id} items={countItems} editable={count.status === "draft" && (owner || date === today)} finalized={count.status === "finalized"} />
        </> : <>
          <div className="section-heading"><div><h2>Chưa mở bản kiểm</h2><p>{formatBusinessDate(date, { day: "numeric", month: "long", year: "numeric" })} · {items.length} mặt hàng đang hoạt động</p></div></div>
          {owner || date === today ? <OpenInventoryCountForm date={date} /> : <p className="form-note">Nhân viên chỉ mở bản kiểm cho ngày hôm nay.</p>}
          {error ? null : items.length === 0 ? <div className="empty-state"><h2>Chưa có mặt hàng</h2><p>Danh mục sẽ xuất hiện sau khi dữ liệu kho được khởi tạo.</p></div> : <ul className="inventory-item-list">{items.map((item) => <li className="inventory-item" key={item.id}><div className="inventory-item-heading"><strong>{item.name}</strong><span className="status status-neutral">{item.category}</span></div><p>1 {item.large_unit} = {Number(item.conversion_factor).toLocaleString("vi-VN")} {item.small_unit}</p></li>)}</ul>}
        </>}
      </section>
    </> : <InventoryReceivingPanel items={items} receipts={receipts} receivingError={receivingError} canCreate={canCreateReceipts} owner={owner} today={today} />}
  </>;
}
