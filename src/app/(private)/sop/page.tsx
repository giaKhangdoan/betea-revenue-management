import { redirect } from "next/navigation";
import { SopWorkspace } from "@/components/sop/sop-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";
import { sopDocumentSchema } from "@/lib/sop/schema";

export const dynamic = "force-dynamic";

const emptyRecipe: RecipeCostDocument = { unitConversions: [], ingredients: [], batches: [], products: [] };

export default async function SopPage() {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const [recipeResult, sopResult, publicationResult] = await Promise.all([
    owner.supabase.from("recipe_cost_workspace").select("revision,document").eq("owner_id", owner.ownerId).maybeSingle(),
    owner.supabase.from("owner_sop_workspace").select("revision,recipe_revision,document").eq("owner_id", owner.ownerId).maybeSingle(),
    owner.supabase.from("staff_sop_publications").select("revision,recipe_revision,published_at").eq("owner_id", owner.ownerId).maybeSingle(),
  ]);
  if (recipeResult.error || sopResult.error || publicationResult.error) return <section className="surface sop-load-error"><h1>Chưa tải được SOP</h1><p>Hãy tải lại trang sau ít phút. Dữ liệu chưa bị thay đổi.</p></section>;

  const parsedRecipe = recipeResult.data?.document ? recipeCostDocumentSchema.safeParse(recipeResult.data.document) : null;
  if (parsedRecipe && !parsedRecipe.success) return <section className="surface sop-load-error"><h1>Công thức cần được kiểm tra</h1><p>Đã chặn biên tập SOP để không công bố định lượng sai. Hãy kiểm tra workspace giá vốn trước.</p></section>;
  const recipe = (parsedRecipe?.success ? parsedRecipe.data : emptyRecipe) as RecipeCostDocument;
  const parsedSop = sopDocumentSchema.safeParse(sopResult.data?.document ?? { products: [] });
  if (!parsedSop.success) return <section className="surface sop-load-error"><h1>Bản nháp SOP cần được kiểm tra</h1><p>Dữ liệu SOP lưu hiện không đúng cấu trúc. Không thể sửa để tránh ghi đè lịch sử.</p></section>;

  return <>
    <div className="page-heading"><div><p className="eyebrow">HƯỚNG DẪN PHA CHẾ</p><h1>Biên tập SOP</h1><p>Tạo hướng dẫn theo từng món và size. Nhân viên chỉ thấy bản đã công bố, kèm định lượng và các bước pha.</p></div></div>
    <SopWorkspace
      key={`${sopResult.data?.revision ?? 0}-${recipeResult.data?.revision ?? 0}`}
      recipe={recipe}
      initialDocument={parsedSop.data}
      initialRevision={sopResult.data?.revision ?? 0}
      initialRecipeRevision={sopResult.data?.recipe_revision ?? 0}
      recipeRevision={recipeResult.data?.revision ?? 0}
      initialPublicationRevision={publicationResult.data?.revision ?? 0}
      publicationRecipeRevision={publicationResult.data?.recipe_revision ?? null}
      publishedAt={publicationResult.data?.published_at ?? null}
    />
  </>;
}
