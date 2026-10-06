import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { deleteR2Object, isR2StorageConfigured } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function isOwnedObjectKey(value: unknown, ownerId: string, namespace: "owner-advances" | "owner-advances-staging"): value is string {
  if (typeof value !== "string") return false;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(`^${ownerId}/${namespace}/${uuid}/${uuid}\\.(jpg|png|webp)$`, "i").test(value);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return response({ error: "Yêu cầu dọn ảnh không hợp lệ." }, 403);

  const owner = await requireOwnerClient();
  if (!owner) return response({ error: "Chỉ chủ cửa hàng được dọn ảnh chứng từ." }, 403);
  if (!isR2StorageConfigured()) return response({ error: "Kho ảnh riêng tư chưa được cấu hình." }, 503);

  const { data: claims, error: claimError } = await owner.supabase.rpc("owner_claim_expired_purchase_uploads");
  if (claimError || !Array.isArray(claims)) return response({ error: "Chưa lấy được danh sách ảnh cần dọn." }, 503);

  let deleted = 0;
  let failed = 0;
  for (const claim of claims) {
    const uploadIntentId = z.uuid().safeParse(claim?.upload_intent_id);
    const isAttached = claim?.attached === true;
    if (
      !uploadIntentId.success
      || typeof claim?.attached !== "boolean"
      || !isOwnedObjectKey(claim?.object_path, owner.ownerId, "owner-advances-staging")
      || !isOwnedObjectKey(claim?.sealed_object_path, owner.ownerId, "owner-advances")
    ) {
      failed += 1;
      continue;
    }

    try {
      await deleteR2Object(claim.object_path);
      if (!isAttached) await deleteR2Object(claim.sealed_object_path);
      const { data: markedDeleted, error: markError } = await owner.supabase.rpc("owner_mark_expired_purchase_upload_deleted", {
        p_upload_intent_id: uploadIntentId.data,
      });
      if (markError || markedDeleted !== true) {
        failed += 1;
        continue;
      }
      deleted += 1;
    } catch {
      // The lease expires and a later cleanup run safely retries this idempotent delete.
      failed += 1;
    }
  }

  return response({
    claimed: claims.length,
    deleted,
    failed,
    hasMore: claims.length === 100,
    retryAfterSeconds: failed > 0 ? 600 : null,
  });
}
