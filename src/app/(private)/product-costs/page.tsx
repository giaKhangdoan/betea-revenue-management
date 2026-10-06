import Link from "next/link";
import { redirect } from "next/navigation";
import { RecipeCostWorkspace } from "@/components/recipe-cost/recipe-cost-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { currentBusinessDate } from "@/lib/finance/format";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";

export const dynamic = "force-dynamic";

export default async function ProductCostsPage() {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");
  const { data, error } = await owner.supabase.from("recipe_cost_workspace")
    .select("revision,document").eq("owner_id", owner.ownerId).maybeSingle();
  if (error) return <section className="surface recipe-cost-error"><h1>Chưa tải được workspace giá vốn</h1><p>Hãy tải lại trang sau ít phút. Dữ liệu hiện tại chưa bị thay đổi.</p></section>;

  let document: RecipeCostDocument | null = null;
  let documentError = false;
  if (data?.document) {
    const parsed = recipeCostDocumentSchema.safeParse(data.document);
    if (parsed.success) document = parsed.data as RecipeCostDocument;
    else documentError = true;
  }
  if (documentError) return <section className="surface recipe-cost-error"><h1>Workspace cần được kiểm tra</h1><p>Dữ liệu lưu hiện không đúng cấu trúc mới. Mình đã chặn thao tác lưu để tránh ghi đè.</p><Link className="text-link" href="/product-costs/history">Mở lịch sử để kiểm tra phiên bản gần nhất</Link></section>;

  return <>
    <div className="page-heading"><div><p className="eyebrow">GIÁ VỐN CÔNG THỨC</p><h1>Nguyên liệu và cost món</h1><p>Quản lý giá nhập, cost mẻ cốt và công thức bán theo size. Tách riêng COGS tổng tháng từ máy POS.</p></div><Link className="button button-secondary" href="/product-costs/history">Lịch sử giá vốn</Link></div>
    <RecipeCostWorkspace key={data?.revision ?? 0} initialDocument={document} initialRevision={data?.revision ?? 0} effectiveDate={currentBusinessDate()} />
  </>;
}
