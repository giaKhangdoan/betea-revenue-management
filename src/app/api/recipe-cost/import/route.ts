import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { calculateRecipeCosts, RecipeCostError } from "@/lib/recipe-cost/calculate";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import { mergeCogsWorkbookImport, parseCogsWorkbook, reviewCogsPreviewAgainstWorkspace } from "@/lib/recipe-cost/workbook-import";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;
const revisionSchema = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);
const sha256Schema = z.string().regex(/^[a-f\d]{64}$/i);

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0" } });
}

function isFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" && "arrayBuffer" in value && "size" in value && "name" in value);
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new ArrayBuffer(totalBytes);
  const output = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== new URL(request.url).origin) return response({ error: "Yêu cầu không hợp lệ." }, 403);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return response({ error: "Yêu cầu vượt giới hạn tải file 4 MB." }, 413);

  const owner = await requireOwnerClient();
  if (!owner) return response({ error: "Chỉ chủ cửa hàng được nhập workbook giá vốn." }, 403);

  let boundedBody: ArrayBuffer | null;
  try {
    boundedBody = await readBoundedBody(request, MAX_REQUEST_BYTES);
  } catch {
    return response({ error: "Không đọc được nội dung tải lên." }, 400);
  }
  if (!boundedBody) return response({ error: "Yêu cầu vượt giới hạn tải file 4 MB." }, 413);
  const boundedHeaders = new Headers(request.headers);
  boundedHeaders.delete("content-length");
  let form: FormData;
  try {
    form = await new Request(request.url, { method: "POST", headers: boundedHeaders, body: boundedBody }).formData();
  } catch {
    return response({ error: "Không đọc được tệp tải lên." }, 400);
  }
  const mode = form.get("mode");
  if (mode !== "preview" && mode !== "confirm") return response({ error: "Chọn xem trước hoặc xác nhận nhập." }, 400);
  const file = form.get("file");
  if (!isFile(file) || !file.name.toLocaleLowerCase("vi-VN").endsWith(".xlsx") || file.name.length > 240) {
    return response({ error: "Chọn một tệp .xlsx hợp lệ." }, 400);
  }
  if (file.size < 4 || file.size > MAX_UPLOAD_BYTES) return response({ error: "Tệp phải nhỏ hơn 4 MB." }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return response({ error: "Tệp không có định dạng XLSX hợp lệ." }, 400);

  let preview;
  try {
    preview = await parseCogsWorkbook(file.name, bytes);
  } catch (error) {
    if (error instanceof RangeError) return response({ error: error.message }, 400);
    return response({ error: "Không đọc được workbook. Hãy kiểm tra cấu trúc và thử tải lại tệp." }, 400);
  }

  if (mode === "preview") {
    const { data: current, error: readError } = await owner.supabase
      .from("recipe_cost_workspace")
      .select("revision,document")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();
    if (readError) return response({ error: "Chưa kiểm tra được nguyên liệu hiện có. Hãy thử lại." }, 503);

    let existing: RecipeCostDocument = { unitConversions: [], ingredients: [], batches: [], products: [] };
    if (current?.document) {
      const existingResult = recipeCostDocumentSchema.safeParse(current.document);
      if (!existingResult.success) return response({ error: "Workspace hiện tại cần được kiểm tra trước khi đối soát workbook." }, 409);
      existing = existingResult.data as RecipeCostDocument;
    }
    const workspacePreview = reviewCogsPreviewAgainstWorkspace(preview, existing);
    return response({ preview: workspacePreview, workspaceRevision: current?.revision ?? 0 });
  }

  const expectedRevision = revisionSchema.safeParse(form.get("expectedRevision"));
  const expectedHash = sha256Schema.safeParse(form.get("expectedHash"));
  const effectiveDate = z.iso.date().safeParse(form.get("effectiveDate"));
  if (!expectedRevision.success || expectedRevision.data < 0) return response({ error: "Phiên bản workspace không hợp lệ. Tải lại trang trước khi nhập." }, 400);
  if (!expectedHash.success || expectedHash.data.toLowerCase() !== preview.sha256) return response({ error: "Tệp đã thay đổi sau khi xem trước. Hãy tạo bản xem trước mới." }, 409);
  if (!effectiveDate.success) return response({ error: "Chọn ngày hiệu lực hợp lệ cho giá nhập." }, 400);

  const { data: current, error: readError } = await owner.supabase
    .from("recipe_cost_workspace")
    .select("revision,document")
    .eq("owner_id", owner.ownerId)
    .maybeSingle();
  if (readError) return response({ error: "Chưa kiểm tra được phiên bản workspace. Hãy thử lại." }, 503);
  const actualRevision = current?.revision ?? 0;
  if (actualRevision !== expectedRevision.data) return response({ error: "Workspace đã đổi từ lần xem trước. Tải lại trang rồi tạo preview mới." }, 409);

  let existing: RecipeCostDocument = { unitConversions: [], ingredients: [], batches: [], products: [] };
  if (current?.document) {
    const existingResult = recipeCostDocumentSchema.safeParse(current.document);
    if (!existingResult.success) return response({ error: "Workspace hiện tại cần được kiểm tra trước khi nhập để tránh ghi đè dữ liệu." }, 409);
    existing = existingResult.data as RecipeCostDocument;
  }

  let document: RecipeCostDocument;
  try {
    document = mergeCogsWorkbookImport(existing, preview, new Date().toISOString(), effectiveDate.data);
  } catch (error) {
    if (error instanceof RangeError) return response({ error: error.message }, 409);
    return response({ error: "Chưa ghép được workbook vào workspace hiện tại." }, 409);
  }
  const validated = recipeCostDocumentSchema.safeParse(document);
  if (!validated.success) return response({ error: "Kết quả import vượt giới hạn hoặc thiếu dữ liệu bắt buộc." }, 422);

  let calculation;
  try {
    calculation = calculateRecipeCosts(validated.data as RecipeCostDocument);
  } catch (error) {
    if (error instanceof RecipeCostError) return response({ error: `Import chưa được lưu vì phép tính không hợp lệ: ${error.message}` }, 422);
    return response({ error: "Không tính được workspace sau import; chưa có dữ liệu nào được lưu." }, 422);
  }

  const { data: nextRevision, error: saveError } = await owner.supabase.rpc("owner_save_recipe_cost_workspace", {
    p_expected_revision: expectedRevision.data,
    p_document: validated.data,
    p_calculation: calculation,
    p_reason: `Nhập workbook COGS: ${file.name.slice(0, 200)}`,
  });
  if (saveError) {
    if (saveError.code === "40001") return response({ error: "Workspace vừa được sửa ở nơi khác. Tải lại và xem trước lại workbook." }, 409);
    return response({ error: "Chưa lưu được workbook. Hãy thử lại; dữ liệu hiện tại vẫn được giữ nguyên." }, 503);
  }
  if (typeof nextRevision !== "number" || !Number.isSafeInteger(nextRevision)) return response({ error: "Chưa xác nhận được phiên bản mới sau khi lưu." }, 503);

  revalidatePath("/product-costs");
  revalidatePath("/product-costs/history");
  const importedCount = document.ingredients.length - existing.ingredients.length;
  return response({
    success: true,
    revision: nextRevision,
    importedIngredients: importedCount,
    unresolvedCount: document.importReview?.items.length ?? 0,
    complete: document.importReview?.complete ?? false,
  });
}
