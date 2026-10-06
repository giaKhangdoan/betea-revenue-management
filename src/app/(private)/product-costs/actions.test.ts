import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireOwnerClient: vi.fn(), rpc: vi.fn(), from: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resolveWorkbookImportReviewItem, saveRecipeCostWorkspace } from "./actions";

function form(document: unknown, revision = "0", reason = "Cập nhật công thức") {
  const data = new FormData();
  data.set("document", JSON.stringify(document));
  data.set("expected_revision", revision);
  data.set("reason", reason);
  return data;
}

function resolveForm(id = "review-1", revision = "2", note = "Đã đối chiếu với chứng từ gốc.") {
  const data = new FormData();
  data.set("item_id", id);
  data.set("expected_revision", revision);
  data.set("resolution_note", note);
  return data;
}

const empty = { unitConversions: [], ingredients: [], batches: [], products: [] };

describe("owner recipe workspace action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) });
    mocks.requireOwnerClient.mockResolvedValue({ ownerId: "owner-id", supabase: { rpc: mocks.rpc, from: mocks.from } });
  });

  it("rejects staff or signed-out access before any write", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    const result = await saveRecipeCostWorkspace(undefined, form(empty));
    expect(result.error).toContain("chủ cửa hàng");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("recalculates the complete graph server-side before saving with the expected revision", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { revision: 2, document: empty }, error: null });
    const document = { ...empty, ingredients: [{ id: "tea", name: "Trà", purchaseQuantity: "1000", purchaseUnit: "g", purchasePriceVnd: "200000", costUnit: "g" }] };
    const result = await saveRecipeCostWorkspace(undefined, form(document, "2"));

    expect(result).toMatchObject({ success: "Đã lưu workspace giá vốn.", revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("owner_save_recipe_cost_workspace", expect.objectContaining({
      p_expected_revision: 2,
      p_reason: "Cập nhật công thức",
      p_calculation: expect.objectContaining({ ingredients: { tea: expect.objectContaining({ unitCostVnd: "200" }) } }),
    }));
  });

  it("preserves server review metadata during an ordinary workspace save", async () => {
    const storedReview = { importedFiles: [], items: [{ id: "review-1", sourceCell: "Menu!G11", name: "Trà sữa", reason: "Công thức chưa map.", required: true }], complete: false };
    mocks.maybeSingle.mockResolvedValue({ data: { revision: 0, document: { ...empty, importReview: storedReview } }, error: null });
    const clientReview = { importedFiles: [], items: [{ ...storedReview.items[0], required: false }], complete: true };
    await saveRecipeCostWorkspace(undefined, form({ ...empty, importReview: clientReview }));

    expect(mocks.rpc).toHaveBeenCalledWith("owner_save_recipe_cost_workspace", expect.objectContaining({
      p_document: expect.objectContaining({ importReview: storedReview }),
    }));
  });

  it("rejects malformed and financially invalid documents before calling the RPC", async () => {
    const malformed = await saveRecipeCostWorkspace(undefined, form({ ...empty, calculation: { fake: true } }));
    const invalid = await saveRecipeCostWorkspace(undefined, form({ ...empty, ingredients: [{ id: "tea", name: "Trà", purchaseQuantity: "0", purchaseUnit: "g", purchasePriceVnd: "200000", costUnit: "g" }] }));

    expect(malformed.error).toContain("không hợp lệ");
    expect(invalid.error).toContain("giá vốn");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records a reason when the owner resolves a saved workbook review item", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { revision: 2, document: {
      ...empty,
      importReview: { importedFiles: [], items: [{ id: "review-1", sourceCell: "Menu!G11", name: "Trà sữa", reason: "Công thức chưa map.", required: true }], complete: false },
    } }, error: null });
    const result = await resolveWorkbookImportReviewItem(undefined, resolveForm());
    const savedDocument = mocks.rpc.mock.calls[0]?.[1]?.p_document;
    const item = savedDocument?.importReview?.items[0];

    expect(result).toMatchObject({ success: expect.stringContaining("đối soát"), revision: 1 });
    expect(item).toMatchObject({ required: false, resolutionNote: "Đã đối chiếu với chứng từ gốc.", resolvedBy: "owner-id" });
    expect(item.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(savedDocument.importReview.complete).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_save_recipe_cost_workspace", expect.objectContaining({ p_expected_revision: 2 }));
  });

  it("does not resolve review items from stale revisions or without an owner", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { revision: 2, document: {
      ...empty,
      importReview: { importedFiles: [], items: [{ id: "review-1", sourceCell: "Menu!G11", name: "Trà sữa", reason: "Công thức chưa map.", required: true }], complete: false },
    } }, error: null });
    const stale = await resolveWorkbookImportReviewItem(undefined, resolveForm("review-1", "1"));
    mocks.requireOwnerClient.mockResolvedValue(null);
    const staff = await resolveWorkbookImportReviewItem(undefined, resolveForm());

    expect(stale.error).toContain("đã đổi");
    expect(staff.error).toContain("chủ cửa hàng");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
