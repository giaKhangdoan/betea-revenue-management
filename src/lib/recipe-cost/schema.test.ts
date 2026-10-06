import { describe, expect, it } from "vitest";
import { recipeCostDocumentSchema } from "./schema";

describe("recipe cost document validation", () => {
  it("accepts the empty workspace and import trace metadata", () => {
    const parsed = recipeCostDocumentSchema.safeParse({
      ingredients: [], batches: [], products: [], unitConversions: [],
      importReview: { importedFiles: [], items: [], complete: false },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed component reference before any persistence call", () => {
    const parsed = recipeCostDocumentSchema.safeParse({
      ingredients: [], batches: [], products: [{ id: "drink", name: "Trà", variants: [{ size: "S", salePriceVnd: "29000", components: [{ kind: "ingredient", ingredientId: "", quantity: "1", unit: "ml" }] }] }], unitConversions: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unexpected document keys instead of accepting client supplied calculation fields", () => {
    const parsed = recipeCostDocumentSchema.safeParse({ ingredients: [], batches: [], products: [], unitConversions: [], calculation: { products: { hidden: "stale" } } });
    expect(parsed.success).toBe(false);
  });
});
