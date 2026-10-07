import { formatBusinessDate, formatVnd } from "@/lib/finance/format";
import { PurchaseLineList, type PurchaseLineDisplay } from "./voucher-detail";

export type AdvanceAuditEvent = {
  id: string;
  event_type: string;
  actor_id: string | null;
  occurred_at: string;
  reason: string | null;
  related_id: string | null;
  before_state: unknown;
  after_state: unknown;
};

type Snapshot = {
  voucher?: Record<string, unknown>;
  daily_expense?: Record<string, unknown>;
  result?: Record<string, unknown>;
  lines?: unknown[];
  stock_links?: unknown[];
  daily_expenses?: unknown[];
  decisions?: unknown[];
  correction_request?: Record<string, unknown>;
  resolution?: string;
};

const EVENT_LABELS: Record<string, string> = {
  voucher_created: "Tạo bản nháp",
  voucher_updated: "Cập nhật bản nháp",
  voucher_finalized: "Chốt phiếu",
  voucher_canceled: "Hủy bản nháp",
  duplicate_resolved: "Đối chiếu khoản chi trùng",
  voucher_corrected: "Hiệu chỉnh phiếu đã chốt",
  reimbursement_recorded: "Ghi lần hoàn tiền",
  profit_posted: "Ghi nhận chi phí vào lợi nhuận",
  profit_reversed: "Hoàn tác bút toán lợi nhuận",
};

function asSnapshot(value: unknown): Snapshot | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Snapshot : null;
}

function normalizedSnapshot(snapshot: Snapshot): Snapshot {
  const nestedPurchaseSnapshot = asSnapshot(snapshot.voucher);
  if (!nestedPurchaseSnapshot?.voucher || typeof nestedPurchaseSnapshot.voucher !== "object") return snapshot;
  return {
    ...snapshot,
    voucher: nestedPurchaseSnapshot.voucher as Record<string, unknown>,
    lines: Array.isArray(snapshot.lines) ? snapshot.lines : nestedPurchaseSnapshot.lines,
    stock_links: Array.isArray(snapshot.stock_links) ? snapshot.stock_links : nestedPurchaseSnapshot.stock_links,
  };
}

function snapshotLines(snapshot: Snapshot | null): PurchaseLineDisplay[] {
  if (!Array.isArray(snapshot?.lines)) return [];
  return snapshot.lines.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const line = value as Record<string, unknown>;
    return [{
      id: String(line.id ?? index),
      description: String(line.description ?? ""),
      costClass: line.cost_class === "raw_material" ? "raw_material" : "non_ingredient",
      inventoryClass: line.inventory_class === "stock" ? "stock" : "non_stock",
      convertedQuantity: line.converted_quantity == null ? null : String(line.converted_quantity),
      smallUnit: line.small_unit_snapshot == null ? null : String(line.small_unit_snapshot),
      quantity: line.quantity_snapshot == null ? null : String(line.quantity_snapshot),
      unit: line.unit_snapshot == null ? null : String(line.unit_snapshot),
      lineAmountVnd: line.line_amount_vnd == null ? null : String(line.line_amount_vnd),
    }];
  });
}

function snapshotHeader(snapshot: Snapshot | null) {
  const voucher = snapshot ? normalizedSnapshot(snapshot).voucher : null;
  if (!voucher) return null;
  return {
    date: typeof voucher.purchase_date === "string" ? voucher.purchase_date : null,
    vendor: typeof voucher.vendor === "string" && voucher.vendor ? voucher.vendor : "Chưa ghi nhà cung cấp",
    total: voucher.invoice_total_vnd == null ? null : Number(voucher.invoice_total_vnd),
    status: typeof voucher.status === "string" ? voucher.status : null,
    note: typeof voucher.note === "string" ? voucher.note : null,
  };
}

function SnapshotPanel({ title, snapshot }: { title: string; snapshot: Snapshot | null }) {
  if (!snapshot) return <div className="owner-purchase-history-snapshot"><strong>{title}</strong><p>Không có ảnh chụp trạng thái cho mốc này.</p></div>;
  const normalized = normalizedSnapshot(snapshot);
  const header = snapshotHeader(normalized);
  const lines = snapshotLines(normalized);
  const expense = snapshot.daily_expense;
  const expenses = Array.isArray(snapshot.daily_expenses) ? snapshot.daily_expenses : [];
  const decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions : [];
  const result = normalized.result ?? (!normalized.voucher && !expense ? normalized as Record<string, unknown> : null);
  const resultLabels: Record<string, string> = {
    reimbursed_vnd: "Tổng đã hoàn",
    outstanding_vnd: "Còn ứng",
    accounting_month: "Kỳ lợi nhuận",
    amount_vnd: "Số tiền",
    business_date: "Ngày ghi nhận",
    event_type: "Loại sự kiện",
    posting_id: "Mã bút toán",
    reversed_posting_id: "Mã bút toán được hoàn tác",
    resolution: "Nguồn tiền đã xác nhận",
    reason: "Lý do",
  };
  const resultFields = result ? Object.entries(result).filter(([key, value]) => resultLabels[key] && (typeof value === "string" || typeof value === "number")) : [];
  return <div className="owner-purchase-history-snapshot">
    <strong>{title}</strong>
    {header ? <dl>
      {header.date ? <><dt>Ngày mua</dt><dd>{formatBusinessDate(header.date)}</dd></> : null}
      <dt>Nhà cung cấp</dt><dd>{header.vendor}</dd>
      {header.total !== null && Number.isSafeInteger(header.total) ? <><dt>Tổng hóa đơn</dt><dd>{formatVnd(header.total)}</dd></> : null}
      {header.status ? <><dt>Trạng thái</dt><dd>{header.status === "draft" ? "Bản nháp" : header.status === "finalized" ? "Đã chốt" : "Đã hủy"}</dd></> : null}
      {header.note ? <><dt>Ghi chú</dt><dd>{header.note}</dd></> : null}
    </dl> : null}
    {Array.isArray(normalized.lines) ? <PurchaseLineList lines={lines} /> : null}
    {expense ? <dl>
      <dt>Chi phí sổ ngày</dt><dd>{typeof expense.reason === "string" ? expense.reason : "Khoản chi"}</dd>
      {typeof expense.business_date === "string" ? <><dt>Ngày chi</dt><dd>{formatBusinessDate(expense.business_date)}</dd></> : null}
      {expense.amount_vnd !== undefined ? <><dt>Số tiền</dt><dd>{formatVnd(Number(expense.amount_vnd))}</dd></> : null}
      <dt>Trạng thái</dt><dd>{expense.deleted_at ? "Đã loại khỏi sổ chi ngày" : "Đang nằm trong sổ chi ngày"}</dd>
    </dl> : null}
    {expenses.length ? <div className="owner-purchase-history-expenses"><strong>Các khoản chi đã rà</strong><ul>{expenses.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      const expenseId = String(row.id ?? "");
      const decisionValue = decisions.find((item) => item && typeof item === "object" && !Array.isArray(item)
        && (item as Record<string, unknown>).daily_expense_id === expenseId) as Record<string, unknown> | undefined;
      const resolution = decisionValue?.resolution;
      const resolutionLabel = resolution === "personal_paid" ? "Admin tự trả"
        : resolution === "shop_cash" ? "Tiền quán trả"
          : resolution === "different_purchase" ? "Giao dịch khác" : "Chưa có quyết định";
      return <li key={expenseId || index}>
        <div><strong>{typeof row.reason === "string" ? row.reason : "Khoản chi"}</strong>
          <span>{typeof row.business_date === "string" ? formatBusinessDate(row.business_date) : ""} · {formatVnd(Number(row.amount_vnd ?? 0))} · {row.deleted_at ? "Đã loại khỏi sổ ngày" : "Đang giữ trong sổ ngày"}</span>
          <small>{resolutionLabel}{typeof decisionValue?.reason === "string" ? ` · ${decisionValue.reason}` : ""}</small>
        </div>
      </li>;
    })}</ul></div> : null}
    {normalized.resolution ? <p className="owner-purchase-history-resolution">Nguồn tiền: {normalized.resolution === "personal_paid" ? "admin tự trả" : normalized.resolution === "shop_cash" ? "tiền quán trả" : "giao dịch khác"}</p> : null}
    {resultFields.length ? <dl>{resultFields.map(([key, value]) => <div key={key}><dt>{resultLabels[key]}</dt><dd>{key.endsWith("_vnd") ? formatVnd(Number(value)) : key === "accounting_month" && typeof value === "string" ? value.slice(0, 7) : key.endsWith("_id") && typeof value === "string" ? value.slice(0, 8) : String(value)}</dd></div>)}</dl> : null}
    {Array.isArray(result?.posted) && result.posted.length ? <ul className="owner-purchase-history-posted-list">{result.posted.map((value, index) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      return <li key={String(row.posting_id ?? index)}>Đã ghi dòng {String(row.line_id ?? "").slice(0, 8)} · {formatVnd(Number(row.amount_vnd ?? 0))}</li>;
    })}</ul> : null}
    {normalized.correction_request?.reason ? <p className="owner-purchase-history-resolution">Lý do hiệu chỉnh: {String(normalized.correction_request.reason)}</p> : null}
    {normalized.stock_links?.length ? <p className="owner-purchase-history-resolution">Liên kết {normalized.stock_links.length} dòng vào phiếu kho.</p> : null}
  </div>;
}

export function AdvanceHistory({ events, ownerId }: { events: AdvanceAuditEvent[]; ownerId: string }) {
  return <details className="surface owner-purchase-detail-card owner-purchase-history">
    <summary className="owner-purchase-history-toggle"><strong>Lịch sử thay đổi</strong><span>{events.length} mốc</span></summary>
    {events.length ? <ol className="owner-purchase-history-list">{events.map((event) => {
      const before = asSnapshot(event.before_state);
      const after = asSnapshot(event.after_state);
      const hasSnapshots = before !== null || after !== null;
      return <li key={event.id} className="owner-purchase-history-event">
        <div className="owner-purchase-history-marker" aria-hidden="true" />
        <div className="owner-purchase-history-content">
          <div className="owner-purchase-history-heading"><strong>{EVENT_LABELS[event.event_type] ?? "Cập nhật phiếu"}</strong><time dateTime={event.occurred_at}>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(event.occurred_at))}</time></div>
          <span className="owner-purchase-history-actor">{event.actor_id === ownerId ? "Bạn" : event.actor_id ? `Admin · ${event.actor_id.slice(0, 8)}` : "Không rõ người thực hiện"}</span>
          {event.reason ? <p className="owner-purchase-history-reason">Lý do: {event.reason}</p> : null}
          {event.related_id ? <small className="owner-purchase-history-related">Mã liên kết: {event.related_id}</small> : null}
          {hasSnapshots ? <details className="owner-purchase-history-diff"><summary>Xem dữ liệu trước và sau</summary><div className="owner-purchase-history-snapshots">
            <SnapshotPanel title="Trước thay đổi" snapshot={before} />
            <SnapshotPanel title="Sau thay đổi" snapshot={after} />
          </div></details> : null}
        </div>
      </li>;
    })}</ol> : <p className="form-note">Chưa có thay đổi.</p>}
  </details>;
}
