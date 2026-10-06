import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { formatVnd } from "@/lib/finance/format";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import type { RecipeCostCalculation, RecipeCostDocument } from "@/lib/recipe-cost/types";

export const dynamic = "force-dynamic";

type SnapshotRow = {
  id: string;
  revision: number;
  captured_at: string;
  captured_by: string;
  reason: string;
  document: unknown;
  calculation: unknown;
};

function capturedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(date) : "Thời điểm không xác định";
}

function historicalAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? formatVnd(amount) : "—";
}

export default async function RecipeCostHistoryPage() {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");
  const { data, error } = await owner.supabase.from("recipe_cost_snapshots")
    .select("id,revision,captured_at,captured_by,reason,document,calculation")
    .eq("owner_id", owner.ownerId).order("revision", { ascending: false }).limit(100);
  if (error) return <section className="surface recipe-cost-error"><h1>Chưa tải được lịch sử</h1><p>Hãy thử tải lại trang.</p></section>;
  const snapshots = (data ?? []) as SnapshotRow[];

  return <>
    <div className="page-heading"><div><p className="eyebrow">LỊCH SỬ GIÁ VỐN</p><h1>Các phiên bản đã lưu</h1><p>Giá nguyên liệu, công thức và cost của từng lần lưu được giữ riêng tại đây.</p></div><Link className="button button-secondary" href="/product-costs">Quay lại workspace</Link></div>
    {snapshots.length === 0 ? <section className="surface recipe-empty"><strong>Chưa có phiên bản lịch sử</strong><p>Lưu workspace giá vốn lần đầu để bắt đầu ghi nhận lịch sử.</p><Link className="button" href="/product-costs">Mở workspace</Link></section> : <div className="recipe-history-list">
      {snapshots.map((snapshot) => {
        const parsedDocument = recipeCostDocumentSchema.safeParse(snapshot.document);
        const document = parsedDocument.success ? parsedDocument.data as RecipeCostDocument : null;
        const calculation = snapshot.calculation as RecipeCostCalculation | null;
        return <details className="surface recipe-history-item" key={snapshot.id}>
          <summary><span className="recipe-history-revision">Phiên bản {snapshot.revision}</span><span className="recipe-history-reason">{snapshot.reason}</span><time>{capturedAt(snapshot.captured_at)}</time><span className="recipe-history-toggle">Mở chi tiết</span></summary>
          {document ? <div className="recipe-history-detail">
            <p className="form-note">Lưu bởi {snapshot.captured_by === owner.ownerId ? owner.email ?? "chủ cửa hàng" : "tài khoản owner"}. Phiên bản cũ được giữ nguyên, không tính lại theo giá hiện tại.</p>
            <div className="recipe-history-columns">
              <section><h3>Nguyên liệu ({document.ingredients.length})</h3>{document.ingredients.length ? <ul>{document.ingredients.map((item) => <li key={item.id}><span>{item.name}<small>{item.purchaseQuantity} {item.purchaseUnit} · {item.costUnit}</small></span><strong>{historicalAmount(item.purchasePriceVnd)}</strong></li>)}</ul> : <p className="form-note">Chưa có nguyên liệu.</p>}</section>
              <section><h3>Cốt / bán thành phẩm ({document.batches.length})</h3>{document.batches.length ? <ul>{document.batches.map((item) => <li key={item.id}><span>{item.name}<small>{item.outputQuantity} {item.outputUnit}</small></span><strong>{historicalAmount(calculation?.batches?.[item.id]?.totalCostVnd)}</strong></li>)}</ul> : <p className="form-note">Chưa có cốt.</p>}</section>
              <section><h3>Món & size ({document.products.length})</h3>{document.products.length ? <ul>{document.products.map((product) => <li className="recipe-history-product" key={product.id}><span>{product.name}{product.variants.map((variant) => <small key={variant.size}>{variant.size} · Cost {historicalAmount(calculation?.products?.[product.id]?.variants[variant.size]?.totalCostVnd)} · Bán {historicalAmount(variant.salePriceVnd)}</small>)}</span></li>)}</ul> : <p className="form-note">Chưa có món.</p>}</section>
            </div>
            {document.importReview?.importedFiles.length ? <div className="recipe-history-import"><h3>Workbook đã nhập</h3><ul>{document.importReview.importedFiles.map((file) => <li key={file.sha256}><span>{file.filename}<small>{file.sha256.slice(0, 16)}… · {file.ingredientCount} nguyên liệu được nhập</small></span><strong>{document.importReview?.complete ? "Đã đối soát" : `${document.importReview?.items.filter((item) => item.required).length ?? 0} mục chờ`}</strong></li>)}</ul></div> : null}
          </div> : <div className="recipe-history-detail"><p className="form-error">Snapshot có dữ liệu cũ không đúng cấu trúc hiển thị hiện tại.</p></div>}
        </details>;
      })}
    </div>}
  </>;
}
