"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { calculateRecipeCosts, RecipeCostError } from "@/lib/recipe-cost/calculate";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";

export type RecipeWorkspaceActionState = { error?: string; success?: string; revision?: number };

const revisionSchema = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);
const reasonSchema = z.string().trim().min(1).max(500);

export async function saveRecipeCostWorkspace(_state: RecipeWorkspaceActionState | undefined, formData: FormData): Promise<RecipeWorkspaceActionState> {
  const revision = revisionSchema.safeParse(formData.get("expected_revision"));
  const reason = reasonSchema.safeParse(formData.get("reason"));
  const serialized = formData.get("document");
  if (!revision.success || revision.data < 0) return { error: "Phiên bản workspace không hợp lệ; hãy tải lại trang." };
  if (!reason.success) return { error: "Nhập lý do lưu từ 1 đến 500 ký tự." };
  if (typeof serialized !== "string" || serialized.length > 4_500_000) return { error: "Dữ liệu workspace không hợp lệ hoặc vượt giới hạn." };
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng được quản lý giá vốn." };

  let unknownDocument: unknown;
  try {
    unknownDocument = JSON.parse(serialized);
  } catch {
    return { error: "Dữ liệu workspace không phải JSON hợp lệ." };
  }
  const parsed = recipeCostDocumentSchema.safeParse(unknownDocument);
  if (!parsed.success) return { error: "Dữ liệu workspace không hợp lệ. Kiểm tra lại tên, đơn vị và số liệu." };
  let document = parsed.data as RecipeCostDocument;

  const { data: current, error: readError } = await owner.supabase.from("recipe_cost_workspace")
    .select("revision,document").eq("owner_id", owner.ownerId).maybeSingle();
  if (readError) return { error: "Chưa xác minh được phiên bản workspace. Hãy thử lại." };
  if ((current?.revision ?? 0) !== revision.data) return { error: "Workspace đã đổi. Tải lại trang trước khi lưu để tránh ghi đè." };
  let currentReview: RecipeCostDocument["importReview"];
  if (current?.document) {
    const currentParsed = recipeCostDocumentSchema.safeParse(current.document);
    if (!currentParsed.success) return { error: "Workspace hiện tại cần được kiểm tra trước khi lưu." };
    currentReview = (currentParsed.data as RecipeCostDocument).importReview;
  }
  document = { ...document };
  if (currentReview) document.importReview = currentReview;
  else delete document.importReview;

  let calculation;
  try {
    calculation = calculateRecipeCosts(document);
  } catch (error) {
    if (error instanceof RecipeCostError) return { error: `Chưa lưu được giá vốn: ${error.message}` };
    return { error: "Chưa tính được giá vốn. Kiểm tra lại các công thức và đơn vị." };
  }

  const { data, error } = await owner.supabase.rpc("owner_save_recipe_cost_workspace", {
    p_expected_revision: revision.data,
    p_document: document,
    p_calculation: calculation,
    p_reason: reason.data,
  });
  if (error) {
    if (error.code === "40001") return { error: "Workspace vừa được cập nhật ở nơi khác. Tải lại để tránh ghi đè." };
    return { error: "Chưa lưu được workspace giá vốn. Hãy thử lại." };
  }
  if (typeof data !== "number" || !Number.isSafeInteger(data)) return { error: "Đã gửi lưu nhưng chưa xác nhận được phiên bản mới. Tải lại trước khi tiếp tục." };

  revalidatePath("/product-costs");
  revalidatePath("/product-costs/history");
  return { success: "Đã lưu workspace giá vốn.", revision: data };
}

export async function resolveWorkbookImportReviewItem(_state: RecipeWorkspaceActionState | undefined, formData: FormData): Promise<RecipeWorkspaceActionState> {
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng được đối soát workbook giá vốn." };

  const itemId = z.string().min(1).max(200).safeParse(formData.get("item_id"));
  const revision = revisionSchema.safeParse(formData.get("expected_revision"));
  const note = z.string().trim().min(5).max(500).safeParse(formData.get("resolution_note"));
  if (!itemId.success || !revision.success || revision.data < 0 || !note.success) {
    return { error: "Chọn mục cần đối soát, nhập ghi chú từ 5 đến 500 ký tự và tải lại dữ liệu nếu cần." };
  }

  const { data: current, error: readError } = await owner.supabase.from("recipe_cost_workspace")
    .select("revision,document").eq("owner_id", owner.ownerId).maybeSingle();
  if (readError) return { error: "Chưa tải được danh sách đối soát. Hãy thử lại." };
  const actualRevision = current?.revision ?? 0;
  if (actualRevision !== revision.data) return { error: "Workspace đã đổi. Tải lại trang trước khi đối soát mục này." };
  if (!current?.document) return { error: "Chưa có workbook đã nhập để đối soát." };

  const parsed = recipeCostDocumentSchema.safeParse(current.document);
  if (!parsed.success) return { error: "Workspace hiện tại cần được kiểm tra trước khi đối soát." };
  const document = parsed.data as RecipeCostDocument;
  const importReview = document.importReview;
  if (!importReview) return { error: "Chưa có mục workbook nào cần đối soát." };
  const item = importReview.items.find((candidate) => candidate.id === itemId.data);
  if (!item || !item.required) return { error: "Mục đối soát không tồn tại hoặc đã được xử lý." };

  const items = importReview.items.map((candidate) => candidate.id === item.id
    ? { ...candidate, required: false, resolutionNote: note.data, resolvedAt: new Date().toISOString(), resolvedBy: owner.ownerId }
    : candidate);
  const updated: RecipeCostDocument = { ...document, importReview: { ...importReview, items, complete: items.every((candidate) => !candidate.required) } };

  let calculation;
  try {
    calculation = calculateRecipeCosts(updated);
  } catch (error) {
    if (error instanceof RecipeCostError) return { error: `Chưa cập nhật được đối soát: ${error.message}` };
    return { error: "Chưa tính lại được workspace. Dữ liệu hiện tại vẫn được giữ nguyên." };
  }
  const { data, error } = await owner.supabase.rpc("owner_save_recipe_cost_workspace", {
    p_expected_revision: revision.data,
    p_document: updated,
    p_calculation: calculation,
    p_reason: `Đối soát ${item.sourceCell}: ${note.data}`.slice(0, 500),
  });
  if (error) {
    if (error.code === "40001") return { error: "Workspace vừa được sửa ở nơi khác. Tải lại trước khi tiếp tục." };
    return { error: "Chưa lưu được kết quả đối soát. Hãy thử lại." };
  }
  if (typeof data !== "number" || !Number.isSafeInteger(data)) return { error: "Chưa xác nhận được phiên bản sau đối soát. Tải lại trang." };

  revalidatePath("/product-costs");
  revalidatePath("/product-costs/history");
  return { success: "Đã ghi nhận cách xử lý mục đối soát.", revision: data };
}
