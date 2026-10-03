import { createHash } from "node:crypto";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { putAndVerifyR2Object, isR2StorageConfigured } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function contentTypeFor(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return response({ error: "Yêu cầu chuyển ảnh không hợp lệ." }, 403);
  }

  const owner = await requireOwnerClient();
  if (!owner) return response({ error: "Chỉ chủ cửa hàng được chuyển kho ảnh." }, 401);
  if (!isR2StorageConfigured()) return response({ error: "Kho ảnh R2 chưa được cấu hình." }, 503);

  const admin = createAdminClient();
  if (!admin) return response({ error: "Máy chủ chưa sẵn sàng cho tác vụ chuyển ảnh." }, 503);

  const { data: photo, error: findError } = await admin.from("day_photos")
    .select("id,object_path")
    .eq("owner_id", owner.ownerId)
    .eq("storage_provider", "supabase")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findError) return response({ error: "Chưa đọc được danh sách ảnh cần chuyển." }, 500);

  if (!photo) return response({ done: true, migrated: false, remaining: 0 });

  const contentType = contentTypeFor(photo.object_path);
  if (!contentType) return response({ error: "Một ảnh cũ có định dạng chưa được hỗ trợ." }, 422);

  try {
    const { data: source, error: downloadError } = await admin.storage.from("betea-evidence").download(photo.object_path);
    if (downloadError || !source) return response({ error: "Chưa tải được ảnh cũ từ Supabase." }, 502);

    const sourceBytes = Buffer.from(await source.arrayBuffer());
    const { sourceBytes: uploadedBytes, storedBytes } = await putAndVerifyR2Object(photo.object_path, sourceBytes, contentType);
    if (uploadedBytes.byteLength !== sourceBytes.byteLength
      || checksum(uploadedBytes) !== checksum(sourceBytes)
      || storedBytes.byteLength !== sourceBytes.byteLength
      || checksum(storedBytes) !== checksum(sourceBytes)) {
      return response({ error: "Ảnh R2 chưa khớp; bản ghi Supabase vẫn được giữ nguyên." }, 502);
    }

    const { error: updateError } = await admin.from("day_photos")
      .update({ storage_provider: "r2" })
      .eq("id", photo.id)
      .eq("owner_id", owner.ownerId)
      .eq("storage_provider", "supabase");
    if (updateError) return response({ error: "Ảnh đã được sao chép, nhưng chưa cập nhật được nguồn đọc." }, 500);

    const { count, error: countError } = await admin.from("day_photos")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner.ownerId)
      .eq("storage_provider", "supabase");
    if (countError) return response({ error: "Ảnh đã được chuyển; hãy tải lại trang để kiểm tra phần còn lại." }, 500);

    return response({ done: count === 0, migrated: true, remaining: count ?? 0 });
  } catch {
    return response({ error: "Chưa chuyển được ảnh này. Các ảnh còn lại vẫn chưa bị thay đổi." }, 502);
  }
}
