import { describe, expect, it } from "vitest";
import { calculateRecipeCosts, RecipeCostError } from "./calculate";
import type { RecipeCostDocument } from "./types";

const baseDocument: RecipeCostDocument = {
  unitConversions: [],
  ingredients: [
    { id: "tea", name: "Trà khô", purchaseQuantity: "1", purchaseUnit: "kg", purchasePriceVnd: "200000", costUnit: "g" },
    { id: "sugar", name: "Đường", purchaseQuantity: "1", purchaseUnit: "kg", purchasePriceVnd: "30000", costUnit: "g" },
  ],
  batches: [
    {
      id: "tea-base",
      name: "Cốt trà",
      outputQuantity: "200",
      outputUnit: "g",
      components: [{ kind: "ingredient", ingredientId: "tea", quantity: "50", unit: "g" }],
    },
  ],
  products: [
    {
      id: "milk-tea",
      name: "Trà sữa",
      variants: [
        { size: "S", salePriceVnd: "30000", components: [{ kind: "batch", batchId: "tea-base", quantity: "20", unit: "g" }] },
        { size: "M", salePriceVnd: "40000", components: [{ kind: "batch", batchId: "tea-base", quantity: "30", unit: "g" }, { kind: "ingredient", ingredientId: "sugar", quantity: "5", unit: "g" }] },
        { size: "L", salePriceVnd: "50000", components: [{ kind: "batch", batchId: "tea-base", quantity: "40", unit: "g" }] },
      ],
    },
  ],
};

function expectRecipeError(document: RecipeCostDocument, code: string) {
  try {
    calculateRecipeCosts(document);
    throw new Error(`Expected recipe cost error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeCostError);
    expect((error as RecipeCostError).code).toBe(code);
  }
}

describe("recipe cost graph", () => {
  it("calculates purchase unit cost, batch yield, size costs, gross profit and margin", () => {
    const result = calculateRecipeCosts(baseDocument);

    expect(result.ingredients.tea.unitCostVnd).toBe("200");
    expect(result.batches["tea-base"]).toMatchObject({ totalCostVnd: "10000", unitCostVnd: "50", outputUnit: "g" });
    expect(result.products["milk-tea"].variants).toMatchObject({
      S: { sizeOz: 12, totalCostVnd: "1000", grossProfitVnd: "29000", grossMarginPercent: "96.66666667" },
      M: { sizeOz: 17, totalCostVnd: "1650", grossProfitVnd: "38350", grossMarginPercent: "95.875" },
      L: { sizeOz: 22, totalCostVnd: "2000", grossProfitVnd: "48000", grossMarginPercent: "96" },
    });
    expect(result.products["milk-tea"]!.variants.M!.lines.map((line) => line.label)).toEqual(["Cốt trà", "Đường"]);
  });

  it("recalculates every dependent batch and product from a changed raw ingredient price", () => {
    const changed = structuredClone(baseDocument);
    changed.ingredients[0].purchasePriceVnd = "300000";

    const result = calculateRecipeCosts(changed);
    expect(result.ingredients.tea.unitCostVnd).toBe("300");
    expect(result.batches["tea-base"].totalCostVnd).toBe("15000");
    expect(result.products["milk-tea"]!.variants.L!.totalCostVnd).toBe("3000");
  });

  it("keeps repeating decimal unit costs exact until the final cost is produced", () => {
    const repeating: RecipeCostDocument = {
      unitConversions: [],
      ingredients: [{ id: "tea", name: "Trà", purchaseQuantity: "1", purchaseUnit: "g", purchasePriceVnd: "1", costUnit: "g" }],
      batches: [{ id: "base", name: "Cốt", outputQuantity: "3", outputUnit: "g", components: [{ kind: "ingredient", ingredientId: "tea", quantity: "1", unit: "g" }] }],
      products: [{ id: "drink", name: "Món", variants: [{ size: "S", salePriceVnd: "2", components: [{ kind: "batch", batchId: "base", quantity: "3", unit: "g" }] }] }],
    };

    const result = calculateRecipeCosts(repeating);
    expect(result.batches.base!.unitCostVnd).toBe("0.33333333");
    expect(result.products.drink!.variants.S!.totalCostVnd).toBe("1");
  });

  it("allows a product size to be absent while keeping fixed S/M/L ounce mapping", () => {
    const changed = structuredClone(baseDocument);
    changed.products[0]!.variants = [changed.products[0]!.variants[0]!];
    expect(calculateRecipeCosts(changed).products["milk-tea"]!.variants.S!.sizeOz).toBe(12);
  });

  it("marks unavailable sale price as missing profit instead of inventing a value", () => {
    const changed = structuredClone(baseDocument);
    changed.products[0]!.variants[0]!.salePriceVnd = null;
    expect(calculateRecipeCosts(changed).products["milk-tea"].variants.S).toMatchObject({
      totalCostVnd: "1000",
      grossProfitVnd: null,
      grossMarginPercent: null,
    });
  });

  it("rejects missing purchase prices, negative quantities, and zero batch yield", () => {
    const missingPrice = structuredClone(baseDocument);
    missingPrice.ingredients[0].purchasePriceVnd = null;
    expectRecipeError(missingPrice, "MISSING_PRICE");

    const negativeQuantity = structuredClone(baseDocument);
    negativeQuantity.batches[0].components[0].quantity = "-1";
    expectRecipeError(negativeQuantity, "NEGATIVE_QUANTITY");

    const zeroYield = structuredClone(baseDocument);
    zeroYield.batches[0].outputQuantity = "0";
    expectRecipeError(zeroYield, "INVALID_YIELD");

    const negativePrice = structuredClone(baseDocument);
    negativePrice.ingredients[0].purchasePriceVnd = "-1";
    expectRecipeError(negativePrice, "INVALID_PRICE");
  });

  it("rejects incompatible units and broken component references", () => {
    const incompatible = structuredClone(baseDocument);
    incompatible.batches[0].components[0].unit = "ml";
    expectRecipeError(incompatible, "INCOMPATIBLE_UNITS");

    const brokenReference = structuredClone(baseDocument);
    brokenReference.batches[0].components[0] = { kind: "ingredient", ingredientId: "deleted", quantity: "1", unit: "g" };
    expectRecipeError(brokenReference, "MISSING_REFERENCE");

    const malformedConversion = structuredClone(baseDocument);
    malformedConversion.unitConversions = [{ fromUnit: "g", toUnit: "ml", factor: "0" }];
    expectRecipeError(malformedConversion, "INVALID_UNIT_CONVERSION");
  });

  it("rejects cyclic batch dependencies", () => {
    const cyclic = structuredClone(baseDocument);
    cyclic.batches = [
      { id: "a", name: "A", outputQuantity: "1", outputUnit: "g", components: [{ kind: "batch", batchId: "b", quantity: "1", unit: "g" }] },
      { id: "b", name: "B", outputQuantity: "1", outputUnit: "g", components: [{ kind: "batch", batchId: "a", quantity: "1", unit: "g" }] },
    ];
    cyclic.products = [];
    expectRecipeError(cyclic, "RECIPE_CYCLE");
  });
});
