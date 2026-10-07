"use client";

import { useActionState } from "react";
import { saveMonthTargets, saveWeekTarget } from "@/app/(private)/costs/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { addDays, displayVndInput, formatBusinessDate } from "@/lib/finance/format";

export function TargetForms({ month, weekDate, weekStart, monthTarget, weekTarget }: {
  month: string;
  weekDate: string;
  weekStart: string;
  monthTarget: { revenue_target_vnd?: number | null; profit_target_vnd?: number | null } | null;
  weekTarget: { revenue_target_vnd?: number | null } | null;
}) {
  const [monthState, monthAction, monthPending] = useActionState(saveMonthTargets, undefined);
  const [weekState, weekAction, weekPending] = useActionState(saveWeekTarget, undefined);
  return (
    <section className="target-forms">
      <form action={monthAction} className="surface target-form">
        <input type="hidden" name="month" value={month} />
        <div className="section-heading"><div><h2>Mục tiêu tháng</h2><p>So sánh doanh thu và lợi nhuận dự tính với kết quả thực tế.</p></div></div>
        <label className="field"><span>Mục tiêu doanh thu tháng</span><span className="input-suffix"><input name="month_revenue_target_vnd" type="text" inputMode="numeric" placeholder="Chưa đặt" defaultValue={displayVndInput(monthTarget?.revenue_target_vnd)} /><span>đ</span></span></label>
        <label className="field"><span>Mục tiêu lợi nhuận tháng</span><span className="input-suffix"><input name="month_profit_target_vnd" type="text" inputMode="numeric" placeholder="Chưa đặt" defaultValue={displayVndInput(monthTarget?.profit_target_vnd)} /><span>đ</span></span></label>
        <ActionMessage error={monthState?.error} success={monthState?.success} />
        <div className="form-actions"><button className="button button-secondary" type="submit" disabled={monthPending}>{monthPending ? "Đang lưu…" : "Lưu mục tiêu tháng"}</button></div>
      </form>
      <details className="surface compact-disclosure weekly-target-disclosure">
        <summary><strong>Mục tiêu doanh thu tuần</strong><span>{formatBusinessDate(weekStart, { day: "numeric", month: "short" })}–{formatBusinessDate(addDays(weekStart, 6), { day: "numeric", month: "short" })} · {weekTarget?.revenue_target_vnd == null ? "Chưa đặt" : displayVndInput(weekTarget.revenue_target_vnd)}</span></summary>
        <div className="compact-disclosure-content">
          <form method="get" action="/costs" className="week-target-selector">
            <input type="hidden" name="month" value={month} />
            <label className="field"><span>Chọn một ngày trong tuần</span><input type="date" name="week" min="2026-09-01" defaultValue={weekDate} /></label>
            <button className="button button-secondary" type="submit">Xem tuần</button>
          </form>
          <form action={weekAction} className="surface target-form">
            <input type="hidden" name="week_start" value={weekStart} />
            <div className="section-heading"><div><h2>Mục tiêu tuần</h2><p>Tính từ Thứ 2 đến Chủ nhật.</p></div></div>
            <label className="field"><span>Mục tiêu tuần</span><span className="input-suffix"><input name="revenue_target_vnd" type="text" inputMode="numeric" placeholder="Chưa đặt" defaultValue={displayVndInput(weekTarget?.revenue_target_vnd)} /><span>đ</span></span></label>
            <ActionMessage error={weekState?.error} success={weekState?.success} />
            <div className="form-actions"><button className="button button-secondary" type="submit" disabled={weekPending}>{weekPending ? "Đang lưu…" : "Lưu mục tiêu tuần"}</button></div>
          </form>
        </div>
      </details>
    </section>
  );
}
