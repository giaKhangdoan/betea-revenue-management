import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentBusinessDate } from "@/lib/finance/format";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { requireStaff } from "@/lib/auth/require-staff";
import { createR2UploadUrl } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const evidenceDate = z.iso.date().refine((date) => date >= "2026-09-01");
const uploadSchema = z.object({
  date: evidenceDate,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(2 * 1024 * 1024),
  objectPath: z.string().max(360).optional(),
});

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return response({ error: "Yêu cầu tải ảnh không hợp lệ." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Thông tin ảnh chưa hợp lệ." }, 400);
  }
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) return response({ error: "Ảnh phải là JPEG, PNG hoặc WebP và không quá 2 MB." }, 400);

  const owner = await requireOwnerClient();
  const staff = owner ? null : await requireStaff();
  if (!owner && !staff) return response({ error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." }, 401);

  const ownerId = owner?.ownerId ?? staff?.ownerId;
  if (!ownerId) return response({ error: "Không xác định được cửa hàng." }, 403);
  if (staff && parsed.data.date !== currentBusinessDate()) {
    return response({ error: "Nhân viên chỉ được tải ảnh cho ngày hiện tại." }, 403);
  }

  const extension = extensions[parsed.data.contentType];
  const expectedPrefix = `${ownerId}/${parsed.data.date}/`;
  const objectPath = parsed.data.objectPath ?? `${expectedPrefix}${randomUUID()}.${extension}`;
  const isValidPath = objectPath.startsWith(expectedPrefix)
    && new RegExp(`^${ownerId}/${parsed.data.date}/[0-9a-f-]{36}\\.${extension}$`, "i").test(objectPath);
  if (!isValidPath) return response({ error: "Đường dẫn ảnh không hợp lệ." }, 400);

  const uploadUrl = await createR2UploadUrl(objectPath, parsed.data.contentType, parsed.data.size);
  if (!uploadUrl) return response({ error: "Kho ảnh R2 chưa được cấu hình trên máy chủ." }, 503);

  return response({ objectPath, uploadUrl, contentType: parsed.data.contentType });
}
