"use client";

import { useActionState } from "react";
import { saveMonthlyCosts } from "@/app/(private)/costs/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { displayVndInput } from "@/lib/finance/format";

type Costs = {
  cogs_vnd?: number | null;
  rent_vnd?: number | null;
  wages_vnd?: number | null;
  water_bill_vnd?: number | null;
  electricity_bill_vnd?: number | null;
  note?: string | null;
};

export function MonthlyCostForm({ month, costs }: { month: string; costs: Costs | null }) {
  const [state, action, pending] = useActionState(saveMonthlyCosts, undefined);
  const values = [
    { name: "cogs_vnd", label: "COGS theo POS", amount: costs?.cogs_vnd, helper: "Nhập tổng COGS tháng từ máy POS. Không chia về tuần hoặc ngày." },
    { name: "rent_vnd", label: "Tiền thuê mặt bằng", amount: costs?.rent_vnd ?? 10000000, helper: "Mặc định 10.000.000 ₫/tháng; có thể sửa theo thực tế." },
    { name: "wages_vnd", label: "Lương nhân viên", amount: costs?.wages_vnd, helper: "Nhập tổng lương của tháng." },
    { name: "water_bill_vnd", label: "Tiền nước theo bill", amount: costs?.water_bill_vnd, helper: "Nhập một lần theo hóa đơn tháng." },
    { name: "electricity_bill_vnd", label: "Tiền điện theo bill", amount: costs?.electricity_bill_vnd, helper: "Có thể để trống để dùng số ước tính từ công tơ." },
  ];
  return (
    <form action={action} className="surface cost-form">
      <input type="hidden" name="month" value={month} />
      <div className="section-heading"><div><h2>Chi phí tháng</h2><p>Nhập hoặc chỉnh lại theo hóa đơn và số thực tế.</p></div></div>
      <div className="cost-form-grid">
        {values.map((item) => <label className="field cost-field" key={item.name}><span>{item.label}</span><span className="input-suffix"><input name={item.name} type="text" inputMode="numeric" placeholder="Chưa nhập" defaultValue={displayVndInput(item.amount)} /><span>đ</span></span><small>{item.helper}</small></label>)}
      </div>
      <label className="field"><span>Ghi chú</span><textarea name="note" rows={2} maxLength={1000} placeholder="Ghi chú bill, thời điểm nhận hoặc điều chỉnh" defaultValue={costs?.note ?? ""} /></label>
      <p className="form-note">Tiền thuê, lương, nước và tiền điện được chia theo ngày lịch trong tháng. COGS được trừ nguyên tháng, không phân bổ.</p>
      <ActionMessage error={state?.error} success={state?.success} />
      <div className="form-actions"><button className="button" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu chi phí tháng"}</button></div>
    </form>
  );
}
