import Link from "next/link";
import { redirect } from "next/navigation";
import { PurchaseVoucherForm } from "@/components/owner-advances/purchase-voucher-form";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { currentBusinessDate, formatBusinessDate, formatVnd } from "@/lib/finance/format";
import { loadActiveInventoryChoices, loadOwnerPurchaseAllPage, loadOwnerPurchaseMonthPage } from "@/lib/owner-advances/loaders";
import { loadOwnerPurchaseOverview } from "@/lib/owner-advances/overview";

export const dynamic = "force-dynamic";

function selectedMonth(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2026-09" ? value : fallback;
}

function selectedPage(value: string | undefined): number {
  const page = Number(value ?? "1");
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.UTC(year, monthNumber - 1, 15, 12)));
}

export default async function OwnerAdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; page?: string; view?: string }>;
}) {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");
  const params = await searchParams;
  const currentMonth = currentBusinessDate().slice(0, 7);
  const month = selectedMonth(params.month, currentMonth);
  const page = selectedPage(params.page);
  const viewAll = params.view === "all";
  const [vouchersResult, overview, inventoryChoices] = await Promise.all([
    viewAll
      ? loadOwnerPurchaseAllPage(owner.supabase, owner.ownerId, page)
      : loadOwnerPurchaseMonthPage(owner.supabase, owner.ownerId, month, page),
    loadOwnerPurchaseOverview(owner.supabase, owner.ownerId, month),
    loadActiveInventoryChoices(owner.supabase, owner.ownerId),
  ]);
  const pageCount = Math.max(1, Math.ceil(vouchersResult.count / vouchersResult.pageSize));
  const pageRows = vouchersResult.vouchers as Array<typeof vouchersResult.vouchers[number] & { lines?: Array<Record<string, unknown>> }>;
  const monthIsHistorical = month < currentMonth;
  const monthCutoff = overview.summary?.monthCutoffDate;
  const cutoffText = monthIsHistorical ? "cuối tháng" : monthCutoff ? `đến ${formatBusinessDate(monthCutoff, { day: "numeric", month: "short" })}` : "đến hiện tại";

  return <>
    <div className="page-heading owner-purchase-page-heading">
      <div><p className="eyebrow">SỔ ỨNG VÀ THEO DÕI MUA HÀNG</p><h1>Giám sát đồ mua</h1><p>Ghi riêng khoản bạn tự ứng, ảnh chứng từ, mặt hàng và số tiền cửa hàng đã hoàn.</p></div>
      <form className="month-jump" action="/advances"><label htmlFor="advance-month">Chọn tháng</label><input id="advance-month" type="month" name="month" min="2026-09" defaultValue={month} /><button className="button button-secondary" type="submit">Xem</button></form>
    </div>

    <section className="owner-purchase-month-note"><strong>{monthLabel(month)}</strong><span>Chỉ tính phiếu đã chốt có ngày mua trong tháng này. Bản nháp và phiếu hủy không được cộng. Số liệu hoàn ứng tính {cutoffText}.</span></section>
    {overview.summaryError ? <p className="form-error" role="alert">Chưa tải được số liệu phiếu mua của tháng. Thử tải lại trang.</p> : overview.summary ? <div className="owner-purchase-month-metrics">
      <article className="surface owner-purchase-month-metric"><span>Đã ứng trong tháng</span><strong>{formatVnd(overview.summary.monthAdvancedVnd)}</strong><small>{overview.summary.finalizedCount} phiếu đã chốt · theo tháng mua</small></article>
      <article className="surface owner-purchase-month-metric"><span>Đã hoàn {monthIsHistorical ? "đến cuối tháng" : "trong tháng"}</span><strong>{formatVnd(overview.summary.monthReimbursedVnd)}</strong><small>Chỉ các phiếu mua thuộc tháng đã chọn</small></article>
      <article className="surface owner-purchase-month-metric"><span>Còn ứng {monthIsHistorical ? "cuối tháng" : "tạm tính"}</span><strong>{formatVnd(overview.summary.monthOutstandingVnd)}</strong><small>Số dư của cùng nhóm phiếu {cutoffText}</small></article>
      <article className="surface owner-purchase-month-metric owner-purchase-current-balance"><span>Còn ứng hiện tại</span><strong>{formatVnd(overview.summary.currentOutstandingVnd)}</strong><small>Tất cả phiếu đã chốt, từ 01/09/2026 đến nay</small></article>
    </div> : null}

    <section className="surface owner-purchase-recent-card">
      <div className="section-heading"><div><h2>Khoản mua gần đây</h2><p>Các phiếu mới chốt, xem nhanh số tiền đã ứng.</p></div></div>
      {overview.recentError ? <p className="form-error" role="alert">Chưa tải được danh sách khoản mua gần đây.</p> : overview.recentPurchases.length ? <ul className="owner-purchase-recent-list">
        {overview.recentPurchases.map((purchase) => <li key={purchase.id}>
          <Link className="owner-purchase-recent-row" href={`/advances/${purchase.id}`}>
            <span className="owner-purchase-recent-date">{formatBusinessDate(purchase.purchase_date, { day: "numeric", month: "short", year: "numeric" })}</span>
            <span className="owner-purchase-recent-description"><strong>{purchase.vendor || "Chưa ghi nơi mua"}</strong><small>{purchase.note || "Mở phiếu để xem mặt hàng và chứng từ"}</small></span>
            <strong className="owner-purchase-recent-amount">{formatVnd(Number(purchase.invoice_total_vnd))}</strong>
          </Link>
        </li>)}
      </ul> : <p className="empty-inline">Chưa có phiếu mua nào được chốt.</p>}
    </section>

    {vouchersResult.error ? <p className="inventory-history-warning">Tạm khóa biểu mẫu để tránh tạo phiếu trùng khi chưa tải được danh sách hiện có. Tải lại trang sau khi kết nối ổn định.</p> : <details className="surface owner-purchase-create-card">
      <summary><span><strong>Tạo phiếu mua mới</strong><small>Nhập hóa đơn, mặt hàng, số lượng và ảnh sau khi lưu nháp</small></span><span className="owner-purchase-create-toggle">Mở biểu mẫu</span></summary>
      <PurchaseVoucherForm items={inventoryChoices.items} />
      {inventoryChoices.error ? <p className="inventory-history-warning">Danh mục kho chưa tải được đầy đủ; kiểm tra kết nối trước khi lưu dòng có nhập kho.</p> : null}
    </details>}

    <section className="surface owner-purchase-list-card">
      <div className="section-heading owner-purchase-list-heading"><div><h2>{viewAll ? "Tất cả khoản chi" : `Phiếu mua ${monthLabel(month)}`}</h2><p>{vouchersResult.error ? "Chưa tải được số lượng phiếu; danh sách hiện chưa thể đối chiếu." : viewAll ? `${vouchersResult.count} phiếu mua từ 01/09/2026 đến nay, gồm bản nháp, đã chốt và đã hủy.` : `${vouchersResult.count} phiếu gồm bản nháp, đã chốt và đã hủy trong tháng. Danh sách hiển thị từng trang.`}</p></div><div className="owner-purchase-list-actions">{!vouchersResult.error ? <span className="status status-neutral">Trang {Math.min(page, pageCount)} / {pageCount}</span> : null}<Link className="button button-secondary" href={viewAll ? `/advances?month=${month}` : `/advances?month=${month}&view=all`}>{viewAll ? "Theo tháng" : "Xem tất cả khoản chi"}</Link></div></div>
      {vouchersResult.error ? <p className="form-error" role="alert">Chưa tải được phiếu. Hãy tải lại trang trước khi tạo phiếu để tránh nhập trùng.</p> : pageRows.length ? <div className="owner-purchase-list-table-wrap"><table className="owner-purchase-list-table"><thead><tr><th>Ngày mua</th><th>Nơi mua và mặt hàng</th><th>Trạng thái</th><th className="owner-purchase-number-cell">Tổng hóa đơn</th><th></th></tr></thead><tbody>
        {pageRows.map((voucher) => <tr key={voucher.id}>
          <td>{formatBusinessDate(voucher.purchase_date, { day: "numeric", month: "short", year: "numeric" })}</td>
          <td><strong>{voucher.vendor || "Chưa ghi nơi mua"}</strong><span>{voucher.lines?.length ?? 0} dòng{voucher.note ? ` · ${voucher.note}` : ""}</span></td>
          <td><span className={`status ${voucher.status === "finalized" ? "status-success" : voucher.status === "draft" ? "status-warning" : "status-neutral"}`}>{voucher.status === "finalized" ? "Đã chốt" : voucher.status === "draft" ? "Bản nháp" : "Đã hủy"}</span></td>
          <td className="owner-purchase-number-cell"><strong>{formatVnd(Number(voucher.invoice_total_vnd))}</strong></td>
          <td><Link className="text-link" href={`/advances/${voucher.id}`}>Mở phiếu</Link></td>
        </tr>)}
      </tbody></table></div> : <div className="empty-state owner-purchase-empty"><div><h2>{viewAll ? "Chưa có khoản chi nào" : `Chưa có phiếu mua trong ${monthLabel(month)}`}</h2><p>Tạo một bản nháp để bắt đầu theo dõi tiền bạn ứng và lưu chứng từ.</p></div></div>}
      {pageCount > 1 ? <nav className="owner-purchase-pagination" aria-label="Trang phiếu mua">
        {page > 1 ? <Link className="button button-secondary" href={`/advances?month=${month}${viewAll ? "&view=all" : ""}&page=${page - 1}`}>Trang trước</Link> : <span />}
        <span>Trang {Math.min(page, pageCount)} / {pageCount}</span>
        {page < pageCount ? <Link className="button button-secondary" href={`/advances?month=${month}${viewAll ? "&view=all" : ""}&page=${page + 1}`}>Trang sau</Link> : <span />}
      </nav> : null}
    </section>

    <aside className="owner-purchase-separation-note"><strong>Tách rõ nguồn tiền</strong><p>Chi phí nhân viên trả từ doanh thu quán vẫn nhập ở sổ ngày. Sổ này chỉ ghi khoản admin tự trả trước. Nguyên liệu dùng để đối chiếu kho; không tự cộng vào lợi nhuận vì COGS tháng lấy từ POS.</p></aside>
  </>;
}
