"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { publishStaffSop, saveSopDraft } from "@/app/(private)/sop/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import type { RecipeComponent, RecipeCostDocument, RecipeProductVariant, RecipeSize } from "@/lib/recipe-cost/types";
import type { SopDocument } from "@/lib/sop/schema";

const sizeOrder: RecipeSize[] = ["S", "M", "L"];
type SopProduct = SopDocument["products"][number];
type SopVariant = SopProduct["variants"][number];
type SopStep = NonNullable<SopProduct["steps"]>[number];
type IngredientMatrixRow = { key: string; name: string; unit: string; quantities: Partial<Record<RecipeSize, string>> };

function variantFor(product: RecipeCostDocument["products"][number] | undefined, size: RecipeSize): RecipeProductVariant | undefined {
  return product?.variants.find((variant) => variant.size === size);
}

function sourceKey(component: RecipeComponent) {
  return component.kind === "ingredient" ? "ingredient:" + component.ingredientId : "batch:" + component.batchId;
}

function componentName(component: RecipeComponent, recipe: RecipeCostDocument) {
  return component.kind === "ingredient"
    ? recipe.ingredients.find((item) => item.id === component.ingredientId)?.name ?? component.label ?? "Nguyên liệu cần kiểm tra"
    : recipe.batches.find((item) => item.id === component.batchId)?.name ?? component.label ?? "Cốt cần kiểm tra";
}

function ingredientMatrix(product: RecipeCostDocument["products"][number] | undefined, includedSizes: RecipeSize[], recipe: RecipeCostDocument): IngredientMatrixRow[] {
  const rows = new Map<string, IngredientMatrixRow>();
  for (const size of sizeOrder) {
    if (!includedSizes.includes(size)) continue;
    const variant = variantFor(product, size);
    const occurrences = new Map<string, number>();
    for (const component of variant?.components ?? []) {
      const baseKey = sourceKey(component) + "|" + component.unit;
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      const key = baseKey + "|" + occurrence;
      const row = rows.get(key) ?? { key, name: componentName(component, recipe), unit: component.unit, quantities: {} };
      row.quantities[size] = component.quantity;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

function sameSteps(a: SopVariant["steps"], b: SopVariant["steps"]) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

export function SopWorkspace({
  recipe,
  initialDocument,
  initialRevision,
  initialRecipeRevision,
  recipeRevision,
  initialPublicationRevision,
  publicationRecipeRevision,
  publishedAt,
}: {
  recipe: RecipeCostDocument;
  initialDocument: SopDocument;
  initialRevision: number;
  initialRecipeRevision: number;
  recipeRevision: number;
  initialPublicationRevision: number;
  publicationRecipeRevision: number | null;
  publishedAt: string | null;
}) {
  const [document, setDocument] = useState<SopDocument>(initialDocument);
  const initialSerializedDocument = JSON.stringify(initialDocument);
  const [submittedDocument, setSubmittedDocument] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState(recipe.products[0]?.id ?? "");
  const [reason, setReason] = useState("Cập nhật SOP pha chế");
  const [saveState, saveAction, saving] = useActionState(saveSopDraft, undefined);
  const [publishState, publishAction, publishing] = useActionState(publishStaffSop, undefined);

  const revision = saveState?.revision ?? initialRevision;
  const savedRecipeRevision = saveState?.savedRecipeRevision ?? initialRecipeRevision;
  const selectedProduct = recipe.products.find((item) => item.id === selectedProductId);
  const sopProduct = document.products.find((item) => item.productId === selectedProductId);
  const includedSizes = sizeOrder.filter((size) => sopProduct?.variants.some((variant) => variant.size === size));
  const sharedSteps = sopProduct?.steps ?? sopProduct?.variants.find((variant) => variant.steps?.length)?.steps ?? [];
  const sharedNotes = sopProduct?.notes ?? sopProduct?.variants.find((variant) => variant.notes?.trim())?.notes ?? "";
  const legacyStepsDiffer = Boolean(sopProduct && !sopProduct.steps && sopProduct.variants.some((variant) => !sameSteps(variant.steps, sopProduct.variants[0]?.steps)));
  const legacyNotesDiffer = Boolean(sopProduct && sopProduct.notes === undefined && new Set(sopProduct.variants.map((variant) => variant.notes ?? "")).size > 1);
  const matrixRows = ingredientMatrix(selectedProduct, includedSizes, recipe);

  const serializedDocument = useMemo(() => JSON.stringify(document), [document]);
  const isDirty = saving || (saveState?.error ? true : saveState?.success
    ? serializedDocument !== submittedDocument
    : serializedDocument !== initialSerializedDocument);
  const isStale = revision > 0 && savedRecipeRevision !== recipeRevision;
  const isPublishable = document.products.length > 0 && document.products.every((product) => {
    if (!product.variants.length) return false;
    const steps = product.steps ?? product.variants.find((variant) => variant.steps?.length)?.steps ?? [];
    return steps.length > 0 && steps.every((step) => step.title.trim() && step.instruction.trim());
  });
  const canPublish = !isDirty && !isStale && revision > 0 && isPublishable;
  const publicationRevision = publishState?.revision ?? initialPublicationRevision;
  const currentPublicationRecipeRevision = publishState?.success ? recipeRevision : publicationRecipeRevision;
  const currentPublication = publicationRevision > 0 && currentPublicationRecipeRevision === recipeRevision && !isStale;

  function toggleSize(size: RecipeSize) {
    if (!selectedProduct || !variantFor(selectedProduct, size)) return;
    setDocument((current) => {
      const currentProduct = current.products.find((item) => item.productId === selectedProduct.id);
      if (currentProduct?.variants.some((variant) => variant.size === size)) {
        const variants = currentProduct.variants.filter((variant) => variant.size !== size);
        return { products: variants.length
          ? current.products.map((item) => item.productId === selectedProduct.id ? { ...item, variants } : item)
          : current.products.filter((item) => item.productId !== selectedProduct.id) };
      }
      const firstSteps = currentProduct?.steps ?? currentProduct?.variants.find((variant) => variant.steps?.length)?.steps;
      const firstNotes = currentProduct?.notes ?? currentProduct?.variants.find((variant) => variant.notes?.trim())?.notes;
      const nextVariant: SopVariant = {
        size,
        ...(!currentProduct?.steps && firstSteps ? { steps: structuredClone(firstSteps) } : {}),
        ...(!currentProduct?.notes && firstNotes ? { notes: firstNotes } : {}),
      };
      if (!currentProduct) return { products: [...current.products, { productId: selectedProduct.id, variants: [nextVariant] }] };
      return { products: current.products.map((item) => item.productId === selectedProduct.id ? { ...item, variants: [...item.variants, nextVariant] } : item) };
    });
  }

  function updateProduct(update: (product: SopProduct) => SopProduct) {
    if (!selectedProduct) return;
    setDocument((current) => ({ products: current.products.map((product) => product.productId === selectedProduct.id ? update(product) : product) }));
  }

  function updateSteps(update: (steps: SopStep[]) => SopStep[]) {
    if (!sopProduct) return;
    updateProduct((product) => ({ ...product, steps: update(structuredClone(sharedSteps)) }));
  }

  function updateNotes(notes: string) {
    if (!sopProduct) return;
    updateProduct((product) => ({ ...product, notes }));
  }

  return <div className="sop-workspace">
    <section className="surface sop-status-card">
      <div><p className="eyebrow">BẢN NHÁP SOP</p><h2>{revision ? "Phiên bản " + revision : "Chưa lưu bản nháp"}</h2><p>Định lượng lấy trực tiếp từ công thức giá vốn; quy trình pha chỉ nhập một lần cho các size đã chọn.</p></div>
      <div className="sop-status-tags">
        {isStale ? <span className="status status-warning">Công thức đã thay đổi</span> : <span className="status status-success">Công thức phiên bản {recipeRevision}</span>}
        {currentPublication ? <span className="status status-neutral">Nhân viên đang xem bản {publicationRevision}</span> : <span className="status status-warning">Bản nhân viên chưa cập nhật</span>}
        {publishState?.success ? <small>Vừa công bố phiên bản mới.</small> : publishedAt ? <small>Lần công bố gần nhất: {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(publishedAt))}</small> : null}
      </div>
    </section>

    {recipe.products.length === 0 ? <section className="surface sop-empty"><h2>Chưa có món trong công thức</h2><p>Hãy thêm món và size ở khu vực giá vốn trước. SOP sẽ lấy định lượng từ đó để tránh lệch công thức.</p><Link className="button button-secondary" href="/product-costs">Mở giá vốn món</Link></section> : <div className="sop-work-area">
      <section className="surface sop-editor-panel">
        <div className="section-heading"><div><h2>Hướng dẫn theo món</h2><p>Chọn size cần công bố. Thành phần được so sánh theo cột; các bước chỉ cần viết một lần.</p></div></div>
        <label className="field sop-product-select"><span>Món trong menu</span><select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>{recipe.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>

        <div className="sop-size-picker" aria-label="Size được đưa vào SOP">
          <strong>Size trong SOP</strong>
          <div>{sizeOrder.map((size) => {
            const available = Boolean(variantFor(selectedProduct, size));
            const included = includedSizes.includes(size);
            return <button type="button" key={size} className={"sop-size-chip" + (included ? " sop-size-chip-active" : "")} aria-pressed={included} disabled={!available} onClick={() => toggleSize(size)}>
              <span>{size}</span><small>{included ? "Đang dùng" : available ? "+ Thêm size" : "Chưa có công thức"}</small>
            </button>;
          })}</div>
        </div>

        {includedSizes.length ? <>
          <section className="sop-recipe-matrix" aria-label="Định lượng nguyên liệu theo size">
            <div className="sop-matrix-heading"><div><h3>Định lượng nguyên liệu</h3><p>Tự đồng bộ từ Giá vốn món. S · 12oz, M · 17oz, L · 22oz.</p></div><span>{matrixRows.length} thành phần</span></div>
            {matrixRows.length ? <div className="sop-matrix-scroll"><table className="sop-size-matrix"><thead><tr><th>Nguyên liệu / cốt</th><th>Đơn vị</th>{includedSizes.map((size) => <th key={size}>Size {size}</th>)}</tr></thead><tbody>{matrixRows.map((row) => <tr key={row.key}><th scope="row">{row.name}</th><td>{row.unit}</td>{includedSizes.map((size) => <td key={size}>{row.quantities[size] ?? "—"}</td>)}</tr>)}</tbody></table></div> : <p className="form-note">Các size đã chọn chưa có thành phần trong công thức giá vốn.</p>}
          </section>

          <section className="sop-instructions-editor">
            <div className="section-heading"><div><h3>Quy trình pha chung</h3><p>Nhân viên xem cùng một quy trình cho mọi size đã chọn.</p></div><button type="button" className="button button-secondary" onClick={() => updateSteps((steps) => [...steps, { id: crypto.randomUUID(), title: "", instruction: "" }])}>Thêm bước</button></div>
            {legacyStepsDiffer ? <p className="sop-legacy-warning" role="status">Quy trình cũ có bước khác nhau giữa các size. Từ khi lưu bước ở đây, quy trình này sẽ dùng chung cho các size đang chọn.</p> : null}
            {sharedSteps.length === 0 ? <p className="form-note">Thêm các bước pha theo đúng thứ tự nhân viên cần làm.</p> : <div className="sop-step-list">{sharedSteps.map((step, index) => <article className="sop-step-editor" key={step.id}>
              <div className="sop-step-number">{index + 1}</div>
              <div className="sop-step-fields"><label className="field"><span>Tên bước</span><input maxLength={120} value={step.title} onChange={(event) => updateSteps((steps) => steps.map((item) => item.id === step.id ? { ...item, title: event.target.value } : item))} placeholder="Ví dụ: Ủ trà" /></label><label className="field"><span>Hướng dẫn nhân viên</span><textarea maxLength={1200} rows={3} value={step.instruction} onChange={(event) => updateSteps((steps) => steps.map((item) => item.id === step.id ? { ...item, instruction: event.target.value } : item))} placeholder="Ghi thời gian, thao tác và lưu ý cần làm…" /></label></div>
              <div className="sop-step-actions"><button type="button" className="button button-plain" disabled={index === 0} onClick={() => updateSteps((steps) => { [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; return steps; })}>Lên</button><button type="button" className="button button-plain" disabled={index === sharedSteps.length - 1} onClick={() => updateSteps((steps) => { [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; return steps; })}>Xuống</button><button type="button" className="button button-plain" onClick={() => updateSteps((steps) => steps.filter((item) => item.id !== step.id))}>Xóa</button></div>
            </article>)}</div>}
            <label className="field sop-notes"><span>Ghi chú chung cho món</span><textarea maxLength={1200} rows={2} value={sharedNotes} onChange={(event) => updateNotes(event.target.value)} placeholder="Không bắt buộc" /></label>
            {legacyNotesDiffer ? <p className="sop-legacy-warning" role="status">Ghi chú cũ khác nhau theo size. Khi lưu ghi chú ở đây, nội dung này sẽ dùng chung.</p> : null}
          </section>
        </> : <div className="sop-add-size-prompt"><strong>Chưa chọn size cho SOP</strong><p>Thêm ít nhất một size có công thức để nhập quy trình pha và công bố cho nhân viên.</p></div>}
      </section>

      <div className="sop-support-column">
        <section className="surface sop-preview-card" aria-label="Xem trước SOP nhân viên">
          <div className="section-heading"><div><p className="eyebrow">XEM TRƯỚC PHÍA NHÂN VIÊN</p><h2>{selectedProduct?.name ?? "Món"}</h2><p>Bảng nguyên liệu theo size và quy trình dùng chung.</p></div><span className="status status-neutral">Bản xem trước</span></div>
          {includedSizes.length ? <>
            {matrixRows.length ? <div className="sop-preview-components"><strong>Định lượng</strong><div className="sop-matrix-scroll"><table className="sop-size-matrix"><thead><tr><th>Nguyên liệu</th><th>ĐVT</th>{includedSizes.map((size) => <th key={size}>{size}</th>)}</tr></thead><tbody>{matrixRows.map((row) => <tr key={"preview-" + row.key}><th scope="row">{row.name}</th><td>{row.unit}</td>{includedSizes.map((size) => <td key={size}>{row.quantities[size] ?? "—"}</td>)}</tr>)}</tbody></table></div></div> : <p className="form-note">Chưa có định lượng để hiển thị.</p>}
            <div className="sop-preview-components"><strong>Các bước pha</strong>{sharedSteps.length ? <ol>{sharedSteps.map((step, index) => <li key={step.id}><span>{index + 1}. {step.title.trim() || "Chưa đặt tên bước"}</span><p>{step.instruction.trim() || "Chưa có hướng dẫn."}</p></li>)}</ol> : <p className="form-note">Chưa thêm bước pha cho món này.</p>}</div>
            {sharedNotes.trim() ? <p className="staff-sop-notes"><strong>Ghi chú:</strong> {sharedNotes}</p> : null}
          </> : <p className="form-note">Thêm size để xem bản hướng dẫn.</p>}
        </section>

        <section className="surface sop-save-panel">
          <div className="section-heading"><div><h2>Lưu và công bố</h2><p>Bản nháp chỉ chủ cửa hàng thấy. Nhân viên chỉ thấy bản đã công bố gần nhất.</p></div><span className={"status " + (isDirty ? "status-warning" : "status-success")}>{isDirty ? "Có thay đổi chưa lưu" : "Đã lưu"}</span></div>
          {isStale ? <p className="sop-stale-notice" role="status">Công thức đã đổi từ phiên bản {savedRecipeRevision} sang {recipeRevision}. Hãy kiểm tra định lượng và lưu SOP trước khi công bố.</p> : null}
          <form action={saveAction} className="sop-save-form" onSubmit={() => setSubmittedDocument(serializedDocument)}>
            <input type="hidden" name="document" value={serializedDocument} /><input type="hidden" name="expected_revision" value={revision} /><input type="hidden" name="expected_recipe_revision" value={recipeRevision} />
            <label className="field"><span>Lý do lưu phiên bản</span><input name="reason" value={reason} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></label>
            <button className="button" type="submit" disabled={saving || (!isDirty && !isStale)}>{saving ? "Đang lưu…" : "Lưu bản nháp"}</button>
          </form>
          <ActionMessage error={saveState?.error} success={saveState?.success} />
          <div className="sop-publish-row"><div><strong>{publicationRevision ? "Bản nhân viên: " + publicationRevision : "Chưa có bản cho nhân viên"}</strong><span>{isPublishable ? "Bản nháp đủ bước để công bố." : "Chọn ít nhất một size và hoàn tất các bước pha trước khi công bố."}</span></div>
            <form action={publishAction}><input type="hidden" name="expected_revision" value={revision} /><input type="hidden" name="expected_recipe_revision" value={recipeRevision} /><button className="button button-secondary" type="submit" disabled={!canPublish || publishing}>{publishing ? "Đang công bố…" : "Công bố cho nhân viên"}</button></form>
          </div>
          <ActionMessage error={publishState?.error} success={publishState?.success} />
        </section>
      </div>
    </div>}
  </div>;
}
