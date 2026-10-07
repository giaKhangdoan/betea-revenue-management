"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { publishStaffSop, saveSopDraft } from "@/app/(private)/sop/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import type { RecipeCostDocument, RecipeProductVariant, RecipeSize } from "@/lib/recipe-cost/types";
import type { SopDocument } from "@/lib/sop/schema";

const sizeOrder: RecipeSize[] = ["S", "M", "L"];

function variantFor(product: RecipeCostDocument["products"][number] | undefined, size: RecipeSize): RecipeProductVariant | undefined {
  return product?.variants.find((variant) => variant.size === size);
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
  const [selectedSize, setSelectedSize] = useState<RecipeSize>(sizeOrder.find((size) => recipe.products[0]?.variants.some((variant) => variant.size === size)) ?? "S");
  const [reason, setReason] = useState("Cập nhật SOP pha chế");
  const [saveState, saveAction, saving] = useActionState(saveSopDraft, undefined);
  const [publishState, publishAction, publishing] = useActionState(publishStaffSop, undefined);

  const revision = saveState?.revision ?? initialRevision;
  const savedRecipeRevision = saveState?.savedRecipeRevision ?? initialRecipeRevision;
  const selectedProduct = recipe.products.find((item) => item.id === selectedProductId);
  const recipeVariant = variantFor(selectedProduct, selectedSize);
  const sopProduct = document.products.find((item) => item.productId === selectedProductId);
  const sopVariant = sopProduct?.variants.find((item) => item.size === selectedSize);
  const serializedDocument = useMemo(() => JSON.stringify(document), [document]);
  const isDirty = saving || (saveState?.error ? true : saveState?.success
    ? serializedDocument !== submittedDocument
    : serializedDocument !== initialSerializedDocument);
  const isStale = revision > 0 && savedRecipeRevision !== recipeRevision;
  const isPublishable = document.products.length > 0 && document.products.every((product) =>
    product.variants.length > 0 && product.variants.every((variant) =>
      variant.steps.length > 0 && variant.steps.every((step) => step.title.trim() && step.instruction.trim())));
  const canPublish = !isDirty && !isStale && revision > 0 && isPublishable;
  const publicationRevision = publishState?.revision ?? initialPublicationRevision;
  const currentPublicationRecipeRevision = publishState?.success ? recipeRevision : publicationRecipeRevision;
  const currentPublication = publicationRevision > 0 && currentPublicationRecipeRevision === recipeRevision && !isStale;

  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    const product = recipe.products.find((item) => item.id === productId);
    const preferredSize = sizeOrder.find((size) => product?.variants.some((variant) => variant.size === size));
    if (preferredSize) setSelectedSize(preferredSize);
  }

  function selectOrAddSize(size: RecipeSize) {
    setSelectedSize(size);
    if (!selectedProduct || !variantFor(selectedProduct, size) || sopProduct?.variants.some((variant) => variant.size === size)) return;
    setDocument((current) => {
      const existingProduct = current.products.find((item) => item.productId === selectedProduct.id);
      if (!existingProduct) return { products: [...current.products, { productId: selectedProduct.id, variants: [{ size, steps: [] }] }] };
      return { products: current.products.map((item) => item.productId === selectedProduct.id
        ? { ...item, variants: [...item.variants, { size, steps: [] }] }
        : item) };
    });
  }

  function updateSelectedVariant(update: (variant: NonNullable<typeof sopVariant>) => NonNullable<typeof sopVariant>) {
    if (!sopVariant || !selectedProduct) return;
    setDocument((current) => ({
      products: current.products.map((product) => product.productId !== selectedProduct.id ? product : {
        ...product,
        variants: product.variants.map((variant) => variant.size === selectedSize ? update(variant as typeof sopVariant) : variant),
      }),
    }));
  }

  function removeSelectedSize() {
    if (!selectedProduct || !sopVariant) return;
    setDocument((current) => ({
      products: current.products.flatMap((product) => {
        if (product.productId !== selectedProduct.id) return [product];
        const variants = product.variants.filter((variant) => variant.size !== selectedSize);
        return variants.length ? [{ ...product, variants }] : [];
      }),
    }));
  }

  return <div className="sop-workspace">
    <section className="surface sop-status-card">
      <div><p className="eyebrow">BẢN NHÁP SOP</p><h2>{revision ? `Phiên bản ${revision}` : "Chưa lưu bản nháp"}</h2><p>Định lượng luôn lấy từ công thức giá vốn hiện tại. Lưu và công bố là hai thao tác riêng.</p></div>
      <div className="sop-status-tags">
        {isStale ? <span className="status status-warning">Công thức đã thay đổi</span> : <span className="status status-success">Công thức phiên bản {recipeRevision}</span>}
        {currentPublication ? <span className="status status-neutral">Nhân viên đang xem bản {publicationRevision}</span> : <span className="status status-warning">Bản nhân viên chưa cập nhật</span>}
        {publishState?.success ? <small>Vừa công bố phiên bản mới.</small> : publishedAt ? <small>Lần công bố gần nhất: {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(publishedAt))}</small> : null}
      </div>
    </section>

    {recipe.products.length === 0 ? <section className="surface sop-empty"><h2>Chưa có món trong công thức</h2><p>Hãy thêm món và size ở khu vực giá vốn trước. SOP sẽ lấy định lượng từ đó để tránh lệch công thức.</p><Link className="button button-secondary" href="/product-costs">Mở giá vốn món</Link></section> : <div className="sop-work-area">
      <section className="surface sop-editor-panel">
        <div className="section-heading"><div><h2>Chọn món và size</h2><p>Chỉ thêm những size đã có công thức. Mỗi bước sẽ hiện đúng thứ tự cho nhân viên.</p></div></div>
        <div className="sop-select-grid">
          <label className="field"><span>Món trong menu</span><select value={selectedProductId} onChange={(event) => selectProduct(event.target.value)}>{recipe.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
          <div className="field"><span>Size</span><div className="sop-size-options">{sizeOrder.map((size) => {
            const available = Boolean(variantFor(selectedProduct, size));
            const included = sopProduct?.variants.some((variant) => variant.size === size) ?? false;
            return <button type="button" key={size} className={`sop-size-button${selectedSize === size ? " sop-size-button-active" : ""}`} aria-pressed={selectedSize === size} disabled={!available} onClick={() => selectOrAddSize(size)}>{size}{included ? <small>Đã thêm</small> : available ? <small>+ Thêm SOP</small> : <small>Chưa có công thức</small>}</button>;
          })}</div></div>
        </div>

        {recipeVariant ? <div className="sop-quantity-reference"><div><h3>Định lượng theo công thức gốc · {selectedProduct?.name} size {selectedSize}</h3><p>Muốn đổi lượng pha, cập nhật công thức ở mục giá vốn rồi lưu SOP theo revision mới.</p></div>
          {recipeVariant.components.length ? <ul>{recipeVariant.components.map((component, index) => {
            const name = component.kind === "ingredient" ? recipe.ingredients.find((item) => item.id === component.ingredientId)?.name : recipe.batches.find((item) => item.id === component.batchId)?.name;
            return <li key={`${component.kind}-${component.kind === "ingredient" ? component.ingredientId : component.batchId}-${index}`}><span>{name ?? "Thành phần cần kiểm tra"}</span><strong>{component.quantity} {component.unit}</strong></li>;
          })}</ul> : <p className="form-note">Size này chưa có thành phần định lượng.</p>}
        </div> : null}

        {sopVariant ? <div className="sop-instructions-editor">
          <div className="section-heading"><div><h3>Các bước pha · {selectedSize}</h3><p>Thêm bước theo thứ tự. Tiêu đề ngắn giúp nhân viên quét nhanh.</p></div><button type="button" className="button button-secondary" onClick={() => updateSelectedVariant((variant) => ({ ...variant, steps: [...variant.steps, { id: crypto.randomUUID(), title: "", instruction: "" }] }))}>Thêm bước</button></div>
          {sopVariant.steps.length === 0 ? <p className="form-note">Size đã có trong bản nháp nhưng chưa có bước pha.</p> : <div className="sop-step-list">{sopVariant.steps.map((step, index) => <article className="sop-step-editor" key={step.id}>
            <div className="sop-step-number">{index + 1}</div>
            <div className="sop-step-fields"><label className="field"><span>Tên bước</span><input maxLength={120} value={step.title} onChange={(event) => updateSelectedVariant((variant) => ({ ...variant, steps: variant.steps.map((item) => item.id === step.id ? { ...item, title: event.target.value } : item) }))} placeholder="Ví dụ: Ủ trà" /></label><label className="field"><span>Hướng dẫn nhân viên</span><textarea maxLength={1200} rows={3} value={step.instruction} onChange={(event) => updateSelectedVariant((variant) => ({ ...variant, steps: variant.steps.map((item) => item.id === step.id ? { ...item, instruction: event.target.value } : item) }))} placeholder="Ghi thời gian, thao tác và lưu ý cần làm…" /></label></div>
            <div className="sop-step-actions"><button type="button" className="button button-plain" disabled={index === 0} onClick={() => updateSelectedVariant((variant) => { const steps = [...variant.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; return { ...variant, steps }; })}>Lên</button><button type="button" className="button button-plain" disabled={index === sopVariant.steps.length - 1} onClick={() => updateSelectedVariant((variant) => { const steps = [...variant.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; return { ...variant, steps }; })}>Xuống</button><button type="button" className="button button-plain" onClick={() => updateSelectedVariant((variant) => ({ ...variant, steps: variant.steps.filter((item) => item.id !== step.id) }))}>Xóa</button></div>
          </article>)}</div>}
          <label className="field sop-notes"><span>Ghi chú chung cho size này</span><textarea maxLength={1200} rows={2} value={sopVariant.notes ?? ""} onChange={(event) => updateSelectedVariant((variant) => ({ ...variant, notes: event.target.value }))} placeholder="Không bắt buộc" /></label>
          <button type="button" className="button button-plain sop-remove-size" onClick={removeSelectedSize}>Bỏ size này khỏi SOP</button>
        </div> : <div className="sop-add-size-prompt"><strong>Size {selectedSize} chưa có trong SOP</strong><p>Thêm size để bắt đầu viết hướng dẫn. Định lượng tham chiếu đã lấy từ công thức gốc.</p><button className="button" type="button" onClick={() => selectOrAddSize(selectedSize)}>Thêm size vào SOP</button></div>}
      </section>

      <div className="sop-support-column">
      <section className="surface sop-preview-card" aria-label="Xem trước SOP nhân viên">
        <div className="section-heading"><div><p className="eyebrow">XEM TRƯỚC PHÍA NHÂN VIÊN</p><h2>{selectedProduct?.name ?? "Món"} · Size {selectedSize}</h2><p>Nhân viên chỉ thấy tên nguyên liệu, định lượng, bước pha và ghi chú.</p></div><span className="status status-neutral">Bản xem trước</span></div>
        {recipeVariant?.components.length ? <div className="sop-preview-components"><strong>Định lượng</strong><ul>{recipeVariant.components.map((component, index) => {
          const name = component.kind === "ingredient" ? recipe.ingredients.find((item) => item.id === component.ingredientId)?.name : recipe.batches.find((item) => item.id === component.batchId)?.name;
          return <li key={`preview-${index}`}><span>{name ?? "Thành phần cần kiểm tra"}</span><strong>{component.quantity} {component.unit}</strong></li>;
        })}</ul></div> : <p className="form-note">Chưa có định lượng để hiển thị.</p>}
        <div className="sop-preview-components"><strong>Các bước pha</strong>{sopVariant?.steps.length ? <ol>{sopVariant.steps.map((step, index) => <li key={step.id}><span>{index + 1}. {step.title.trim() || "Chưa đặt tên bước"}</span><p>{step.instruction.trim() || "Chưa có hướng dẫn."}</p></li>)}</ol> : <p className="form-note">Chưa thêm bước pha cho size này.</p>}</div>
        {sopVariant?.notes?.trim() ? <p className="staff-sop-notes"><strong>Ghi chú:</strong> {sopVariant.notes}</p> : null}
      </section>

      <section className="surface sop-save-panel">
        <div className="section-heading"><div><h2>Lưu và công bố</h2><p>Bản nháp chỉ chủ cửa hàng thấy. Nhân viên chỉ thấy bản đã công bố gần nhất.</p></div><span className={`status ${isDirty ? "status-warning" : "status-success"}`}>{isDirty ? "Có thay đổi chưa lưu" : "Đã lưu"}</span></div>
        {isStale ? <p className="sop-stale-notice" role="status">Công thức đã đổi từ phiên bản {savedRecipeRevision} sang {recipeRevision}. Hãy xem lại định lượng và lưu SOP để xác nhận phiên bản mới trước khi công bố.</p> : null}
        <form action={saveAction} className="sop-save-form" onSubmit={() => setSubmittedDocument(serializedDocument)}>
          <input type="hidden" name="document" value={serializedDocument} /><input type="hidden" name="expected_revision" value={revision} /><input type="hidden" name="expected_recipe_revision" value={recipeRevision} />
          <label className="field"><span>Lý do lưu phiên bản</span><input name="reason" value={reason} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></label>
          <button className="button" type="submit" disabled={saving || (!isDirty && !isStale)}>{saving ? "Đang lưu…" : "Lưu bản nháp"}</button>
        </form>
        <ActionMessage error={saveState?.error} success={saveState?.success} />
        <div className="sop-publish-row"><div><strong>{publicationRevision ? `Bản nhân viên: ${publicationRevision}` : "Chưa có bản cho nhân viên"}</strong><span>{isPublishable ? "Bản nháp đủ bước để công bố." : "Hoàn tất ít nhất một size và tất cả bước pha trước khi công bố."}</span></div>
          <form action={publishAction}><input type="hidden" name="expected_revision" value={revision} /><input type="hidden" name="expected_recipe_revision" value={recipeRevision} /><button className="button button-secondary" type="submit" disabled={!canPublish || publishing}>{publishing ? "Đang công bố…" : "Công bố cho nhân viên"}</button></form>
        </div>
        <ActionMessage error={publishState?.error} success={publishState?.success} />
      </section>
      </div>
    </div>}
  </div>;
}
