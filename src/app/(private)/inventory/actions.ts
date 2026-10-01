"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentBusinessDate } from "@/lib/finance/format";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";

export type InventoryCountActionState = { error?: string; success?: string } | undefined;

const dateSchema = z.iso.date();
const idSchema = z.uuid();
const quantitySchema = z.string().max(16).regex(/^\d{1,12}(\.\d{1,3})?$/);

async function getInventoryAccess() {
  const owner = await requireOwnerClient();
  if (owner) return { ...owner, basePath: "/inventory", role: "owner" as const };
  const staff = await requireStaff();
  if (staff) return { ...staff, basePath: "/staff/inventory", role: "staff" as const };
  return null;
}

export async function openInventoryCountAction(
  _state: InventoryCountActionState,
  formData: FormData,
): Promise<InventoryCountActionState> {
  const date = dateSchema.safeParse(formData.get("business_date"));
  if (!date.success) return { error: "Ngày kiểm không hợp lệ." };

  const access = await getInventoryAccess();
  if (!access) return { error: "Tài khoản không còn quyền truy cập kho." };
  if (date.data > currentBusinessDate()) return { error: "Không thể mở bản kiểm cho ngày trong tương lai." };
  if (access.role === "staff" && date.data !== currentBusinessDate()) {
    return { error: "Nhân viên chỉ được mở bản kiểm hôm nay." };
  }

  const { error } = await access.supabase.rpc("open_inventory_count", { p_business_date: date.data });
  if (error) return { error: "Không thể mở bản kiểm. Vui lòng tải lại trang và thử lại." };
  revalidatePath(access.basePath);
  return { success: "Đã mở bản kiểm." };
}

export async function saveInventoryCountDraftAction(
  _state: InventoryCountActionState,
  formData: FormData,
): Promise<InventoryCountActionState> {
  const countId = idSchema.safeParse(formData.get("count_id"));
  if (!countId.success) return { error: "Bản kiểm không hợp lệ." };

  const quantities = new Map<string, { item_id: string; large_quantity?: string | null; small_quantity?: string | null }>();
  for (const [key, rawValue] of formData.entries()) {
    const match = /^(large|small)_quantity_([0-9a-f-]{36})$/i.exec(key);
    if (!match) continue;
    if (typeof rawValue !== "string") return { error: "Số lượng không hợp lệ." };
    const itemId = idSchema.safeParse(match[2]);
    const value = rawValue.trim();
    if (!itemId.success || (value !== "" && !quantitySchema.safeParse(value).success)) {
      return { error: "Số lượng cần không âm và tối đa 3 chữ số thập phân." };
    }
    const entry = quantities.get(itemId.data) ?? { item_id: itemId.data };
    entry[match[1] === "large" ? "large_quantity" : "small_quantity"] = value === "" ? null : value;
    quantities.set(itemId.data, entry);
  }
  if (quantities.size === 0) return { error: "Không có số lượng để lưu." };

  const access = await getInventoryAccess();
  if (!access) return { error: "Tài khoản không còn quyền truy cập kho." };
  const { error } = await access.supabase.rpc("save_inventory_count_draft", {
    p_count_id: countId.data,
    p_quantities: [...quantities.values()],
  });
  if (error) return { error: "Không thể lưu bản kiểm. Kiểm tra số lượng và quyền sửa ngày này." };

  revalidatePath(access.basePath);
  return { success: "Đã lưu bản nháp. Bản này chưa phải mốc tồn kho." };
}

export async function finalizeInventoryCountAction(
  _state: InventoryCountActionState,
  formData: FormData,
): Promise<InventoryCountActionState> {
  const countId = idSchema.safeParse(formData.get("count_id"));
  if (!countId.success) return { error: "Bản kiểm không hợp lệ." };

  const access = await getInventoryAccess();
  if (!access) return { error: "Tài khoản không còn quyền truy cập kho." };
  const { error } = await access.supabase.rpc("finalize_inventory_count", { p_count_id: countId.data });
  if (error) {
    return {
      error: error.message.includes("uncounted items")
        ? "Hãy nhập số lượng cho tất cả mặt hàng trước khi chốt. Số 0 vẫn được tính là đã kiểm."
        : error.message.includes("recounted after the latest receipt")
          ? "Có hàng nhập sau lần đếm gần nhất. Hãy kiểm lại mặt hàng đó rồi chốt."
          : "Không thể chốt bản kiểm. Kiểm tra quyền truy cập và trạng thái bản kiểm.",
    };
  }

  revalidatePath(access.basePath);
  return { success: "Đã chốt bản kiểm. Phiếu nhập sau thời điểm này thuộc kỳ tiếp theo." };
}
