"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";
import { buildStaffSopProjection, sopDocumentSchema, type SopDocument } from "@/lib/sop/schema";

export type SopActionState = { error?: string; success?: string; revision?: number; savedRecipeRevision?: number };

const revisionField = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);
const reasonField = z.string().trim().min(1).max(500);

function rpcErrorMessage(message: string | undefined, fallback: string) {
  if (message?.includes("40001")) return "Dữ liệu đã thay đổi ở nơi khác. Hãy tải lại trang, kiểm tra rồi thử lại.";
  return fallback;
}

export async function saveSopDraft(_state: SopActionState | undefined, formData: FormData): Promise<SopActionState> {
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng được chỉnh sửa SOP." };

  const expectedRevision = revisionField.safeParse(formData.get("expected_revision"));
  const expectedRecipeRevision = revisionField.safeParse(formData.get("expected_recipe_revision"));
  if (!expectedRevision.success || !expectedRecipeRevision.success) {
    return { error: "Thông tin lưu SOP không hợp lệ. Tải lại trang rồi thử lại." };
  }

  const [{ data: recipeRow, error: recipeError }, { data: sopRow, error: sopError }] = await Promise.all([
    owner.supabase.from("recipe_cost_workspace").select("revision").eq("owner_id", owner.ownerId).maybeSingle(),
    owner.supabase.from("owner_sop_workspace").select("revision,recipe_revision").eq("owner_id", owner.ownerId).maybeSingle(),
  ]);
  if (recipeError || sopError) return { error: "Chưa xác minh được phiên bản công thức hoặc SOP. Hãy thử lại." };
  const savedRecipeRevision = sopRow?.recipe_revision ?? 0;
  if ((recipeRow?.revision ?? 0) !== expectedRecipeRevision.data) return { error: "Công thức đã thay đổi. Tải lại, kiểm tra định lượng rồi lưu SOP lại.", revision: expectedRevision.data, savedRecipeRevision };
  if ((sopRow?.revision ?? 0) !== expectedRevision.data) return { error: "Bản SOP đã thay đổi. Tải lại trang trước khi lưu để tránh ghi đè.", revision: expectedRevision.data, savedRecipeRevision };

  const reason = reasonField.safeParse(formData.get("reason"));
  const serialized = formData.get("document");
  if (!reason.success || typeof serialized !== "string" || serialized.length > 4_500_000) {
    return { error: "Thông tin lưu SOP không hợp lệ. Tải lại trang rồi thử lại.", revision: expectedRevision.data, savedRecipeRevision };
  }
  let unknownDocument: unknown;
  try { unknownDocument = JSON.parse(serialized); }
  catch { return { error: "Nội dung SOP không phải JSON hợp lệ.", revision: expectedRevision.data, savedRecipeRevision }; }
  const parsed = sopDocumentSchema.safeParse(unknownDocument);
  if (!parsed.success) return { error: "Nội dung SOP không hợp lệ. Kiểm tra món, size và các bước pha.", revision: expectedRevision.data, savedRecipeRevision };
  const document = parsed.data as SopDocument;

  const { data, error } = await owner.supabase.rpc("owner_save_sop_workspace", {
    p_expected_revision: expectedRevision.data,
    p_expected_recipe_revision: expectedRecipeRevision.data,
    p_document: document,
    p_reason: reason.data,
  });
  if (error) return { error: rpcErrorMessage(error.message, "Chưa lưu được bản nháp SOP. Hãy thử lại."), revision: expectedRevision.data, savedRecipeRevision };
  if (typeof data !== "number" || !Number.isSafeInteger(data)) return { error: "Đã gửi lưu nhưng chưa xác nhận được phiên bản SOP mới. Tải lại trang.", revision: expectedRevision.data, savedRecipeRevision };

  revalidatePath("/sop");
  revalidatePath("/staff/sop");
  return { success: "Đã lưu bản nháp SOP.", revision: data, savedRecipeRevision: expectedRecipeRevision.data };
}

export async function publishStaffSop(_state: SopActionState | undefined, formData: FormData): Promise<SopActionState> {
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Chỉ chủ cửa hàng được công bố SOP cho nhân viên." };

  const expectedRevision = revisionField.safeParse(formData.get("expected_revision"));
  const expectedRecipeRevision = revisionField.safeParse(formData.get("expected_recipe_revision"));
  if (!expectedRevision.success || expectedRevision.data < 1 || !expectedRecipeRevision.success) {
    return { error: "Phiên bản SOP không hợp lệ. Tải lại trang rồi thử lại." };
  }

  const [{ data: sopRow, error: sopError }, { data: recipeRow, error: recipeError }] = await Promise.all([
    owner.supabase.from("owner_sop_workspace").select("revision,recipe_revision,document").eq("owner_id", owner.ownerId).maybeSingle(),
    owner.supabase.from("recipe_cost_workspace").select("revision,document").eq("owner_id", owner.ownerId).maybeSingle(),
  ]);
  if (sopError || recipeError) return { error: "Chưa tải được SOP và công thức hiện tại. Chưa có gì được công bố." };
  if (!sopRow || !recipeRow || sopRow.revision !== expectedRevision.data
    || recipeRow.revision !== expectedRecipeRevision.data || sopRow.recipe_revision !== recipeRow.revision) {
    return { error: "Công thức đã thay đổi hoặc SOP chưa gắn với phiên bản mới nhất. Tải lại, lưu và kiểm tra lại trước khi công bố." };
  }

  const sop = sopDocumentSchema.safeParse(sopRow.document);
  const recipe = recipeCostDocumentSchema.safeParse(recipeRow.document);
  if (!sop.success || !recipe.success) return { error: "Dữ liệu SOP hoặc công thức cần được kiểm tra trước khi công bố." };

  let staffDocument;
  try { staffDocument = buildStaffSopProjection(sop.data, recipe.data as RecipeCostDocument); }
  catch (error) { return { error: error instanceof Error ? error.message : "SOP chưa sẵn sàng để công bố." }; }

  const { data, error } = await owner.supabase.rpc("owner_publish_staff_sop", {
    p_expected_revision: expectedRevision.data,
    p_expected_recipe_revision: expectedRecipeRevision.data,
    p_staff_document: staffDocument,
  });
  if (error) return { error: rpcErrorMessage(error.message, "Chưa công bố được SOP. Kiểm tra lại bản nháp rồi thử lại.") };
  if (typeof data !== "number" || !Number.isSafeInteger(data)) return { error: "Đã gửi công bố nhưng chưa xác nhận được phiên bản nhân viên. Tải lại trang." };

  revalidatePath("/sop");
  revalidatePath("/staff/sop");
  return { success: "Đã công bố SOP an toàn cho nhân viên.", revision: data };
}
