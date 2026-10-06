import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  requireStaff: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveInventoryReceiptAction } from "./actions";

const itemId = "72000000-0000-4000-8000-000000000001";
const receiptId = "82000000-0000-4000-8000-000000000001";

function makeForm(confirm = false) {
  const data = new FormData();
  data.set("mode", "create");
  data.append("item_id", itemId);
  data.append("large_quantity", "10");
  data.append("loose_quantity", "0");
  if (confirm) data.set("confirm_outliers", "yes");
  return data;
}

function makeSupabase() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({
      data: [{ id: itemId, name: "Trà đen", large_unit: "Gói", conversion_factor: "100", small_unit: "Gr" }],
      error: null,
    }).then(resolve),
  };
  const rpc = vi.fn(async (name: string) => name === "inventory_receipt_outlier_baselines"
    ? { data: [{ item_id: itemId, receipt_count: 3, median_quantity: "100" }], error: null }
    : { data: receiptId, error: null });
  return { from: vi.fn(() => query), rpc };
}

describe("inventory receipt outlier confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue(null);
    mocks.requireStaff.mockResolvedValue(null);
  });

  it("requires an explicit owner confirmation before saving an outlier receipt", async () => {
    const supabase = makeSupabase();
    mocks.requireOwnerClient.mockResolvedValue({ supabase, ownerId: itemId });

    const warning = await saveInventoryReceiptAction(undefined, makeForm());

    expect(warning?.outliers).toEqual([{
      item_id: itemId,
      item_name: "Trà đen",
      current_quantity: "1000",
      median_quantity: "100",
      ratio: "10,00×",
    }]);
    expect(warning?.canConfirmOutliers).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);

    const saved = await saveInventoryReceiptAction(undefined, makeForm(true));

    expect(saved?.success).toBe("Đã tạo phiếu nhập.");
    expect(supabase.rpc).toHaveBeenLastCalledWith("owner_create_inventory_receipt", {
      p_lines: [{ item_id: itemId, large_quantity: "10", loose_quantity: "0" }],
      p_confirm_large_quantities: true,
    });
  });

  it("does not allow staff to confirm or save an outlier receipt", async () => {
    const supabase = makeSupabase();
    mocks.requireStaff.mockResolvedValue({ supabase, ownerId: itemId });

    const result = await saveInventoryReceiptAction(undefined, makeForm(true));

    expect(result?.error).toContain("hãy kiểm tra lại");
    expect(result?.outliers).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("inventory_receipt_outlier_baselines", expect.any(Object));
  });
});
