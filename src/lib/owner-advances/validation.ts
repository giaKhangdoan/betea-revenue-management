import { z } from "zod";

const MAX_SAFE_VND = Number.MAX_SAFE_INTEGER;
const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= "2026-09-01";
}, "Ngày phải từ 01/09/2026 và là ngày hợp lệ.");

function parseWholeVnd(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const amount = Number(trimmed);
    return Number.isSafeInteger(amount) ? amount : undefined;
  }
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(trimmed)) {
    const amount = Number(trimmed.replace(/[.,]/g, ""));
    return Number.isSafeInteger(amount) ? amount : undefined;
  }
  return undefined;
}

function moneySchema(minimum: number) {
  return z.preprocess(parseWholeVnd, z.number().int().min(minimum).max(MAX_SAFE_VND));
}

function optionalMoneySchema() {
  return z.preprocess((value) => value === "" || value === null || value === undefined ? null : parseWholeVnd(value),
    z.number().int().min(0).max(MAX_SAFE_VND).nullable());
}

const quantityTextSchema = z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/);
const positiveDecimalText = quantityTextSchema.refine((value) => Number(value) > 0, "Giá trị phải lớn hơn 0.");
const nonnegativeDecimalText = quantityTextSchema;
const lineIdSchema = z.string().trim().min(1).max(120);

const stockLineSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(240),
  costClass: z.enum(["raw_material", "non_ingredient"]),
  inventoryClass: z.literal("stock"),
  inventoryItemId: lineIdSchema,
  largeQuantity: nonnegativeDecimalText.refine((value) => /^\d+$/.test(value), "Đơn vị lớn phải là số nguyên không âm."),
  looseQuantity: nonnegativeDecimalText,
  conversionFactor: positiveDecimalText.optional(),
  smallUnit: z.string().trim().min(1).max(80).optional(),
  convertedQuantity: positiveDecimalText.optional(),
  lineAmountVnd: optionalMoneySchema().optional(),
});

const nonStockLineSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(240),
  costClass: z.enum(["raw_material", "non_ingredient"]),
  inventoryClass: z.literal("non_stock"),
  inventoryItemId: z.union([z.literal(""), z.null()]).optional(),
  unit: z.string().trim().min(1).max(80),
  quantity: nonnegativeDecimalText,
  lineAmountVnd: optionalMoneySchema().optional(),
});

function adaptLineInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return {
    id: row.id ?? row.lineId ?? row.line_id,
    description: row.description,
    costClass: row.costClass ?? row.cost_class,
    inventoryClass: row.inventoryClass ?? row.inventory_class,
    inventoryItemId: row.inventoryItemId ?? row.inventory_item_id,
    largeQuantity: row.largeQuantity ?? row.large_quantity,
    looseQuantity: row.looseQuantity ?? row.loose_quantity,
    conversionFactor: row.conversionFactor ?? row.conversion_factor,
    smallUnit: row.smallUnit ?? row.small_unit,
    convertedQuantity: row.convertedQuantity ?? row.converted_quantity,
    unit: row.unit ?? row.unitSnapshot ?? row.unit_snapshot,
    quantity: row.quantity ?? row.quantitySnapshot ?? row.quantity_snapshot,
    lineAmountVnd: row.lineAmountVnd ?? row.line_amount_vnd,
  };
}

const purchaseLineSchema = z.preprocess(adaptLineInput,
  z.discriminatedUnion("inventoryClass", [stockLineSchema, nonStockLineSchema]));

export function parsePurchaseLineInput(input: unknown) {
  return purchaseLineSchema.safeParse(input);
}

const voucherHeaderSchema = z.object({
  purchaseDate: businessDateSchema,
  vendor: z.string().trim().max(160).optional().nullable(),
  invoiceTotalVnd: moneySchema(1),
  note: z.string().max(4000).optional().nullable(),
  lines: z.array(purchaseLineSchema).min(1).max(200).optional(),
});

function adaptVoucherInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  let lines = row.lines;
  if (typeof lines === "string") {
    try { lines = JSON.parse(lines) as unknown; } catch { lines = undefined; }
  }
  return {
    purchaseDate: row.purchaseDate ?? row.purchase_date,
    vendor: row.vendor,
    invoiceTotalVnd: row.invoiceTotalVnd ?? row.invoice_total_vnd,
    note: row.note,
    lines,
  };
}

export function parseVoucherDraftInput(input: unknown) {
  return voucherHeaderSchema.safeParse(adaptVoucherInput(input));
}

const reimbursementSchema = z.object({
  businessDate: businessDateSchema,
  amountVnd: moneySchema(1),
  note: z.string().max(1000).optional().nullable(),
});

export function parseReimbursementInput(input: unknown) {
  const row = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return reimbursementSchema.safeParse({
    businessDate: row.businessDate ?? row.business_date,
    amountVnd: row.amountVnd ?? row.amount_vnd,
    note: row.note,
  });
}

const profitPostingSchema = z.object({
  voucherId: z.uuid(),
  lineIds: z.array(z.uuid()).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "Không chọn trùng dòng."),
  accountingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
  idempotencyKey: z.uuid(),
  confirmed: z.boolean(),
}).refine((value) => value.confirmed, { path: ["confirmed"], message: "Cần xác nhận trước khi ghi nhận vào lợi nhuận." });

export function parseProfitPostingInput(input: unknown) {
  const row = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return profitPostingSchema.safeParse({
    voucherId: row.voucherId ?? row.voucher_id,
    lineIds: row.lineIds ?? row.line_ids,
    accountingMonth: row.accountingMonth ?? row.accounting_month,
    idempotencyKey: row.idempotencyKey ?? row.idempotency_key,
    confirmed: row.confirmed === true || row.confirmed === "on" || row.confirmed === "true",
  });
}
