import { requireStaff } from "@/lib/auth/require-staff";
import { staffSopPublicationSchema } from "@/lib/sop/schema";

export const dynamic = "force-dynamic";

export default async function StaffSopPage() {
  const staff = await requireStaff();
  if (!staff) return null;

  const { data, error } = await staff.supabase.from("staff_sop_publications")
    .select("revision,recipe_revision,published_at,document")
    .eq("owner_id", staff.ownerId).maybeSingle();
  if (error) return <section className="surface staff-sop-empty"><h1>Chưa tải được hướng dẫn</h1><p>Hãy tải lại trang sau ít phút.</p></section>;
  if (!data) return <section className="surface staff-sop-empty"><p className="eyebrow">HƯỚNG DẪN PHA CHẾ</p><h1>Chưa có SOP được công bố</h1><p>Chủ cửa hàng sẽ cập nhật hướng dẫn tại đây khi sẵn sàng.</p></section>;

  const publication = staffSopPublicationSchema.safeParse(data.document);
  if (!publication.success) return <section className="surface staff-sop-empty"><h1>Hướng dẫn cần được cập nhật</h1><p>Bản SOP hiện không đúng định dạng an toàn. Báo chủ cửa hàng kiểm tra và công bố lại.</p></section>;

  return <>
    <div className="page-heading staff-page-heading"><div><p className="eyebrow">HƯỚNG DẪN PHA CHẾ</p><h1>SOP cửa hàng</h1><p>Bản {data.revision} · Cập nhật {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(data.published_at))}</p></div></div>
    <div className="staff-sop-products">{publication.data.products.map((product, productIndex) => <section className="surface staff-sop-product" key={`${product.name}-${productIndex}`}>
      <div className="staff-sop-product-heading"><h2>{product.name}</h2><span>{product.variants.length} size</span></div>
      {product.variants.map((variant) => <article className="staff-sop-variant" key={`${product.name}-${variant.size}`}>
        <div className="staff-sop-size-heading"><h3>Size {variant.size}</h3><span>{variant.sizeOz} oz</span></div>
        <div className="staff-sop-block"><h4>Định lượng</h4>{variant.components.length ? <ul className="staff-sop-ingredients">{variant.components.map((component, index) => <li key={`${component.name}-${index}`}><span>{component.name}</span><strong>{component.quantity} {component.unit}</strong></li>)}</ul> : <p className="form-note">Không có thành phần định lượng.</p>}</div>
        <div className="staff-sop-block"><h4>Các bước pha</h4><ol className="staff-sop-steps">{variant.steps.map((step, index) => <li key={`${step.title}-${index}`}><span className="staff-sop-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.instruction}</p></div></li>)}</ol></div>
        {variant.notes ? <p className="staff-sop-notes"><strong>Ghi chú:</strong> {variant.notes}</p> : null}
      </article>)}
    </section>)}</div>
  </>;
}
