import { z } from "zod";

const decimal = z.string().max(32).regex(/^-?\d+(?:\.\d{1,8})?$/);
const sourceTrace = z.object({ sheet: z.string().min(1).max(100), cell: z.string().min(1).max(40) }).strict();
const component = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ingredient"), ingredientId: z.string().min(1).max(120) }).strict(),
  z.object({ kind: z.literal("batch"), batchId: z.string().min(1).max(120) }).strict(),
]).and(z.object({
  quantity: decimal,
  unit: z.string().min(1).max(80),
  label: z.string().max(160).optional(),
  sourceTrace: sourceTrace.optional(),
}));

const importReview = z.object({
  importedFiles: z.array(z.object({
    sha256: z.string().regex(/^[a-f\d]{64}$/i),
    filename: z.string().min(1).max(240),
    importedAt: z.string().datetime(),
    ingredientCount: z.number().int().nonnegative(),
  }).strict()).max(100),
  items: z.array(z.object({
    id: z.string().min(1).max(200),
    sourceCell: z.string().min(1).max(160),
    name: z.string().min(1).max(240),
    reason: z.string().min(1).max(1000),
    required: z.boolean(),
    resolutionNote: z.string().min(1).max(500).optional(),
    resolvedAt: z.iso.datetime().optional(),
    resolvedBy: z.string().min(1).max(200).optional(),
  }).strict()).max(3000),
  complete: z.boolean(),
}).strict();

export const recipeCostDocumentSchema = z.object({
  unitConversions: z.array(z.object({
    fromUnit: z.string().min(1).max(80),
    toUnit: z.string().min(1).max(80),
    factor: decimal,
    sourceTrace: sourceTrace.optional(),
  }).strict()).max(1000),
  ingredients: z.array(z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    purchaseQuantity: decimal,
    purchaseUnit: z.string().min(1).max(80),
    purchasePriceVnd: decimal.nullable(),
    costUnit: z.string().min(1).max(80),
    effectiveDate: z.iso.date().optional(),
    sourceTrace: sourceTrace.extend({ priceCell: z.string().max(40).optional(), quantityCell: z.string().max(40).optional() }).optional(),
  }).strict()).max(1000),
  batches: z.array(z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    outputQuantity: decimal,
    outputUnit: z.string().min(1).max(80),
    components: z.array(component).max(200),
  }).strict()).max(1000),
  products: z.array(z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    variants: z.array(z.object({
      size: z.enum(["S", "M", "L"]),
      salePriceVnd: decimal.nullable(),
      components: z.array(component).max(200),
    }).strict()).max(3),
  }).strict()).max(1000),
  importReview: importReview.optional(),
}).strict();

export type ValidRecipeCostDocument = z.infer<typeof recipeCostDocumentSchema>;
