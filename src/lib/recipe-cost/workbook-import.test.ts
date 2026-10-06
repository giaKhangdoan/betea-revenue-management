import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { mergeCogsWorkbookImport, parseCogsWorkbook, previewCogsWorkbook, reviewCogsPreviewAgainstWorkspace, validateXlsxArchive, type CogsWorkbookRows } from "./workbook-import";
import type { RecipeCostDocument } from "./types";
import { calculateRecipeCosts } from "./calculate";

const rows: CogsWorkbookRows = {
  rawIngredients: [
    { row: 14, name: "Hồng Trà Nguyên Lá", purchaseUnit: "KG", priceVnd: 150000, packageQuantity: 1000, costName: "Hồng Trà Nguyên Lá", costUnit: "Gr" },
    { row: 24, name: "Mứt Vải Hoa Hồng", purchaseUnit: "KG", priceVnd: 181062, packageQuantity: 800, costName: "Mứt Vải Hoa Hồng", costUnit: "Ml" },
    { row: 35, name: "Đường nâu Hàn Quốc", purchaseUnit: "Gr", priceVnd: 72000, packageQuantity: 1000, costName: "Đường đen", costUnit: "Gr" },
    { row: 50, name: "Mật ong", purchaseUnit: "Ml", priceVnd: 150000, packageQuantity: 1000, costName: "Mật ong", costUnit: "Ml" },
    { row: 54, name: "Tắc Trái", purchaseUnit: "Trái", priceVnd: 30000, packageQuantity: null, costName: "Tắc Trái", costUnit: "Trái", formulaCells: ["E54"], formulaErrors: [] },
    { row: 58, name: "Mật ong", purchaseUnit: "Ml", priceVnd: 150000, packageQuantity: 1000, costName: "Mật ong", costUnit: "Ml" },
  ],
  recipeWarnings: [
    { sheet: "Trà Kiwi", cell: "C18", kind: "suspicious_lookup", message: "Formula looks up a different ingredient row" },
    { sheet: "Matcha Latte", cell: "F27", kind: "cached_formula_error", message: "Cached formula result is an error" },
  ],
};

describe("COGS workbook import preview", () => {
  it("reads a real XLSX archive and holds populated source blocks outside the import mapping", async () => {
    const workbook = new ExcelJS.Workbook();
    const ingredients = workbook.addWorksheet("Bảng NVl");
    workbook.addWorksheet("Menu");
    const orphan = workbook.addWorksheet("Legacy drink");
    orphan.getCell("B4").value = "Chưa có trong menu";
    const hidden = workbook.addWorksheet("Sheet1");
    hidden.state = "hidden";
    hidden.getCell("A1").value = "Legacy cost";
    ingredients.getCell("B14").value = "Hồng Trà";
    ingredients.getCell("C14").value = "KG";
    ingredients.getCell("D14").value = 200000;
    ingredients.getCell("E14").value = 1000;
    ingredients.getCell("F14").value = "Hồng Trà";
    ingredients.getCell("G14").value = "g";
    ingredients.getCell("B44").value = "Cốt trà";
    ingredients.getCell("H44").value = 8.25;
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const preview = await parseCogsWorkbook("fixture.xlsx", bytes);

    expect(preview.ingredients).toHaveLength(1);
    expect(preview.reviewItems.some((item) => item.sourceCell === "Bảng NVl!A43:K58" && item.reason.includes("chưa được nhập"))).toBe(true);
    expect(preview.reviewItems.some((item) => item.sourceCell.startsWith("Legacy drink!") && item.reason.includes("không được tham chiếu trong Menu"))).toBe(true);
    expect(preview.reviewItems.some((item) => item.sourceCell.startsWith("Sheet1!") && item.reason.includes("không được tham chiếu trong Menu"))).toBe(true);
  });

  it("rejects malformed and zip-bomb-style archives before the workbook parser loads them", () => {
    expect(() => validateXlsxArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow("ZIP/XLSX");
    const zip64 = new Uint8Array(69);
    const view = new DataView(zip64.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(28, 1, true);
    view.setUint32(20, 1, true);
    view.setUint32(24, 0xffffffff, true);
    zip64[46] = 0x61;
    view.setUint32(47, 0x06054b50, true);
    view.setUint16(55, 1, true);
    view.setUint16(57, 1, true);
    view.setUint32(59, 47, true);
    expect(() => validateXlsxArchive(zip64)).toThrow("ZIP64");
  });

  it("imports only explicit, dimension-safe ingredient rows and preserves source trace", () => {
    const preview = previewCogsWorkbook(rows, "cogs-betea.xlsx", "a".repeat(64));

    expect(preview.ingredients).toHaveLength(1);
    expect(preview.ingredients[0]).toMatchObject({
      id: "cogs-aaaaaaaa-b14",
      name: "Hồng Trà Nguyên Lá",
      purchaseQuantity: "1",
      purchaseUnit: "kg",
      costUnit: "g",
      purchasePriceVnd: "150000",
      sourceTrace: { sheet: "Bảng NVl", cell: "B14", priceCell: "D14", quantityCell: "E14" },
    });
    expect(preview.unitConversions).toContainEqual({ fromUnit: "kg", toUnit: "g", factor: "1000", sourceTrace: { sheet: "Bảng NVl", cell: "E14" } });
    expect(preview.summary).toMatchObject({ importableIngredients: 1, totalPurchasePriceVnd: "150000", reviewItems: 7, canMarkComplete: false });
  });

  it("does not treat workbook errors, aliases, duplicates or mass-to-volume as resolved data", () => {
    const preview = previewCogsWorkbook(rows, "cogs-betea.xlsx", "b".repeat(64));
    const reasons = preview.reviewItems.map((item) => `${item.sourceCell}: ${item.reason}`);

    expect(reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("G24"),
      expect.stringContaining("F35"),
      expect.stringContaining("F50"),
      expect.stringContaining("E54"),
      expect.stringContaining("F58"),
      expect.stringContaining("Trà Kiwi!C18"),
      expect.stringContaining("Matcha Latte!F27"),
    ]));
    expect(preview.ingredients.some((ingredient) => ingredient.name === "Mứt Vải Hoa Hồng")).toBe(false);
    expect(preview.ingredients.some((ingredient) => ingredient.name === "Đường nâu Hàn Quốc")).toBe(false);
    expect(preview.ingredients.some((ingredient) => ingredient.name === "Mật ong")).toBe(false);
  });

  it("keeps explicit same-dimension package conversions and holds unconfirmed liter yield", () => {
    const preview = previewCogsWorkbook({
      rawIngredients: [
        { row: 33, name: "Ice hot", purchaseUnit: "HỘP (450ml)", priceVnd: 48000, packageQuantity: 450, costName: "Ice hot", costUnit: "Ml" },
        { row: 39, name: "Sữa tươi", purchaseUnit: "L", priceVnd: 33000, packageQuantity: 900, costName: "Sữa tươi", costUnit: "Ml" },
      ], recipeWarnings: [],
    }, "cogs-betea.xlsx", "e".repeat(64));

    expect(preview.ingredients).toHaveLength(1);
    expect(preview.unitConversions).toContainEqual({ fromUnit: "hộp (450ml)", toUnit: "ml", factor: "450", sourceTrace: { sheet: "Bảng NVl", cell: "C33" } });
    expect(preview.reviewItems[0].sourceCell).toContain("C39:G39");
    const recipeDocument: RecipeCostDocument = { unitConversions: preview.unitConversions, ingredients: preview.ingredients, batches: [], products: [] };
    expect(calculateRecipeCosts(recipeDocument).ingredients[preview.ingredients[0].id]?.unitCostVnd).toBe("106.66666667");
  });

  it("assigns stable distinct review keys when several formula issues share a cell", () => {
    const preview = previewCogsWorkbook({ rawIngredients: [], recipeWarnings: [
      { sheet: "Trà Kiwi", cell: "C18", kind: "cached_formula_error", message: "Cached error" },
      { sheet: "Trà Kiwi", cell: "C18", kind: "suspicious_lookup", message: "Stale lookup" },
    ] }, "cogs-betea.xlsx", "f".repeat(64));

    expect(new Set(preview.reviewItems.map((item) => item.id)).size).toBe(2);
  });

  it("records the import and keeps any unresolved workbook rows open", () => {
    const preview = previewCogsWorkbook(rows, "cogs-betea.xlsx", "c".repeat(64));
    const empty: RecipeCostDocument = { ingredients: [], batches: [], products: [], unitConversions: [] };
    const saved = mergeCogsWorkbookImport(empty, preview, "2026-10-06T03:00:00.000Z", "2026-10-06");

    expect(saved.ingredients).toHaveLength(1);
    expect(saved.ingredients[0].effectiveDate).toBe("2026-10-06");
    expect(saved.importReview).toMatchObject({ complete: false, importedFiles: [{ sha256: "c".repeat(64), ingredientCount: 1 }] });
    expect(saved.importReview?.items).toHaveLength(7);
    expect(() => mergeCogsWorkbookImport(saved, preview, "2026-10-06T03:00:00.000Z")).toThrow("already been imported");
  });

  it("does not add a workbook ingredient over an existing workspace name", () => {
    const preview = previewCogsWorkbook(rows, "cogs-betea.xlsx", "d".repeat(64));
    const existing: RecipeCostDocument = {
      ingredients: [{ id: "existing-tea", name: "Hồng Trà Nguyên Lá", purchaseQuantity: "1", purchaseUnit: "kg", purchasePriceVnd: "140000", costUnit: "g" }],
      batches: [], products: [], unitConversions: [],
    };
    const saved = mergeCogsWorkbookImport(existing, preview, "2026-10-06T03:00:00.000Z");

    expect(saved.ingredients).toHaveLength(1);
    expect(saved.importReview?.items.some((item) => item.reason.includes("đã có trong workspace"))).toBe(true);
    expect(saved.importReview?.complete).toBe(false);
  });

  it("removes workspace name collisions from the preview total and creates one review item", () => {
    const preview = previewCogsWorkbook(rows, "cogs-betea.xlsx", "e".repeat(64));
    const existing: RecipeCostDocument = {
      ingredients: [{ id: "existing-tea", name: "hồng trà nguyên lá", purchaseQuantity: "1", purchaseUnit: "kg", purchasePriceVnd: "140000", costUnit: "g" }],
      batches: [], products: [], unitConversions: [],
    };

    const reviewed = reviewCogsPreviewAgainstWorkspace(preview, existing);
    const conflictItems = reviewed.reviewItems.filter((item) => item.reason.includes("đã có trong workspace"));

    expect(reviewed.ingredients).toHaveLength(0);
    expect(reviewed.summary).toMatchObject({ importableIngredients: 0, totalPurchasePriceVnd: "0", canMarkComplete: false });
    expect(conflictItems).toHaveLength(1);
    expect(conflictItems[0].name).toBe("Hồng Trà Nguyên Lá");
  });
});
