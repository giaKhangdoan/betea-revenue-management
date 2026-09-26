"use client";

import { useActionState } from "react";
import { addDailyExpense, type EntryActionState } from "@/app/(private)/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";

export function DailyExpenseForm({ date }: { date: string }) {
  const [state, formAction, pending] = useActionState<EntryActionState, FormData>(addDailyExpense, undefined);
  return (
    <form action={formAction} className="expense-form surface">
      <div className="section-heading"><div><h2>Chi phí phát sinh</h2><p>Nhập khoản mua đá, vận chuyển, sửa chữa hoặc khoản chi khác.</p></div></div>
      <input type="hidden" name="business_date" value={date} />
      <div className="expense-grid">
        <label className="field"><span>Số tiền</span><span className="input-suffix"><input name="amount_vnd" type="text" inputMode="numeric" placeholder="Ví dụ: 120.000" /><span>đ</span></span></label>
        <label className="field"><span>Lý do chi</span><input name="reason" required minLength={2} maxLength={240} placeholder="Ví dụ: mua đá, phí giao nguyên liệu" /></label>
      </div>
      <ActionMessage error={state?.error} success={state?.success} />
      <div className="form-actions"><button className="button button-secondary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Thêm chi phí"}</button></div>
    </form>
  );
}
