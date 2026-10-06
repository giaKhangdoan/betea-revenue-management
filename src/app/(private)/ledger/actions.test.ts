import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  rpc: vi.fn(),
  loadOwnerDailyRecords: vi.fn(),
  loadFinalizedExpenseMatches: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/ledger/owner-daily-records", () => ({ loadOwnerDailyRecords: mocks.loadOwnerDailyRecords }));
vi.mock("@/lib/owner-advances/loaders", () => ({ loadFinalizedExpenseMatches: mocks.loadFinalizedExpenseMatches }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addDailyExpense } from "./actions";

const ownerId = "93000000-0000-4000-8000-000000000001";
const voucherOne = "94000000-0000-4000-8000-000000000001";
const voucherTwo = "94000000-0000-4000-8000-000000000002";
const reviewKey = "97000000-0000-4000-8000-000000000001";
const owner = { ownerId, supabase: { rpc: mocks.rpc } };
const matches = [
  { voucherId: voucherOne, purchaseDate: "2026-10-06", vendor: "Supplier A", note: null, invoiceTotalVnd: 120000, matchedText: "Đá viên", matchKind: "line" as const },
  { voucherId: voucherTwo, purchaseDate: "2026-10-06", vendor: "Supplier B", note: null, invoiceTotalVnd: 120000, matchedText: "Đá viên", matchKind: "line" as const },
];

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const commonForm = {
  business_date: "2026-10-06",
  amount_vnd: "120.000",
  reason: "Đá viên",
};

describe("addDailyExpense finalized purchase review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue(owner);
    mocks.rpc.mockResolvedValue({ data: { daily_expense_id: "95000000-0000-4000-8000-000000000001" }, error: null });
    mocks.loadFinalizedExpenseMatches.mockResolvedValue({ candidates: matches, error: false });
  });

  it("holds a possible duplicate for admin review instead of inserting it", async () => {
    const result = await addDailyExpense(undefined, form(commonForm));

    expect(result?.duplicateCandidates).toEqual(matches);
    expect(result?.duplicateReviewKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result?.error).toContain("phiếu mua cá nhân đã chốt");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("writes a distinct shop expense only after an audited owner decision for every current match", async () => {
    const result = await addDailyExpense(undefined, form({
      ...commonForm,
      review_as_different_purchase: "yes",
      matched_voucher_ids: JSON.stringify([voucherOne, voucherTwo]),
      duplicate_review_key: reviewKey,
      duplicate_review_reason: "Đá giao hôm nay riêng, ngoài các hóa đơn đã chốt.",
    }));

    expect(result?.success).toContain("ghi lý do giao dịch khác");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_add_daily_expense_after_duplicate_review", {
      p_business_date: "2026-10-06",
      p_amount_vnd: 120000,
      p_reason: "Đá viên",
      p_matched_voucher_ids: [voucherOne, voucherTwo],
      p_review_reason: "Đá giao hôm nay riêng, ngoài các hóa đơn đã chốt.",
      p_idempotency_key: reviewKey,
    });
    expect(mocks.loadFinalizedExpenseMatches).not.toHaveBeenCalled();
  });

  it("reloads candidates when a purchase is finalized between preview and save", async () => {
    mocks.loadFinalizedExpenseMatches
      .mockResolvedValueOnce({ candidates: [], error: false })
      .mockResolvedValueOnce({ candidates: matches, error: false });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "This daily expense matches a finalized purchase and must be reviewed before it can be changed" } });

    const result = await addDailyExpense(undefined, form(commonForm));

    expect(result?.duplicateCandidates).toEqual(matches);
    expect(result?.error).toContain("Phiếu mua vừa được chốt");
    expect(mocks.rpc).toHaveBeenCalledWith("owner_add_daily_expense", {
      p_business_date: "2026-10-06",
      p_amount_vnd: 120000,
      p_reason: "Đá viên",
    });
  });
});
