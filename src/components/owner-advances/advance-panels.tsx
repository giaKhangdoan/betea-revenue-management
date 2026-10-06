"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  finalizePurchaseVoucher,
  postPurchaseCosts,
  recordPurchaseReimbursement,
  resolvePurchaseDuplicate,
  reversePurchaseCostPosting,
  type AdvanceActionState,
} from "@/app/(private)/advances/actions";
import { formatBusinessDate, formatVnd } from "@/lib/finance/format";
import { getEligibleProfitLines, summarizeReimbursements } from "@/lib/owner-advances/presentation";
import type { DuplicateExpenseMatch } from "@/lib/owner-advances/duplicate-matching";
import { EvidenceUploader } from "./evidence-uploader";

type ReceiptCandidate = { id: string; receiptCode: string; links: Array<{ purchase_line_id: string; receipt_line_id: string }> };

export function VoucherFinalizationPanel({
  voucherId,
  candidates,
  receiptCandidates,
  duplicateCheckError = false,
  receiptCheckError = false,
  idempotencyKey,
}: {
  voucherId: string;
  candidates: DuplicateExpenseMatch[];
  receiptCandidates: ReceiptCandidate[];
  duplicateCheckError?: boolean;
  receiptCheckError?: boolean;
  idempotencyKey: string;
}) {
  const router = useRouter();
  const [finalState, finalizeAction, finalizing] = useActionState<AdvanceActionState | undefined, FormData>(finalizePurchaseVoucher, undefined);
  const [resolutionState, resolveAction, resolving] = useActionState<AdvanceActionState | undefined, FormData>(resolvePurchaseDuplicate, undefined);
  const duplicateRows = finalState?.duplicateCandidates ?? candidates;
  const [decisions, setDecisions] = useState<Record<string, { resolution: string; reason: string }>>({});
  const [receiptChoice, setReceiptChoice] = useState(receiptCandidates.length === 1 ? receiptCandidates[0]!.id : "");

  const chosenReceipt = receiptCandidates.find(({ id }) => id === receiptChoice);
  const directFinalizationAvailable = duplicateRows.length === 0 && !finalState?.requiresDuplicateReview && !duplicateCheckError && !receiptCheckError;
  const batchDecisions = duplicateRows.map((candidate) => ({
    daily_expense_id: candidate.id,
    resolution: decisions[candidate.id]?.resolution ?? "",
    reason: decisions[candidate.id]?.reason ?? "",
  }));
  const hasShopCashDecision = batchDecisions.some(({ resolution }) => resolution === "shop_cash");
  const hasPersonalPaidDecision = batchDecisions.some(({ resolution }) => resolution === "personal_paid");
  const hasDifferentPurchaseDecision = batchDecisions.some(({ resolution }) => resolution === "different_purchase");
  const conflictingPayers = hasShopCashDecision && hasPersonalPaidDecision;
  const allDecisionsComplete = batchDecisions.length > 0 && batchDecisions.every(({ resolution, reason }) =>
    Boolean(resolution) && reason.trim().length >= (resolution === "different_purchase" ? 5 : 2));
  const showReceiptChoice = duplicateRows.length === 0 || (hasPersonalPaidDecision && !hasShopCashDecision && !hasDifferentPurchaseDecision);

  useEffect(() => {
    if (finalState?.success || resolutionState?.success) router.refresh();
  }, [finalState?.success, resolutionState?.success, router]);

  return <section className="surface owner-purchase-finalization">
    <div className="section-heading"><div><h2>Kiểm tra rồi chốt phiếu</h2><p>Sau khi chốt, các dòng kho và trạng thái phiếu được lưu cùng một giao dịch.</p></div></div>

    {showReceiptChoice && receiptCandidates.length ? <div className="field owner-purchase-receipt-choice"><label htmlFor={`${voucherId}-receipt-choice`}>Nhập kho</label><select id={`${voucherId}-receipt-choice`} value={receiptChoice} onChange={(event) => setReceiptChoice(event.target.value)}><option value="">Tạo phiếu nhập kho mới</option>{receiptCandidates.map((receipt) => <option key={receipt.id} value={receipt.id}>Dùng phiếu {receipt.receiptCode} đã nhập đúng số lượng</option>)}</select><span className="form-note">Chỉ chọn phiếu có đúng mặt hàng và số lượng. Dòng ngoài kho không tạo biến động tồn.</span></div> : showReceiptChoice ? <p className="form-note">Không tìm thấy phiếu nhập kho cùng ngày khớp chính xác; khi chốt, hệ thống sẽ tạo một phiếu cho các dòng tồn kho.</p> : null}

    {duplicateCheckError || receiptCheckError ? <div className="form-error" role="alert"><p>Chưa tải đủ đối chiếu chi phí hoặc phiếu nhập kho. Chưa thể chốt an toàn.</p><button className="button button-secondary" type="button" onClick={() => router.refresh()}>Tải lại để kiểm tra</button></div> : null}

    {directFinalizationAvailable ? <form action={finalizeAction} className="owner-purchase-inline-form">
      <input type="hidden" name="voucher_id" value={voucherId} />
      <input type="hidden" name="existing_receipt_id" value={chosenReceipt?.id ?? ""} />
      <input type="hidden" name="receipt_line_links" value={JSON.stringify(chosenReceipt?.links ?? [])} />
      {finalState?.error ? <p className="form-error" role="alert">{finalState.error}</p> : null}
      {finalState?.error ? <button className="button button-secondary" type="button" onClick={() => router.refresh()}>Tải lại và kiểm tra khoản chi</button> : null}
      <button className="button" type="submit" disabled={finalizing}>{finalizing ? "Đang đối chiếu…" : "Không có khoản trùng · chốt phiếu"}</button>
    </form> : null}

    {duplicateRows.length ? <div className="owner-purchase-duplicate-warning">
      <strong>Đã tìm thấy {duplicateRows.length} khoản chi cùng ngày, cùng số tiền và nội dung gần khớp.</strong>
      <p>Chọn quyết định riêng cho từng khoản. Hệ thống chỉ chốt sau khi tất cả khoản hiện còn khớp đã được xem và ghi lý do.</p>
      <ul className="owner-purchase-duplicate-list">{duplicateRows.map((candidate) => <li key={candidate.id}>
        <div><strong>{candidate.reason}</strong><span>{formatBusinessDate(candidate.business_date, { day: "numeric", month: "short", year: "numeric" })} · {formatVnd(Number(candidate.amount_vnd))} · Tiền quán</span><small>Khớp {candidate.matchKind === "line" ? "dòng hàng" : "tổng hóa đơn"}: {candidate.matchedText}</small></div>
      </li>)}</ul>
      <form action={resolveAction} className="owner-purchase-resolution-form">
        <input type="hidden" name="voucher_id" value={voucherId} />
        <input type="hidden" name="decisions" value={JSON.stringify(batchDecisions)} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        <input type="hidden" name="existing_receipt_id" value={chosenReceipt?.id ?? ""} />
        <input type="hidden" name="receipt_line_links" value={JSON.stringify(chosenReceipt?.links ?? [])} />
        {duplicateRows.map((candidate, index) => {
          const decision = decisions[candidate.id] ?? { resolution: "", reason: "" };
          const idPrefix = `${voucherId}-duplicate-${candidate.id}`;
          return <fieldset className="owner-purchase-duplicate-decision" key={candidate.id}>
            <legend>Quyết định {index + 1} · {candidate.reason}</legend>
            <span className="form-note">{formatBusinessDate(candidate.business_date, { day: "numeric", month: "short" })} · {formatVnd(Number(candidate.amount_vnd))} · Khớp {candidate.matchKind === "line" ? candidate.matchedText : "tổng hóa đơn"}</span>
            <div className="owner-purchase-duplicate-decision-fields">
              <div className="field"><label htmlFor={`${idPrefix}-resolution`}>Nguồn tiền / phân loại</label><select id={`${idPrefix}-resolution`} required value={decision.resolution} onChange={(event) => setDecisions((current) => ({ ...current, [candidate.id]: { ...decision, resolution: event.target.value } }))}><option value="">Chọn quyết định</option><option value="personal_paid">Cùng giao dịch · admin tự trả</option><option value="shop_cash">Cùng giao dịch · tiền quán trả</option><option value="different_purchase">Giao dịch khác · giữ khoản chi</option></select></div>
              <div className="field"><label htmlFor={`${idPrefix}-reason`}>Lý do xác nhận</label><input id={`${idPrefix}-reason`} required minLength={decision.resolution === "different_purchase" ? 5 : 2} maxLength={500} value={decision.reason} onChange={(event) => setDecisions((current) => ({ ...current, [candidate.id]: { ...decision, reason: event.target.value } }))} placeholder={decision.resolution === "different_purchase" ? "Vì sao đây là giao dịch khác?" : "Ví dụ: Đã xem hóa đơn và xác nhận người trả"} /></div>
            </div>
          </fieldset>;
        })}
        {conflictingPayers ? <p className="form-error" role="alert">Một giao dịch không thể vừa do quán trả vừa do admin tự trả. Hãy kiểm tra lại các lựa chọn.</p> : null}
        {!showReceiptChoice && !hasShopCashDecision ? <p className="form-note">Các khoản được đánh dấu là giao dịch khác sẽ tạo phiếu nhập kho mới; không tái sử dụng phiếu có thể thuộc giao dịch khác.</p> : null}
        {hasShopCashDecision ? <p className="form-note">Có khoản xác nhận tiền quán đã trả: bản nháp sẽ được hủy, chi phí ngày được giữ nguyên.</p> : null}
        {resolutionState?.error ? <p className="form-error" role="alert">{resolutionState.error}</p> : null}
        {resolutionState?.error ? <button className="button button-secondary" type="button" onClick={() => router.refresh()}>Tải lại các khoản cần đối chiếu</button> : null}
        {resolutionState?.success ? <p className="form-success" role="status">{resolutionState.success}</p> : null}
        <button className="button" type="submit" disabled={resolving || !allDecisionsComplete || conflictingPayers}>{resolving ? "Đang lưu quyết định…" : `Ghi ${duplicateRows.length} quyết định và xử lý phiếu`}</button>
        <p className="form-note">Các quyết định, lưu lịch sử và chốt hoặc hủy phiếu được xử lý trong cùng một giao dịch.</p>
      </form>
    </div> : null}
    {finalState?.error && !finalState.requiresDuplicateReview && duplicateRows.length === 0 ? <p className="form-error" role="alert">{finalState.error}</p> : null}
  </section>;
}

export type ReimbursementDisplayEvent = {
  id: string;
  event_type: "payment" | "reversal";
  business_date: string;
  amount_vnd: number | string;
  note: string | null;
  reverses_event_id?: string | null;
  created_at: string;
  actor_id?: string;
};

function ReimbursementEntryForm({
  voucherId,
  idempotencyKey,
  events,
  reversalEvent,
}: {
  voucherId: string;
  idempotencyKey: string;
  events: readonly ReimbursementDisplayEvent[];
  reversalEvent?: ReimbursementDisplayEvent;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<AdvanceActionState | undefined, FormData>(recordPurchaseReimbursement, undefined);
  const result = state?.result && typeof state.result === "object" ? state.result as { event_id?: string; outstanding_vnd?: number } : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const reversedByEvent = new Map<string, number>();
  for (const event of events) if (event.event_type === "reversal" && event.reverses_event_id) {
    reversedByEvent.set(event.reverses_event_id, (reversedByEvent.get(event.reverses_event_id) ?? 0) + Number(event.amount_vnd));
  }
  const remaining = reversalEvent ? Number(reversalEvent.amount_vnd) - (reversedByEvent.get(reversalEvent.id) ?? 0) : null;

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [router, state?.success]);

  return <div className="owner-purchase-reimbursement-entry">
    <form action={action} className="owner-purchase-inline-form">
      <input type="hidden" name="voucher_id" value={voucherId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="reverses_event_id" value={reversalEvent?.id ?? ""} />
      <div className="owner-purchase-form-fields">
        <div className="field"><label htmlFor={`${voucherId}-${reversalEvent?.id ?? "repay"}-date`}>{reversalEvent ? "Ngày điều chỉnh" : "Ngày cửa hàng hoàn"}</label><input id={`${voucherId}-${reversalEvent?.id ?? "repay"}-date`} name="business_date" type="date" min="2026-09-01" required defaultValue={today} /></div>
        <div className="field"><label htmlFor={`${voucherId}-${reversalEvent?.id ?? "repay"}-amount`}>{reversalEvent ? "Số tiền điều chỉnh" : "Số tiền đã hoàn"}</label><input id={`${voucherId}-${reversalEvent?.id ?? "repay"}-amount`} name="amount_vnd" type="text" inputMode="numeric" required placeholder={reversalEvent ? `Tối đa ${remaining}` : "Nhập số tiền thực hoàn"} /></div>
        <div className="field"><label htmlFor={`${voucherId}-${reversalEvent?.id ?? "repay"}-note`}>{reversalEvent ? "Lý do điều chỉnh" : "Ghi chú"}</label><input id={`${voucherId}-${reversalEvent?.id ?? "repay"}-note`} name="note" maxLength={1000} placeholder={reversalEvent ? "Nêu lý do sửa lần hoàn" : "Ví dụ: Hoàn lần 1"} /></div>
      </div>
      {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state?.success ? <p className="form-success" role="status">{state.success}{result?.outstanding_vnd !== undefined ? ` Số còn ứng: ${formatVnd(result.outstanding_vnd)}.` : ""}</p> : null}
      <button className="button button-secondary" type="submit" disabled={pending || (remaining !== null && remaining <= 0)}>{pending ? "Đang lưu…" : reversalEvent ? "Ghi điều chỉnh hoàn tiền" : "Ghi nhận tiền đã hoàn"}</button>
    </form>
    {result?.event_id ? <div className="owner-purchase-reimbursement-proof"><p className="form-note">Có thể thêm ảnh xác nhận khoản hoàn vừa ghi.</p><EvidenceUploader voucherId={voucherId} reimbursementId={result.event_id} /></div> : null}
  </div>;
}

export function ReimbursementPanel({
  voucherId,
  invoiceTotalVnd,
  events,
  idempotencyKey,
  allowReimbursement,
}: {
  voucherId: string;
  invoiceTotalVnd: number | string;
  events: ReimbursementDisplayEvent[];
  idempotencyKey: string;
  allowReimbursement: boolean;
}) {
  const summary = summarizeReimbursements(invoiceTotalVnd, events);
  const [reversalEventId, setReversalEventId] = useState("");
  const reversedByEvent = new Map<string, number>();
  for (const event of events) if (event.event_type === "reversal" && event.reverses_event_id) {
    reversedByEvent.set(event.reverses_event_id, (reversedByEvent.get(event.reverses_event_id) ?? 0) + Number(event.amount_vnd));
  }
  return <section className="surface owner-purchase-financial-panel">
    <div className="section-heading"><div><h2>Tiền đã hoàn lại</h2><p>Các lần hoàn được cộng nối tiếp, không sửa hoặc xóa lịch sử cũ.</p></div></div>
    <div className="owner-purchase-balance-grid"><div><span>Đã hoàn</span><strong>{formatVnd(summary.reimbursedVnd)}</strong></div><div><span>Còn ứng</span><strong>{formatVnd(summary.outstandingVnd)}</strong></div></div>
    {events.length ? <ol className="owner-purchase-event-list">{events.map((event) => <li key={event.id}>
      <div><strong>{event.event_type === "payment" ? "Cửa hàng hoàn tiền" : "Điều chỉnh lần hoàn"}</strong><span>{formatBusinessDate(event.business_date, { day: "numeric", month: "short", year: "numeric" })}{event.note ? ` · ${event.note}` : ""}</span><small>{formatBusinessDate(event.created_at.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })} · do admin ghi nhận</small></div>
      <strong className={event.event_type === "payment" ? "owner-purchase-event-positive" : "owner-purchase-event-reversal"}>{event.event_type === "payment" ? "+" : "−"}{formatVnd(Number(event.amount_vnd))}</strong>
      {allowReimbursement && event.event_type === "payment" && (reversedByEvent.get(event.id) ?? 0) < Number(event.amount_vnd) ? <button className="button button-plain" type="button" onClick={() => setReversalEventId((current) => current === event.id ? "" : event.id)}>{reversalEventId === event.id ? "Đóng điều chỉnh" : "Điều chỉnh"}</button> : null}
      {reversalEventId === event.id ? <div className="owner-purchase-reversal-form"><ReimbursementEntryForm key={`${idempotencyKey}-${event.id}`} voucherId={voucherId} idempotencyKey={idempotencyKey} events={events} reversalEvent={event} /></div> : null}
    </li>)}</ol> : <p className="form-note">Chưa ghi nhận lần hoàn nào.</p>}
    {allowReimbursement && summary.outstandingVnd > 0 ? <details className="owner-purchase-new-reimbursement"><summary>Thêm lần hoàn tiền</summary><ReimbursementEntryForm key={idempotencyKey} voucherId={voucherId} idempotencyKey={idempotencyKey} events={events} /></details> : null}
  </section>;
}

export type ProfitLine = {
  id: string;
  description: string;
  active: boolean;
  costClass: string;
  inventoryClass: string;
  lineAmountVnd: number | string | null;
};

type ProfitPostingDisplay = {
  id: string;
  source_line_id: string;
  posting_type: "post" | "reversal";
  accounting_month: string;
  amount_vnd: number | string;
  reverses_posting_id: string | null;
  created_at: string;
  actor_id?: string;
};

function ReverseProfitForm({ posting, idempotencyKey }: { posting: ProfitPostingDisplay; idempotencyKey: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<AdvanceActionState | undefined, FormData>(reversePurchaseCostPosting, undefined);
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [router, state?.success]);
  return <form action={action} className="owner-purchase-reverse-profit-form">
    <input type="hidden" name="posting_id" value={posting.id} />
    <input type="hidden" name="accounting_month" value={posting.accounting_month} />
    <input type="hidden" name="idempotency_key" value={idempotencyKey} />
    <div className="field"><label htmlFor={`${posting.id}-reverse-reason`}>Lý do hoàn tác</label><input id={`${posting.id}-reverse-reason`} name="reason" required minLength={2} maxLength={500} placeholder="Ghi lý do để giữ lịch sử" /></div>
    {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state?.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <button className="button button-danger" type="submit" disabled={pending}>{pending ? "Đang hoàn tác…" : `Hoàn tác ${formatVnd(Number(posting.amount_vnd))}`}</button>
  </form>;
}

export function ProfitPostingPanel({
  voucherId,
  purchaseDate,
  lines,
  postings,
  idempotencyKey,
}: {
  voucherId: string;
  purchaseDate: string;
  lines: ProfitLine[];
  postings: ProfitPostingDisplay[];
  idempotencyKey: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<AdvanceActionState | undefined, FormData>(postPurchaseCosts, undefined);
  const { eligible, excluded } = getEligibleProfitLines(lines);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>(eligible.map(({ id }) => id));
  const accountingMonth = `${purchaseDate.slice(0, 7)}-01`;
  const selectedTotal = eligible.filter(({ id }) => selectedLineIds.includes(id)).reduce((sum, line) => sum + Number(line.lineAmountVnd), 0);
  const activePostingIds = new Set(postings.filter(({ posting_type }) => posting_type === "reversal").map(({ reverses_posting_id }) => reverses_posting_id));
  const activePosts = postings.filter((posting) => posting.posting_type === "post" && !activePostingIds.has(posting.id));

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [router, state?.success]);

  return <section className="surface owner-purchase-financial-panel">
    <div className="section-heading"><div><h2>Ghi nhận chi phí vào lợi nhuận</h2><p>Không tự động cộng vào lợi nhuận. Nguyên liệu luôn loại trừ vì COGS tháng lấy từ POS.</p></div></div>
    <div className="owner-purchase-post-preview"><span>Kỳ ghi nhận mặc định</span><strong>{accountingMonth.slice(0, 7)}</strong><span>Phần đã chọn</span><strong>{formatVnd(selectedTotal)}</strong></div>
    {eligible.length ? <form action={action} className="owner-purchase-profit-form">
      <input type="hidden" name="voucher_id" value={voucherId} />
      <input type="hidden" name="line_ids" value={JSON.stringify(selectedLineIds)} />
      <input type="hidden" name="accounting_month" value={accountingMonth} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <fieldset className="owner-purchase-profit-lines"><legend>Chọn dòng đủ điều kiện</legend>
        {eligible.map((line) => <label key={line.id} className="owner-purchase-profit-line"><input type="checkbox" checked={selectedLineIds.includes(line.id)} onChange={(event) => setSelectedLineIds((current) => event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id))} /><span>{line.description}</span><strong>{formatVnd(Number(line.lineAmountVnd))}</strong></label>)}
      </fieldset>
      {excluded.length ? <details className="owner-purchase-exclusions"><summary>{excluded.length} dòng không ghi nhận được</summary><ul>{excluded.map((line) => <li key={line.id}><span>{line.description}</span><small>{line.reason === "raw_material" ? "Nguyên liệu · thuộc COGS POS" : line.reason === "unpriced" ? "Chưa nhập tiền cho dòng" : "Dòng đã được thay thế"}</small></li>)}</ul></details> : null}
      <label className="owner-purchase-confirm"><input type="checkbox" name="confirmed" required />Tôi xác nhận ghi {formatVnd(selectedTotal)} vào lợi nhuận tháng {accountingMonth.slice(0, 7)}.</label>
      {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state?.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <button className="button" type="submit" disabled={pending || selectedLineIds.length === 0}>{pending ? "Đang ghi nhận…" : "Xem lại và ghi nhận"}</button>
    </form> : <p className="form-note">Chưa có dòng ngoài nguyên liệu nào có giá phân bổ.</p>}

    {postings.length ? <div className="owner-purchase-posting-history"><h3>Lịch sử ghi nhận lợi nhuận</h3><ul>{postings.map((posting) => <li key={posting.id}><span>{posting.posting_type === "post" ? "Đã ghi nhận" : "Đã hoàn tác"} · {posting.accounting_month.slice(0, 7)} · {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(posting.created_at))}</span><strong>{formatVnd(Number(posting.amount_vnd))}</strong></li>)}</ul></div> : null}
    {activePosts.map((posting) => <details className="owner-purchase-reverse-posting" key={posting.id}><summary>Hoàn tác bút toán #{posting.id.slice(0, 8)}</summary><ReverseProfitForm key={`${idempotencyKey}-${posting.id}`} posting={posting} idempotencyKey={idempotencyKey} /></details>)}
  </section>;
}
