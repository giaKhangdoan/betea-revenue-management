"use client";

import { useActionState } from "react";
import { restoreDeletedShift, type EntryActionState } from "@/app/(private)/ledger/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { formatVnd } from "@/lib/finance/format";

type DeletedShift = {
  id: string;
  shift_code: string;
  amount_vnd: number;
  deleted_at: string;
  restored_at: string | null;
};

export function DeletedShiftHistory({ date, rows }: { date: string; rows: DeletedShift[] }) {
  const [state, action, pending] = useActionState<EntryActionState, FormData>(restoreDeletedShift, undefined);
  if (rows.length === 0) return null;
  return <section className="surface table-card deleted-shift-card">
    <div className="section-heading"><div><h2>Lịch sử ca đã xóa</h2><p>Giá trị cũ vẫn được lưu để đối chiếu; khôi phục sẽ không ghi đè ca đã nhập lại.</p></div></div>
    <div className="deleted-shift-list">{rows.map((row) => <div className="deleted-shift-row" key={row.id}><div><strong>Ca {row.shift_code}</strong><span>{formatVnd(row.amount_vnd)} · {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(row.deleted_at))}</span></div>{row.restored_at ? <span className="status status-success">Đã khôi phục</span> : <form action={action}><input type="hidden" name="business_date" value={date} /><input type="hidden" name="deletion_id" value={row.id} /><button className="text-button" type="submit" disabled={pending}>{pending ? "Đang khôi phục…" : "Khôi phục ca"}</button></form>}</div>)}</div>
    <ActionMessage error={state?.error} success={state?.success} />
  </section>;
}
