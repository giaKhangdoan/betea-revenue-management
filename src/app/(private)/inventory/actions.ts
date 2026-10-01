"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentBusinessDate } from "@/lib/finance/format";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";

export type InventoryCountActionState = { error?: string; success?: string } | undefined;
export type InventoryCatalogActionState = { error?: string; success?: string } | undefined;

const dateSchema = z.iso.date();
const idSchema = z.uuid();
const quantitySchema = z.string().max(16).regex(/^\d{1,12}(\.\d{1,3})?$/);
const catalogItemSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên mặt hàng.").max(120, "Tên mặt hàng tối đa 120 ký tự."),
  category: z.string().trim().min(1, "Nhập nhóm hàng.").max(120, "Nhóm hàng tối đa 120 ký tự."),
  largeUnit: z.string().trim().min(1, "Nhập đơn vị lớn.").max(120, "Đơn vị tối đa 120 ký tự."),
  conversionFactor: z.string().trim()
    .regex(/^\d{1,11}(?:\.\d{1,3})?$/, "Hệ số cần là số dương, tối đa 3 chữ số thập phân.")
    .refine((value) => Number(value) > 0, "Hệ số cần lớn hơn 0."),
  smallUnit: z.string().trim().min(1, "Nhập đơn vị gốc.").max(120, "Đơn vị tối đa 120 ký tự."),
}).superRefine(({ conversionFactor, smallUnit }, context) => {
  const divisibleUnits = ["gr", "g", "mg", "ml", "kg", "l", "lít"];
  if (!divisibleUnits.includes(smallUnit.toLowerCase()) && !Number.isInteger(Number(conversionFactor))) {
    context.addIssue({ code: "custom", path: ["conversionFactor"], message: "Đơn vị gốc không chia lẻ nên hệ số phải là số nguyên." });
  }
});

function catalogFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    category: formData.get("category"),
    largeUnit: formData.get("large_unit"),
    conversionFactor: formData.get("conversion_factor"),
    smallUnit: formData.get("small_unit"),
  };
}

function catalogValidationError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Kiểm tra lại thông tin mặt hàng.";
}

export async function createInventoryItemAction(
  _state: InventoryCatalogActionState,
  formData: FormData,
): Promise<InventoryCatalogActionState> {
  const item = catalogItemSchema.safeParse(catalogFormData(formData));
  if (!item.success) return { error: catalogValidationError(item.error) };

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng mới được quản lý danh mục." };
  const { error } = await owner.supabase.rpc("owner_create_inventory_item", {
    p_name: item.data.name,
    p_category: item.data.category,
    p_large_unit: item.data.largeUnit,
    p_conversion_factor: item.data.conversionFactor,
    p_small_unit: item.data.smallUnit,
  });
  if (error) return { error: "Chưa thêm được mặt hàng. Hãy kiểm tra đơn vị và hệ số quy đổi." };

  revalidatePath("/inventory");
  return { success: "Đã thêm mặt hàng vào danh mục." };
}

export async function updateInventoryItemAction(
  _state: InventoryCatalogActionState,
  formData: FormData,
): Promise<InventoryCatalogActionState> {
  const id = idSchema.safeParse(formData.get("item_id"));
  const item = catalogItemSchema.safeParse(catalogFormData(formData));
  if (!id.success) return { error: "Mặt hàng không hợp lệ." };
  if (!item.success) return { error: catalogValidationError(item.error) };

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng mới được quản lý danh mục." };
  const { error } = await owner.supabase.rpc("owner_update_inventory_item", {
    p_item_id: id.data,
    p_name: item.data.name,
    p_category: item.data.category,
    p_large_unit: item.data.largeUnit,
    p_conversion_factor: item.data.conversionFactor,
    p_small_unit: item.data.smallUnit,
  });
  if (error) return { error: "Chưa lưu được mặt hàng. Hãy kiểm tra đơn vị và hệ số quy đổi." };

  revalidatePath("/inventory");
  return { success: "Đã cập nhật mặt hàng. Lịch sử đã lưu được giữ nguyên." };
}

export async function deactivateInventoryItemAction(
  _state: InventoryCatalogActionState,
  formData: FormData,
): Promise<InventoryCatalogActionState> {
  const id = idSchema.safeParse(formData.get("item_id"));
  if (!id.success) return { error: "Mặt hàng không hợp lệ." };

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng mới được quản lý danh mục." };
  const { error } = await owner.supabase.rpc("owner_deactivate_inventory_item", { p_item_id: id.data });
  if (error) return { error: "Chưa ngừng dùng được mặt hàng. Hãy tải lại trang và thử lại." };

  revalidatePath("/inventory");
  return { success: "Đã ngừng dùng mặt hàng. Lịch sử đã lưu vẫn được giữ." };
}

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
