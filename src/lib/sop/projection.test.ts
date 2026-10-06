import { describe, expect, it } from "vitest";
import { buildStaffSopProjection, staffSopPublicationSchema, sopDocumentSchema } from "./schema";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";

const recipe: RecipeCostDocument = {
  unitConversions: [],
  ingredients: [{ id: "tea", name: "Hồng Trà", purchaseQuantity: "1000", purchaseUnit: "g", purchasePriceVnd: "999999", costUnit: "g" }],
  batches: [{ id: "base", name: "Cốt Trà", outputQuantity: "1000", outputUnit: "ml", components: [] }],
  products: [{ id: "drink", name: "Trà Sữa", variants: [{
    size: "S", salePriceVnd: "30000", components: [
      { kind: "ingredient", ingredientId: "tea", quantity: "40", unit: "g", label: "999999" },
      { kind: "batch", batchId: "base", quantity: "20", unit: "ml" },
    ],
  }] }],
};

const sop = {
  products: [{ productId: "drink", variants: [{
    size: "S", notes: "Lắc đều trước khi rót.",
    steps: [{ id: "step-1", title: "Ủ trà", instruction: "Ngâm trà trong nước nóng 8 phút." }],
  }] }],
};

describe("staff SOP projection", () => {
  it("builds an allowlisted recipe view without cost or sale fields", () => {
    const published = buildStaffSopProjection(sop, recipe);
    expect(published).toEqual({ products: [{
      name: "Trà Sữa",
      variants: [{
        size: "S", sizeOz: 12,
        components: [
          { name: "Hồng Trà", quantity: "40", unit: "g" },
          { name: "Cốt Trà", quantity: "20", unit: "ml" },
        ],
        steps: [{ title: "Ủ trà", instruction: "Ngâm trà trong nước nóng 8 phút." }],
        notes: "Lắc đều trước khi rót.",
      }],
    }] });
    expect(staffSopPublicationSchema.safeParse(published).success).toBe(true);
    expect(JSON.stringify(published)).not.toMatch(/purchasePrice|unitCost|totalCost|grossProfit|margin|salePrice|999999/i);
  });

  it("rejects a stale product reference or an SOP step that has not been completed", () => {
    const missingProduct = { products: [{ productId: "deleted", variants: [{ size: "S", steps: [{ id: "s", title: "Bước", instruction: "Pha" }] }] }] };
    const emptyStep = { products: [{ productId: "drink", variants: [{ size: "S", steps: [{ id: "s", title: "", instruction: "" }] }] }] };
    expect(() => buildStaffSopProjection(missingProduct, recipe)).toThrow("không còn trong menu");
    expect(() => buildStaffSopProjection(emptyStep, recipe)).toThrow("hoàn tất các bước");
  });

  it("rejects duplicate product and size records in a draft", () => {
    const duplicate = { products: [
      { productId: "drink", variants: [{ size: "S", steps: [] }, { size: "S", steps: [] }] },
      { productId: "drink", variants: [] },
    ] };
    expect(sopDocumentSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects financial fields smuggled into a SOP draft or the staff publication", () => {
    const draftWithCost = { ...sop, costVnd: "999999" };
    const staffWithCost = { products: [{ name: "Trà Sữa", unitCostVnd: "999999", variants: [{
      size: "S", sizeOz: 12, components: [{ name: "Hồng Trà", quantity: "40", unit: "g" }],
      steps: [{ title: "Ủ trà", instruction: "Ngâm 8 phút." }],
    }] }] };
    expect(sopDocumentSchema.safeParse(draftWithCost).success).toBe(false);
    expect(staffSopPublicationSchema.safeParse(staffWithCost).success).toBe(false);
  });

  it("requires a recipe component before creating a staff publication", () => {
    const emptyRecipe: RecipeCostDocument = { ...recipe, products: [{ ...recipe.products[0], variants: [{ ...recipe.products[0].variants[0], components: [] }] }] };
    expect(() => buildStaffSopProjection(sop, emptyRecipe)).toThrow("chưa có định lượng");
  });
});
