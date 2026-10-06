import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdvanceHistory, type AdvanceAuditEvent } from "@/components/owner-advances/advance-history";
import { EvidenceUploader } from "@/components/owner-advances/evidence-uploader";
import { EvidenceGallery, PurchaseLineList } from "@/components/owner-advances/voucher-detail";
import { CancelPurchaseDraftForm, PurchaseVoucherForm } from "@/components/owner-advances/purchase-voucher-form";
import { ProfitPostingPanel, ReimbursementPanel, VoucherFinalizationPanel } from "@/components/owner-advances/advance-panels";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { formatBusinessDate, formatVnd } from "@/lib/finance/format";
import { getEligibleProfitLines, summarizeReimbursements } from "@/lib/owner-advances/presentation";
import { loadActiveInventoryChoices, loadOwnerPurchaseVoucher, loadPurchaseDuplicateCandidates, loadReceiptLinkCandidates } from "@/lib/owner-advances/loaders";
import type { OwnerPurchaseLineRow } from "@/lib/owner-advances/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

function lineDisplay(lines: OwnerPurchaseLineRow[]) {
  return lines.map((line) => ({
    id: line.id,
    description: line.description,
    costClass: line.cost_class,
    inventoryClass: line.inventory_class,
    active: line.active,
    convertedQuantity: line.converted_quantity,
    smallUnit: line.small_unit_snapshot,
    quantity: line.quantity_snapshot,
    unit: line.unit_snapshot,
    lineAmountVnd: line.line_amount_vnd,
  }));
}

export default async function OwnerPurchaseVoucherPage({ params }: { params: Promise<{ voucherId: string }> }) {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");
  const { voucherId } = await params;
  if (!z.uuid().safeParse(voucherId).success) notFound();
  const loaded = await loadOwnerPurchaseVoucher(owner.supabase, owner.ownerId, voucherId);
  if (loaded.error) return <section className="surface owner-purchase-load-error"><p className="eyebrow">PHIẾU MUA</p><h1>Chưa tải được chi tiết phiếu</h1><p>Dữ liệu chưa được thay đổi. Tải lại sau khi kết nối ổn định.</p><Link className="button button-secondary" href="/advances">Quay lại danh sách</Link></section>;
  if (!loaded.data) notFound();

  const { voucher, lines, reimbursements, evidence, evidenceTruncated, events, postings, sourceLinks, receiptHeader, receiptLines } = loaded.data;
  const activeLines = lines.filter(({ active }) => active);
  const balance = summarizeReimbursements(voucher.invoice_total_vnd, reimbursements);
  const inventoryChoices = await loadActiveInventoryChoices(owner.supabase, owner.ownerId);
  let duplicateCandidates: Awaited<ReturnType<typeof loadPurchaseDuplicateCandidates>> = { candidates: [], error: false };
  let receiptCandidates: Awaited<ReturnType<typeof loadReceiptLinkCandidates>> = { candidates: [], error: false };
  if (voucher.status === "draft") {
    [duplicateCandidates, receiptCandidates] = await Promise.all([
      loadPurchaseDuplicateCandidates(owner.supabase, owner.ownerId, voucher, activeLines),
      loadReceiptLinkCandidates(owner.supabase, owner.ownerId, voucher.purchase_date, activeLines.filter((line) => line.inventory_class === "stock")),
    ]);
  }

  const eventsList = (events ?? []) as AdvanceAuditEvent[];
  const postingRows = (postings ?? []) as Array<Record<string, unknown>>;
  const activePostingIds = new Set(postingRows.filter((posting) => posting.posting_type === "reversal").map((posting) => String(posting.reverses_posting_id)));
  const hasActivePostings = postingRows.some((posting) => posting.posting_type === "post" && !activePostingIds.has(String(posting.id)));
  const evidenceItems = evidence.map((item) => ({ id: item.id, fileName: item.file_name, caption: item.caption, reimbursementId: item.reimbursement_id }));
  const profitLines = activeLines.map((line) => ({
    id: line.id,
    description: line.description,
    active: line.active,
    costClass: line.cost_class,
    inventoryClass: line.inventory_class,
    lineAmountVnd: line.line_amount_vnd,
  }));
  const eligibleProfitLines = getEligibleProfitLines(profitLines).eligible;
  const activePostLineIds = new Set(postingRows.filter((posting) => posting.posting_type === "post" && !activePostingIds.has(String(posting.id))).map((posting) => String(posting.source_line_id)));
  const alreadyPostedLines = eligibleProfitLines.filter(({ id }) => activePostLineIds.has(id));
  const unpostedProfitLines = profitLines.filter(({ id }) => !activePostLineIds.has(id));

  return <>
    <div className="page-heading owner-purchase-detail-heading">
      <div><p className="eyebrow">GIÁM SÁT ĐỒ MUA</p><h1>{voucher.vendor || "Phiếu mua"}</h1><p>{formatBusinessDate(voucher.purchase_date)} · Mã phiếu {voucher.id.slice(0, 8)}</p></div>
      <div className="owner-purchase-detail-heading-actions"><span className={`status ${voucher.status === "finalized" ? "status-success" : voucher.status === "draft" ? "status-warning" : "status-neutral"}`}>{voucher.status === "finalized" ? "Đã chốt" : voucher.status === "draft" ? "Bản nháp" : "Đã hủy"}</span><Link className="button button-secondary" href="/advances">Danh sách phiếu</Link></div>
    </div>

    <section className="owner-purchase-detail-summary">
      <article className="surface"><span>Tổng hóa đơn</span><strong>{formatVnd(Number(voucher.invoice_total_vnd))}</strong><small>Ngày mua {formatBusinessDate(voucher.purchase_date, { day: "numeric", month: "long", year: "numeric" })}</small></article>
      <article className="surface"><span>Đã hoàn</span><strong>{formatVnd(balance.reimbursedVnd)}</strong><small>Lịch sử hoàn nối tiếp, có điều chỉnh</small></article>
      <article className="surface"><span>Còn ứng</span><strong>{formatVnd(balance.outstandingVnd)}</strong><small>{voucher.status === "draft" ? "Bản nháp chưa được tính vào số dư" : "Số dư khoản admin đã ứng"}</small></article>
    </section>

    <div className="owner-purchase-detail-columns">
      <div className="owner-purchase-detail-primary">
        <section className="surface owner-purchase-detail-card">
          <div className="section-heading"><div><h2>Chi tiết hàng đã mua</h2><p>Tổng hóa đơn là số thực trả; tiền dòng không tự suy ra từ số lượng.</p></div><strong>{activeLines.length} dòng</strong></div>
          <PurchaseLineList lines={lineDisplay(activeLines)} />
          {voucher.note ? <div className="owner-purchase-voucher-note"><strong>Ghi chú</strong><p>{voucher.note}</p></div> : null}
          {voucher.status === "finalized" ? <div className="owner-purchase-receipt-link"><strong>Liên kết kho</strong><p>{receiptHeader ? `Phiếu ${String(receiptHeader.receipt_code)} · ${formatDateTime(String(receiptHeader.received_at))}` : "Phiếu này không tạo biến động kho."}</p>{receiptLines.length ? <ul>{receiptLines.map((line) => <li key={String(line.id)}>{String(line.item_name)} · {String(line.converted_quantity)} {String(line.small_unit)}</li>)}</ul> : null}</div> : null}
          {voucher.status === "canceled" && voucher.cancel_reason ? <p className="inventory-history-warning">Đã hủy: {voucher.cancel_reason}</p> : null}
        </section>

        <section className="surface owner-purchase-detail-card">
          <div className="section-heading"><div><h2>Ảnh hóa đơn và chứng từ</h2><p>Ảnh riêng tư trên kho R2; bấm từng ảnh để mở liên kết xem tạm.</p></div><span className="status status-neutral">{evidence.length}{evidenceTruncated ? "+" : ""} ảnh</span></div>
          <EvidenceGallery evidence={evidenceItems} />
          {evidenceTruncated ? <p className="form-note">Danh sách chỉ tải 100 ảnh gần nhất để trang không phải lấy toàn bộ chứng từ cùng lúc.</p> : null}
          {voucher.status !== "canceled" ? <EvidenceUploader voucherId={voucher.id} /> : null}
        </section>

        {voucher.status === "draft" ? <>
          <details className="surface owner-purchase-detail-card owner-purchase-edit-draft">
            <summary><span><strong>Chỉnh sửa bản nháp</strong><small>Thay đổi thông tin trước khi chốt</small></span><span className="owner-purchase-create-toggle">Mở biểu mẫu</span></summary>
            <PurchaseVoucherForm items={inventoryChoices.items} voucher={voucher} lines={lines} mode="draft" />
          </details>
          <VoucherFinalizationPanel
            voucherId={voucher.id}
            candidates={duplicateCandidates.candidates}
            receiptCandidates={receiptCandidates.candidates}
            duplicateCheckError={duplicateCandidates.error}
            receiptCheckError={receiptCandidates.error}
            idempotencyKey={randomUUID()}
          />
          <details className="surface owner-purchase-detail-card owner-purchase-cancel-card"><summary><span><strong>Hủy bản nháp</strong><small>Yêu cầu ghi lý do; phiếu không được xóa khỏi lịch sử</small></span><span className="owner-purchase-create-toggle">Mở</span></summary><CancelPurchaseDraftForm voucherId={voucher.id} /></details>
        </> : null}

        {voucher.status === "finalized" ? <>
          <ReimbursementPanel key={`repayment-${randomUUID()}`} voucherId={voucher.id} invoiceTotalVnd={voucher.invoice_total_vnd} events={reimbursements} idempotencyKey={randomUUID()} allowReimbursement />
          <ProfitPostingPanel key={`profit-${randomUUID()}`} voucherId={voucher.id} purchaseDate={voucher.purchase_date} lines={unpostedProfitLines} postings={postingRows as never} idempotencyKey={randomUUID()} />
          <details className="surface owner-purchase-detail-card owner-purchase-correction-card">
            <summary><span><strong>Hiệu chỉnh phiếu đã chốt</strong><small>Ghi thay đổi mới; không ghi đè lịch sử kho hoặc lần hoàn cũ</small></span><span className="owner-purchase-create-toggle">Mở biểu mẫu</span></summary>
            {hasActivePostings ? <p className="inventory-history-warning">Phiếu có khoản đang tác động lợi nhuận. Hãy mở lịch sử ghi nhận bên dưới và hoàn tác bút toán trước khi sửa tiền hoặc dòng hàng.</p> : <PurchaseVoucherForm items={inventoryChoices.items} voucher={voucher} lines={lines} mode="correction" />}
          </details>
          {alreadyPostedLines.length ? <p className="form-note owner-purchase-posted-note">{alreadyPostedLines.length} dòng đã được ghi vào lợi nhuận; chúng không xuất hiện lại trong danh sách ghi nhận.</p> : null}
        </> : null}
      </div>

      <div className="owner-purchase-detail-secondary">
        {voucher.status === "finalized" ? <section className="surface owner-purchase-detail-card"><div className="section-heading"><div><h2>Nguồn tiền và đối chiếu</h2><p>Phân biệt khoản admin ứng với chi phí đã trả bằng tiền quán.</p></div></div>
          {sourceLinks.length ? <ul className="owner-purchase-source-list">{sourceLinks.map((source) => <li key={String(source.id)}><strong>{source.resolution === "personal_paid" ? "Đã xác nhận: admin tự trả" : source.resolution === "shop_cash" ? "Đã xác nhận: tiền quán trả" : "Đã xác nhận: giao dịch khác"}</strong><span>{formatDateTime(String(source.created_at))} · chi phí sổ ngày {String(source.daily_expense_id).slice(0, 8)}</span></li>)}</ul> : <p className="form-note">Không có khoản chi ngày trùng được liên kết.</p>}
          <p className="owner-purchase-separation-note-inline">Chi từ tiền quán vẫn nằm trong chi phí ngày. Khoản admin tự trả được theo dõi tại đây; doanh thu Bluebook giữ nguyên là doanh thu gộp.</p>
        </section> : null}
        <AdvanceHistory events={eventsList} ownerId={owner.ownerId} />
      </div>
    </div>
  </>;
}
