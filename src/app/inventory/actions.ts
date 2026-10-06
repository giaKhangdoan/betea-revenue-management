"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";
import { calculateInventoryReceiptOutlier, calculateConvertedReceiptQuantity, formatInventoryMilli, inventoryQuantityToMilli } from "@/lib/inventory/receipts";

export type InventoryReceiptOutlier = {
  item_id: string;
  item_name: string;
  current_quantity: string;
  median_quantity: string;
  ratio: string;
};

export type InventoryReceiptActionState = {
  error?: string;
  success?: string;
  outliers?: InventoryReceiptOutlier[];
  canConfirmOutliers?: boolean;
} | undefined;

function textValues(formData: FormData, name: string) {
  return formData.getAll(name).map((value) => typeof value === "string" ? value.trim() : "");
}

export async function saveInventoryReceiptAction(
  _state: InventoryReceiptActionState,
  formData: FormData,
): Promise<InventoryReceiptActionState> {
  const mode = formData.get("mode");
  if (mode !== "create" && mode !== "update" && mode !== "owner-correct") return { error: "Thao tác phiếu nhập không hợp lệ." };

  const owner = mode === "create" || mode === "owner-correct" ? await requireOwnerClient() : null;
  const staff = mode === "update" || (mode === "create" && !owner) ? await requireStaff() : null;
  if (!owner && !staff) return { error: "Tài khoản không còn quyền truy cập kho hoặc phiên đã hết hạn." };
  if (mode === "owner-correct" && !owner) return { error: "Chỉ chủ cửa hàng mới được sửa phiếu cần hiệu chỉnh." };
  const supabase = owner?.supabase ?? staff!.supabase;
  const ownerId = owner?.ownerId ?? staff!.ownerId;

  const itemIds = textValues(formData, "item_id");
  const largeQuantities = textValues(formData, "large_quantity");
  const looseQuantities = textValues(formData, "loose_quantity");
  if (itemIds.length < 1 || itemIds.length > 200 || itemIds.length !== largeQuantities.length || itemIds.length !== looseQuantities.length) {
    return { error: "Phiếu cần ít nhất một dòng hàng hợp lệ." };
  }

  const lines = [];
  for (let index = 0; index < itemIds.length; index += 1) {
    const itemId = z.uuid().safeParse(itemIds[index]);
    const largeQuantity = largeQuantities[index];
    const looseQuantity = looseQuantities[index];
    if (!itemId.success || largeQuantity.length > 17 || !/^\d+$/.test(largeQuantity)
      || looseQuantity.length > 21 || !/^\d+(?:[.,]\d{1,3})?$/.test(looseQuantity)) {
      return { error: "Số lượng cần là số không âm; phần lẻ tối đa 3 chữ số." };
    }
    lines.push({
      item_id: itemId.data,
      large_quantity: largeQuantity,
      loose_quantity: looseQuantity.replace(",", "."),
    });
  }

  if (mode !== "create") {
    const reason = formData.get("reason");
    if (typeof reason !== "string" || reason.trim().length === 0 || reason.trim().length > 500) {
      return { error: "Hãy nhập lý do chỉnh sửa (tối đa 500 ký tự)." };
    }
  }

  const receiptId = mode === "create" ? null : z.uuid().safeParse(formData.get("receipt_id"));
  if (receiptId && !receiptId.success) return { error: "Phiếu nhập không hợp lệ." };
  const itemIdList = [...new Set(lines.map((line) => line.item_id))];
  const { data: items, error: itemError } = await supabase.from("inventory_items")
    .select("id,name,large_unit,conversion_factor,small_unit")
    .eq("owner_id", ownerId).in("id", itemIdList);
  if (itemError || !items || items.length !== itemIdList.length) {
    return { error: "Chưa kiểm tra được đơn vị của các mặt hàng. Chưa lưu phiếu." };
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  const quantitiesByItem = new Map<string, bigint>();
  for (const line of lines) {
    const item = itemById.get(line.item_id);
    if (!item || item.conversion_factor == null) continue;
    const quantity = calculateConvertedReceiptQuantity(line.large_quantity, item.conversion_factor, line.loose_quantity);
    const milli = quantity === null ? null : inventoryQuantityToMilli(quantity);
    if (milli === null) return { error: "Không tính được phép quy đổi. Kiểm tra lại đơn vị và hệ số." };
    quantitiesByItem.set(line.item_id, (quantitiesByItem.get(line.item_id) ?? BigInt(0)) + milli);
  }

  let outliers: InventoryReceiptOutlier[] = [];
  if (quantitiesByItem.size > 0) {
    const { data: baselines, error: baselineError } = await supabase.rpc("inventory_receipt_outlier_baselines", {
      p_item_ids: [...quantitiesByItem.keys()],
      p_exclude_receipt_id: receiptId?.success ? receiptId.data : null,
    });
    if (baselineError) return { error: "Chưa kiểm tra được các lần nhập trước. Chưa lưu phiếu." };
    const baselineByItem = new Map((Array.isArray(baselines) ? baselines : []).map((row: {
      item_id: string;
      receipt_count: number;
      median_quantity: string | number | null;
    }) => [row.item_id, row]));
    outliers = [...quantitiesByItem].flatMap(([itemId, quantity]) => {
      const baseline = baselineByItem.get(itemId);
      const warning = baseline
        ? calculateInventoryReceiptOutlier(formatInventoryMilli(quantity), baseline.median_quantity, Number(baseline.receipt_count))
        : null;
      const item = itemById.get(itemId);
      return warning && item ? [{
        item_id: itemId,
        item_name: item.name,
        current_quantity: warning.currentQuantity,
        median_quantity: warning.medianQuantity,
        ratio: warning.ratio,
      }] : [];
    });
  }

  const confirmOutliers = formData.get("confirm_outliers") === "yes";
  if (outliers.length > 0 && (!owner || !confirmOutliers)) {
    if (staff) return {
      outliers,
      error: "Số lượng cao hơn mức nhập gần đây. Nhân viên hãy kiểm tra lại hoặc nhờ chủ xác nhận phiếu.",
    };
    return { outliers, canConfirmOutliers: true };
  }
  if (confirmOutliers && !owner) return { error: "Chỉ chủ cửa hàng mới được xác nhận số lượng nhập bất thường." };

  let result;
  if (mode === "create") {
    result = owner
      ? await owner.supabase.rpc("owner_create_inventory_receipt", { p_lines: lines, p_confirm_large_quantities: confirmOutliers })
      : await staff!.supabase.rpc("staff_create_inventory_receipt", { p_lines: lines });
  } else {
    if (!receiptId?.success) return { error: "Phiếu nhập không hợp lệ." };
    const reason = String(formData.get("reason")).trim();
    if (mode === "owner-correct") {
      result = await owner!.supabase.rpc("owner_correct_inventory_receipt_confirmed", {
        p_receipt_id: receiptId.data,
        p_lines: lines,
        p_reason: reason,
        p_confirm_large_quantities: confirmOutliers,
      });
    } else {
      result = await staff!.supabase.rpc("staff_update_inventory_receipt", {
        p_receipt_id: receiptId.data,
        p_lines: lines,
        p_reason: reason,
      });
    }
  }
  if (result.error) {
    return {
      error: result.error.message.includes("Large inventory receipt quantity requires owner confirmation")
        ? "Số lượng vượt 5 lần trung vị các lần nhập gần đây; chủ cửa hàng cần xác nhận."
        : result.error.message.includes("eligible for staff edit today")
        ? "Phiếu đã qua ngày được phép chỉnh sửa."
        : result.error.message.includes("Receipt item unit configuration changed")
          ? "Đơn vị hoặc quy cách của mặt hàng đã thay đổi từ lúc lập phiếu; không thể hiệu chỉnh phiếu cũ theo danh mục hiện tại."
        : result.error.message.includes("owner correction")
          ? "Phiếu đã nằm trong kỳ kiểm đã chốt; chỉ chủ cửa hàng mới được hiệu chỉnh."
        : "Chưa lưu được phiếu nhập. Hãy kiểm tra số lượng, quyền truy cập và thử lại.",
    };
  }

  revalidatePath("/inventory");
  revalidatePath("/staff/inventory");
  return { success: mode === "create" ? "Đã tạo phiếu nhập." : mode === "owner-correct" ? "Đã hiệu chỉnh phiếu nhập." : "Đã cập nhật phiếu nhập." };
}
