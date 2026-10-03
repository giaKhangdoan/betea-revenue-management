"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";
import { deleteR2Object } from "@/lib/storage/r2";

export type PhotoActionResult = { error?: string; success?: string };

export async function addDayPhotoRecord(input: {
  date: string;
  category: string;
  shiftCode: string;
  objectPath: string;
  caption: string;
}): Promise<PhotoActionResult> {
  const parsed = z.object({
    date: z.iso.date().refine((date) => date >= "2026-09-01"),
    category: z.enum(["bluebook", "cleaning", "arrangement", "other"]),
    shiftCode: z.union([z.literal(""), z.enum(["06-10", "10-14", "14-18", "18-22"])]),
    objectPath: z.string().min(8).max(360),
    caption: z.string().max(240),
  }).safeParse(input);
  if (!parsed.success) return { error: "Thông tin ảnh chưa hợp lệ." };

  const owner = await requireOwnerClient();
  const staff = owner ? null : await requireStaff();
  if (!owner && !staff) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const ownerId = owner?.ownerId ?? staff?.ownerId;
  const expectedPath = ownerId
    ? new RegExp(`^${ownerId}/${parsed.data.date}/[0-9a-f-]{36}\\.(jpg|png|webp)$`, "i")
    : null;
  if (!ownerId || !expectedPath?.test(parsed.data.objectPath)) {
    return { error: "Đường dẫn ảnh không thuộc sổ ngày này." };
  }
  const { error } = owner
    ? await owner.supabase.rpc("owner_create_day_photo_r2", {
      p_business_date: parsed.data.date,
      p_category: parsed.data.category,
      p_shift_code: parsed.data.shiftCode,
      p_object_path: parsed.data.objectPath,
      p_caption: parsed.data.caption,
    })
    : await staff!.supabase.rpc("staff_create_day_photo_r2", {
      p_business_date: parsed.data.date,
      p_category: parsed.data.category,
      p_shift_code: parsed.data.shiftCode,
      p_object_path: parsed.data.objectPath,
      p_caption: parsed.data.caption,
    });
  if (error) return { error: "Ảnh đã tải lên nhưng chưa lưu được nhãn. Hãy thử lại." };

  revalidatePath(`/ledger/${parsed.data.date}`);
  revalidatePath("/");
  return { success: "Đã lưu ảnh chứng từ." };
}

export async function deleteDayPhotoRecord(input: { date: string; id: string }): Promise<PhotoActionResult> {
  const parsed = z.object({ date: z.iso.date(), id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Không tìm thấy ảnh cần xóa." };
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };

  const { data: photo, error: findError } = await owner.supabase.from("day_photos")
    .select("id,owner_id,business_date,shift_code,category,object_path,storage_provider,caption,created_at")
    .eq("owner_id", owner.ownerId).eq("business_date", parsed.data.date).eq("id", parsed.data.id).maybeSingle();
  if (findError || !photo) return { error: "Ảnh không còn tồn tại hoặc bạn không có quyền xóa." };

  const { error: rowError } = await owner.supabase.rpc("owner_delete_day_photo", {
    p_business_date: parsed.data.date,
    p_photo_id: parsed.data.id,
  });
  if (rowError) return { error: "Chưa xóa được bản ghi ảnh. Hãy tải lại trang rồi thử lại." };

  if (photo.storage_provider === "r2") {
    try {
      await deleteR2Object(photo.object_path);
    } catch {
      const { error: restoreError } = await owner.supabase.rpc("owner_create_day_photo_r2", {
        p_business_date: photo.business_date,
        p_category: photo.category,
        p_shift_code: photo.shift_code ?? "",
        p_object_path: photo.object_path,
        p_caption: photo.caption ?? "",
      });
      revalidatePath(`/ledger/${parsed.data.date}`);
      if (restoreError) return { error: "Tệp R2 chưa xóa được và bản ghi ảnh chưa khôi phục được. Hãy tải lại trước khi thử tiếp." };
      return { error: "Chưa xóa được ảnh khỏi R2. Bản ghi đã được khôi phục; hãy thử lại sau." };
    }

    const { error: legacyStorageError } = await owner.supabase.storage.from("betea-evidence").remove([photo.object_path]);
    if (legacyStorageError) {
      const { error: restoreError } = await owner.supabase.rpc("owner_create_day_photo", {
        p_business_date: photo.business_date,
        p_category: photo.category,
        p_shift_code: photo.shift_code ?? "",
        p_object_path: photo.object_path,
        p_caption: photo.caption ?? "",
      });
      revalidatePath(`/ledger/${parsed.data.date}`);
      if (restoreError) return { error: "Ảnh R2 đã xóa nhưng bản ghi chưa khôi phục được. Hãy tải lại trước khi thử tiếp." };
      return { error: "Ảnh đã xóa khỏi R2 nhưng bản sao Supabase chưa xóa được. Bản ghi đã chuyển về bản sao; hãy thử lại." };
    }
  } else {
    const { error: storageError } = await owner.supabase.storage.from("betea-evidence").remove([photo.object_path]);
    if (storageError) {
      const { error: restoreError } = await owner.supabase.rpc("owner_create_day_photo", {
      p_business_date: photo.business_date,
      p_category: photo.category,
      p_shift_code: photo.shift_code ?? "",
      p_object_path: photo.object_path,
      p_caption: photo.caption ?? "",
      });
      revalidatePath(`/ledger/${parsed.data.date}`);
      if (restoreError) return { error: "Ảnh vẫn còn trong kho nhưng bản ghi chưa khôi phục được. Không tải lại ảnh này; hãy thử lại sau." };
      return { error: "Chưa xóa được tệp ảnh. Bản ghi đã được khôi phục; hãy thử lại khi có kết nối." };
    }
  }

  revalidatePath(`/ledger/${parsed.data.date}`);
  return { success: "Đã xóa ảnh." };
}
