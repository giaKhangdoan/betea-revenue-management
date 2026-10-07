"use client";

import { useActionState, useMemo, useState } from "react";
import { saveRecipeCostWorkspace } from "@/app/(private)/product-costs/actions";
import { ActionMessage } from "@/components/ledger/action-message";
import { calculateRecipeCosts, RecipeCostError } from "@/lib/recipe-cost/calculate";
import { recipeCostDocumentSchema } from "@/lib/recipe-cost/schema";
import type { RecipeBatch, RecipeComponent, RecipeCostDocument, RecipeProduct, RecipeProductVariant, RecipeSize } from "@/lib/recipe-cost/types";
import { WorkbookImportPanel } from "@/components/recipe-cost/workbook-import-panel";

type Tab = "ingredients" | "batches" | "products" | "import";
type ComponentChoice = { value: string; label: string; unit: string };

const emptyDocument = (): RecipeCostDocument => ({ unitConversions: [], ingredients: [], batches: [], products: [] });
const sizes: RecipeSize[] = ["S", "M", "L"];

function id() {
  return crypto.randomUUID();
}

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(number)} ₫` : "—";
}

function unitMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(number)} ₫` : "—";
}

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(number)}%` : "—";
}

function ComponentEditor({
  components,
  onChange,
  ingredients,
  batches,
  omitBatchId,
}: {
  components: RecipeComponent[];
  onChange: (next: RecipeComponent[]) => void;
  ingredients: RecipeCostDocument["ingredients"];
  batches: RecipeBatch[];
  omitBatchId?: string;
}) {
  const choices: ComponentChoice[] = [
    ...ingredients.map((item) => ({ value: `ingredient:${item.id}`, label: item.name, unit: item.costUnit })),
    ...batches.filter((item) => item.id !== omitBatchId).map((item) => ({ value: `batch:${item.id}`, label: item.name, unit: item.outputUnit })),
  ];
  function changeComponent(index: number, patch: Partial<RecipeComponent>) {
    onChange(components.map((component, componentIndex) => componentIndex === index ? { ...component, ...patch } as RecipeComponent : component));
  }
  function selectSource(index: number, value: string) {
    const [kind, sourceId] = value.split(":", 2);
    const choice = choices.find((item) => item.value === value);
    if (!choice || (kind !== "ingredient" && kind !== "batch")) return;
    const current = components[index];
    const next: RecipeComponent = kind === "ingredient"
      ? { kind, ingredientId: sourceId, quantity: current.quantity, unit: choice.unit, label: choice.label }
      : { kind, batchId: sourceId, quantity: current.quantity, unit: choice.unit, label: choice.label };
    onChange(components.map((component, componentIndex) => componentIndex === index ? next : component));
  }

  return (
    <div className="recipe-component-editor">
      {components.length === 0 ? <p className="form-note">Chưa có thành phần. Chọn nguyên liệu hoặc cốt đã tạo để thêm vào công thức.</p> : null}
      {components.map((component, index) => {
        const selected = component.kind === "ingredient" ? `ingredient:${component.ingredientId}` : `batch:${component.batchId}`;
        return <div className="recipe-component-row" key={`${selected}-${index}`}>
          <label className="field"><span>Nguyên liệu / cốt</span><select value={selected} onChange={(event) => selectSource(index, event.target.value)}>
            {choices.length === 0 ? <option value="">Tạo nguyên liệu trước</option> : null}
            {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select></label>
          <label className="field"><span>Lượng dùng</span><input type="number" min="0" step="any" value={component.quantity} onChange={(event) => changeComponent(index, { quantity: event.target.value })} /></label>
          <label className="field"><span>Đơn vị</span><input value={component.unit} onChange={(event) => changeComponent(index, { unit: event.target.value })} /></label>
          <button className="button button-secondary recipe-remove-line" type="button" onClick={() => onChange(components.filter((_, componentIndex) => componentIndex !== index))}>Bỏ dòng</button>
        </div>;
      })}
      <button className="button button-secondary" type="button" disabled={!choices.length} onClick={() => {
        const first = choices[0];
        const [kind, sourceId] = first.value.split(":", 2);
        const next: RecipeComponent = kind === "batch"
          ? { kind, batchId: sourceId, quantity: "1", unit: first.unit, label: first.label }
          : { kind: "ingredient", ingredientId: sourceId, quantity: "1", unit: first.unit, label: first.label };
        onChange([...components, next]);
      }}>Thêm thành phần</button>
    </div>
  );
}

type ProductComponentRow = {
  key: string;
  sourceValue: string;
  unit: string;
  label: string;
  occurrence: number;
  units: Partial<Record<RecipeSize, string>>;
  quantities: Partial<Record<RecipeSize, string>>;
};

function componentSourceValue(component: RecipeComponent) {
  return component.kind === "ingredient"
    ? `ingredient:${component.ingredientId}`
    : `batch:${component.batchId}`;
}

function productComponentRows(product: RecipeProduct): ProductComponentRow[] {
  const rows = new Map<string, ProductComponentRow>();
  for (const size of sizes) {
    const variant = product.variants.find((item) => item.size === size);
    const occurrences = new Map<string, number>();
    for (const component of variant?.components ?? []) {
      const sourceValue = componentSourceValue(component);
      const occurrence = occurrences.get(sourceValue) ?? 0;
      occurrences.set(sourceValue, occurrence + 1);
      const key = `${sourceValue}\u0000${occurrence}`;
      const row = rows.get(key) ?? {
        key,
        sourceValue,
        unit: component.unit,
        label: component.label ?? sourceValue,
        occurrence,
        units: {},
        quantities: {},
      };
      row.units[size] = component.unit;
      row.quantities[size] = component.quantity;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

function componentIndexForRow(components: RecipeComponent[], row: ProductComponentRow) {
  let occurrence = 0;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (componentSourceValue(component) !== row.sourceValue) continue;
    if (occurrence === row.occurrence) return index;
    occurrence += 1;
  }
  return -1;
}

function recipeComponent(sourceValue: string, quantity: string, unit: string, label: string): RecipeComponent | null {
  const [kind, sourceId] = sourceValue.split(":", 2);
  if (kind === "ingredient" && sourceId) return { kind, ingredientId: sourceId, quantity, unit, label };
  if (kind === "batch" && sourceId) return { kind, batchId: sourceId, quantity, unit, label };
  return null;
}

export function RecipeCostWorkspace({ initialDocument, initialRevision, effectiveDate }: {
  initialDocument: RecipeCostDocument | null;
  initialRevision: number;
  effectiveDate: string;
}) {
  const [document, setDocument] = useState<RecipeCostDocument>(initialDocument ?? emptyDocument());
  const [state, saveAction, pending] = useActionState(saveRecipeCostWorkspace, undefined);
  const revision = state?.revision ?? initialRevision;
  const [tab, setTab] = useState<Tab>("ingredients");
  const [selectedIngredientId, setSelectedIngredientId] = useState(initialDocument?.ingredients[0]?.id ?? "");
  const [selectedBatchId, setSelectedBatchId] = useState(initialDocument?.batches[0]?.id ?? "");
  const [batchDraft, setBatchDraft] = useState<RecipeBatch | null>(() => initialDocument?.batches[0] ? structuredClone(initialDocument.batches[0]) : null);
  const [productDraft, setProductDraft] = useState<RecipeProduct | null>(() => initialDocument?.products[0] ? structuredClone(initialDocument.products[0]) : null);
  const [productSearch, setProductSearch] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [reason, setReason] = useState("Cập nhật nguyên liệu và công thức");

  const validation = useMemo(() => recipeCostDocumentSchema.safeParse(document), [document]);
  const calculated = useMemo(() => {
    try { return { value: calculateRecipeCosts(document), error: "" }; }
    catch (error) { return { value: null, error: error instanceof RecipeCostError ? error.message : "Không tính được cost từ dữ liệu hiện tại." }; }
  }, [document]);
  const ingredient = document.ingredients.find((item) => item.id === selectedIngredientId) ?? null;
  const batchCost = batchDraft ? calculated.value?.batches[batchDraft.id] : null;
  const products = calculated.value?.products ?? {};

  function changeDocument(update: (current: RecipeCostDocument) => RecipeCostDocument) {
    setDocument((current) => update(current));
  }
  function updateIngredient(field: keyof NonNullable<typeof ingredient>, value: string | null) {
    if (!ingredient) return;
    changeDocument((current) => ({ ...current, ingredients: current.ingredients.map((item) => item.id === ingredient.id ? { ...item, [field]: value } : item) }));
  }
  function addIngredient() {
    const newIngredient = { id: id(), name: "Nguyên liệu mới", purchaseQuantity: "1", purchaseUnit: "g", purchasePriceVnd: null, costUnit: "g", effectiveDate };
    changeDocument((current) => ({ ...current, ingredients: [...current.ingredients, newIngredient] }));
    setSelectedIngredientId(newIngredient.id);
  }
  function removeIngredient() {
    if (!ingredient) return;
    const referenced = document.batches.some((batch) => batch.components.some((component) => component.kind === "ingredient" && component.ingredientId === ingredient.id))
      || document.products.some((product) => product.variants.some((variant) => variant.components.some((component) => component.kind === "ingredient" && component.ingredientId === ingredient.id)));
    if (referenced) return;
    changeDocument((current) => ({ ...current, ingredients: current.ingredients.filter((item) => item.id !== ingredient.id) }));
    setSelectedIngredientId(document.ingredients.find((item) => item.id !== ingredient.id)?.id ?? "");
  }
  function openBatch(batch: RecipeBatch) {
    if (draftDirty && !window.confirm("Bạn có thay đổi công thức chưa áp dụng. Bỏ thay đổi đó để mở mẻ khác?")) return;
    setBatchDraft(structuredClone(batch));
    setSelectedBatchId(batch.id);
    setDraftDirty(false);
  }
  function createBatch() {
    if (draftDirty && !window.confirm("Bỏ thay đổi công thức chưa áp dụng để tạo mẻ mới?")) return;
    const batch = { id: id(), name: "", outputQuantity: "", outputUnit: "ml", components: [] } as RecipeBatch;
    setBatchDraft(batch);
    setSelectedBatchId(batch.id);
    setDraftDirty(true);
  }
  function applyBatch() {
    if (!batchDraft?.name.trim() || !batchDraft.outputQuantity || !batchDraft.outputUnit.trim() || !batchDraft.components.length) return;
    changeDocument((current) => ({ ...current, batches: current.batches.some((item) => item.id === batchDraft.id) ? current.batches.map((item) => item.id === batchDraft.id ? batchDraft : item) : [...current.batches, batchDraft] }));
    setDraftDirty(false);
  }
  function openProduct(product: RecipeProduct) {
    if (draftDirty && !window.confirm("Bạn có thay đổi món chưa áp dụng. Bỏ thay đổi đó để mở món khác?")) return;
    setProductDraft(structuredClone(product));
    setDraftDirty(false);
  }
  function createProduct() {
    if (draftDirty && !window.confirm("Bỏ thay đổi món chưa áp dụng để tạo món mới?")) return;
    const product = { id: id(), name: "", variants: [] };
    setProductDraft(product);
    setDraftDirty(true);
  }
  function applyProduct() {
    if (!productDraft?.name.trim() || !productDraft.variants.length || productDraft.variants.some((variant) => !variant.components.length)) return;
    changeDocument((current) => ({ ...current, products: current.products.some((item) => item.id === productDraft.id) ? current.products.map((item) => item.id === productDraft.id ? productDraft : item) : [...current.products, productDraft] }));
    setDraftDirty(false);
  }
  function updateProductDraft(update: (product: RecipeProduct) => RecipeProduct) {
    setProductDraft((current) => current ? update(current) : current);
    setDraftDirty(true);
  }
  function updateProductMatrixSource(row: ProductComponentRow, sourceValue: string) {
    const choice = productComponentChoices.find((item) => item.value === sourceValue);
    if (!choice) return;
    updateProductDraft((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        const components = [...variant.components];
        const index = componentIndexForRow(components, row);
        if (index < 0) return variant;
        const current = components[index];
        const replacement = recipeComponent(sourceValue, current.quantity, row.unit, choice.label);
        if (!replacement) return variant;
        components[index] = replacement;
        return { ...variant, components };
      }),
    }));
  }
  function updateProductMatrixUnit(row: ProductComponentRow, unit: string) {
    updateProductDraft((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        const components = [...variant.components];
        const index = componentIndexForRow(components, row);
        if (index < 0) return variant;
        components[index] = { ...components[index], unit } as RecipeComponent;
        return { ...variant, components };
      }),
    }));
  }
  function updateProductMatrixQuantity(row: ProductComponentRow, size: RecipeSize, quantity: string) {
    const choice = productComponentChoices.find((item) => item.value === row.sourceValue);
    updateProductDraft((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        if (variant.size !== size) return variant;
        const components = [...variant.components];
        const index = componentIndexForRow(components, row);
        if (!quantity) {
          if (index >= 0) components.splice(index, 1);
          return { ...variant, components };
        }
        if (index >= 0) components[index] = { ...components[index], quantity } as RecipeComponent;
        else {
          const next = recipeComponent(row.sourceValue, quantity, row.unit, choice?.label ?? row.label);
          if (next) components.push(next);
        }
        return { ...variant, components };
      }),
    }));
  }
  function removeProductMatrixRow(row: ProductComponentRow) {
    updateProductDraft((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        const components = [...variant.components];
        const index = componentIndexForRow(components, row);
        if (index >= 0) components.splice(index, 1);
        return { ...variant, components };
      }),
    }));
  }
  function addProductMatrixRow() {
    if (!productDraft) return;
    const rows = productComponentRows(productDraft);
    const choice = productComponentChoices.find((item) => !rows.some((row) => row.sourceValue === item.value));
    if (!choice) return;
    updateProductDraft((product) => ({
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        components: [...variant.components, recipeComponent(choice.value, "1", choice.unit, choice.label)!],
      })),
    }));
  }
  function deleteBatch() {
    if (!batchDraft) return;
    const referenced = document.batches.some((batch) => batch.id !== batchDraft.id && batch.components.some((component) => component.kind === "batch" && component.batchId === batchDraft.id))
      || document.products.some((product) => product.variants.some((variant) => variant.components.some((component) => component.kind === "batch" && component.batchId === batchDraft.id)));
    if (referenced) return;
    changeDocument((current) => ({ ...current, batches: current.batches.filter((batch) => batch.id !== batchDraft.id) }));
    const nextBatch = document.batches.find((item) => item.id !== batchDraft.id) ?? null;
    setBatchDraft(nextBatch ? structuredClone(nextBatch) : null); setSelectedBatchId(nextBatch?.id ?? ""); setDraftDirty(false);
  }
  function deleteProduct() {
    if (!productDraft) return;
    changeDocument((current) => ({ ...current, products: current.products.filter((product) => product.id !== productDraft.id) }));
    const nextProduct = document.products.find((product) => product.id !== productDraft.id) ?? null;
    setProductDraft(nextProduct ? structuredClone(nextProduct) : null); setDraftDirty(false);
  }
  function addVariant(size: RecipeSize) {
    if (!productDraft || productDraft.variants.some((variant) => variant.size === size)) return;
    updateProductDraft((product) => ({ ...product, variants: [...product.variants, { size, salePriceVnd: null, components: [] }] }));
  }
  function updateVariant(size: RecipeSize, field: "salePriceVnd" | "components", value: string | null | RecipeComponent[]) {
    updateProductDraft((product) => ({ ...product, variants: product.variants.map((variant) => variant.size === size ? { ...variant, [field]: value } as RecipeProductVariant : variant) }));
  }
  const componentSources = { ingredients: document.ingredients, batches: document.batches };
  const productComponentChoices: ComponentChoice[] = [
    ...document.ingredients.map((item) => ({ value: `ingredient:${item.id}`, label: item.name, unit: item.costUnit })),
    ...document.batches.map((item) => ({ value: `batch:${item.id}`, label: item.name, unit: item.outputUnit })),
  ];
  const productRows = productDraft ? productComponentRows(productDraft) : [];
  const productDraftVariants = productDraft ? sizes.flatMap((size) => productDraft.variants.filter((variant) => variant.size === size)) : [];

  return <div className="recipe-cost-workspace">
    <div className="recipe-cost-overview">
      <div className="surface recipe-overview-metric"><span>Nguyên liệu</span><strong>{document.ingredients.length}</strong><small>Giá nhập và đơn vị cost</small></div>
      <div className="surface recipe-overview-metric"><span>Cốt / bán thành phẩm</span><strong>{document.batches.length}</strong><small>Mẻ, sản lượng và cost đơn vị</small></div>
      <div className="surface recipe-overview-metric"><span>Món trong menu</span><strong>{document.products.length}</strong><small>Cost theo từng size S · M · L</small></div>
    </div>

    <div className="recipe-cost-tabs" role="tablist" aria-label="Quản lý giá vốn">
      {([ ["ingredients", "Nguyên liệu"], ["batches", "Cốt / bán thành phẩm"], ["products", "Món & size"], ["import", "Nhập workbook"] ] as const).map(([key, label]) =>
        <button key={key} id={`recipe-tab-${key}`} aria-controls={`recipe-panel-${key}`} className={tab === key ? "recipe-cost-tab recipe-cost-tab-active" : "recipe-cost-tab"} type="button" role="tab" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>)}
    </div>

    <section id="recipe-panel-ingredients" role="tabpanel" aria-labelledby="recipe-tab-ingredients" className="surface recipe-cost-panel" hidden={tab !== "ingredients"}>
      <div className="section-heading"><div><h2>Nguyên liệu gốc</h2><p>Nhập giá mua, lượng mua và đơn vị tính cost. Thay đổi giá sẽ tính lại các món liên quan.</p></div><button type="button" className="button" onClick={addIngredient}>Thêm nguyên liệu</button></div>
      {document.ingredients.length === 0 ? <div className="recipe-empty"><strong>Chưa có nguyên liệu</strong><p>Tải workbook để xem trước dữ liệu có thể nhập hoặc thêm nguyên liệu thủ công.</p><button className="button button-secondary" type="button" onClick={() => setTab("import")}>Xem trước workbook</button></div> : <div className="recipe-two-column">
        <div className="recipe-item-list" aria-label="Danh sách nguyên liệu">{document.ingredients.map((item) => <button key={item.id} type="button" className={item.id === selectedIngredientId ? "recipe-item-button recipe-item-button-selected" : "recipe-item-button"} onClick={() => setSelectedIngredientId(item.id)}><span><strong>{item.name || "Chưa đặt tên"}</strong><small>{money(item.purchasePriceVnd)} / {item.purchaseQuantity} {item.purchaseUnit}</small></span><b>{calculated.value ? `${unitMoney(calculated.value.ingredients[item.id]?.unitCostVnd)} / ${item.costUnit}` : "Kiểm tra dữ liệu"}</b></button>)}</div>
        {ingredient ? <div className="recipe-edit-form">
          <div className="section-heading"><div><h3>Thông tin mua hàng</h3><p>{ingredient.sourceTrace ? `Nguồn: ${ingredient.sourceTrace.sheet}!${ingredient.sourceTrace.cell}` : "Bạn có thể sửa thông tin khi giá nhập thay đổi."}</p></div></div>
          <label className="field"><span>Tên nguyên liệu</span><input value={ingredient.name} onChange={(event) => updateIngredient("name", event.target.value)} /></label>
          <div className="recipe-field-grid">
            <label className="field"><span>Số lượng mua</span><input type="number" min="0" step="any" value={ingredient.purchaseQuantity} onChange={(event) => updateIngredient("purchaseQuantity", event.target.value)} /></label>
            <label className="field"><span>Đơn vị mua</span><input value={ingredient.purchaseUnit} onChange={(event) => updateIngredient("purchaseUnit", event.target.value)} /></label>
            <label className="field"><span>Giá mua (₫)</span><input type="number" min="0" step="any" value={ingredient.purchasePriceVnd ?? ""} onChange={(event) => updateIngredient("purchasePriceVnd", event.target.value || null)} /></label>
            <label className="field"><span>Đơn vị cost</span><input value={ingredient.costUnit} onChange={(event) => updateIngredient("costUnit", event.target.value)} /></label>
            <label className="field"><span>Ngày hiệu lực</span><input type="date" value={ingredient.effectiveDate ?? effectiveDate} onChange={(event) => updateIngredient("effectiveDate", event.target.value)} /></label>
          </div>
          <div className="recipe-cost-total"><span>Cost / {ingredient.costUnit || "đơn vị"}</span><strong>{calculated.value ? unitMoney(calculated.value.ingredients[ingredient.id]?.unitCostVnd) : "Chưa tính được"}</strong></div>
          {ingredient.sourceTrace ? <p className="form-note">Giá gốc và khối lượng lấy tại {ingredient.sourceTrace.priceCell} và {ingredient.sourceTrace.quantityCell}. Bản workbook không được lưu cùng hệ thống.</p> : null}
          <div className="recipe-edit-actions"><button type="button" className="button button-danger" disabled={document.batches.some((batch) => batch.components.some((item) => item.kind === "ingredient" && item.ingredientId === ingredient.id)) || document.products.some((product) => product.variants.some((variant) => variant.components.some((item) => item.kind === "ingredient" && item.ingredientId === ingredient.id)))} onClick={removeIngredient}>Xóa nguyên liệu</button></div>
        </div> : <p className="form-note">Chọn một nguyên liệu để xem và sửa.</p>}
      </div>}
      <section className="recipe-conversion-card"><div className="section-heading"><div><h3>Hệ số quy đổi do bạn nhập</h3><p>Chỉ thêm hệ số đã xác nhận; hệ thống không tự đổi g sang ml.</p></div><ConversionAdder onAdd={(conversion) => changeDocument((current) => ({ ...current, unitConversions: [...current.unitConversions, conversion] }))} /></div>
        {document.unitConversions.length ? <ul className="recipe-conversion-list">{document.unitConversions.map((conversion, index) => <li key={`${conversion.fromUnit}-${conversion.toUnit}-${index}`}><span>1 {conversion.fromUnit} = {conversion.factor} {conversion.toUnit}{conversion.sourceTrace ? ` · ${conversion.sourceTrace.sheet}!${conversion.sourceTrace.cell}` : ""}</span><button className="text-button" type="button" onClick={() => changeDocument((current) => ({ ...current, unitConversions: current.unitConversions.filter((_, itemIndex) => itemIndex !== index) }))}>Xóa</button></li>)}</ul> : <p className="form-note">Chưa có hệ số quy đổi.</p>}
      </section>
    </section>

    <section id="recipe-panel-batches" role="tabpanel" aria-labelledby="recipe-tab-batches" className="surface recipe-cost-panel" hidden={tab !== "batches"}>
      <div className="section-heading"><div><h2>Cốt và bán thành phẩm</h2><p>Tạo mẻ từ nguyên liệu/cốt có sẵn, nhập lượng thành phẩm thu được để tính giá trên mỗi đơn vị.</p></div><button className="button" type="button" onClick={createBatch}>Tạo mẻ mới</button></div>
      <div className="recipe-two-column recipe-two-column-editor">
        <div className="recipe-item-list" aria-label="Danh sách cốt">{document.batches.map((batch) => <button className={batch.id === selectedBatchId ? "recipe-item-button recipe-item-button-selected" : "recipe-item-button"} type="button" key={batch.id} onClick={() => openBatch(batch)}><span><strong>{batch.name}</strong><small>Sản lượng {batch.outputQuantity} {batch.outputUnit}</small></span><b>{calculated.value ? money(calculated.value.batches[batch.id]?.totalCostVnd) : "Kiểm tra"}</b></button>)}{!document.batches.length ? <p className="form-note">Chưa có mẻ cốt. Tạo cốt sau khi đã nhập nguyên liệu.</p> : null}</div>
        {batchDraft ? <div className="recipe-edit-form"><div className="section-heading"><div><h3>{document.batches.some((item) => item.id === batchDraft.id) ? "Sửa công thức mẻ" : "Mẻ mới"}</h3><p>Cost hiển thị sau khi áp dụng công thức vào workspace.</p></div>{draftDirty ? <button type="button" className="text-button" onClick={() => { const saved = document.batches.find((item) => item.id === batchDraft.id); setBatchDraft(saved ? structuredClone(saved) : null); setDraftDirty(false); }}>Bỏ thay đổi</button> : null}</div>
          <label className="field"><span>Tên cốt</span><input value={batchDraft.name} onChange={(event) => { setBatchDraft({ ...batchDraft, name: event.target.value }); setDraftDirty(true); }} /></label>
          <div className="recipe-field-grid"><label className="field"><span>Sản lượng</span><input type="number" min="0" step="any" value={batchDraft.outputQuantity} onChange={(event) => { setBatchDraft({ ...batchDraft, outputQuantity: event.target.value }); setDraftDirty(true); }} /></label><label className="field"><span>Đơn vị thành phẩm</span><input value={batchDraft.outputUnit} onChange={(event) => { setBatchDraft({ ...batchDraft, outputUnit: event.target.value }); setDraftDirty(true); }} /></label></div>
          <ComponentEditor components={batchDraft.components} onChange={(components) => { setBatchDraft({ ...batchDraft, components }); setDraftDirty(true); }} ingredients={componentSources.ingredients} batches={componentSources.batches} omitBatchId={batchDraft.id} />
          {batchCost ? <div className="recipe-cost-total"><span>Cost mẻ · cost / {batchCost.outputUnit}</span><strong>{money(batchCost.totalCostVnd)} · {unitMoney(batchCost.unitCostVnd)}</strong></div> : null}
          {draftDirty ? <p className="form-note">Thay đổi chưa áp dụng. Hãy áp dụng mẻ trước khi lưu toàn bộ workspace.</p> : null}
          <div className="recipe-edit-actions"><button type="button" className="button button-secondary" disabled={!batchDraft.name.trim() || !batchDraft.outputQuantity || !batchDraft.components.length} onClick={applyBatch}>Áp dụng công thức</button><button type="button" className="button button-danger" disabled={!document.batches.some((item) => item.id === batchDraft.id) || document.batches.some((item) => item.id !== batchDraft.id && item.components.some((component) => component.kind === "batch" && component.batchId === batchDraft.id)) || document.products.some((product) => product.variants.some((variant) => variant.components.some((component) => component.kind === "batch" && component.batchId === batchDraft.id)))} onClick={deleteBatch}>Xóa mẻ</button></div>
        </div> : <p className="form-note">Chọn một cốt hoặc tạo mẻ mới để sửa.</p>}
      </div>
    </section>

    <section id="recipe-panel-products" role="tabpanel" aria-labelledby="recipe-tab-products" className="surface recipe-cost-panel" hidden={tab !== "products"}>
      <div className="section-heading"><div><h2>Công thức món theo size</h2><p>Chọn món để xem hoặc sửa công thức. Size S = 12oz, M = 17oz, L = 22oz.</p></div><button className="button" type="button" onClick={createProduct}>Thêm món</button></div>
      <div className="recipe-two-column recipe-product-editor">
        <div className="recipe-item-list recipe-product-list" aria-label="Danh sách món">
          <label className="field recipe-product-search"><span>Tìm món</span><input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Nhập tên món…" /></label>
          {document.products.filter((product) => product.name.toLocaleLowerCase("vi").includes(productSearch.trim().toLocaleLowerCase("vi"))).map((product) => <button key={product.id} type="button" aria-pressed={product.id === productDraft?.id} className={product.id === productDraft?.id ? "recipe-item-button recipe-item-button-selected" : "recipe-item-button"} onClick={() => openProduct(product)}>
            <span><strong>{product.name || "Món chưa đặt tên"}</strong><small>{product.variants.length ? product.variants.map((variant) => `${variant.size}: ${products[product.id]?.variants[variant.size] ? money(products[product.id]!.variants[variant.size]!.totalCostVnd) : "chưa tính cost"}`).join(" · ") : "Chưa thêm size"}</small></span><b>{product.variants.length} size</b>
          </button>)}
          {!document.products.length ? <p className="form-note">Chưa có món trong menu. Tạo món mới để bắt đầu.</p> : null}
          {document.products.length > 0 && !document.products.some((product) => product.name.toLocaleLowerCase("vi").includes(productSearch.trim().toLocaleLowerCase("vi"))) ? <p className="form-note">Không tìm thấy món phù hợp.</p> : null}
        </div>
        {productDraft ? <div className="recipe-edit-form"><div className="section-heading"><div><h3>{document.products.some((item) => item.id === productDraft.id) ? "Sửa món" : "Món mới"}</h3><p>Cost mỗi size được tính từ các thành phần bên dưới.</p></div>{draftDirty ? <button type="button" className="text-button" onClick={() => { const saved = document.products.find((item) => item.id === productDraft.id); setProductDraft(saved ? structuredClone(saved) : null); setDraftDirty(false); }}>Bỏ thay đổi</button> : null}</div>
          <label className="field"><span>Tên món</span><input value={productDraft.name} onChange={(event) => updateProductDraft((product) => ({ ...product, name: event.target.value }))} /></label>
          <div className="recipe-size-add">{sizes.map((size) => <button type="button" key={size} className="button button-secondary" disabled={productDraft.variants.some((variant) => variant.size === size)} onClick={() => addVariant(size)}>Thêm size {size} · {size === "S" ? 12 : size === "M" ? 17 : 22}oz</button>)}</div>
          <div className="recipe-product-size-cards">
            {productDraftVariants.map((variant) => {
              const cost = products[productDraft.id]?.variants[variant.size];
              return <article className="recipe-product-size-card" key={variant.size}>
                <div className="recipe-product-size-heading"><h4>Size {variant.size} · {variant.size === "S" ? 12 : variant.size === "M" ? 17 : 22}oz</h4><button className="text-button" type="button" onClick={() => updateProductDraft((product) => ({ ...product, variants: product.variants.filter((item) => item.size !== variant.size) }))}>Bỏ size</button></div>
                <label className="field"><span>Giá bán (₫)</span><input type="number" min="0" step="any" value={variant.salePriceVnd ?? ""} onChange={(event) => updateVariant(variant.size, "salePriceVnd", event.target.value || null)} /></label>
                <div className="recipe-product-size-cost"><span>Cost đã áp dụng</span><strong>{cost ? money(cost.totalCostVnd) : "Chưa tính"}</strong></div>
                {cost ? <details className="recipe-product-size-breakdown"><summary>Xem chi tiết cost</summary><CostBreakdown lines={cost.lines} total={cost.totalCostVnd} profit={cost.grossProfitVnd} margin={cost.grossMarginPercent} /></details> : null}
              </article>;
            })}
          </div>
          <section className="recipe-product-component-matrix" aria-label="Nguyên liệu theo từng size">
            <div className="recipe-product-matrix-heading"><div><h4>Nguyên liệu và cốt</h4><p>Chọn mỗi thành phần một lần, rồi nhập lượng dùng cho từng size.</p></div><button className="button button-secondary" type="button" disabled={!productComponentChoices.length || productRows.length >= productComponentChoices.length} onClick={addProductMatrixRow}>Thêm thành phần</button></div>
            {productRows.length ? <div className="recipe-matrix-scroll"><table className="recipe-size-matrix"><thead><tr><th scope="col">Thành phần</th><th scope="col">Đơn vị</th>{productDraftVariants.map((variant) => <th scope="col" key={variant.size}>Size {variant.size}</th>)}<th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{productRows.map((row) => <tr key={row.key}>
              <td><select aria-label="Nguyên liệu hoặc cốt" value={row.sourceValue} onChange={(event) => updateProductMatrixSource(row, event.target.value)}>{productComponentChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></td>
              <td><input aria-label={`Đơn vị ${row.label}`} value={row.unit} onChange={(event) => updateProductMatrixUnit(row, event.target.value)} />{new Set(Object.values(row.units)).size > 1 ? <small className="recipe-unit-difference">Khác: {Object.entries(row.units).map(([size, unit]) => size + ": " + unit).join(" · ")}</small> : null}</td>
              {productDraftVariants.map((variant) => <td key={variant.size}><input aria-label={`Lượng ${row.label} size ${variant.size}`} type="number" min="0" step="any" value={row.quantities[variant.size] ?? ""} onChange={(event) => updateProductMatrixQuantity(row, variant.size, event.target.value)} /></td>)}
              <td><button className="button button-secondary recipe-remove-line" type="button" aria-label={`Bỏ ${row.label}`} onClick={() => removeProductMatrixRow(row)}>Bỏ</button></td>
            </tr>)}</tbody></table></div> : <p className="form-note">Chọn các size cần bán, rồi thêm nguyên liệu hoặc cốt để bắt đầu công thức.</p>}
          </section>
          {draftDirty ? <p className="form-note">Thay đổi chưa áp dụng. Hãy áp dụng món trước khi lưu workspace.</p> : null}
          <div className="recipe-edit-actions"><button type="button" className="button button-secondary" disabled={!productDraft.name.trim() || !productDraft.variants.length || productDraft.variants.some((variant) => !variant.components.length)} onClick={applyProduct}>Áp dụng món vào workspace</button><button type="button" className="button button-danger" disabled={!document.products.some((item) => item.id === productDraft.id)} onClick={deleteProduct}>Xóa món</button></div>
        </div> : <p className="form-note">Chọn một món hoặc thêm món mới để nhập công thức.</p>}
      </div>
    </section>

    <section id="recipe-panel-import" role="tabpanel" aria-labelledby="recipe-tab-import" className="surface recipe-cost-panel recipe-import-panel" hidden={tab !== "import"}>
      <WorkbookImportPanel revision={revision} effectiveDate={effectiveDate} disabled={draftDirty || pending} reviewItems={document.importReview?.items ?? []} importedFiles={document.importReview?.importedFiles ?? []} />
    </section>

    <section className="surface recipe-save-panel">
      <div className="section-heading"><div><h2>Lưu phiên bản hiện tại</h2><p>Giá trị chỉ lưu sau khi bạn chọn lưu. Lịch sử được ghi lại mỗi lần lưu.</p></div><span className="status status-neutral">Phiên bản {revision}</span></div>
      {calculated.error ? <p className="form-error">Chưa thể tính cost: {calculated.error}</p> : null}
      {!validation.success ? <p className="form-error">Có trường chưa hợp lệ. Kiểm tra tên, giá, đơn vị và ngày hiệu lực trước khi lưu.</p> : null}
      {draftDirty ? <p className="incomplete-callout">Có công thức cốt/món chưa áp dụng vào workspace. Hãy áp dụng hoặc bỏ thay đổi đó trước khi lưu.</p> : null}
      {document.importReview?.items.some((item) => item.required) ? <div className="incomplete-callout">Workbook còn {document.importReview.items.filter((item) => item.required).length} mục cần đối soát. Những dòng này chưa được tính là đã xử lý.</div> : null}
      <form action={saveAction} className="recipe-save-form">
        <input type="hidden" name="document" value={JSON.stringify(document)} />
        <input type="hidden" name="expected_revision" value={revision} />
        <label className="field"><span>Lý do tạo phiên bản</span><input name="reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
        <ActionMessage error={state?.error} success={state?.success} />
        <div className="recipe-save-actions"><button className="button" type="submit" disabled={pending || draftDirty || !validation.success || Boolean(calculated.error)}>{pending ? "Đang lưu…" : "Lưu giá và công thức"}</button><span>Cost được tính lại trên máy chủ trước khi lưu.</span></div>
      </form>
    </section>
  </div>;
}

function ConversionAdder({ onAdd }: { onAdd: (conversion: RecipeCostDocument["unitConversions"][number]) => void }) {
  const [fromUnit, setFromUnit] = useState("");
  const [toUnit, setToUnit] = useState("");
  const [factor, setFactor] = useState("");
  return <div className="recipe-conversion-add"><label className="field"><span>Từ</span><input value={fromUnit} onChange={(event) => setFromUnit(event.target.value)} placeholder="gói" /></label><label className="field"><span>Sang</span><input value={toUnit} onChange={(event) => setToUnit(event.target.value)} placeholder="ml" /></label><label className="field"><span>Hệ số</span><input type="number" min="0" step="any" value={factor} onChange={(event) => setFactor(event.target.value)} placeholder="1" /></label><button className="button button-secondary" type="button" disabled={!fromUnit.trim() || !toUnit.trim() || !Number(factor)} onClick={() => { onAdd({ fromUnit: fromUnit.trim(), toUnit: toUnit.trim(), factor }); setFromUnit(""); setToUnit(""); setFactor(""); }}>Thêm</button></div>;
}

function CostBreakdown({ lines, total, profit, margin }: { lines: { label: string; quantity: string; unit: string; lineCostVnd: string }[]; total: string; profit: string | null; margin: string | null }) {
  return <div className="recipe-breakdown"><h5>Chi tiết cost</h5><ul>{lines.map((line, index) => <li key={`${line.label}-${index}`}><span>{line.label}<small>{line.quantity} {line.unit}</small></span><strong>{money(line.lineCostVnd)}</strong></li>)}</ul><div className="recipe-breakdown-total"><span>Tổng cost{profit !== null ? " · lãi gộp · biên lãi" : ""}</span><strong>{money(total)}{profit !== null ? ` · ${money(profit)} · ${percent(margin)}` : ""}</strong></div></div>;
}
