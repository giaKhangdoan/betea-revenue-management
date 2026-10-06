import Link from "next/link";
import { formatBusinessDate, monthStart } from "@/lib/finance/format";
import type { InventoryItem } from "@/lib/inventory/catalog";
import type { InventoryCatalogItem } from "@/lib/inventory/catalog";
import type { InventoryLatestItemReceipt, InventoryReceipt } from "@/lib/inventory/receipts";
import { formatInventoryQuantity, type InventoryCount, type InventoryCountItem, type InventoryMovementSummary, type InventoryStockSnapshot } from "@/lib/inventory/counts";
import { InventoryReceivingPanel } from "@/components/inventory/inventory-receiving-panel";
import { InventoryCountDashboardBackButton, InventoryCountEditor, InventoryCountNavigationProvider, OpenInventoryCountForm } from "@/components/inventory/inventory-count-forms";
import { InventoryCatalogManager } from "@/components/inventory/inventory-catalog-manager";

function formatInventoryTimestamp(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

function countQuantity(item: { large_unit?: string | null; conversion_factor?: number | string | null; large_quantity?: string | number | null; small_quantity?: string | number | null; count_large_unit_only?: boolean; counted_quantity: string | number | null; small_unit: string }) {
  if (item.count_large_unit_only && item.large_unit) {
    return `${formatInventoryQuantity(item.large_quantity ?? null) ?? "—"} ${item.large_unit}`;
  }
  if (item.large_unit && item.conversion_factor == null) {
    return `${formatInventoryQuantity(item.large_quantity ?? null) ?? "—"} ${item.large_unit} + ${formatInventoryQuantity(item.small_quantity ?? null) ?? "—"} ${item.small_unit}`;
  }
  return `${formatInventoryQuantity(item.counted_quantity) ?? "—"} ${item.small_unit}`;
}

function InventoryStockSnapshotPanel({
  items,
  snapshot,
  error,
  latestReceipts,
  latestReceiptsError,
}: {
  items: InventoryItem[];
  snapshot: InventoryStockSnapshot | null;
  error: boolean;
  latestReceipts: InventoryLatestItemReceipt[];
  latestReceiptsError: boolean;
}) {
  const countedByItem = new Map((snapshot?.items ?? []).map((item) => [item.item_id, item]));
  const latestReceiptByItem = new Map(latestReceipts.map((receipt) => [receipt.item_id, receipt]));
  const countedItemCount = items.filter((item) => countedByItem.has(item.id)).length;

  return <section className="surface inventory-panel inventory-stock-panel">
    {error ? <div className="empty-state"><h2>Chưa tải được tồn kho</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : snapshot ? <>
      <div className="section-heading"><div><h2>Hàng còn lại</h2><p>{items.length} mặt hàng · {countedItemCount} có số kiểm gần nhất · {items.length - countedItemCount} chưa kiểm sau khi thêm mới</p><p>Lần kiểm gần nhất · {formatBusinessDate(snapshot.business_date, { day: "numeric", month: "long", year: "numeric" })} · {formatInventoryTimestamp(snapshot.finalized_at)}</p></div><span className={`status ${snapshot.history_integrity?.status === "unverified" ? "status-warning" : "status-success"}`}>{snapshot.history_integrity?.status === "unverified" ? "Cần đối chiếu" : "Đã kiểm"}</span></div>
      {snapshot.history_integrity?.status === "unverified" ? <p className="inventory-history-warning" role="status">Dữ liệu của lần kiểm này chưa xác minh được toàn bộ lịch sử. Số lượng bên dưới là số đang lưu hiện tại.</p> : null}
      {latestReceiptsError ? <p className="inventory-history-warning" role="status">Chưa tải được phiếu nhập mới nhất cho các mặt hàng chưa có số kiểm.</p> : null}
      {items.length === 0 ? <p className="empty-inline">Chưa có mặt hàng đang hoạt động.</p> : <ul className="inventory-stock-list">{items.map((item) => {
        const counted = countedByItem.get(item.id);
        const latestReceipt = latestReceiptByItem.get(item.id);
        const receivedQuantity = latestReceipt?.lines.map(receiptQuantity).join(" + ");
        const label = counted
          ? `Số tại lần kiểm · ${formatBusinessDate(snapshot.business_date)}`
          : latestReceipt
            ? `Theo phiếu ${latestReceipt.receipt_code} · ${formatInventoryTimestamp(latestReceipt.received_at)} · chưa kiểm`
            : latestReceiptsError
              ? "Chưa tải được số nhập gần nhất"
              : "Chưa có số kiểm hoặc phiếu nhập";
        return <li className="inventory-stock-card" key={item.id}>
          <div className="inventory-stock-item-name"><span>{item.category}</span><strong>{item.name}</strong><small>{label}</small></div>
          <strong className="inventory-stock-quantity">{counted ? countQuantity(counted) : receivedQuantity || "—"}</strong>
        </li>;
      })}</ul>}
    </> : error ? <div className="empty-state"><h2>Chưa tải được tồn kho</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : <>
      <div className="section-heading"><div><h2>Hàng trong kho</h2><p>{items.length} mặt hàng · chưa có bản kiểm đã chốt</p></div><span className="status status-warning">Chưa kiểm</span></div>
      <p className="inventory-movement-note">Mặt hàng chưa kiểm hiển thị số lượng theo phiếu nhập gần nhất để tiện theo dõi.</p>
      {latestReceiptsError ? <p className="inventory-history-warning" role="status">Chưa tải được phiếu nhập mới nhất.</p> : null}
      {items.length === 0 ? <p className="empty-inline">Chưa có mặt hàng đang hoạt động.</p> : <ul className="inventory-stock-list">{items.map((item) => {
        const latestReceipt = latestReceiptByItem.get(item.id);
        const receivedQuantity = latestReceipt?.lines.map(receiptQuantity).join(" + ");
        const label = latestReceipt
          ? `Theo phiếu ${latestReceipt.receipt_code} · ${formatInventoryTimestamp(latestReceipt.received_at)} · chưa kiểm`
          : latestReceiptsError
            ? "Chưa tải được số nhập gần nhất"
            : "Chưa có số kiểm hoặc phiếu nhập";
        return <li className="inventory-stock-card" key={item.id}>
          <div className="inventory-stock-item-name"><span>{item.category}</span><strong>{item.name}</strong><small>{label}</small></div>
          <strong className="inventory-stock-quantity">{receivedQuantity || "—"}</strong>
        </li>;
      })}</ul>}
    </>}
  </section>;
}

function receiptQuantity(line: InventoryMovementSummary["receiptsSinceLatest"][number]["lines"][number]) {
  return line.large_unit
    ? `${formatInventoryQuantity(line.large_quantity ?? null) ?? "—"} ${line.large_unit} + ${formatInventoryQuantity(line.loose_quantity ?? null) ?? "—"} ${line.small_unit}`
    : `${formatInventoryQuantity(line.loose_quantity ?? null) ?? "—"} ${line.small_unit}`;
}

export function InventoryMovementPanel({ summary, error, owner }: { summary: InventoryMovementSummary; error: boolean; owner: boolean }) {
  if (!owner) return <section className="surface inventory-panel inventory-movement-panel">
    <div className="section-heading"><div><h2>Mốc kiểm và biến động</h2><p>Lịch sử biến động chỉ dành cho quản trị viên.</p></div></div>
    <p className="inventory-history-warning" role="status">Nhân viên không xem được biến động tồn kho vì lịch sử xác minh chỉ quản trị viên được phép truy cập. Nhân viên vẫn có thể xem bản kiểm và phiếu nhập trong các mục được cấp quyền.</p>
  </section>;

  const latest = summary.latest;
  return <section className="surface inventory-panel inventory-movement-panel">
    <div className="section-heading"><div><h2>Mốc kiểm và biến động</h2><p>Chủ xem mọi kỳ.</p></div></div>
    {error ? <div className="empty-state"><h3>Chưa tải được lịch sử kho</h3><p>Vui lòng tải lại trang sau ít phút.</p></div> : <>
      <section className="inventory-movement-block">
        <h3>{latest?.history_integrity?.status === "unverified" ? "Dữ liệu tồn đang lưu gần nhất" : "Số đếm chốt gần nhất"}</h3>
        {latest ? <>
          <p className="inventory-movement-note">{formatBusinessDate(latest.business_date, { day: "numeric", month: "long", year: "numeric" })} · chốt lúc {formatInventoryTimestamp(latest.finalized_at)}.</p>
          {latest.history_integrity?.status === "unverified" ? <p className="inventory-history-warning" role="status">Lịch sử chưa xác minh — cần đối chiếu. {latest.history_integrity.reason ?? "Các số bên dưới là dữ liệu hiện lưu, chưa xác nhận là số tại lúc chốt."}</p> : null}
          {latest.items.length === 0 ? <p className="empty-inline">Bản kiểm không có mặt hàng.</p> : <ul className="inventory-movement-list">{latest.items.map((item) => <li className="inventory-movement-row" key={item.item_id}>
            <strong>{item.item_name}</strong><span>{countQuantity(item)}</span>
          </li>)}</ul>}
        </> : <p className="inventory-movement-note">Chưa có bản kiểm chốt trong phạm vi xem nên chưa có mốc tồn kho.</p>}
      </section>

      <section className="inventory-movement-block">
        <h3>{latest ? "Phiếu nhập sau mốc chốt" : "Phiếu nhập trong phạm vi xem"}</h3>
        <p className="inventory-movement-note">Phiếu được liệt kê riêng; không cộng vào số đếm để suy ra tồn hiện tại.</p>
        {summary.receiptsSinceLatest.length === 0 ? <p className="empty-inline">Chưa có phiếu nhập {latest ? "sau mốc này" : "trong phạm vi này"}.</p> : <div className="inventory-receipt-list">{summary.receiptsSinceLatest.map((receipt) => <article className="inventory-receipt" key={receipt.id}>
          <div className="inventory-receipt-heading"><div><h3>{receipt.receipt_code}</h3><p>{formatInventoryTimestamp(receipt.received_at)} · {receipt.created_by_label}</p></div></div>
          {receipt.history_integrity?.status === "unverified" ? <p className="inventory-history-warning" role="status">Lịch sử phiếu chưa xác minh — cần đối chiếu. Không dùng dòng hàng hiện lưu để kết luận số lượng tại lúc nhập. {receipt.history_integrity.reason}</p>
            : <ul className="inventory-receipt-lines">{receipt.lines.map((line, index) => <li key={`${receipt.id}-${index}`}><div><strong>{line.item_name}</strong></div><strong>{receiptQuantity(line)}</strong></li>)}</ul>}
        </article>)}</div>}
      </section>

      {summary.periods.length > 0 ? <section className="inventory-movement-block">
        <h3>Biến động giữa các lần kiểm</h3>
        <p className="inventory-movement-note">Số dương hoặc âm chỉ mô tả biến động theo các số đếm và phiếu nhập; không kết luận thất thoát.</p>
        <div className="inventory-period-list">{[...summary.periods].reverse().map((period, index) => <details className="inventory-period" key={`${period.previous_count.id}-${period.current_count.id}`} open={index === 0}>
          <summary>{formatBusinessDate(period.previous_count.business_date)} → {formatBusinessDate(period.current_count.business_date)}</summary>
          {period.history_unverified ? <p className="inventory-history-warning" role="status">Lịch sử chưa xác minh — cần đối chiếu. {period.history_unverified_reasons?.join(" ")}</p> : null}
          <ul className="inventory-movement-list">{period.items.map((item) => <li className="inventory-movement-detail" key={item.item_id}>
            <div><strong>{item.item_name}</strong><span>{item.history_unverified ? "Lịch sử chưa xác minh; cần đối chiếu trước khi dùng kết quả." : item.unit_changed ? "Đơn vị tồn không nhất quán trong kỳ." : item.conversion_unavailable ? "Có hai đơn vị nhưng không có hệ số để cộng." : `${item.previous_quantity ?? "Chưa có mốc"} + ${item.received_quantity} − ${item.current_quantity ?? "Chưa có mốc"} ${item.small_unit}`}</span></div>
            <strong>{item.history_unverified ? "Cần đối chiếu" : item.unit_changed || item.conversion_unavailable ? "Không so sánh được" : item.movement_sign === null ? "Chưa đủ mốc" : `${item.movement_sign > 0 ? "+" : item.movement_sign < 0 ? "−" : ""}${item.movement_quantity} ${item.small_unit}`}</strong>
          </li>)}</ul>
        </details>)}</div>
      </section> : null}
    </>}
  </section>;
}

export function InventoryWorkspace({
  basePath,
  items,
  catalogItems,
  receipts,
  receiptHasMore = false,
  receiptNextCursor = null,
  needsRecountItemIds = [],
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
  latestStockSnapshot = null,
  latestStockSnapshotError = false,
  latestStockReceipts = [],
  latestStockReceiptsError = false,
}: {
  basePath: string;
  items: InventoryItem[];
  catalogItems: InventoryCatalogItem[];
  receipts: InventoryReceipt[];
  receiptHasMore?: boolean;
  receiptNextCursor?: { receivedAt: string; id: string } | null;
  needsRecountItemIds?: string[];
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
  latestStockSnapshot?: InventoryStockSnapshot | null;
  latestStockSnapshotError?: boolean;
  latestStockReceipts?: InventoryLatestItemReceipt[];
  latestStockReceiptsError?: boolean;
}) {
  return <InventoryCountNavigationProvider destination={owner ? "/" : "/staff/dashboard"}><>
    <div className="page-heading">
      <div className="inventory-page-heading-title"><InventoryCountDashboardBackButton /><div><p className="eyebrow">QUẢN LÝ CỬA HÀNG</p><h1>Kho</h1><p>{owner ? "Xem số lượng còn lại từ lần kiểm gần nhất đã chốt." : "Danh mục hàng hóa và các đơn vị quy đổi."}</p></div></div>
    </div>

    <nav className="inventory-tabs" aria-label="Kho">
      <Link className="inventory-tab" href={owner ? `${basePath}?tab=stock` : `${basePath}?tab=stock&date=${date}`} aria-current={tab === "stock" ? "page" : undefined}>Tồn kho</Link>
      <Link className="inventory-tab" href={`${basePath}?tab=receiving`} aria-current={tab === "receiving" ? "page" : undefined}>Nhập kho</Link>
      {owner ? <Link className="inventory-tab" href={`${basePath}?tab=catalog`} aria-current={tab === "catalog" ? "page" : undefined}>Danh mục</Link> : null}
    </nav>

    {owner && tab !== "catalog" ? <div className="inventory-history-entry">
      <Link className="button button-secondary" href="/inventory/history">Lịch sử kho</Link>
      <span>Lịch sử chỉ tải khi bạn mở mục này.</span>
    </div> : null}

    {owner && tab === "stock" ? <form className="inventory-date-filter" action="/inventory/export" method="get">
      <label className="field"><span>Từ ngày</span><input type="date" name="from" defaultValue={monthStart(today)} max={today} required /></label>
      <label className="field"><span>Đến ngày</span><input type="date" name="to" defaultValue={today} max={today} required /></label>
      <button className="button button-secondary" type="submit">Tải workbook Excel</button>
    </form> : null}

    {tab === "catalog" && owner ? <section className="surface inventory-panel">{error
      ? <div className="empty-state"><h2>Chưa tải được danh mục</h2><p>Vui lòng tải lại trang sau ít phút.</p></div>
      : <InventoryCatalogManager items={catalogItems} />}</section> : tab === "stock" ? <>
      {owner ? <InventoryStockSnapshotPanel items={items} snapshot={latestStockSnapshot} error={error || latestStockSnapshotError}
        latestReceipts={latestStockReceipts} latestReceiptsError={latestStockReceiptsError} /> : <>
      <form className="inventory-date-filter" method="get" action={basePath}>
        <input type="hidden" name="tab" value="stock" />
        <label className="field"><span>Ngày kiểm</span><input type="date" name="date" defaultValue={date} min={owner ? undefined : weekStart} max={owner ? today : weekEnd} /></label>
        <button className="button button-secondary" type="submit">Xem ngày</button>
        <span>Nhân viên xem trong tuần hiện tại.</span>
      </form>
      <section className="surface inventory-panel">
        {error ? <div className="empty-state"><h2>Chưa tải được danh mục</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : countError ? <div className="empty-state"><h2>Chưa tải được bản kiểm</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : count ? <>
          <div className="section-heading"><div><h2>Bản kiểm {formatBusinessDate(date, { day: "numeric", month: "long", year: "numeric" })}</h2></div><span className="status status-neutral">{count.status === "finalized" ? "Đã chốt" : "Bản nháp"}</span></div>
          <p className="inventory-draft-note">{count.status === "finalized"
            ? count.finalized_at
              ? `Đã chốt lúc ${formatInventoryTimestamp(count.finalized_at)}.`
              : "Bản kiểm đã chốt."
            : "Bản nháp chưa phải mốc tồn kho."}</p>
          <InventoryCountEditor key={count.id} countId={count.id} items={countItems} editable={count.status === "draft" && (owner || date === today)} finalized={count.status === "finalized"} needsRecountItemIds={needsRecountItemIds} />
        </> : <>
          <div className="section-heading"><div><h2>Chưa mở bản kiểm</h2><p>{formatBusinessDate(date, { day: "numeric", month: "long", year: "numeric" })} · {items.length} mặt hàng đang hoạt động</p></div></div>
          {owner || date === today ? <OpenInventoryCountForm date={date} /> : <p className="form-note">Nhân viên chỉ mở bản kiểm cho ngày hôm nay.</p>}
          {error ? null : items.length === 0 ? <div className="empty-state"><h2>Chưa có mặt hàng</h2><p>Danh mục sẽ xuất hiện sau khi dữ liệu kho được khởi tạo.</p></div> : <ul className="inventory-item-list">{items.map((item) => <li className="inventory-item" key={item.id}><div className="inventory-item-heading"><strong>{item.name}</strong><span className="status status-neutral">{item.category}</span></div><p>{!item.large_unit ? `Kiểm theo ${item.small_unit}` : item.conversion_factor == null ? `Kiểm riêng ${item.large_unit} và ${item.small_unit}` : item.count_large_unit_only ? `Kiểm theo ${item.large_unit}` : `1 ${item.large_unit} = ${Number(item.conversion_factor).toLocaleString("vi-VN")} ${item.small_unit}`}</p></li>)}</ul>}
        </>}
      </section>
      </>}
    </> : <InventoryReceivingPanel items={items} receipts={receipts} receivingError={receivingError} canCreate={canCreateReceipts} owner={owner} today={today} hasMore={receiptHasMore} nextCursor={receiptNextCursor} pageBaseHref={owner ? "/inventory/history" : basePath} />}
  </></InventoryCountNavigationProvider>;
}
