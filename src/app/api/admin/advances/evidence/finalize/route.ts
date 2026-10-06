import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { deleteR2Object, headR2Object, isR2StorageConfigured, sealR2Object } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const finalizeSchema = z.object({ uploadIntentId: z.uuid() });

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function expireAndDelete(
  owner: NonNullable<Awaited<ReturnType<typeof requireOwnerClient>>>,
  uploadIntentId: string,
  sealedObjectPath: string,
) {
  try {
    const { data: objectPath, error } = await owner.supabase.rpc("owner_expire_purchase_upload_intent", {
      p_upload_intent_id: uploadIntentId,
    });
    if (!error && typeof objectPath === "string") {
      try {
        await deleteR2Object(objectPath);
        await deleteR2Object(sealedObjectPath);
      } catch {
        // Leave the expired intent for the retryable orphan cleanup route.
      }
    }
  } catch {
    // A later owner cleanup can recover an expired intent without risking an attached image.
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return response({ error: "Yêu cầu hoàn tất tải ảnh không hợp lệ." }, 403);

  const owner = await requireOwnerClient();
  if (!owner) return response({ error: "Chỉ chủ cửa hàng được hoàn tất ảnh chứng từ." }, 403);
  if (!isR2StorageConfigured()) return response({ error: "Kho ảnh riêng tư chưa được cấu hình." }, 503);

  const parsedBody = await readBoundedJson(request, 4096);
  if (!parsedBody.ok) return response({ error: "Thông tin hoàn tất ảnh chưa hợp lệ." }, parsedBody.reason === "too-large" ? 413 : 400);
  const parsed = finalizeSchema.safeParse(parsedBody.value);
  if (!parsed.success) return response({ error: "Phiên tải ảnh chưa hợp lệ." }, 400);

  const { data: intent, error: intentError } = await owner.supabase
    .from("owner_purchase_upload_intents")
    .select("id, voucher_id, object_path, sealed_object_path, mime_type, byte_size, status, expires_at")
    .eq("owner_id", owner.ownerId)
    .eq("id", parsed.data.uploadIntentId)
    .maybeSingle();
  if (intentError) return response({ error: "Chưa đọc được phiên tải ảnh. Hãy thử lại." }, 503);
  if (!intent) return response({ error: "Không tìm thấy phiên tải ảnh." }, 404);

  if (intent.status === "attached") {
    const { data: evidence, error: evidenceError } = await owner.supabase
      .from("owner_purchase_evidence")
      .select("id")
      .eq("owner_id", owner.ownerId)
      .eq("upload_intent_id", intent.id)
      .maybeSingle();
    if (evidenceError) return response({ error: "Ảnh đã lưu nhưng chưa đọc lại được. Hãy tải lại." }, 503);
    if (!evidence) return response({ error: "Thông tin ảnh đã lưu cần được kiểm tra." }, 409);
    return response({ evidenceId: evidence.id, alreadyFinalized: true });
  }

  if (intent.status !== "pending" && intent.status !== "uploaded") {
    await expireAndDelete(owner, intent.id, intent.sealed_object_path);
    return response({ error: "Phiên tải ảnh đã hết hạn. Hãy tải ảnh lại." }, 410);
  }
  if (Date.parse(intent.expires_at) <= Date.now()) {
    await expireAndDelete(owner, intent.id, intent.sealed_object_path);
    return response({ error: "Phiên tải ảnh đã hết hạn. Hãy tải ảnh lại." }, 410);
  }

  let storedObject;
  try {
    storedObject = await headR2Object(intent.object_path);
  } catch {
    return response({ error: "Chưa xác minh được ảnh trong kho. Hãy thử lại sau." }, 503);
  }

  if (!storedObject) {
    await expireAndDelete(owner, intent.id, intent.sealed_object_path);
    return response({ error: "Chưa thấy ảnh được tải lên. Hãy tải lại ảnh rồi hoàn tất." }, 409);
  }
  if (storedObject.contentLength !== intent.byte_size || storedObject.contentType !== intent.mime_type) {
    await expireAndDelete(owner, intent.id, intent.sealed_object_path);
    return response({ error: "Ảnh tải lên không khớp định dạng hoặc dung lượng đã chọn." }, 422);
  }

  try {
    await sealR2Object(intent.object_path, intent.sealed_object_path, intent.mime_type, intent.byte_size);
  } catch {
    // Keep the pending intent for an idempotent retry; cleanup removes both keys if it expires.
    return response({ error: "Chưa khóa được ảnh chứng từ. Hãy thử hoàn tất lại sau." }, 503);
  }

  let finalized: { data: unknown; error: { code?: string } | null };
  try {
    finalized = await owner.supabase.rpc("owner_finalize_purchase_upload", {
      p_upload_intent_id: intent.id,
    });
  } catch {
    // A lost response is ambiguous: keep the object and let an idempotent retry resolve it.
    return response({ error: "Chưa nhận được xác nhận lưu ảnh. Hãy tải lại danh sách trước khi thử lại." }, 503);
  }

  if (finalized.error) {
    await expireAndDelete(owner, intent.id, intent.sealed_object_path);
    const status = finalized.error.code === "22023" ? 409 : 503;
    return response({ error: status === 409 ? "Phiên ảnh không còn hợp lệ. Hãy tải ảnh lại." : "Chưa lưu được ảnh chứng từ. Hãy thử lại." }, status);
  }
  if (!z.uuid().safeParse(finalized.data).success) {
    // The RPC may have committed even if its response payload was malformed. Do not delete evidence.
    return response({ error: "Ảnh có thể đã lưu; hãy tải lại danh sách trước khi tải thêm." }, 503);
  }

  try {
    // The upload URL only targets the staging key and can be replayed briefly;
    // a delayed cleanup removes any staging copy recreated during that window.
    await deleteR2Object(intent.object_path);
  } catch {
    // Attached evidence points to the sealed key; cleanup will retry the staging delete.
  }

  return response({ evidenceId: finalized.data, alreadyFinalized: false });
}
