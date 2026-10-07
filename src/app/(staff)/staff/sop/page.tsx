import { requireStaff } from "@/lib/auth/require-staff";
import { staffSopPublicationSchema } from "@/lib/sop/schema";

export const dynamic = "force-dynamic";

type PublishedProduct = ReturnType<typeof staffSopPublicationSchema.parse>["products"][number];

function ingredientRows(product: PublishedProduct) {
  const rows = new Map<string, { name: string; unit: string; quantities: Record<string, string> }>();
  for (const variant of product.variants) {
    const occurrences = new Map<string, number>();
    for (const component of variant.components) {
      const base = component.name + "|" + component.unit;
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      const key = base + "|" + occurrence;
      const row = rows.get(key) ?? { name: component.name, unit: component.unit, quantities: {} };
      row.quantities[variant.size] = component.quantity;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

function sameContent(values: Array<string | undefined>) {
  return new Set(values.map((value) => value ?? "")).size <= 1;
}

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
    <nav className="staff-sop-index" aria-label="Danh sách món">{publication.data.products.map((product, index) => <a key={index} href={`#sop-product-${index}`}>{product.name}</a>)}</nav>
    <div className="staff-sop-products">{publication.data.products.map((product, productIndex) => {
      const rows = ingredientRows(product);
      const variants = [...product.variants].sort((a, b) => ["S", "M", "L"].indexOf(a.size) - ["S", "M", "L"].indexOf(b.size));
      const sharedSteps = product.steps ?? (sameContent(variants.map((variant) => JSON.stringify(variant.steps ?? []))) ? variants[0]?.steps : undefined);
      const sharedNotes = product.notes ?? (sameContent(variants.map((variant) => variant.notes)) ? variants[0]?.notes : undefined);
      return <section className="surface staff-sop-product" id={"sop-product-" + productIndex} key={product.name + "-" + productIndex}>
        <div className="staff-sop-product-heading"><div><h2>{product.name}</h2><span>{variants.map((variant) => variant.size + " · " + variant.sizeOz + "oz").join("  /  ")}</span></div></div>
        <div className="staff-sop-product-body">
          <section className="staff-sop-block"><h3>Định lượng nguyên liệu</h3>
            {rows.length ? <div className="sop-matrix-scroll"><table className="sop-size-matrix staff-sop-matrix"><thead><tr><th>Nguyên liệu</th><th>Đơn vị</th>{variants.map((variant) => <th key={variant.size}>Size {variant.size}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.name + row.unit + index}><th scope="row">{row.name}</th><td>{row.unit}</td>{variants.map((variant) => <td key={variant.size}>{row.quantities[variant.size] ?? "—"}</td>)}</tr>)}</tbody></table></div> : <p className="form-note">Chưa có định lượng.</p>}
          </section>
          {sharedSteps?.length ? <section className="staff-sop-block"><h3>Các bước pha</h3><ol className="staff-sop-steps">{sharedSteps.map((step, index) => <li key={step.title + "-" + index}><span className="staff-sop-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.instruction}</p></div></li>)}</ol></section> : variants.map((variant) => <section className="staff-sop-block staff-sop-size-process" key={"steps-" + variant.size}><h3>Các bước pha · Size {variant.size}</h3>{variant.steps?.length ? <ol className="staff-sop-steps">{variant.steps.map((step, index) => <li key={step.title + "-" + index}><span className="staff-sop-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.instruction}</p></div></li>)}</ol> : <p className="form-note">Chưa có bước pha.</p>}</section>)}
          {sharedNotes ? <p className="staff-sop-notes"><strong>Ghi chú:</strong> {sharedNotes}</p> : !product.notes && !sameContent(variants.map((variant) => variant.notes)) ? <div className="staff-sop-legacy-notes">{variants.filter((variant) => variant.notes).map((variant) => <p className="staff-sop-notes" key={variant.size}><strong>Ghi chú · Size {variant.size}:</strong> {variant.notes}</p>)}</div> : null}
        </div>
      </section>;
    })}</div>
  </>;
}
