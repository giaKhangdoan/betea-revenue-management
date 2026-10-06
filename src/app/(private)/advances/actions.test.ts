import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  readQueries: null as null | Record<string, Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createPurchaseVoucher,
  correctPurchaseVoucher,
  finalizePurchaseVoucher,
  postPurchaseCosts,
  recordPurchaseReimbursement,
  reversePurchaseCostPosting,
  resolvePurchaseDuplicate,
  updatePurchaseVoucher,
} from "./actions";

const ownerId = "93000000-0000-4000-8000-000000000001";
const voucherId = "94000000-0000-4000-8000-000000000001";
const dailyExpenseId = "95000000-0000-4000-8000-000000000001";
const lineId = "96000000-0000-4000-8000-000000000001";
const idempotencyKey = "97000000-0000-4000-8000-000000000001";
const owner = { ownerId, supabase: { rpc: mocks.rpc, from: mocks.from } };

const lines = [
  {
    description: "Trà đen",
    cost_class: "raw_material",
    inventory_class: "stock",
    inventory_item_id: "98000000-0000-4000-8000-000000000001",
    large_quantity: "1",
    loose_quantity: "0",
    line_amount_vnd: "200000",
  },
  {
    description: "Sửa máy dập nắp",
    cost_class: "non_ingredient",
    inventory_class: "non_stock",
    unit_snapshot: "lần",
    quantity_snapshot: "1",
    line_amount_vnd: "50000",
  },
];

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function voucherForm(overrides: Record<string, string> = {}) {
  return form({
    purchase_date: "2026-10-06",
    vendor: "Nhà cung cấp",
    invoice_total_vnd: "250000",
    note: "Mua trà và sửa máy",
    lines: JSON.stringify(lines),
    ...overrides,
  });
}

function createReadQuery(rows: unknown[], single: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "range", "insert", "update", "delete"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  query.then = vi.fn((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject));
  return query;
}

function configureOwnerReads(expenses: unknown[] = []) {
  const queries = {
    owner_purchase_vouchers: createReadQuery([], {
      id: voucherId,
      owner_id: ownerId,
      purchase_date: "2026-10-06",
      vendor: "Nhà cung cấp",
      invoice_total_vnd: 250_000,
      note: "Mua trà và sửa máy",
      status: "draft",
    }),
    owner_purchase_lines: createReadQuery([{
      id: lineId,
      owner_id: ownerId,
      voucher_id: voucherId,
      active: true,
      description: "Sửa máy dập nắp",
      cost_class: "non_ingredient",
      inventory_class: "non_stock",
      line_amount_vnd: 50_000,
    }], null),
    daily_expenses: createReadQuery(expenses, null),
  };
  mocks.readQueries = queries;
  mocks.from.mockImplementation((table: string) => {
    const query = queries[table as keyof typeof queries];
    if (!query) throw new Error(`Unexpected table access: ${table}`);
    return query;
  });
}

function expectNoTableWrites() {
  for (const query of Object.values(mocks.readQueries ?? {})) {
    expect(query.insert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
    expect(query.delete).not.toHaveBeenCalled();
  }
}

describe("owner purchase server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue(owner);
    mocks.rpc.mockResolvedValue({ data: voucherId, error: null });
    configureOwnerReads();
  });

  it("denies signed-out and staff sessions before any voucher write", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    const result = await createPurchaseVoucher(undefined, voucherForm());

    expect(result?.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("creates a draft through the owner RPC with explicit mixed line classifications", async () => {
    const result = await createPurchaseVoucher(undefined, voucherForm());

    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_create_purchase_voucher", {
      p_purchase_date: "2026-10-06",
      p_vendor: "Nhà cung cấp",
      p_invoice_total_vnd: 250000,
      p_note: "Mua trà và sửa máy",
      p_lines: [
        expect.objectContaining({ cost_class: "raw_material", inventory_class: "stock", inventory_item_id: "98000000-0000-4000-8000-000000000001" }),
        expect.objectContaining({ cost_class: "non_ingredient", inventory_class: "non_stock", unit_snapshot: "lần" }),
      ],
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("updates a draft through the audited update RPC and requires an edit reason", async () => {
    const missingReason = await updatePurchaseVoucher(undefined, voucherForm({ voucher_id: voucherId }));
    expect(missingReason?.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();

    const result = await updatePurchaseVoucher(undefined, voucherForm({ voucher_id: voucherId, reason: "Đối chiếu lại hóa đơn" }));
    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_update_purchase_voucher", expect.objectContaining({
      p_voucher_id: voucherId,
      p_reason: "Đối chiếu lại hóa đơn",
      p_lines: expect.arrayContaining([
        expect.objectContaining({ cost_class: "raw_material" }),
        expect.objectContaining({ cost_class: "non_ingredient" }),
      ]),
    }));
  });

  it("finalizes through one owner RPC, leaving stock and service side effects to the database transaction", async () => {
    const result = await finalizePurchaseVoucher(undefined, form({ voucher_id: voucherId }));

    expect(result?.success).toBeTruthy();
    expect(mocks.from).toHaveBeenCalledTimes(3);
    expect(mocks.from).toHaveBeenCalledWith("owner_purchase_vouchers");
    expect(mocks.from).toHaveBeenCalledWith("owner_purchase_lines");
    expect(mocks.from).toHaveBeenCalledWith("daily_expenses");
    expect(mocks.readQueries?.owner_purchase_vouchers.select).toHaveBeenCalled();
    expect(mocks.readQueries?.owner_purchase_vouchers.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(mocks.readQueries?.owner_purchase_vouchers.eq).toHaveBeenCalledWith("id", voucherId);
    expect(mocks.readQueries?.owner_purchase_lines.select).toHaveBeenCalled();
    expect(mocks.readQueries?.owner_purchase_lines.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(mocks.readQueries?.owner_purchase_lines.eq).toHaveBeenCalledWith("voucher_id", voucherId);
    expect(mocks.readQueries?.owner_purchase_lines.eq).toHaveBeenCalledWith("active", true);
    expect(mocks.readQueries?.daily_expenses.select).toHaveBeenCalled();
    expect(mocks.readQueries?.daily_expenses.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(mocks.readQueries?.daily_expenses.eq).toHaveBeenCalledWith("business_date", "2026-10-06");
    expectNoTableWrites();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_finalize_purchase_voucher", expect.objectContaining({ p_voucher_id: voucherId }));
  });

  it("rejects an inventory receipt selection when the voucher has no stock lines", async () => {
    const result = await finalizePurchaseVoucher(undefined, form({
      voucher_id: voucherId,
      existing_receipt_id: "99000000-0000-4000-8000-000000000001",
      receipt_line_links: "[]",
    }));

    expect(result?.error).toContain("không có dòng nhập kho");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(3);
    expectNoTableWrites();
  });

  it("requires a valid idempotency UUID and submits candidate decisions through one atomic RPC", async () => {
    configureOwnerReads([{
      id: dailyExpenseId,
      business_date: "2026-10-06",
      amount_vnd: 50_000,
      reason: "Sửa máy dập nắp",
      created_at: "2026-10-06T12:00:00Z",
    }]);
    const invalid = await resolvePurchaseDuplicate(undefined, form({
      voucher_id: voucherId,
      decisions: JSON.stringify([{ daily_expense_id: dailyExpenseId, resolution: "personal_paid", reason: "Đây là cùng giao dịch" }]),
      idempotency_key: "not-a-uuid",
      receipt_line_links: "[]",
    }));
    expect(invalid?.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();

    const result = await resolvePurchaseDuplicate(undefined, form({
      voucher_id: voucherId,
      decisions: JSON.stringify([{ daily_expense_id: dailyExpenseId, resolution: "personal_paid", reason: "Đây là cùng giao dịch" }]),
      idempotency_key: idempotencyKey,
      receipt_line_links: "[]",
    }));

    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_resolve_purchase_duplicates", expect.objectContaining({
      p_voucher_id: voucherId,
      p_decisions: [{ daily_expense_id: dailyExpenseId, resolution: "personal_paid", reason: "Đây là cùng giao dịch" }],
      p_idempotency_key: idempotencyKey,
    }));
    expect(mocks.from).not.toHaveBeenCalled();
    expectNoTableWrites();
  });

  it("forces a new stock receipt when every duplicate is confirmed as a different purchase", async () => {
    configureOwnerReads([{
      id: dailyExpenseId,
      business_date: "2026-10-06",
      amount_vnd: 50_000,
      reason: "Sửa máy dập nắp",
      created_at: "2026-10-06T12:00:00Z",
    }]);
    const result = await resolvePurchaseDuplicate(undefined, form({
      voucher_id: voucherId,
      decisions: JSON.stringify([{ daily_expense_id: dailyExpenseId, resolution: "different_purchase", reason: "Giao dịch khác, có hóa đơn riêng" }]),
      idempotency_key: idempotencyKey,
      existing_receipt_id: "99000000-0000-4000-8000-000000000001",
      receipt_line_links: JSON.stringify([{ purchase_line_id: lineId, receipt_line_id: "99100000-0000-4000-8000-000000000001" }]),
    }));

    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith("owner_resolve_purchase_duplicates", expect.objectContaining({
      p_existing_receipt_id: null,
      p_receipt_line_links: [],
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("corrects a finalized voucher through the history-preserving RPC and surfaces active-posting rejection", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Reverse active profit postings before correcting purchase lines or invoice total" },
    });
    const result = await correctPurchaseVoucher(undefined, voucherForm({
      voucher_id: voucherId,
      reason: "Sửa lại số lượng trên hóa đơn",
      existing_receipt_id: "99000000-0000-4000-8000-000000000001",
      receipt_line_links: "[]",
    }));

    expect(result?.error).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_correct_purchase_voucher", expect.objectContaining({
      p_voucher_id: voucherId,
      p_reason: "Sửa lại số lượng trên hóa đơn",
      p_lines: expect.arrayContaining([
        expect.objectContaining({ cost_class: "raw_material" }),
        expect.objectContaining({ cost_class: "non_ingredient" }),
      ]),
    }));
    expectNoTableWrites();
  });

  it("appends a partial repayment through the immutable reimbursement RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { reimbursed_vnd: 30_000, outstanding_vnd: 220_000 }, error: null });
    const result = await recordPurchaseReimbursement(undefined, form({
      voucher_id: voucherId,
      business_date: "2026-10-06",
      amount_vnd: "30000",
      note: "Hoàn lần 1",
      idempotency_key: idempotencyKey,
    }));

    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_record_purchase_reimbursement", expect.objectContaining({
      p_voucher_id: voucherId,
      p_event_type: "payment",
      p_business_date: "2026-10-06",
      p_amount_vnd: 30000,
      p_idempotency_key: idempotencyKey,
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("posts selected profit only after explicit confirmation and uses the idempotent posting RPC", async () => {
    const unconfirmed = await postPurchaseCosts(undefined, form({
      voucher_id: voucherId,
      line_ids: JSON.stringify([lineId]),
      accounting_month: "2026-10-01",
      idempotency_key: idempotencyKey,
    }));
    expect(unconfirmed?.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();

    const result = await postPurchaseCosts(undefined, form({
      voucher_id: voucherId,
      line_ids: JSON.stringify([lineId]),
      accounting_month: "2026-10-01",
      idempotency_key: idempotencyKey,
      confirmed: "on",
    }));
    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_post_purchase_costs", {
      p_voucher_id: voucherId,
      p_line_ids: [lineId],
      p_accounting_month: "2026-10-01",
      p_idempotency_key: idempotencyKey,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reverses an existing profit posting with an audited reason and idempotency key", async () => {
    const postingId = "91000000-0000-4000-8000-000000000001";
    const result = await reversePurchaseCostPosting(undefined, form({
      posting_id: postingId,
      accounting_month: "2026-10-01",
      reason: "Điều chỉnh do nhập nhầm khoản chi",
      idempotency_key: idempotencyKey,
    }));
    expect(result?.success).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_reverse_purchase_cost_posting", {
      p_posting_id: postingId,
      p_accounting_month: "2026-10-01",
      p_reason: "Điều chỉnh do nhập nhầm khoản chi",
      p_idempotency_key: idempotencyKey,
    });
    expectNoTableWrites();
  });
});
