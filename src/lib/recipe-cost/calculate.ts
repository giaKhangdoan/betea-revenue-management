import type {
  CalculatedBatchCost,
  CalculatedIngredientCost,
  CalculatedProductCost,
  CalculatedProductVariantCost,
  RecipeComponent,
  RecipeCostCalculation,
  RecipeCostDocument,
  RecipeCostLine,
} from "./types";
import {
  add,
  compare,
  divide,
  formatDecimal,
  multiply,
  parseDecimal,
  subtract,
  convertQuantityExact,
  type DecimalFraction,
  UnitConversionError,
} from "./units";

export type RecipeCostErrorCode =
  | "MISSING_PRICE"
  | "INVALID_DECIMAL"
  | "INVALID_PURCHASE_QUANTITY"
  | "INVALID_PRICE"
  | "INVALID_YIELD"
  | "NEGATIVE_QUANTITY"
  | "INVALID_SALE_PRICE"
  | "INVALID_UNIT_CONVERSION"
  | "INCOMPATIBLE_UNITS"
  | "AMBIGUOUS_CONVERSION"
  | "MISSING_REFERENCE"
  | "RECIPE_CYCLE"
  | "DUPLICATE_ID"
  | "EMPTY_RECIPE";

export class RecipeCostError extends Error {
  constructor(readonly code: RecipeCostErrorCode, message: string, readonly path?: string) {
    super(path ? `${message} (${path})` : message);
    this.name = "RecipeCostError";
  }
}

const SIZE_OUNCES = { S: 12, M: 17, L: 22 } as const;
const ZERO = parseDecimal("0");
const ONE = parseDecimal("1");
const HUNDRED = parseDecimal("100");

function decimal(value: string | null, path: string): DecimalFraction {
  if (value === null || typeof value !== "string") throw new RecipeCostError("INVALID_DECIMAL", "A decimal value is required", path);
  try {
    return parseDecimal(value);
  } catch {
    throw new RecipeCostError("INVALID_DECIMAL", `Invalid decimal value: ${value}`, path);
  }
}

function assertId(id: string, path: string) {
  if (typeof id !== "string" || !id.trim()) throw new RecipeCostError("MISSING_REFERENCE", "An entity ID is required", path);
}

function assertUniqueIds<T extends { id: string }>(rows: readonly T[], kind: string) {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    assertId(row.id, `${kind}[${index}].id`);
    if (seen.has(row.id)) throw new RecipeCostError("DUPLICATE_ID", `Duplicate ${kind} ID: ${row.id}`, kind);
    seen.add(row.id);
  });
}

function addAmounts(amounts: readonly DecimalFraction[]): DecimalFraction {
  return amounts.reduce(add, ZERO);
}

function translateUnitError(error: unknown, path: string): never {
  if (error instanceof UnitConversionError) throw new RecipeCostError(error.code, error.message, path);
  if (error instanceof RangeError) throw new RecipeCostError("INVALID_DECIMAL", error.message, path);
  throw error;
}

export function calculateRecipeCosts(document: RecipeCostDocument): RecipeCostCalculation {
  if (!document || !Array.isArray(document.ingredients) || !Array.isArray(document.batches) || !Array.isArray(document.products) || !Array.isArray(document.unitConversions)) {
    throw new RecipeCostError("INVALID_DECIMAL", "Recipe document is malformed");
  }
  document.unitConversions.forEach((conversion, index) => {
    try {
      if (!conversion.fromUnit.trim() || !conversion.toUnit.trim() || compare(parseDecimal(conversion.factor), ZERO) <= 0) {
        throw new RecipeCostError("INVALID_UNIT_CONVERSION", "Unit conversion values must be named and factors must be positive", `unitConversions[${index}]`);
      }
    } catch (error) {
      if (error instanceof RecipeCostError) throw error;
      translateUnitError(error, `unitConversions[${index}]`);
    }
  });
  assertUniqueIds(document.ingredients, "ingredients");
  assertUniqueIds(document.batches, "batches");
  assertUniqueIds(document.products, "products");

  const ingredientInputs = new Map(document.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const batchInputs = new Map(document.batches.map((batch) => [batch.id, batch]));
  const ingredientResults = new Map<string, CalculatedIngredientCost>();
  const ingredientUnitCosts = new Map<string, DecimalFraction>();
  const batchResults = new Map<string, CalculatedBatchCost>();
  const batchUnitCosts = new Map<string, DecimalFraction>();

  for (const ingredient of document.ingredients) {
    const path = `ingredient:${ingredient.id}`;
    if (ingredient.purchasePriceVnd === null) throw new RecipeCostError("MISSING_PRICE", `Purchase price is missing for ${ingredient.name}`, path);
    const purchaseQuantity = decimal(ingredient.purchaseQuantity, `${path}.purchaseQuantity`);
    const purchasePrice = decimal(ingredient.purchasePriceVnd, `${path}.purchasePriceVnd`);
    if (compare(purchaseQuantity, ZERO) <= 0) throw new RecipeCostError("INVALID_PURCHASE_QUANTITY", "Purchase quantity must be greater than zero", path);
    if (compare(purchasePrice, ZERO) < 0) throw new RecipeCostError("INVALID_PRICE", "Purchase price cannot be negative", path);
    if (!ingredient.costUnit?.trim() || !ingredient.purchaseUnit?.trim()) throw new RecipeCostError("INCOMPATIBLE_UNITS", "Purchase and cost units are required", path);
    let quantityInCostUnit: DecimalFraction;
    try {
      quantityInCostUnit = convertQuantityExact(purchaseQuantity, ingredient.purchaseUnit, ingredient.costUnit, document.unitConversions);
    } catch (error) {
      translateUnitError(error, path);
    }
    if (compare(quantityInCostUnit!, ZERO) <= 0) throw new RecipeCostError("INVALID_PURCHASE_QUANTITY", "Converted purchase quantity must be greater than zero", path);
    const unitCost = divide(purchasePrice, quantityInCostUnit!);
    ingredientUnitCosts.set(ingredient.id, unitCost);
    ingredientResults.set(ingredient.id, {
      id: ingredient.id,
      name: ingredient.name,
      unitCostVnd: formatDecimal(unitCost),
      costUnit: ingredient.costUnit,
      purchaseQuantity: ingredient.purchaseQuantity,
      purchaseUnit: ingredient.purchaseUnit,
      purchasePriceVnd: ingredient.purchasePriceVnd,
    });
  }

  const calculatingBatches = new Set<string>();
  const calculateBatch = (batchId: string): CalculatedBatchCost => {
    const cached = batchResults.get(batchId);
    if (cached) return cached;
    const batch = batchInputs.get(batchId);
    if (!batch) throw new RecipeCostError("MISSING_REFERENCE", `Referenced batch does not exist: ${batchId}`, `batch:${batchId}`);
    if (calculatingBatches.has(batchId)) throw new RecipeCostError("RECIPE_CYCLE", `Recipe dependency cycle includes ${batch.name}`, `batch:${batchId}`);
    const outputQuantity = decimal(batch.outputQuantity, `batch:${batchId}.outputQuantity`);
    if (compare(outputQuantity, ZERO) <= 0) throw new RecipeCostError("INVALID_YIELD", `Batch yield must be greater than zero: ${batch.name}`, `batch:${batchId}`);
    if (!batch.outputUnit?.trim()) throw new RecipeCostError("INCOMPATIBLE_UNITS", `Batch output unit is required: ${batch.name}`, `batch:${batchId}`);
    if (!Array.isArray(batch.components) || batch.components.length === 0) throw new RecipeCostError("EMPTY_RECIPE", `Batch has no components: ${batch.name}`, `batch:${batchId}`);

    calculatingBatches.add(batchId);
    try {
      const lines = batch.components.map((component, index) => calculateLine(component, `batch:${batchId}.components[${index}]`));
      const total = addAmounts(lines.map((line) => line.amount));
      const unitCost = divide(total, outputQuantity);
      const calculated: CalculatedBatchCost = {
        id: batch.id,
        name: batch.name,
        totalCostVnd: formatDecimal(total),
        unitCostVnd: formatDecimal(unitCost),
        outputQuantity: batch.outputQuantity,
        outputUnit: batch.outputUnit,
        lines: lines.map(({ line }) => line),
      };
      batchResults.set(batchId, calculated);
      batchUnitCosts.set(batchId, unitCost);
      return calculated;
    } finally {
      calculatingBatches.delete(batchId);
    }
  };

  const calculateLine = (component: RecipeComponent, path: string): { line: RecipeCostLine; amount: DecimalFraction } => {
    const quantity = decimal(component.quantity, `${path}.quantity`);
    if (compare(quantity, ZERO) < 0) throw new RecipeCostError("NEGATIVE_QUANTITY", "Recipe quantity cannot be negative", path);
    if (!component.unit?.trim()) throw new RecipeCostError("INCOMPATIBLE_UNITS", "Recipe unit is required", path);

    let sourceId: string;
    let label: string;
    let sourceUnit: string;
    let unitCost: DecimalFraction;
    if (component.kind === "ingredient") {
      sourceId = component.ingredientId;
      const ingredient = ingredientInputs.get(sourceId);
      const ingredientUnitCost = ingredientUnitCosts.get(sourceId);
      if (!ingredient || !ingredientUnitCost) throw new RecipeCostError("MISSING_REFERENCE", `Referenced ingredient does not exist: ${sourceId}`, path);
      sourceUnit = ingredient.costUnit;
      label = component.label?.trim() || ingredient.name;
      try {
        const oneInputUnitInCostUnit = convertQuantityExact(ONE, component.unit, sourceUnit, document.unitConversions);
        unitCost = multiply(oneInputUnitInCostUnit, ingredientUnitCost);
        const usedQuantityInCostUnit = convertQuantityExact(quantity, component.unit, sourceUnit, document.unitConversions);
        const amount = multiply(usedQuantityInCostUnit, ingredientUnitCost);
        return {
          line: { label, sourceKind: "ingredient", sourceId, quantity: component.quantity, unit: component.unit, unitCostVnd: formatDecimal(unitCost), lineCostVnd: formatDecimal(amount) },
          amount,
        };
      } catch (error) {
        translateUnitError(error, path);
      }
    } else if (component.kind === "batch") {
      sourceId = component.batchId;
      const sourceBatch = batchInputs.get(sourceId);
      if (!sourceBatch) throw new RecipeCostError("MISSING_REFERENCE", `Referenced batch does not exist: ${sourceId}`, path);
      calculateBatch(sourceId);
      const exactBatchUnitCost = batchUnitCosts.get(sourceId);
      if (!exactBatchUnitCost) throw new RecipeCostError("MISSING_REFERENCE", `Batch cost is unavailable: ${sourceId}`, path);
      sourceUnit = sourceBatch.outputUnit;
      label = component.label?.trim() || sourceBatch.name;
      try {
        const oneInputUnitInBatchUnit = convertQuantityExact(ONE, component.unit, sourceUnit, document.unitConversions);
        unitCost = multiply(oneInputUnitInBatchUnit, exactBatchUnitCost);
        const usedQuantityInBatchUnit = convertQuantityExact(quantity, component.unit, sourceUnit, document.unitConversions);
        const amount = multiply(usedQuantityInBatchUnit, exactBatchUnitCost);
        return {
          line: { label, sourceKind: "batch", sourceId, quantity: component.quantity, unit: component.unit, unitCostVnd: formatDecimal(unitCost), lineCostVnd: formatDecimal(amount) },
          amount,
        };
      } catch (error) {
        translateUnitError(error, path);
      }
    } else {
      throw new RecipeCostError("MISSING_REFERENCE", "Recipe component must reference an ingredient or batch", path);
    }
    throw new RecipeCostError("MISSING_REFERENCE", "Recipe component source is invalid", path);
  };

  // Evaluate all batches, including unused ones, so invalid legacy recipes cannot be reported as healthy.
  document.batches.forEach((batch) => calculateBatch(batch.id));

  const productResults = new Map<string, CalculatedProductCost>();
  for (const product of document.products) {
    if (!Array.isArray(product.variants) || product.variants.length === 0) throw new RecipeCostError("EMPTY_RECIPE", `Product has no size recipes: ${product.name}`, `product:${product.id}`);
    const variants: Partial<Record<"S" | "M" | "L", CalculatedProductVariantCost>> = {};
    for (const variant of product.variants) {
      if (!(variant.size in SIZE_OUNCES)) throw new RecipeCostError("INVALID_DECIMAL", `Unsupported size: ${variant.size}`, `product:${product.id}`);
      if (variants[variant.size]) throw new RecipeCostError("DUPLICATE_ID", `Duplicate ${variant.size} recipe size`, `product:${product.id}`);
      if (!Array.isArray(variant.components) || variant.components.length === 0) throw new RecipeCostError("EMPTY_RECIPE", `Size ${variant.size} has no recipe components`, `product:${product.id}`);
      const lines = variant.components.map((component, index) => calculateLine(component, `product:${product.id}.${variant.size}.components[${index}]`));
      const total = addAmounts(lines.map((line) => line.amount));
      let salePrice: DecimalFraction | null = null;
      let grossProfit: DecimalFraction | null = null;
      let grossMargin: DecimalFraction | null = null;
      if (variant.salePriceVnd !== null) {
        salePrice = decimal(variant.salePriceVnd, `product:${product.id}.${variant.size}.salePriceVnd`);
        if (compare(salePrice, ZERO) < 0) throw new RecipeCostError("INVALID_SALE_PRICE", "Sale price cannot be negative", `product:${product.id}.${variant.size}`);
        grossProfit = subtract(salePrice, total);
        if (compare(salePrice, ZERO) > 0) grossMargin = multiply(divide(grossProfit, salePrice), HUNDRED);
      }
      variants[variant.size] = {
        size: variant.size,
        sizeOz: SIZE_OUNCES[variant.size],
        salePriceVnd: variant.salePriceVnd,
        totalCostVnd: formatDecimal(total),
        grossProfitVnd: grossProfit === null ? null : formatDecimal(grossProfit),
        grossMarginPercent: grossMargin === null ? null : formatDecimal(grossMargin),
        lines: lines.map(({ line }) => line),
      };
    }
    productResults.set(product.id, { id: product.id, name: product.name, variants });
  }

  const toRecord = <T>(items: Map<string, T>): Record<string, T> => Object.fromEntries(items.entries());
  return {
    calculationVersion: 1,
    ingredients: toRecord(ingredientResults),
    batches: toRecord(batchResults),
    products: toRecord(productResults),
  };
}
