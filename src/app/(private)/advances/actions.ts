"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { loadPurchaseDuplicateCandidates, loadReceiptLinkCandidates } from "@/lib/owner-advances/loaders";
import {
  parseProfitPostingInput,
  parsePurchaseLineInput,
  parseReimbursementInput,
  parseVoucherDraftInput,
} from "@/lib/owner-advances/validation";
import type { OwnerPurchaseLineRow, OwnerPurchaseVoucherRow } from "@/lib/owner-advances/types";

export type AdvanceActionState = {
  error?: string;
  success?: string;
  voucherId?: string;
  requiresDuplicateReview?: boolean;
  duplicateCandidates?: Array<{
    id: string;
    business_date: string;
    amount_vnd: number | string;
    reason: string;
    created_at: string;
    matchedText: string;
    matchedAmountVnd: number;
    matchKind: "invoice" | "line";
    paymentSource: "shop_cash";
  }>;
  result?: unknown;
};

const uuidSchema = z.uuid();
const reasonSchema = z.string().trim().min(2).max(500);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readJsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string") return undefined;
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}

function validatedVoucher(formData: FormData) {
  const parsed = parseVoucherDraftInput({
    purchaseDate: formText(formData, "purchase_date"),
    vendor: formText(formData, "vendor"),
    invoiceTotalVnd: formText(formData, "invoice_total_vnd"),
    note: formText(formData, "note"),
    lines: readJsonField(formData, "lines"),
  });
  if (!parsed.success || !parsed.data.lines?.length) return null;
  const lines = parsed.data.lines.map((line) => parsePurchaseLineInput(line));
  if (lines.some((line) => !line.success)) return null;
  return {
    purchaseDate: parsed.data.purchaseDate,
    vendor: parsed.data.vendor?.trim() || null,
    invoiceTotalVnd: parsed.data.invoiceTotalVnd,
    note: parsed.data.note?.trim() || null,
    lines: lines.map((line) => line.success ? line.data : null).filter((line): line is NonNullable<typeof line> => line !== null),
  };
}

function toRpcLines(lines: NonNullable<ReturnType<typeof validatedVoucher>>["lines"], preserveIds = false) {
  return lines.map((line) => line.inventoryClass === "stock"
    ? {
      ...(preserveIds && line.id ? { line_id: line.id } : {}),
      description: line.description,
      cost_class: line.costClass,
      inventory_class: "stock",
      inventory_item_id: line.inventoryItemId,
      large_quantity: line.largeQuantity,
      loose_quantity: line.looseQuantity,
      line_amount_vnd: line.lineAmountVnd,
    }
    : {
      ...(preserveIds && line.id ? { line_id: line.id } : {}),
      description: line.description,
      cost_class: line.costClass,
      inventory_class: "non_stock",
      unit_snapshot: line.unit,
      quantity_snapshot: line.quantity,
      line_amount_vnd: line.lineAmountVnd,
    });
}

function parseReceiptLinks(formData: FormData) {
  const parsedId = formText(formData, "existing_receipt_id").trim() ? uuidSchema.safeParse(formText(formData, "existing_receipt_id")) : null;
  if (parsedId && !parsedId.success) return null;
  const rawLinks = readJsonField(formData, "receipt_line_links");
  const linksSchema = z.array(z.object({ purchase_line_id: z.uuid(), receipt_line_id: z.uuid() })).max(200);
  const parsedLinks = linksSchema.safeParse(rawLinks ?? []);
  if (!parsedLinks.success) return null;
  const purchaseIds = new Set(parsedLinks.data.map(({ purchase_line_id }) => purchase_line_id));
  const receiptIds = new Set(parsedLinks.data.map(({ receipt_line_id }) => receipt_line_id));
  if (purchaseIds.size !== parsedLinks.data.length || receiptIds.size !== parsedLinks.data.length) return null;
  return { receiptId: parsedId?.success ? parsedId.data : null, links: parsedLinks.data };
}

function getOwnerFailure(): AdvanceActionState {
  return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền chủ cửa hàng." };
}

function getRpcFailure(error: { code?: string; message?: string } | null | undefined, fallback: string): AdvanceActionState {
  const message = error?.message ?? "";
  if (message.includes("Reverse active profit postings")) {
    return { error: "Khoản này đã được ghi vào lợi nhuận. Hãy hoàn tác bút toán lợi nhuận trước khi sửa phiếu." };
  }
  if (message.includes("reimbursements")) {
    return { error: "Tổng tiền đã hoàn không khớp với số tiền ứng mới. Kiểm tra lại phiếu trước khi sửa." };
  }
  if (message.includes("Review matching daily expenses before correcting")) {
    return { error: "Phiếu mới khớp với một khoản chi trong sổ ngày. Hãy đối chiếu khoản đó trước khi hiệu chỉnh phiếu đã chốt." };
  }
  if (message.includes("already finalized")) return { error: "Phiếu đã được chốt ở thao tác khác. Tải lại trang để xem trạng thái mới." };
  return { error: fallback };
}

function refreshPurchaseViews(voucherId?: string) {
  revalidatePath("/advances");
  revalidatePath("/inventory");
  revalidatePath("/reports");
  if (voucherId) revalidatePath(`/advances/${voucherId}`);
}

export async function createPurchaseVoucher(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucher = validatedVoucher(formData);
  if (!voucher) return { error: "Kiểm tra ngày, tổng hóa đơn và ít nhất một dòng hàng; phân loại kho và loại chi phí phải chọn rõ." };
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();

  const { data, error } = await owner.supabase.rpc("owner_create_purchase_voucher", {
    p_purchase_date: voucher.purchaseDate,
    p_vendor: voucher.vendor,
    p_invoice_total_vnd: voucher.invoiceTotalVnd,
    p_note: voucher.note,
    p_lines: toRpcLines(voucher.lines),
  });
  if (error || !uuidSchema.safeParse(data).success) return getRpcFailure(error, "Chưa lưu được bản nháp phiếu mua. Kiểm tra lại số lượng kho và thử lại.");
  const voucherId = data as string;
  refreshPurchaseViews(voucherId);
  return { success: "Đã lưu bản nháp. Bản nháp chưa cộng vào kho hoặc lợi nhuận.", voucherId };
}

export async function updatePurchaseVoucher(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucherId = uuidSchema.safeParse(formText(formData, "voucher_id"));
  const reason = reasonSchema.safeParse(formText(formData, "reason"));
  const voucher = validatedVoucher(formData);
  if (!voucherId.success || !reason.success || !voucher) return { error: "Nhập lý do chỉnh sửa và kiểm tra lại thông tin phiếu nháp." };
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();

  const { error } = await owner.supabase.rpc("owner_update_purchase_voucher", {
    p_voucher_id: voucherId.data,
    p_purchase_date: voucher.purchaseDate,
    p_vendor: voucher.vendor,
    p_invoice_total_vnd: voucher.invoiceTotalVnd,
    p_note: voucher.note,
    p_lines: toRpcLines(voucher.lines),
    p_reason: reason.data,
  });
  if (error) return getRpcFailure(error, "Chưa cập nhật được phiếu nháp. Tải lại trang rồi thử lại.");
  refreshPurchaseViews(voucherId.data);
  return { success: "Đã lưu thay đổi và ghi lịch sử phiếu.", voucherId: voucherId.data };
}

export async function cancelPurchaseVoucher(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucherId = uuidSchema.safeParse(formText(formData, "voucher_id"));
  const reason = reasonSchema.safeParse(formText(formData, "reason"));
  if (!voucherId.success || !reason.success) return { error: "Nhập lý do hủy từ 2 đến 500 ký tự." };
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();
  const { error } = await owner.supabase.rpc("owner_cancel_purchase_voucher", { p_voucher_id: voucherId.data, p_reason: reason.data });
  if (error) return getRpcFailure(error, "Chưa hủy được phiếu. Phiếu đã chốt không thể hủy theo luồng bản nháp.");
  refreshPurchaseViews(voucherId.data);
  return { success: "Đã hủy bản nháp; phiếu không ảnh hưởng kho hay tài chính.", voucherId: voucherId.data };
}

export async function finalizePurchaseVoucher(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucherId = uuidSchema.safeParse(formText(formData, "voucher_id"));
  if (!voucherId.success) return { error: "Mã phiếu mua không hợp lệ." };
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();

  const [voucherResult, linesResult] = await Promise.all([
    owner.supabase.from("owner_purchase_vouchers").select("id,owner_id,purchase_date,vendor,invoice_total_vnd,note,status")
      .eq("owner_id", owner.ownerId).eq("id", voucherId.data).maybeSingle(),
    owner.supabase.from("owner_purchase_lines").select("id,voucher_id,line_number,active,description,cost_class,inventory_class,inventory_item_id,item_name_snapshot,large_unit_snapshot,conversion_factor_snapshot,small_unit_snapshot,large_quantity,loose_quantity,converted_quantity,unit_snapshot,quantity_snapshot,line_amount_vnd")
      .eq("owner_id", owner.ownerId).eq("voucher_id", voucherId.data).eq("active", true).order("line_number"),
  ]);
  if (voucherResult.error || linesResult.error) return { error: "Chưa đọc được phiếu để kiểm tra khoản trùng. Thử lại sau." };
  if (!voucherResult.data || voucherResult.data.status !== "draft") return { error: "Chỉ phiếu nháp mới được chốt." };
  const voucher = voucherResult.data as OwnerPurchaseVoucherRow;
  const lines = (linesResult.data ?? []) as OwnerPurchaseLineRow[];
  if (lines.length === 0) return { error: "Phiếu cần có ít nhất một dòng hàng trước khi chốt." };
  const duplicateResult = await loadPurchaseDuplicateCandidates(owner.supabase, owner.ownerId, voucher, lines);
  if (duplicateResult.error) return { error: "Chưa kiểm tra được chi phí cùng ngày. Phiếu chưa được chốt." };
  if (duplicateResult.candidates.length) {
    return {
      requiresDuplicateReview: true,
      duplicateCandidates: duplicateResult.candidates,
      error: "Có khoản chi trong sổ ngày trùng ngày, số tiền và nội dung. Chọn bản ghi chuẩn trước khi chốt.",
    };
  }

  const receipt = parseReceiptLinks(formData);
  if (!receipt) return { error: "Liên kết phiếu kho không hợp lệ. Tải lại trang rồi thử lại." };
  const stockLines = lines.filter((line) => line.inventory_class === "stock");
  if (!receipt.receiptId && receipt.links.length) return { error: "Liên kết dòng kho cần chọn đúng phiếu nhập kho trước khi chốt." };
  if (receipt.receiptId) {
    if (!stockLines.length) return { error: "Phiếu không có dòng nhập kho nên không thể gắn phiếu kho hiện có." };
    const receiptCheck = await loadReceiptLinkCandidates(owner.supabase, owner.ownerId, voucher.purchase_date, stockLines);
    if (receiptCheck.error) return { error: "Chưa xác minh được phiếu nhập kho. Tải lại để kiểm tra trước khi chốt." };
    const candidate = receiptCheck.candidates.find(({ id }) => id === receipt.receiptId);
    const key = (links: typeof receipt.links) => links.map(({ purchase_line_id, receipt_line_id }) => `${purchase_line_id}:${receipt_line_id}`).sort().join("|");
    if (!candidate || key(candidate.links) !== key(receipt.links)) {
      return { error: "Phiếu nhập kho đã thay đổi hoặc không khớp chính xác với mặt hàng. Tải lại danh sách rồi chọn lại." };
    }
  }
  const { data, error } = await owner.supabase.rpc("owner_finalize_purchase_voucher", {
    p_voucher_id: voucherId.data,
    p_existing_receipt_id: receipt.receiptId,
    p_receipt_line_links: receipt.links,
  });
  if (error) return getRpcFailure(error, "Chưa chốt được phiếu. Kiểm tra lại số lượng và đơn vị kho." );
  refreshPurchaseViews(voucherId.data);
  return { success: "Đã chốt phiếu và xử lý các dòng kho trong cùng giao dịch.", voucherId: voucherId.data, result: data };
}

export async function resolvePurchaseDuplicate(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucherId = uuidSchema.safeParse(formText(formData, "voucher_id"));
  const rawDecisions = readJsonField(formData, "decisions");
  const decisionsSchema = z.array(z.object({
    daily_expense_id: z.uuid(),
    resolution: z.enum(["personal_paid", "shop_cash", "different_purchase"]),
    reason: z.string().trim().min(2).max(500),
  })).min(1).max(1000);
  const decisions = decisionsSchema.safeParse(rawDecisions);
  const idempotencyKey = uuidSchema.safeParse(formText(formData, "idempotency_key"));
  const receipt = parseReceiptLinks(formData);
  if (!voucherId.success || !decisions.success || !idempotencyKey.success || !receipt) {
    return { error: "Kiểm tra các khoản chi cần đối chiếu, từng quyết định, lý do và khóa thao tác." };
  }
  if (decisions.data.some((decision) => decision.resolution === "different_purchase" && decision.reason.length < 5)) {
    return { error: "Với từng khoản được xác nhận là giao dịch khác, ghi lý do từ 5 ký tự trở lên." };
  }
  if (decisions.data.some((decision) => decision.resolution === "shop_cash")
    && decisions.data.some((decision) => decision.resolution === "personal_paid")) {
    return { error: "Một giao dịch không thể vừa do quán trả vừa do admin tự trả. Kiểm tra lại các quyết định." };
  }
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();
  const hasShopCash = decisions.data.some(({ resolution }) => resolution === "shop_cash");
  const hasPersonalPaid = decisions.data.some(({ resolution }) => resolution === "personal_paid");
  const hasDifferentPurchase = decisions.data.some(({ resolution }) => resolution === "different_purchase");
  const needsReceiptChoice = !hasShopCash && hasPersonalPaid && !hasDifferentPurchase;

  // The SQL RPC verifies every selected row, re-counts all current matches,
  // validates receipt-line identity, and writes the decisions atomically.
  // Keeping this boundary in the database also lets exact retries replay after
  // a successful finalization instead of failing a stale server preflight.
  const { data, error } = await owner.supabase.rpc("owner_resolve_purchase_duplicates", {
    p_voucher_id: voucherId.data,
    p_decisions: decisions.data.map((decision) => ({
      ...decision,
      reason: decision.reason.trim(),
    })),
    p_existing_receipt_id: needsReceiptChoice ? receipt.receiptId : null,
    p_receipt_line_links: needsReceiptChoice ? receipt.links : [],
    p_idempotency_key: idempotencyKey.data,
  });
  if (error) return getRpcFailure(error, "Chưa ghi nhận được quyết định đối chiếu. Chưa có thay đổi một phía nào được áp dụng.");
  refreshPurchaseViews(voucherId.data);
  return { success: hasShopCash ? "Đã giữ chi phí tiền quán và hủy bản nháp trùng sau khi ghi lịch sử từng quyết định." : "Đã ghi lịch sử từng khoản và chốt phiếu trong một giao dịch.", voucherId: voucherId.data, result: data };
}

export async function recordPurchaseReimbursement(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucherId = uuidSchema.safeParse(formText(formData, "voucher_id"));
  const parsed = parseReimbursementInput({
    businessDate: formText(formData, "business_date"),
    amountVnd: formText(formData, "amount_vnd"),
    note: formText(formData, "note"),
  });
  const idempotencyKey = uuidSchema.safeParse(formText(formData, "idempotency_key"));
  const reversalIdRaw = formText(formData, "reverses_event_id").trim();
  const reversesEventId = reversalIdRaw ? uuidSchema.safeParse(reversalIdRaw) : null;
  if (!voucherId.success || !parsed.success || !idempotencyKey.success || (reversesEventId && !reversesEventId.success)) {
    return { error: "Nhập ngày, số tiền hoàn và ghi chú hợp lệ; thao tác cần mã chống ghi trùng." };
  }
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();

  const eventType = reversesEventId ? "reversal" : "payment";
  const { data, error } = await owner.supabase.rpc("owner_record_purchase_reimbursement", {
    p_voucher_id: voucherId.data,
    p_event_type: eventType,
    p_business_date: parsed.data.businessDate,
    p_amount_vnd: parsed.data.amountVnd,
    p_note: parsed.data.note?.trim() || null,
    p_idempotency_key: idempotencyKey.data,
    p_reverses_event_id: reversesEventId?.success ? reversesEventId.data : null,
  });
  if (error) return getRpcFailure(error, "Chưa ghi được lần hoàn tiền. Số tiền hoàn có thể vượt quá số đã ứng hoặc phiếu chưa chốt.");
  refreshPurchaseViews(voucherId.data);
  return { success: "Đã thêm sự kiện hoàn/điều chỉnh; lịch sử các lần trước vẫn được giữ.", voucherId: voucherId.data, result: data };
}

export async function postPurchaseCosts(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const rawLineIds = readJsonField(formData, "line_ids");
  const parsed = parseProfitPostingInput({
    voucherId: formText(formData, "voucher_id"),
    lineIds: rawLineIds,
    accountingMonth: formText(formData, "accounting_month"),
    idempotencyKey: formText(formData, "idempotency_key"),
    confirmed: formData.get("confirmed") === "on",
  });
  if (!parsed.success) return { error: "Chọn dòng đủ điều kiện, kỳ tháng và xác nhận trước khi ghi nhận vào lợi nhuận." };
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();

  const { data, error } = await owner.supabase.rpc("owner_post_purchase_costs", {
    p_voucher_id: parsed.data.voucherId,
    p_line_ids: parsed.data.lineIds,
    p_accounting_month: parsed.data.accountingMonth,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return getRpcFailure(error, "Chưa ghi nhận được chi phí vào lợi nhuận. Dòng có thể đã ghi trước đó hoặc không đủ điều kiện.");
  refreshPurchaseViews(parsed.data.voucherId);
  return { success: "Đã ghi nhận các khoản được chọn vào lợi nhuận.", voucherId: parsed.data.voucherId, result: data };
}

export async function reversePurchaseCostPosting(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const postingId = uuidSchema.safeParse(formText(formData, "posting_id"));
  const accountingMonth = monthSchema.safeParse(formText(formData, "accounting_month"));
  const reason = reasonSchema.safeParse(formText(formData, "reason"));
  const idempotencyKey = uuidSchema.safeParse(formText(formData, "idempotency_key"));
  if (!postingId.success || !accountingMonth.success || !reason.success || !idempotencyKey.success) {
    return { error: "Nhập lý do và kỳ điều chỉnh hợp lệ để hoàn tác bút toán." };
  }
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();
  const { error } = await owner.supabase.rpc("owner_reverse_purchase_cost_posting", {
    p_posting_id: postingId.data,
    p_accounting_month: accountingMonth.data,
    p_reason: reason.data,
    p_idempotency_key: idempotencyKey.data,
  });
  if (error) return getRpcFailure(error, "Chưa hoàn tác được bút toán lợi nhuận. Tải lại lịch sử rồi thử lại.");
  refreshPurchaseViews();
  return { success: "Đã ghi bút toán hoàn tác vào lịch sử." };
}

export async function correctPurchaseVoucher(_state: AdvanceActionState | undefined, formData: FormData): Promise<AdvanceActionState> {
  const voucherId = uuidSchema.safeParse(formText(formData, "voucher_id"));
  const reason = reasonSchema.safeParse(formText(formData, "reason"));
  const voucher = validatedVoucher(formData);
  const receipt = parseReceiptLinks(formData);
  if (!voucherId.success || !reason.success || !voucher || !receipt) return { error: "Nhập lý do hiệu chỉnh và kiểm tra lại các dòng của phiếu." };
  const owner = await requireOwnerClient();
  if (!owner) return getOwnerFailure();
  const { data, error } = await owner.supabase.rpc("owner_correct_purchase_voucher", {
    p_voucher_id: voucherId.data,
    p_purchase_date: voucher.purchaseDate,
    p_vendor: voucher.vendor,
    p_invoice_total_vnd: voucher.invoiceTotalVnd,
    p_note: voucher.note,
    p_lines: toRpcLines(voucher.lines, true),
    p_existing_receipt_id: receipt.receiptId,
    p_receipt_line_links: receipt.links,
    p_reason: reason.data,
  });
  if (error) return getRpcFailure(error, "Chưa hiệu chỉnh được phiếu. Lịch sử cũ vẫn được giữ nguyên.");
  refreshPurchaseViews(voucherId.data);
  return { success: "Đã hiệu chỉnh phiếu bằng sự kiện mới, các lần hoàn và bút toán trước vẫn được giữ.", voucherId: voucherId.data, result: data };
}
