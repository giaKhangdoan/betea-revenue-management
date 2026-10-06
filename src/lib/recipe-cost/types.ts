/** Decimal inputs and outputs are strings so JSON and Postgres numeric values stay exact. */
export type DecimalString = string;
export type RecipeSize = "S" | "M" | "L";
export type RecipeComponentSource =
  | { kind: "ingredient"; ingredientId: string }
  | { kind: "batch"; batchId: string };

export type UnitConversion = {
  fromUnit: string;
  toUnit: string;
  /** Quantity in `fromUnit` multiplied by this factor yields `toUnit`. */
  factor: DecimalString;
  sourceTrace?: { sheet: string; cell: string };
};

export type RecipeIngredient = {
  id: string;
  name: string;
  purchaseQuantity: DecimalString;
  purchaseUnit: string;
  purchasePriceVnd: DecimalString | null;
  costUnit: string;
  effectiveDate?: string;
  sourceTrace?: { sheet: string; cell: string; priceCell?: string; quantityCell?: string };
};

export type RecipeComponent = RecipeComponentSource & {
  quantity: DecimalString;
  unit: string;
  label?: string;
};

export type RecipeBatch = {
  id: string;
  name: string;
  outputQuantity: DecimalString;
  outputUnit: string;
  components: RecipeComponent[];
};

export type RecipeProductVariant = {
  size: RecipeSize;
  salePriceVnd: DecimalString | null;
  components: RecipeComponent[];
};

export type RecipeProduct = {
  id: string;
  name: string;
  variants: RecipeProductVariant[];
};

export type RecipeCostDocument = {
  unitConversions: UnitConversion[];
  ingredients: RecipeIngredient[];
  batches: RecipeBatch[];
  products: RecipeProduct[];
  importReview?: {
    importedFiles: Array<{ sha256: string; filename: string; importedAt: string; ingredientCount: number }>;
    items: Array<{
      id: string;
      sourceCell: string;
      name: string;
      reason: string;
      required: boolean;
      resolutionNote?: string;
      resolvedAt?: string;
      resolvedBy?: string;
    }>;
    complete: boolean;
  };
};

export type CalculatedIngredientCost = {
  id: string;
  name: string;
  unitCostVnd: DecimalString;
  costUnit: string;
  purchaseQuantity: DecimalString;
  purchaseUnit: string;
  purchasePriceVnd: DecimalString;
};

export type RecipeCostLine = {
  label: string;
  sourceKind: RecipeComponentSource["kind"];
  sourceId: string;
  quantity: DecimalString;
  unit: string;
  unitCostVnd: DecimalString;
  lineCostVnd: DecimalString;
};

export type CalculatedBatchCost = {
  id: string;
  name: string;
  totalCostVnd: DecimalString;
  unitCostVnd: DecimalString;
  outputQuantity: DecimalString;
  outputUnit: string;
  lines: RecipeCostLine[];
};

export type CalculatedProductVariantCost = {
  size: RecipeSize;
  sizeOz: 12 | 17 | 22;
  salePriceVnd: DecimalString | null;
  totalCostVnd: DecimalString;
  grossProfitVnd: DecimalString | null;
  grossMarginPercent: DecimalString | null;
  lines: RecipeCostLine[];
};

export type CalculatedProductCost = {
  id: string;
  name: string;
  variants: Partial<Record<RecipeSize, CalculatedProductVariantCost>>;
};

export type RecipeCostCalculation = {
  calculationVersion: 1;
  ingredients: Record<string, CalculatedIngredientCost>;
  batches: Record<string, CalculatedBatchCost>;
  products: Record<string, CalculatedProductCost>;
};
