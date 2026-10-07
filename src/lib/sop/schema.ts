import { z } from "zod";
import type { RecipeCostDocument, RecipeSize } from "@/lib/recipe-cost/types";

const stepSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().max(120),
  instruction: z.string().max(1200),
}).strict();

const sopVariantSchema = z.object({
  size: z.enum(["S", "M", "L"]),
  steps: z.array(stepSchema).max(40).optional(),
  notes: z.string().max(1200).optional(),
}).strict();

export const sopDocumentSchema = z.object({
  products: z.array(z.object({
    productId: z.string().min(1).max(120),
    variants: z.array(sopVariantSchema).max(3),
    steps: z.array(stepSchema).max(40).optional(),
    notes: z.string().max(1200).optional(),
  }).strict()).max(1000),
}).strict().superRefine((document, context) => {
  const productIds = new Set<string>();
  document.products.forEach((product, productIndex) => {
    if (productIds.has(product.productId)) {
      context.addIssue({ code: "custom", path: ["products", productIndex, "productId"], message: "Món bị lặp trong SOP." });
    }
    productIds.add(product.productId);
    const sizes = new Set<string>();
    product.variants.forEach((variant, variantIndex) => {
      if (sizes.has(variant.size)) {
        context.addIssue({ code: "custom", path: ["products", productIndex, "variants", variantIndex, "size"], message: "Size bị lặp trong SOP." });
      }
      sizes.add(variant.size);
      const stepIds = new Set<string>();
      (variant.steps ?? []).forEach((step, stepIndex) => {
        if (stepIds.has(step.id)) {
          context.addIssue({ code: "custom", path: ["products", productIndex, "variants", variantIndex, "steps", stepIndex, "id"], message: "Mã bước pha bị lặp." });
        }
        stepIds.add(step.id);
      });
    });
    const sharedStepIds = new Set<string>();
    (product.steps ?? []).forEach((step, stepIndex) => {
      if (sharedStepIds.has(step.id)) {
        context.addIssue({ code: "custom", path: ["products", productIndex, "steps", stepIndex, "id"], message: "Mã bước pha bị lặp." });
      }
      sharedStepIds.add(step.id);
    });
  });
});

const staffStepSchema = z.object({ title: z.string().min(1).max(120), instruction: z.string().min(1).max(1200) }).strict();
const staffComponentSchema = z.object({
  name: z.string().min(1).max(240),
  quantity: z.string().min(1).max(32),
  unit: z.string().min(1).max(80),
}).strict();
const staffVariantSchema = z.object({
  size: z.enum(["S", "M", "L"]),
  sizeOz: z.union([z.literal(12), z.literal(17), z.literal(22)]),
  components: z.array(staffComponentSchema).min(1).max(200),
  steps: z.array(staffStepSchema).min(1).max(40).optional(),
  notes: z.string().max(1200).optional(),
}).strict();

export const staffSopPublicationSchema = z.object({
  products: z.array(z.object({
    name: z.string().min(1).max(240),
    variants: z.array(staffVariantSchema).min(1).max(3),
    steps: z.array(staffStepSchema).min(1).max(40).optional(),
    notes: z.string().max(1200).optional(),
  }).strict()).min(1).max(1000),
}).strict();

export type SopDocument = z.infer<typeof sopDocumentSchema>;
export type StaffSopPublication = z.infer<typeof staffSopPublicationSchema>;

const sizeOz: Record<RecipeSize, 12 | 17 | 22> = { S: 12, M: 17, L: 22 };

export function buildStaffSopProjection(input: unknown, recipe: RecipeCostDocument): StaffSopPublication {
  const sop = sopDocumentSchema.parse(input);
  if (!sop.products.length) throw new Error("Thêm ít nhất một món vào SOP trước khi công bố.");

  const products = sop.products.map((sopProduct) => {
    const product = recipe.products.find((candidate) => candidate.id === sopProduct.productId);
    if (!product) throw new Error(`Món ${sopProduct.productId} không còn trong menu. Hãy tải lại SOP.`);

    return {
      name: product.name,
      variants: sopProduct.variants.map((sopVariant) => {
        const variant = product.variants.find((candidate) => candidate.size === sopVariant.size);
        if (!variant) throw new Error(`Size ${sopVariant.size} của món ${product.name} không còn trong công thức.`);
        const steps = sopProduct.steps ?? sopVariant.steps ?? [];
        if (!steps.length || steps.some((step) => !step.title.trim() || !step.instruction.trim())) {
          throw new Error(`Hãy hoàn tất các bước pha của món ${product.name} size ${sopVariant.size}.`);
        }
        const components = variant.components.map((component) => {
          const sourceName = component.kind === "ingredient"
            ? recipe.ingredients.find((item) => item.id === component.ingredientId)?.name
            : recipe.batches.find((item) => item.id === component.batchId)?.name;
          const quantity = Number(component.quantity);
          if (!sourceName || !Number.isFinite(quantity) || quantity <= 0 || !component.unit.trim()) {
            throw new Error(`Thành phần của món ${product.name} size ${sopVariant.size} không hợp lệ. Kiểm tra lại công thức giá vốn.`);
          }
          return { name: sourceName, quantity: component.quantity, unit: component.unit };
        });
        if (!components.length) throw new Error(`Món ${product.name} size ${sopVariant.size} chưa có định lượng trong công thức giá vốn.`);

        return {
          size: sopVariant.size,
          sizeOz: sizeOz[sopVariant.size],
          components,
          ...(!sopProduct.steps ? { steps: steps.map((step) => ({ title: step.title.trim(), instruction: step.instruction.trim() })) } : {}),
          ...(sopProduct.notes === undefined && sopVariant.notes?.trim() ? { notes: sopVariant.notes.trim() } : {}),
        };
      }),
      ...(sopProduct.steps ? { steps: sopProduct.steps.map((step) => ({ title: step.title.trim(), instruction: step.instruction.trim() })) } : {}),
      ...(sopProduct.notes?.trim() ? { notes: sopProduct.notes.trim() } : {}),
    };
  });

  return staffSopPublicationSchema.parse({ products });
}
