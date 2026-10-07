import Link from "next/link";
import { InventoryReceivingPanel } from "@/components/inventory/inventory-receiving-panel";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { formatBusinessDate } from "@/lib/finance/format";
import { getFinalizedInventoryCountPage, formatInventoryQuantity } from "@/lib/inventory/counts";
import { getActiveInventoryItems } from "@/lib/inventory/catalog";
import { getInventoryReceiptPage } from "@/lib/inventory/receipts";

export const dynamic = "force-dynamic";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

function HistoryHeading({ view }: { view: "receipts" | "counts" }) {
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">QUẢN LÝ CỬA HÀNG</p><h1>Lịch sử kho</h1></div>
      <Link className="button button-secondary" href="/inventory?tab=stock">Quay lại tồn kho</Link>
    </div>
    <nav className="inventory-tabs" aria-label="Loại lịch sử">
      <Link className="inventory-tab" href="/inventory/history?view=receipts" aria-current={view === "receipts" ? "page" : undefined}>Phiếu nhập</Link>
      <Link className="inventory-tab" href="/inventory/history?view=counts" aria-current={view === "counts" ? "page" : undefined}>Bản kiểm đã chốt</Link>
    </nav>
  </>;
}

function CountHistory({ page }: { page: Awaited<ReturnType<typeof getFinalizedInventoryCountPage>> }) {
  return <section className="surface inventory-panel">
    <div className="section-heading"><div><h2>Bản kiểm đã chốt</h2><p>Các số đã lưu và phiên bản hiệu chỉnh được giữ nguyên.</p></div><strong>{page.data.length} bản kiểm</strong></div>
    {page.data.length === 0 ? <p className="empty-inline">Chưa có bản kiểm đã chốt.</p> : <div className="inventory-receipt-list">
      {page.data.map((count) => <article className="inventory-receipt" key={count.id}>
        <div className="inventory-receipt-heading"><div><h3>{formatBusinessDate(count.business_date, { day: "numeric", month: "long", year: "numeric" })}</h3><p>Chốt lúc {formatTimestamp(count.finalized_at)}</p></div><span className="status status-neutral">Đã chốt</span></div>
        {count.history_integrity?.status === "unverified" ? <p className="inventory-history-warning" role="status">Lịch sử chưa xác minh — cần đối chiếu. {count.history_integrity.reason}</p> : null}
        {count.history_truncated ? <p className="inventory-history-warning" role="status">Chi tiết bản kiểm vượt giới hạn một lần tải; đang hiển thị tối đa 500 mặt hàng và 100 phiên bản gần nhất.</p> : null}
        <ul className="inventory-movement-list">{count.items.map((item) => <li className="inventory-movement-row" key={item.item_id}>
          <strong>{item.item_name}</strong><span>{item.large_unit && item.conversion_factor == null
            ? `${formatInventoryQuantity(item.large_quantity ?? null) ?? "—"} ${item.large_unit} + ${formatInventoryQuantity(item.small_quantity ?? null) ?? "—"} ${item.small_unit}`
            : `${formatInventoryQuantity(item.counted_quantity) ?? "—"} ${item.small_unit}`}</span>
        </li>)}</ul>
        {count.versions?.length ? <details className="inventory-receipt-audit"><summary>Lịch sử hiệu chỉnh ({count.versions.filter((version) => version.event_type === "count_corrected").length})</summary>
          {count.versions.filter((version) => version.event_type === "count_corrected").map((version, index) => <div className="inventory-receipt-correction" key={`${count.id}-${version.effective_at}-${version.sequence_no ?? index}`}>
            <p>{formatTimestamp(version.effective_at)}{version.actor_label ? ` · ${version.actor_label}` : ""}</p>
            {version.reason ? <p>Lý do: {version.reason}</p> : null}
            <ul className="inventory-movement-list">{version.items.map((item) => <li className="inventory-movement-row" key={item.item_id}>
              <strong>{item.item_name}</strong><span>{formatInventoryQuantity(item.counted_quantity) ?? "—"} {item.small_unit}</span>
            </li>)}</ul>
          </div>)}</details> : null}
      </article>)}
    </div>}
    {page.hasMore && page.nextCursor ? <Link className="button button-secondary inventory-history-more" href={`/inventory/history?view=counts&before=${encodeURIComponent(page.nextCursor.finalizedAt)}&beforeId=${encodeURIComponent(page.nextCursor.id)}`}>Xem bản kiểm cũ hơn</Link> : null}
  </section>;
}

export default async function InventoryHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; before?: string | string[]; beforeId?: string | string[] }>;
}) {
  const owner = await requireOwnerClient();
  if (!owner) return null;

  const params = await searchParams;
  const view: "receipts" | "counts" = params.view === "counts" ? "counts" : "receipts";
  const before = typeof params.before === "string" ? params.before : undefined;
  const beforeId = typeof params.beforeId === "string" ? params.beforeId : undefined;
  if (view === "receipts") {
    const [page, items] = await Promise.all([
      getInventoryReceiptPage(owner.supabase, owner.ownerId, { beforeAt: before, beforeId, includeHistory: true }),
      getActiveInventoryItems(owner.supabase, owner.ownerId),
    ]);
    return <main className="page-shell inventory-history-page">
      <HistoryHeading view={view} />
      {page.error ? <section className="surface inventory-panel"><div className="empty-state"><h2>Chưa tải được lịch sử</h2><p>Vui lòng tải lại trang sau ít phút.</p></div></section>
        : <InventoryReceivingPanel items={items.data ?? []} receipts={page.data} canCreate={false}
          owner receivingError={Boolean(items.error)} today="" hasMore={page.hasMore} nextCursor={page.nextCursor} />}
    </main>;
  }

  const page = await getFinalizedInventoryCountPage(owner.supabase, owner.ownerId, { beforeAt: before, beforeId });
  return <main className="page-shell inventory-history-page">
    <HistoryHeading view={view} />
    {page.error ? <section className="surface inventory-panel"><div className="empty-state"><h2>Chưa tải được lịch sử</h2><p>Vui lòng tải lại trang sau ít phút.</p></div></section>
      : <CountHistory page={page} />}
  </main>;
}
