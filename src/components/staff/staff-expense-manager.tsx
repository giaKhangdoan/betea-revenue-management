"use client";

import { useActionState, useState } from "react";
import { saveStaffEntryAction, type StaffEntryActionState } from "@/app/(staff)/staff/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatVnd } from "@/lib/finance/format";

type Expense = { id: string; amount_vnd: number; reason: string; created_at: string };

export function StaffExpenseManager({ date, expenses, editable }: { date: string; expenses: Expense[]; editable: boolean }) {
  const [state, action, pending] = useActionState<StaffEntryActionState, FormData>(saveStaffEntryAction, undefined);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = expenses.find((expense) => expense.id === editingId) ?? null;
  return <section className="surface staff-expense-card">
    <div className="section-heading"><div><h2>Chi phí phát sinh</h2><p>{editable ? "Mua đá, vận chuyển, sửa chữa hoặc khoản chi khác trong ngày." : "Ngày đã qua chỉ xem lại."}</p></div><strong>{formatVnd(expenses.reduce((sum, expense) => sum + Number(expense.amount_vnd), 0))}</strong></div>
    {editable ? <form className="staff-single-form" action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="expense_add" /><div className="staff-shift-grid"><label className="field"><span>Số tiền</span><input name="amount_vnd" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} inputMode="numeric" placeholder="Ví dụ: 120.000" /></label><label className="field"><span>Lý do</span><input name="reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={240} placeholder="Ví dụ: mua đá" /></label></div><button className="button button-secondary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Thêm chi phí"}</button><ActionMessage error={state?.error} success={state?.success} /></form> : null}
    {expenses.length === 0 ? <p className="empty-inline">Chưa có chi phí phát sinh trong ngày.</p> : <div className="staff-expense-list">{expenses.map((expense) => editing?.id === expense.id ? <form className="staff-expense-edit" key={expense.id} action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="expense_update" /><input type="hidden" name="expense_id" value={expense.id} /><label className="field"><span>Số tiền</span><input name="amount_vnd" defaultValue={String(expense.amount_vnd)} inputMode="numeric" /></label><label className="field"><span>Lý do</span><input name="reason" defaultValue={expense.reason} maxLength={240} /></label><div className="staff-inline-actions"><button className="button button-secondary" type="submit" disabled={pending}>Lưu</button><button className="text-button" type="button" onClick={() => setEditingId(null)}>Hủy</button></div><ActionMessage error={state?.error} success={state?.success} /></form> : <div className="staff-expense-row" key={expense.id}><div><strong>{expense.reason}</strong><span>{new Intl.DateTimeFormat("vi-VN", { timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(expense.created_at))}</span></div><strong>{formatVnd(expense.amount_vnd)}</strong>{editable ? <div className="staff-inline-actions"><button className="text-button" type="button" onClick={() => setEditingId(expense.id)}>Sửa</button><form action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="kind" value="expense_delete" /><input type="hidden" name="expense_id" value={expense.id} /><button className="text-button text-button-danger" type="submit" disabled={pending}>Xóa</button></form></div> : null}</div>)}</div>}
  </section>;
}
