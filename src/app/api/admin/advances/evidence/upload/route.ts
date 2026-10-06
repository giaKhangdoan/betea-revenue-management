import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { createR2UploadUrl, isR2StorageConfigured } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16 * 1024;
const uploadSchema = z.object({
  voucherId: z.uuid(),
  reimbursementId: z.uuid().nullable().optional(),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(2 * 1024 * 1024),
  fileName: z.string().trim().min(1).max(1024),
  caption: z.string().max(500).optional().nullable(),
});

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function sanitizeFileName(fileName: string) {
  const leaf = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const safe = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return [...safe].slice(0, 255).join("") || "hoa-don";
}

function sanitizeCaption(caption: string | null | undefined) {
  const safe = caption?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return safe || null;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return response({ error: "Yêu cầu tải ảnh không hợp lệ." }, 403);

  const owner = await requireOwnerClient();
  if (!owner) return response({ error: "Chỉ chủ cửa hàng được tải chứng từ mua hàng." }, 403);
  if (!isR2StorageConfigured()) return response({ error: "Kho ảnh riêng tư chưa được cấu hình." }, 503);

  const parsedBody = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    return response(
      { error: parsedBody.reason === "too-large" ? "Thông tin ảnh vượt giới hạn." : "Thông tin ảnh chưa hợp lệ." },
      parsedBody.reason === "too-large" ? 413 : 400,
    );
  }

  const parsed = uploadSchema.safeParse(parsedBody.value);
  if (!parsed.success) return response({ error: "Chọn ảnh JPEG, PNG hoặc WebP, dung lượng tối đa 2 MB." }, 400);

  const extension = extensions[parsed.data.contentType];
  const objectPath = `${owner.ownerId}/owner-advances-staging/${parsed.data.voucherId}/${randomUUID()}.${extension}`;
  let intentResult: Awaited<ReturnType<typeof owner.supabase.rpc>>;
  try {
    intentResult = await owner.supabase.rpc("owner_create_purchase_upload_intent", {
      p_voucher_id: parsed.data.voucherId,
      p_object_path: objectPath,
      p_mime_type: parsed.data.contentType,
      p_byte_size: parsed.data.size,
      p_file_name: sanitizeFileName(parsed.data.fileName),
      p_caption: sanitizeCaption(parsed.data.caption),
      p_reimbursement_id: parsed.data.reimbursementId ?? null,
    });
  } catch {
    return response({ error: "Chưa tạo được phiên tải ảnh. Hãy thử lại." }, 503);
  }
  const { data: intentId, error: intentError } = intentResult;
  if (intentError || !z.uuid().safeParse(intentId).success) {
    return response({ error: "Không tạo được phiên tải ảnh. Kiểm tra phiếu mua rồi thử lại." }, 400);
  }

  let uploadUrl: string | null;
  try {
    uploadUrl = await createR2UploadUrl(objectPath, parsed.data.contentType, parsed.data.size);
  } catch {
    try {
      await owner.supabase.rpc("owner_expire_purchase_upload_intent", { p_upload_intent_id: intentId });
    } catch {
      // The intent remains owner-scoped and will be collected after its grace period.
    }
    return response({ error: "Chưa tạo được liên kết tải ảnh. Hãy thử lại." }, 503);
  }

  if (!uploadUrl) {
    try {
      await owner.supabase.rpc("owner_expire_purchase_upload_intent", { p_upload_intent_id: intentId });
    } catch {
      // The intent remains owner-scoped and will be collected after its grace period.
    }
    return response({ error: "Kho ảnh riêng tư chưa sẵn sàng." }, 503);
  }

  return response({
    uploadIntentId: intentId,
    uploadUrl,
    requiredHeaders: { "Content-Type": parsed.data.contentType },
    expiresInSeconds: 120,
  });
}
