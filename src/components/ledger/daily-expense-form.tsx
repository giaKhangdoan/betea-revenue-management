"use client";

import { useActionState, useState } from "react";
import { addDailyExpense, type EntryActionState } from "@/app/(private)/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatBusinessDate, formatVnd } from "@/lib/finance/format";

export function DailyExpenseForm({ date }: { date: string }) {
  const [state, formAction, pending] = useActionState<EntryActionState, FormData>(addDailyExpense, undefined);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [dismissedReviewKey, setDismissedReviewKey] = useState("");
  const duplicateCandidates = state?.duplicateCandidates ?? [];
  const needsDuplicateReview = duplicateCandidates.length > 0 && state?.duplicateReviewKey !== dismissedReviewKey;

  return (
    <form action={formAction} className="expense-form surface">
      <div className="section-heading"><div><h2>Chi phí phát sinh</h2><p>Nhập khoản mua đá, vận chuyển, sửa chữa hoặc khoản chi khác. Sau khi admin đối chiếu với phiếu mua, khoản chi sẽ khóa sửa/xóa để giữ nguyên lịch sử.</p></div></div>
      <input type="hidden" name="business_date" value={date} />
      <div className="expense-grid">
        <label className="field"><span>Số tiền</span><span className="input-suffix"><input name="amount_vnd" type="text" inputMode="numeric" placeholder="Ví dụ: 120.000" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} readOnly={needsDuplicateReview} /><span>đ</span></span></label>
        <label className="field"><span>Lý do chi</span><input name="reason" required minLength={2} maxLength={240} placeholder="Ví dụ: mua đá, phí giao nguyên liệu" value={reason} onChange={(event) => setReason(event.currentTarget.value)} readOnly={needsDuplicateReview} /></label>
      </div>
      <ActionMessage error={state?.error} success={state?.success} />
      {needsDuplicateReview ? <section className="owner-expense-duplicate-review" aria-label="Đối chiếu phiếu mua đã chốt">
        <strong>Khoản chi này khớp với {duplicateCandidates.length} phiếu mua đã chốt.</strong>
        <p>Chỉ xác nhận nếu đây là khoản chi tiền quán riêng, khác với các giao dịch trong danh sách. Nếu cùng một giao dịch đã được ghi ở phiếu mua cá nhân, không nhập lại khoản này.</p>
        <ul>{duplicateCandidates.map((candidate) => <li key={candidate.voucherId}>
          <strong>{candidate.vendor || candidate.note || "Phiếu mua cá nhân"}</strong>
          <span>{formatBusinessDate(candidate.purchaseDate, { day: "numeric", month: "short", year: "numeric" })} · Hóa đơn {formatVnd(candidate.invoiceTotalVnd)} · Khớp {candidate.matchKind === "line" ? candidate.matchedText : "tổng hóa đơn"}</span>
        </li>)}</ul>
        <label className="field"><span>Lý do xác nhận đây là giao dịch khác</span><textarea name="duplicate_review_reason" required minLength={5} maxLength={500} placeholder="Ví dụ: Chi phí vận chuyển phát sinh riêng, không nằm trong hóa đơn đã chốt." /></label>
        <input type="hidden" name="review_as_different_purchase" value="yes" />
        <input type="hidden" name="matched_voucher_ids" value={JSON.stringify(duplicateCandidates.map(({ voucherId }) => voucherId))} />
        <input type="hidden" name="duplicate_review_key" value={state?.duplicateReviewKey ?? ""} />
        <div className="form-actions">
          <button className="button" type="submit" disabled={pending}>{pending ? "Đang lưu quyết định…" : "Xác nhận giao dịch khác và ghi chi phí"}</button>
          <button className="button button-secondary" type="button" onClick={() => setDismissedReviewKey(state?.duplicateReviewKey ?? "")} disabled={pending}>Hủy đối chiếu</button>
        </div>
      </section> : <div className="form-actions"><button className="button button-secondary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : duplicateCandidates.length ? "Kiểm tra lại và thêm chi phí" : "Thêm chi phí"}</button></div>}
    </form>
  );
}
