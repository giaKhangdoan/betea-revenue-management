import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { createR2ReadUrl, isR2StorageConfigured } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: Request, context: { params: Promise<{ evidenceId: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return response({ error: "Yêu cầu xem ảnh không hợp lệ." }, 403);

  const owner = await requireOwnerClient();
  if (!owner) return response({ error: "Chỉ chủ cửa hàng được xem ảnh chứng từ." }, 403);
  if (!isR2StorageConfigured()) return response({ error: "Kho ảnh riêng tư chưa được cấu hình." }, 503);

  const { evidenceId } = await context.params;
  if (!z.uuid().safeParse(evidenceId).success) return response({ error: "Mã ảnh không hợp lệ." }, 400);

  const { data: evidence, error } = await owner.supabase
    .from("owner_purchase_evidence")
    .select("object_path, mime_type, file_name, byte_size, caption")
    .eq("owner_id", owner.ownerId)
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) return response({ error: "Chưa đọc được ảnh chứng từ. Hãy thử lại." }, 503);
  if (!evidence) return response({ error: "Không tìm thấy ảnh chứng từ." }, 404);

  try {
    const url = await createR2ReadUrl(evidence.object_path);
    if (!url) return response({ error: "Kho ảnh riêng tư chưa sẵn sàng." }, 503);
    return response({
      url,
      contentType: evidence.mime_type,
      fileName: evidence.file_name,
      byteSize: evidence.byte_size,
      caption: evidence.caption,
      expiresInSeconds: 300,
    });
  } catch {
    return response({ error: "Chưa tạo được liên kết xem ảnh. Hãy thử lại." }, 503);
  }
}
