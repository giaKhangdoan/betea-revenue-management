import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";
import { createEvidencePhotoUrl } from "@/lib/storage/photo-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  if (!z.uuid().safeParse(photoId).success) return response({ error: "Không tìm thấy ảnh." }, 404);

  const owner = await requireOwnerClient();
  const staff = owner ? null : await requireStaff();
  if (!owner && !staff) return response({ error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." }, 401);

  const access = owner ?? staff!;
  const { data: photo, error } = await access.supabase.from("day_photos")
    .select("id,owner_id,business_date,object_path,storage_provider")
    .eq("id", photoId)
    .eq("owner_id", access.ownerId)
    .maybeSingle();
  if (error || !photo) return response({ error: "Không tìm thấy ảnh hoặc bạn không có quyền xem." }, 404);

  const url = await createEvidencePhotoUrl(access.supabase, photo);
  if (!url) return response({ error: "Chưa tạo được liên kết xem ảnh." }, 503);
  return response({ url });
}
