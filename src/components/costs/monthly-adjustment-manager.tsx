"use client";

import { useActionState } from "react";
import { addMonthlyCostAdjustment, deleteMonthlyCostAdjustment } from "@/app/costs/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatVnd } from "@/lib/finance/format";

type Adjustment = {
  id: string;
  category: string;
  amount_delta_vnd: number;
  note: string;
  created_at: string;
};

const categories = [
  { value: "rent", label: "Thuê mặt bằng" },
  { value: "wages", label: "Lương nhân viên" },
  { value: "water", label: "Tiền nước" },
] as const;

const categoryLabels = Object.fromEntries(categories.map(({ value, label }) => [value, label]));

function AdjustmentRow({ adjustment }: { adjustment: Adjustment }) {
  const [state, action, pending] = useActionState(deleteMonthlyCostAdjustment, undefined);
  const amount = Number(adjustment.amount_delta_vnd);
  return (
    <div className="adjustment-row">
      <div><strong>{categoryLabels[adjustment.category] ?? "Chi phí tháng"} · {amount > 0 ? "Tăng" : "Giảm"} {formatVnd(Math.abs(amount))}</strong><span>{adjustment.note}</span><time dateTime={adjustment.created_at}>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(adjustment.created_at))}</time><ActionMessage error={state?.error} success={state?.success} /></div>
      <form action={action} onSubmit={(event) => { if (!window.confirm("Gỡ điều chỉnh này khỏi chi phí tháng?")) event.preventDefault(); }}>
        <input type="hidden" name="id" value={adjustment.id} />
        <button className="text-button" type="submit" disabled={pending} aria-label={`Gỡ điều chỉnh ${categoryLabels[adjustment.category] ?? "chi phí"} ${formatVnd(Math.abs(amount))}`}>{pending ? "Đang gỡ…" : "Gỡ"}</button>
      </form>
    </div>
  );
}

export function MonthlyAdjustmentManager({ month, adjustments }: { month: string; adjustments: Adjustment[] }) {
  const [state, action, pending] = useActionState(addMonthlyCostAdjustment, undefined);
  const totalDelta = adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount_delta_vnd), 0);
  const categoryTotals = categories.map(({ value, label }) => ({
    label,
    amount: adjustments.filter((adjustment) => adjustment.category === value)
      .reduce((sum, adjustment) => sum + Number(adjustment.amount_delta_vnd), 0),
  }));

  return (
    <section className="surface monthly-adjustment-card">
      <div className="section-heading"><div><h2>Điều chỉnh chi phí tháng</h2><p>Ghi phần tăng hoặc giảm và lý do; chi phí gốc vẫn được giữ để đối chiếu.</p></div><strong>{totalDelta > 0 ? "+" : ""}{formatVnd(totalDelta)}</strong></div>
      <div className="adjustment-totals" aria-label="Tổng điều chỉnh theo khoản">
        {categoryTotals.map(({ label, amount }) => <div key={label}><span>{label}</span><strong>{amount > 0 ? "+" : ""}{formatVnd(amount)}</strong></div>)}
      </div>
      <form action={action} className="adjustment-form">
        <input type="hidden" name="month" value={month} />
        <label className="field"><span>Khoản cần điều chỉnh</span><select name="category" defaultValue="rent"><option value="rent">Thuê mặt bằng</option><option value="wages">Lương nhân viên</option><option value="water">Tiền nước</option></select></label>
        <label className="field"><span>Loại điều chỉnh</span><select name="direction" defaultValue="increase"><option value="increase">Tăng chi phí</option><option value="decrease">Giảm chi phí</option></select></label>
        <label className="field"><span>Số tiền</span><span className="input-suffix"><input name="amount_vnd" type="text" inputMode="numeric" placeholder="Ví dụ: 250.000" required /><span>đ</span></span></label>
        <label className="field adjustment-reason"><span>Lý do</span><input name="note" type="text" minLength={2} maxLength={240} placeholder="Ví dụ: giảm tiền thuê tháng này" required /></label>
        <ActionMessage error={state?.error} success={state?.success} />
        <div className="form-actions"><button className="button button-secondary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Thêm điều chỉnh"}</button></div>
      </form>
      <div className="adjustment-list">
        {adjustments.length === 0 ? <p className="empty-inline">Chưa có điều chỉnh cho tháng này.</p> : adjustments.map((adjustment) => <AdjustmentRow adjustment={adjustment} key={adjustment.id} />)}
      </div>
    </section>
  );
}
