import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireOwnerClient: vi.fn(), rpc: vi.fn(), from: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { publishStaffSop, saveSopDraft } from "./actions";

const recipe = {
  unitConversions: [],
  ingredients: [{ id: "tea", name: "Hồng Trà", purchaseQuantity: "1000", purchaseUnit: "g", purchasePriceVnd: "200000", costUnit: "g" }],
  batches: [],
  products: [{ id: "drink", name: "Trà Sữa", variants: [{ size: "S", salePriceVnd: "30000", components: [{ kind: "ingredient", ingredientId: "tea", quantity: "40", unit: "g", label: "hidden label" }] }] }],
};
const document = { products: [{ productId: "drink", variants: [{ size: "S", steps: [{ id: "a", title: "Ủ trà", instruction: "Ngâm 8 phút." }] }] }] };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("owner SOP actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    mocks.read.mockImplementation((table: string) => ({
      data: table === "owner_sop_workspace" ? { revision: 4, recipe_revision: 3, document } : { revision: 3, document: recipe },
      error: null,
    }));
    mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: () => mocks.read(table) }) }) }));
    mocks.requireOwnerClient.mockResolvedValue({ ownerId: "owner-id", supabase: { from: mocks.from, rpc: mocks.rpc } });
  });

  it("requires owner access before saving a SOP draft", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    const result = await saveSopDraft(undefined, form({ document: JSON.stringify(document), expected_revision: "4", expected_recipe_revision: "3", reason: "Cập nhật SOP" }));
    expect(result.error).toContain("chủ cửa hàng");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("checks both revisions and saves the owner's validated draft through the RPC", async () => {
    const result = await saveSopDraft(undefined, form({ document: JSON.stringify(document), expected_revision: "4", expected_recipe_revision: "3", reason: "Cập nhật hướng dẫn" }));
    expect(result).toMatchObject({ success: expect.stringContaining("SOP"), revision: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith("owner_save_sop_workspace", {
      p_expected_revision: 4,
      p_expected_recipe_revision: 3,
      p_document: document,
      p_reason: "Cập nhật hướng dẫn",
    });
  });

  it("does not save against a recipe revision that changed since the editor loaded", async () => {
    mocks.read.mockImplementation((table: string) => ({ data: table === "recipe_cost_workspace" ? { revision: 5, document: recipe } : { revision: 4, document }, error: null }));
    const result = await saveSopDraft(undefined, form({ document: JSON.stringify(document), expected_revision: "4", expected_recipe_revision: "3", reason: "Cập nhật SOP" }));
    expect(result.error?.toLowerCase()).toContain("công thức đã thay đổi");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("publishes only the allowlisted current recipe projection, never client supplied financial fields", async () => {
    const result = await publishStaffSop(undefined, form({ expected_revision: "4", expected_recipe_revision: "3" }));
    const call = mocks.rpc.mock.calls[0];
    expect(result).toMatchObject({ success: expect.stringContaining("nhân viên"), revision: 2 });
    expect(call?.[0]).toBe("owner_publish_staff_sop");
    expect(call?.[1]).toMatchObject({ p_expected_revision: 4, p_expected_recipe_revision: 3 });
    expect(call?.[1]?.p_staff_document).toEqual({ products: [{ name: "Trà Sữa", variants: [{
      size: "S", sizeOz: 12,
      components: [{ name: "Hồng Trà", quantity: "40", unit: "g" }],
      steps: [{ title: "Ủ trà", instruction: "Ngâm 8 phút." }],
    }] }] });
    expect(JSON.stringify(call?.[1]?.p_staff_document)).not.toMatch(/purchasePrice|salePrice|cost|margin|200000|30000/i);
  });

  it("blocks publish when the saved SOP was tied to an older recipe revision", async () => {
    mocks.read.mockImplementation((table: string) => ({ data: table === "recipe_cost_workspace" ? { revision: 4, document: recipe } : { revision: 4, recipe_revision: 3, document }, error: null }));
    const result = await publishStaffSop(undefined, form({ expected_revision: "4", expected_recipe_revision: "4" }));
    expect(result.error?.toLowerCase()).toContain("công thức đã thay đổi");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
