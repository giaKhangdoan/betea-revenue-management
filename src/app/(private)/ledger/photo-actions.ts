"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";

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
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  if (!parsed.data.objectPath.startsWith(`${owner.ownerId}/${parsed.data.date}/`)) {
    return { error: "Đường dẫn ảnh không thuộc sổ ngày này." };
  }
  const { error: dayError } = await owner.supabase.from("daily_records").upsert({
    owner_id: owner.ownerId,
    business_date: parsed.data.date,
  }, { onConflict: "owner_id,business_date", ignoreDuplicates: true });
  if (dayError) return { error: "Chưa tạo được ngày để lưu ảnh." };
  const { error } = await owner.supabase.from("day_photos").insert({
    owner_id: owner.ownerId,
    business_date: parsed.data.date,
    shift_code: parsed.data.shiftCode || null,
    category: parsed.data.category,
    object_path: parsed.data.objectPath,
    caption: parsed.data.caption.trim() || null,
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
    .select("id,owner_id,business_date,shift_code,category,object_path,caption,created_at")
    .eq("owner_id", owner.ownerId).eq("business_date", parsed.data.date).eq("id", parsed.data.id).maybeSingle();
  if (findError || !photo) return { error: "Ảnh không còn tồn tại hoặc bạn không có quyền xóa." };

  const { data: deleted, error: rowError } = await owner.supabase.from("day_photos")
    .delete().eq("owner_id", owner.ownerId).eq("business_date", parsed.data.date).eq("id", parsed.data.id)
    .select("id").maybeSingle();
  if (rowError || !deleted) return { error: "Chưa xóa được bản ghi ảnh. Hãy tải lại trang rồi thử lại." };

  const { error: storageError } = await owner.supabase.storage.from("betea-evidence").remove([photo.object_path]);
  if (storageError) {
    const { error: restoreError } = await owner.supabase.from("day_photos").insert(photo);
    revalidatePath(`/ledger/${parsed.data.date}`);
    if (restoreError) return { error: "Ảnh vẫn còn trong kho nhưng bản ghi chưa khôi phục được. Không tải lại ảnh này; hãy thử lại sau." };
    return { error: "Chưa xóa được tệp ảnh. Bản ghi đã được khôi phục; hãy thử lại khi có kết nối." };
  }

  revalidatePath(`/ledger/${parsed.data.date}`);
  return { success: "Đã xóa ảnh." };
}
