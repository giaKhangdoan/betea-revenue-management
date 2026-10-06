import { describe, expect, it } from "vitest";
import { calculateRecipeCosts } from "./calculate";
import { createRecipeCostSnapshot } from "./versions";
import type { RecipeCostDocument } from "./types";

const document: RecipeCostDocument = {
  unitConversions: [],
  ingredients: [{ id: "tea", name: "Trà", purchaseQuantity: "1", purchaseUnit: "kg", purchasePriceVnd: "200000", costUnit: "g" }],
  batches: [{ id: "base", name: "Cốt", outputQuantity: "200", outputUnit: "g", components: [{ kind: "ingredient", ingredientId: "tea", quantity: "50", unit: "g" }] }],
  products: [],
};

describe("recipe cost history snapshots", () => {
  it("stores a frozen copy of both inputs and calculated results for history", () => {
    const calculation = calculateRecipeCosts(document);
    const snapshot = createRecipeCostSnapshot({
      revision: 2,
      capturedAt: "2026-10-05T10:00:00.000Z",
      capturedBy: "owner-id",
      reason: "Giá nhập hàng mới",
      document,
      calculation,
    });

    document.ingredients[0].purchasePriceVnd = "999999";
    expect(snapshot.document.ingredients[0].purchasePriceVnd).toBe("200000");
    expect(snapshot.calculation.batches.base.totalCostVnd).toBe("10000");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.document.ingredients)).toBe(true);
    expect(() => { (snapshot.document.ingredients[0] as { purchasePriceVnd: string }).purchasePriceVnd = "1"; }).toThrow(TypeError);
  });
});
