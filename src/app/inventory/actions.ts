"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";

export type InventoryReceiptActionState = { error?: string; success?: string } | undefined;

function textValues(formData: FormData, name: string) {
  return formData.getAll(name).map((value) => typeof value === "string" ? value.trim() : "");
}

export async function saveInventoryReceiptAction(
  _state: InventoryReceiptActionState,
  formData: FormData,
): Promise<InventoryReceiptActionState> {
  const mode = formData.get("mode");
  if (mode !== "create" && mode !== "update" && mode !== "owner-correct") return { error: "Thao tác phiếu nhập không hợp lệ." };

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

  let result;
  if (mode === "create") {
    const staff = await requireStaff();
    if (!staff) return { error: "Tài khoản nhân viên không còn quyền truy cập hoặc phiên đã hết hạn." };
    result = await staff.supabase.rpc("staff_create_inventory_receipt", { p_lines: lines });
  } else {
    const receiptId = z.uuid().safeParse(formData.get("receipt_id"));
    if (!receiptId.success) return { error: "Phiếu nhập không hợp lệ." };
    const reason = String(formData.get("reason")).trim();
    if (mode === "owner-correct") {
      const owner = await requireOwnerClient();
      if (!owner) return { error: "Chỉ chủ cửa hàng mới được sửa phiếu cần hiệu chỉnh." };
      result = await owner.supabase.rpc("owner_correct_inventory_receipt", {
        p_receipt_id: receiptId.data,
        p_lines: lines,
        p_reason: reason,
      });
    } else {
      const staff = await requireStaff();
      if (!staff) return { error: "Tài khoản nhân viên không còn quyền truy cập hoặc phiên đã hết hạn." };
      result = await staff.supabase.rpc("staff_update_inventory_receipt", {
        p_receipt_id: receiptId.data,
        p_lines: lines,
        p_reason: reason,
      });
    }
  }
  if (result.error) {
    return {
      error: result.error.message.includes("eligible for staff edit today")
        ? "Phiếu đã qua ngày được phép chỉnh sửa."
        : result.error.message.includes("owner correction")
          ? "Phiếu đã nằm trong kỳ kiểm đã chốt; chỉ chủ cửa hàng mới được hiệu chỉnh."
        : "Chưa lưu được phiếu nhập. Hãy kiểm tra số lượng, quyền truy cập và thử lại.",
    };
  }

  revalidatePath("/inventory");
  revalidatePath("/staff/inventory");
  return { success: mode === "create" ? "Đã tạo phiếu nhập." : mode === "owner-correct" ? "Đã hiệu chỉnh phiếu nhập." : "Đã cập nhật phiếu nhập." };
}
