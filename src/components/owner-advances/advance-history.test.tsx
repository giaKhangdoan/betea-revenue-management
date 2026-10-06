import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdvanceHistory } from "./advance-history";

const ownerId = "61000000-0000-4000-8000-000000000001";

describe("owner purchase audit history", () => {
  it("shows the actor, timestamp, and prior/updated voucher values for a correction", () => {
    const markup = renderToStaticMarkup(createElement(AdvanceHistory, {
      ownerId,
      events: [{
        id: "event-1",
        event_type: "voucher_corrected",
        actor_id: ownerId,
        occurred_at: "2026-10-06T10:00:00.000Z",
        reason: "Sửa số lượng theo hóa đơn",
        related_id: null,
        before_state: { voucher: { purchase_date: "2026-10-06", vendor: "Cửa hàng A", invoice_total_vnd: "100000", status: "finalized" }, lines: [] },
        after_state: { voucher: { purchase_date: "2026-10-06", vendor: "Cửa hàng A", invoice_total_vnd: "120000", status: "finalized" }, lines: [] },
      }],
    }));

    expect(markup).toContain("Hiệu chỉnh phiếu đã chốt");
    expect(markup).toContain("Admin · tài khoản chủ cửa hàng");
    expect(markup).toContain("Sửa số lượng theo hóa đơn");
    expect(markup).toContain("100.000");
    expect(markup).toContain("120.000");
    expect(markup).toContain("Xem dữ liệu trước và sau");
  });

  it("shows repayment balances from the event payload without an empty line-list state", () => {
    const markup = renderToStaticMarkup(createElement(AdvanceHistory, {
      ownerId,
      events: [{
        id: "event-2",
        event_type: "reimbursement_recorded",
        actor_id: ownerId,
        occurred_at: "2026-10-06T10:00:00.000Z",
        reason: null,
        related_id: "repayment-1",
        before_state: null,
        after_state: { event_id: "repayment-1", reimbursed_vnd: 30_000, outstanding_vnd: 220_000 },
      }],
    }));

    expect(markup).toContain("Tổng đã hoàn");
    expect(markup).toContain("30.000");
    expect(markup).toContain("Còn ứng");
    expect(markup).toContain("220.000");
    expect(markup).not.toContain("Phiếu chưa có dòng hàng");
  });

  it("unwraps duplicate-resolution snapshots and shows both the linked voucher and source daily expense", () => {
    const markup = renderToStaticMarkup(createElement(AdvanceHistory, {
      ownerId,
      events: [{
        id: "event-3",
        event_type: "duplicate_resolved",
        actor_id: ownerId,
        occurred_at: "2026-10-06T10:00:00.000Z",
        reason: "Tôi đã trả khoản này bằng tiền cá nhân",
        related_id: "expense-1",
        before_state: {
          voucher: { voucher: { purchase_date: "2026-10-06", vendor: "Nhà cung cấp trà", invoice_total_vnd: "36000", status: "draft" }, lines: [], stock_links: [] },
          daily_expense: { business_date: "2026-10-06", amount_vnd: 36000, reason: "Mua đá", deleted_at: null },
        },
        after_state: {
          voucher: { voucher: { purchase_date: "2026-10-06", vendor: "Nhà cung cấp trà", invoice_total_vnd: "36000", status: "finalized" }, lines: [], stock_links: [] },
          daily_expense: { business_date: "2026-10-06", amount_vnd: 36000, reason: "Mua đá", deleted_at: "2026-10-06T10:00:00Z" },
          resolution: "personal_paid",
        },
      }],
    }));

    expect(markup).toContain("Nhà cung cấp trà");
    expect(markup).toContain("Mua đá");
    expect(markup).toContain("Đã loại khỏi sổ chi ngày");
    expect(markup).toContain("admin tự trả");
  });

  it("shows every expense and its own decision reason in a batch duplicate review", () => {
    const markup = renderToStaticMarkup(createElement(AdvanceHistory, {
      ownerId,
      events: [{
        id: "event-4",
        event_type: "duplicate_resolved",
        actor_id: ownerId,
        occurred_at: "2026-10-06T10:00:00.000Z",
        reason: "Đã đối chiếu 2 khoản chi phát sinh",
        related_id: null,
        before_state: { voucher: { voucher: { purchase_date: "2026-10-06", vendor: "Đường", invoice_total_vnd: 36000, status: "draft" }, lines: [] }, daily_expenses: [] },
        after_state: {
          voucher: { voucher: { purchase_date: "2026-10-06", vendor: "Đường", invoice_total_vnd: 36000, status: "finalized" }, lines: [] },
          daily_expenses: [
            { id: "expense-a", business_date: "2026-10-06", amount_vnd: 36000, reason: "Đường", deleted_at: "2026-10-06T10:00:00Z" },
            { id: "expense-b", business_date: "2026-10-06", amount_vnd: 36000, reason: "Đường lần hai", deleted_at: null },
          ],
          decisions: [
            { daily_expense_id: "expense-a", resolution: "personal_paid", reason: "Admin trả bằng tiền cá nhân" },
            { daily_expense_id: "expense-b", resolution: "different_purchase", reason: "Thuộc hóa đơn khác" },
          ],
        },
      }],
    }));

    expect(markup).toContain("Các khoản chi đã rà");
    expect(markup).toContain("Đường lần hai");
    expect(markup).toContain("Admin trả bằng tiền cá nhân");
    expect(markup).toContain("Giao dịch khác");
    expect(markup).toContain("Thuộc hóa đơn khác");
  });
});
