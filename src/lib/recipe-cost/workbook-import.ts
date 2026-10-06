import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { add, formatDecimal, parseDecimal } from "./units";
import type { RecipeCostDocument, RecipeIngredient, UnitConversion } from "./types";

export type WorkbookWarning = {
  sheet: string;
  cell: string;
  kind: "cached_formula_error" | "missing_formula_cache" | "external_workbook" | "suspicious_lookup" | "recipe_not_imported";
  message: string;
};

export type CogsRawIngredientRow = {
  row: number;
  name: string | null;
  purchaseUnit: string | null;
  priceVnd: number | null;
  packageQuantity: number | null;
  costName: string | null;
  costUnit: string | null;
  formulaCells?: string[];
  formulaErrors?: string[];
};

export type CogsWorkbookRows = {
  rawIngredients: CogsRawIngredientRow[];
  recipeWarnings: WorkbookWarning[];
};

export type WorkbookImportReviewItem = {
  id: string;
  sourceCell: string;
  name: string;
  reason: string;
  required: boolean;
  resolutionNote?: string;
  resolvedAt?: string;
  resolvedBy?: string;
};

export type CogsWorkbookPreview = {
  filename: string;
  sha256: string;
  ingredients: RecipeIngredient[];
  unitConversions: UnitConversion[];
  reviewItems: WorkbookImportReviewItem[];
  summary: {
    importableIngredients: number;
    totalPurchasePriceVnd: string;
    reviewItems: number;
    recipeWarnings: number;
    canMarkComplete: boolean;
  };
};

type Unit = { normalized: string; dimension: "mass" | "volume" | "count" };

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
}

function unit(value: string): Unit | null {
  const key = normalizedName(value).replace(/\./g, "");
  if (["kg", "kilogram", "kilograms"].includes(key)) return { normalized: "kg", dimension: "mass" };
  if (["gr", "g", "gram", "grams"].includes(key)) return { normalized: "g", dimension: "mass" };
  if (["ml", "mililit", "milliliter", "milliliters"].includes(key)) return { normalized: "ml", dimension: "volume" };
  if (["l", "lit", "liter", "liters"].includes(key)) return { normalized: "l", dimension: "volume" };
  if (["cái", "cai", "pcs", "piece"].includes(key)) return { normalized: "cái", dimension: "count" };
  if (["viên", "vien"].includes(key)) return { normalized: "viên", dimension: "count" };
  if (["trái", "trai"].includes(key)) return { normalized: "trái", dimension: "count" };
  return null;
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("Workbook number is not finite");
  return String(value);
}

function packageDefinition(label: string): { quantity: number; unit: Unit } | null {
  const match = label.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|l|viên|vien|cái|cai)(?=\s|\)|$)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  const parsedUnit = unit(match[2]);
  if (!Number.isFinite(amount) || amount <= 0 || !parsedUnit) return null;
  if (parsedUnit.normalized === "kg") return { quantity: amount * 1000, unit: { normalized: "g", dimension: "mass" } };
  if (parsedUnit.normalized === "l") return { quantity: amount * 1000, unit: { normalized: "ml", dimension: "volume" } };
  return { quantity: amount, unit: parsedUnit };
}

function sourceId(hash: string, sourceCell: string): string {
  return `cogs-${hash.slice(0, 8)}-${sourceCell.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
}

function reviewItem(hash: string, sourceCell: string, name: string, reason: string): WorkbookImportReviewItem {
  return { id: sourceId(hash, sourceCell), sourceCell, name, reason, required: true };
}

function importRawIngredient(
  row: CogsRawIngredientRow,
  hash: string,
): { ingredient: RecipeIngredient; conversion?: UnitConversion } | { issue: WorkbookImportReviewItem } {
  const sourceCell = `Bảng NVl!B${row.row}`;
  const name = row.name?.trim() ?? "";
  if (!name || !row.purchaseUnit?.trim() || !row.costName?.trim() || !row.costUnit?.trim()) {
    return { issue: reviewItem(hash, sourceCell, name || `Dòng ${row.row}`, "Thiếu tên hoặc đơn vị nguồn; cần kiểm tra trên workbook.") };
  }
  const formulas = row.formulaCells ?? [];
  if (formulas.length > 0) {
    const details = row.formulaErrors?.length ? ` Có ô lỗi công thức: ${row.formulaErrors.join(", ")}.` : "";
    return { issue: reviewItem(hash, sourceCell, name, `Ô dữ liệu đầu vào có công thức (${formulas.join(", ")}); không tự lấy cache làm dữ liệu.${details}`) };
  }
  if (normalizedName(name) !== normalizedName(row.costName)) {
    return { issue: reviewItem(hash, `Bảng NVl!F${row.row}`, name, `Tên bảng cost là “${row.costName}”, khác tên mua “${name}”; cần xác nhận alias.`) };
  }
  if (row.priceVnd === null || row.packageQuantity === null || row.priceVnd < 0 || row.packageQuantity <= 0) {
    return { issue: reviewItem(hash, `Bảng NVl!D${row.row}:E${row.row}`, name, "Giá hoặc số lượng mua thiếu, bằng 0, hay không phải số cố định.") };
  }

  const costUnit = unit(row.costUnit);
  const purchaseUnit = unit(row.purchaseUnit);
  const explicitPackage = packageDefinition(row.purchaseUnit);
  let purchaseQuantity: number;
  let normalizedPurchaseUnit: string;
  let conversion: UnitConversion | undefined;

  if (purchaseUnit && costUnit && purchaseUnit.normalized === costUnit.normalized) {
    purchaseQuantity = row.packageQuantity;
    normalizedPurchaseUnit = purchaseUnit.normalized;
  } else if (purchaseUnit && costUnit && purchaseUnit.normalized === "kg" && costUnit.normalized === "g") {
    purchaseQuantity = 1;
    normalizedPurchaseUnit = "kg";
    conversion = { fromUnit: "kg", toUnit: "g", factor: decimal(row.packageQuantity), sourceTrace: { sheet: "Bảng NVl", cell: `E${row.row}` } };
  } else if (explicitPackage && costUnit && explicitPackage.unit.dimension === costUnit.dimension) {
    if (Math.abs(explicitPackage.quantity - row.packageQuantity) > 0.000001) {
      return { issue: reviewItem(hash, `Bảng NVl!C${row.row}:E${row.row}`, name, `Số lượng ghi trong tên gói (${explicitPackage.quantity}) không khớp khối lượng nguồn (${row.packageQuantity}).`) };
    }
    purchaseQuantity = 1;
    normalizedPurchaseUnit = row.purchaseUnit.trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
    conversion = { fromUnit: normalizedPurchaseUnit, toUnit: explicitPackage.unit.normalized, factor: decimal(row.packageQuantity), sourceTrace: { sheet: "Bảng NVl", cell: `C${row.row}` } };
  } else if (purchaseUnit && costUnit && purchaseUnit.dimension !== costUnit.dimension) {
    return { issue: reviewItem(hash, `Bảng NVl!C${row.row}:G${row.row}`, name, `Không tự đổi ${purchaseUnit.dimension === "mass" ? "khối lượng" : purchaseUnit.dimension === "volume" ? "thể tích" : "số lượng"} sang ${costUnit.dimension === "mass" ? "khối lượng" : costUnit.dimension === "volume" ? "thể tích" : "số lượng"}.`) };
  } else if (purchaseUnit && costUnit && purchaseUnit.dimension === costUnit.dimension) {
    return { issue: reviewItem(hash, `Bảng NVl!C${row.row}:G${row.row}`, name, "Đơn vị mua và đơn vị cost khác nhau; cần nhập hệ số quy đổi đã xác nhận.") };
  } else {
    return { issue: reviewItem(hash, `Bảng NVl!C${row.row}:G${row.row}`, name, "Đơn vị gói không nhận diện được; cần xác nhận hệ số quy đổi.") };
  }

  return {
    ingredient: {
      id: sourceId(hash, `B${row.row}`),
      name,
      purchaseQuantity: decimal(purchaseQuantity),
      purchaseUnit: normalizedPurchaseUnit,
      purchasePriceVnd: decimal(row.priceVnd),
      costUnit: costUnit!.normalized,
      sourceTrace: { sheet: "Bảng NVl", cell: `B${row.row}`, priceCell: `D${row.row}`, quantityCell: `E${row.row}` },
    },
    conversion,
  };
}

export function previewCogsWorkbook(rows: CogsWorkbookRows, filename: string, sha256: string): CogsWorkbookPreview {
  if (!/^[a-f\d]{64}$/i.test(sha256)) throw new RangeError("Workbook SHA-256 is invalid");
  const rowNameCounts = new Map<string, number>();
  rows.rawIngredients.forEach((row) => {
    const key = row.costName ? normalizedName(row.costName) : "";
    if (key) rowNameCounts.set(key, (rowNameCounts.get(key) ?? 0) + 1);
  });
  const ingredients: RecipeIngredient[] = [];
  const unitConversions: UnitConversion[] = [];
  const reviewItems: WorkbookImportReviewItem[] = [];
  const conversionKeys = new Set<string>();

  for (const row of rows.rawIngredients) {
    const duplicateName = row.costName && (rowNameCounts.get(normalizedName(row.costName)) ?? 0) > 1;
    if (duplicateName) {
      reviewItems.push(reviewItem(sha256, `Bảng NVl!F${row.row}`, row.name ?? `Dòng ${row.row}`, `Tên “${row.costName}” xuất hiện ở nhiều dòng nguồn; không tự gộp.`));
      continue;
    }
    const mapped = importRawIngredient(row, sha256);
    if ("issue" in mapped) {
      reviewItems.push(mapped.issue);
      continue;
    }
    ingredients.push(mapped.ingredient);
    if (mapped.conversion) {
      const key = `${mapped.conversion.fromUnit.toLocaleLowerCase("vi-VN")}->${mapped.conversion.toUnit.toLocaleLowerCase("vi-VN")}:${mapped.conversion.factor}`;
      if (!conversionKeys.has(key)) {
        conversionKeys.add(key);
        unitConversions.push(mapped.conversion);
      }
    }
  }

  rows.recipeWarnings.forEach((warning) => {
    const sourceCell = `${warning.sheet}!${warning.cell}`;
    reviewItems.push(reviewItem(sha256, sourceCell, warning.sheet, warning.message));
  });
  const uniqueReviewItems = reviewItems.map((item, index) => ({ ...item, id: `${item.id}-${index + 1}` }));
  const totalPurchasePrice = ingredients.reduce((sum, ingredient) => add(sum, parseDecimal(ingredient.purchasePriceVnd ?? "0")), parseDecimal("0"));
  return {
    filename,
    sha256: sha256.toLowerCase(),
    ingredients,
    unitConversions,
    reviewItems: uniqueReviewItems,
    summary: {
      importableIngredients: ingredients.length,
      totalPurchasePriceVnd: formatDecimal(totalPurchasePrice),
      reviewItems: uniqueReviewItems.length,
      recipeWarnings: rows.recipeWarnings.length,
      canMarkComplete: uniqueReviewItems.length === 0,
    },
  };
}

export function reviewCogsPreviewAgainstWorkspace(preview: CogsWorkbookPreview, document: RecipeCostDocument): CogsWorkbookPreview {
  const existingNames = new Set(document.ingredients.map((ingredient) => normalizedName(ingredient.name)));
  const importable: RecipeIngredient[] = [];
  const conflicts: WorkbookImportReviewItem[] = [];
  for (const ingredient of preview.ingredients) {
    if (existingNames.has(normalizedName(ingredient.name))) {
      const sourceCell = `Bảng NVl!${ingredient.sourceTrace?.cell ?? "?"}`;
      conflicts.push(reviewItem(preview.sha256, sourceCell, ingredient.name, "Nguyên liệu cùng tên đã có trong workspace; cần chọn cập nhật hay giữ riêng trước khi nhập."));
    } else {
      existingNames.add(normalizedName(ingredient.name));
      importable.push(ingredient);
    }
  }
  const reviewItems = [...preview.reviewItems, ...conflicts].map((item, index) => ({ ...item, id: `${item.id}-${index + 1}` }));
  const totalPurchasePrice = importable.reduce((sum, ingredient) => add(sum, parseDecimal(ingredient.purchasePriceVnd ?? "0")), parseDecimal("0"));
  return {
    ...preview,
    ingredients: importable,
    reviewItems,
    summary: {
      ...preview.summary,
      importableIngredients: importable.length,
      totalPurchasePriceVnd: formatDecimal(totalPurchasePrice),
      reviewItems: reviewItems.length,
      canMarkComplete: reviewItems.length === 0,
    },
  };
}

type CellFormulaValue = { formula?: string; sharedFormula?: string; result?: unknown };

function formulaDetails(value: unknown): { formula: string; result: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CellFormulaValue;
  const formula = candidate.formula ?? candidate.sharedFormula;
  return typeof formula === "string" ? { formula, result: candidate.result } : null;
}

function errorResult(value: unknown): string | null {
  if (typeof value === "string" && /^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)/i.test(value)) return value;
  if (value && typeof value === "object" && "error" in value) return String((value as { error: unknown }).error);
  return null;
}

function numericLiteral(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validateXlsxArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdMinimum = 22;
  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let index = bytes.byteLength - eocdMinimum; index >= searchStart; index -= 1) {
    if (view.getUint32(index, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(index + 20, true);
    if (index + eocdMinimum + commentLength === bytes.byteLength) { eocd = index; break; }
  }
  if (eocd < 0) throw new RangeError("Tệp không có cấu trúc ZIP/XLSX hoàn chỉnh.");
  const diskNumber = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new RangeError("Workbook nhiều phần hoặc ZIP64 không được hỗ trợ.");
  }
  if (entryCount < 1 || entryCount > 1000 || directoryOffset + directorySize > eocd) throw new RangeError("Workbook có cấu trúc ZIP bất thường.");

  let offset = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) throw new RangeError("Workbook có danh mục ZIP không hợp lệ.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (offset + entryLength > directoryOffset + directorySize || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new RangeError("Workbook có mục ZIP64 hoặc thiếu dữ liệu.");
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) throw new RangeError("Workbook được mã hóa hoặc dùng kiểu nén không hỗ trợ.");
    if (uncompressedSize > 10 * 1024 * 1024 || (uncompressedSize > 0 && compressedSize === 0) || (compressedSize > 0 && uncompressedSize / compressedSize > 100)) {
      throw new RangeError("Workbook có mục nén vượt giới hạn an toàn.");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > 20 * 1024 * 1024) throw new RangeError("Workbook giải nén vượt giới hạn 20 MB.");
    offset += entryLength;
  }
  if (offset !== directoryOffset + directorySize) throw new RangeError("Workbook có dữ liệu thừa trong danh mục ZIP.");
}

export async function parseCogsWorkbook(filename: string, bytes: Uint8Array): Promise<CogsWorkbookPreview> {
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) throw new RangeError("Workbook must be between 1 byte and 5 MB");
  validateXlsxArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  const workbookBytes = bytes.slice().buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(workbookBytes);
  const ingredientSheet = workbook.getWorksheet("Bảng NVl");
  const menuSheet = workbook.getWorksheet("Menu");
  if (!ingredientSheet || !menuSheet) throw new RangeError("Workbook is missing the expected Bảng NVl or Menu sheet");

  const rawIngredients: CogsRawIngredientRow[] = [];
  for (let row = 14; row <= 39; row += 1) {
    const cells = ["B", "C", "D", "E", "F", "G"] as const;
    const formulas: string[] = [];
    const errors: string[] = [];
    const values = new Map<string, unknown>();
    for (const column of cells) {
      const address = `${column}${row}`;
      const raw = ingredientSheet.getCell(address).value;
      const formula = formulaDetails(raw);
      if (formula) {
        formulas.push(address);
        values.set(column, formula.result);
        const error = errorResult(formula.result);
        if (error) errors.push(`${address} ${error}`);
      } else {
        values.set(column, raw);
      }
    }
    const name = values.get("B");
    if (typeof name !== "string" || !name.trim()) continue;
    rawIngredients.push({
      row,
      name,
      purchaseUnit: typeof values.get("C") === "string" ? values.get("C") as string : null,
      priceVnd: numericLiteral(values.get("D")),
      packageQuantity: numericLiteral(values.get("E")),
      costName: typeof values.get("F") === "string" ? values.get("F") as string : null,
      costUnit: typeof values.get("G") === "string" ? values.get("G") as string : null,
      formulaCells: formulas,
      formulaErrors: errors,
    });
  }

  const linkedRecipeSheets = new Set<string>();
  menuSheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
    const formula = formulaDetails(cell.value)?.formula;
    if (!formula) return;
    const match = formula.match(/!?['"]?([^'"!]+)['"]?!\$?[A-Z]{1,3}\$?\d+/);
    if (match && workbook.getWorksheet(match[1])) linkedRecipeSheets.add(match[1]);
  }));

  const recipeWarnings: WorkbookWarning[] = [];
  const costRowsOutsideRawTable = Array.from({ length: 16 }, (_, index) => index + 43)
    .filter((rowNumber) => Array.from({ length: 11 }, (_, columnIndex) => ingredientSheet.getCell(rowNumber, columnIndex + 1).value).some((value) => value !== null && value !== undefined && value !== ""));
  if (costRowsOutsideRawTable.length > 0) {
    recipeWarnings.push({
      sheet: "Bảng NVl",
      cell: "A43:K58",
      kind: "recipe_not_imported",
      message: `Khối giá/cost bổ sung có dữ liệu ở dòng ${costRowsOutsideRawTable.join(", ")}; chưa được nhập tự động và cần đối soát từng dòng.`,
    });
  }
  const batchSheet = workbook.getWorksheet("Bán Thành Phẩm");
  if (batchSheet) {
    for (const column of ["A", "G"] as const) {
      batchSheet.eachRow({ includeEmpty: false }, (row) => {
        const cell = batchSheet.getCell(`${column}${row.number}`);
        const title = typeof cell.value === "string" ? cell.value.trim() : "";
        const nextRowLabel = batchSheet.getCell(`${column}${row.number + 1}`).value;
        if (title && typeof nextRowLabel === "string" && normalizedName(nextRowLabel) === "nguyên liệu") {
          recipeWarnings.push({ sheet: batchSheet.name, cell: cell.address, kind: "recipe_not_imported", message: `Cốt/bán thành phẩm “${title}” chưa nhập tự động; cần đối soát các dòng nguyên liệu và sản lượng.` });
        }
      });
    }
    for (const row of [50, 58]) {
      const name = ingredientSheet.getCell(`F${row}`).value;
      if (typeof name === "string" && normalizedName(name) === "mật ong") {
        recipeWarnings.push({ sheet: "Bảng NVl", cell: `F${row}`, kind: "recipe_not_imported", message: "Tên cost này bị lặp ở dòng 50 và 58; cần xác nhận có phải cùng một nguyên liệu trước khi gộp." });
      }
    }
    for (const row of [51, 52]) {
      if (ingredientSheet.getCell(`B${row}`).value !== null) {
        recipeWarnings.push({ sheet: "Bảng NVl", cell: `B${row}`, kind: "recipe_not_imported", message: "Dòng placeholder có giá và lượng bằng 0; không nhập làm nguyên liệu." });
      }
    }
    const tắcQuantity = ingredientSheet.getCell("E54").value;
    if (formulaDetails(tắcQuantity)) recipeWarnings.push({ sheet: "Bảng NVl", cell: "E54", kind: "recipe_not_imported", message: "Số lượng mua là công thức =1000/20; không tự dùng kết quả cache làm lượng mua." });
    for (const cell of ["K51", "K52", "K53"]) {
      if (ingredientSheet.getCell(cell).value !== null) recipeWarnings.push({ sheet: "Bảng NVl", cell, kind: "recipe_not_imported", message: "Có dữ liệu trong khối không có nhãn; giữ lại để quản lý xác định ý nghĩa." });
    }
    recipeWarnings.push({ sheet: "Bảng NVl", cell: "D49:H53", kind: "recipe_not_imported", message: "Đơn giá Trân Châu Hoàng Kim trong bảng tổng khác giá tính từ mẻ bán thành phẩm; cần xác nhận nguồn chuẩn." });
    recipeWarnings.push({ sheet: "Bảng NVl", cell: "D53:H53", kind: "recipe_not_imported", message: "Cost Cốt Mãng Cầu trong bảng tổng khác cost từ công thức mẻ; cần xác nhận nguồn chuẩn." });
    for (const worksheet of workbook.worksheets) {
      if (!linkedRecipeSheets.has(worksheet.name)) continue;
      worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string" && /23\s*oz/i.test(cell.value)) {
          recipeWarnings.push({ sheet: worksheet.name, cell: cell.address, kind: "recipe_not_imported", message: "Tên bao bì ghi 23oz trong khi size L đã xác nhận là 22oz; cần kiểm tra trước khi nhập công thức." });
        }
      }));
    }
  }
  const nonRecipeSheetNames = new Set(["Bảng NVl", "Bán Thành Phẩm", "Menu", "GP Tổng"]);
  for (const worksheet of workbook.worksheets) {
    if (linkedRecipeSheets.has(worksheet.name)) {
      recipeWarnings.push({ sheet: worksheet.name, cell: "A1", kind: "recipe_not_imported", message: "Món có trong Menu nhưng công thức chưa được nhập tự động; cần đối soát từng dòng và size." });
    } else if (!nonRecipeSheetNames.has(worksheet.name)) {
      const populatedCells: string[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value !== null && cell.value !== undefined && cell.value !== "") populatedCells.push(cell.address);
      }));
      if (populatedCells.length > 0) {
        recipeWarnings.push({
          sheet: worksheet.name,
          cell: `${populatedCells[0]}:${populatedCells[populatedCells.length - 1]}`,
          kind: "recipe_not_imported",
          message: `Sheet có ${populatedCells.length} ô dữ liệu nhưng không được tham chiếu trong Menu; chưa nhập tự động và cần xác nhận có còn sử dụng không.`,
        });
      }
    }
    worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      const formula = formulaDetails(cell.value);
      if (!formula) return;
      const formulaError = errorResult(formula.result);
      if (formulaError) recipeWarnings.push({ sheet: worksheet.name, cell: cell.address, kind: "cached_formula_error", message: `Công thức có giá trị lỗi được lưu trong Excel (${formulaError}); không đổi thành 0.` });
      else if (formula.result === undefined) recipeWarnings.push({ sheet: worksheet.name, cell: cell.address, kind: "missing_formula_cache", message: "Excel không lưu giá trị kết quả cho công thức này." });
      if (/\[[^\]]+\]/.test(formula.formula)) recipeWarnings.push({ sheet: worksheet.name, cell: cell.address, kind: "external_workbook", message: "Công thức tham chiếu tới một workbook bên ngoài." });
      if (Number(cell.row) > 16 && /\$B\$16/i.test(formula.formula)) recipeWarnings.push({ sheet: worksheet.name, cell: cell.address, kind: "suspicious_lookup", message: "Công thức dùng tham chiếu cố định $B$16 ở dòng nguyên liệu khác; cần kiểm tra đơn vị/tên tra cứu." });
    }));
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const preview = previewCogsWorkbook({ rawIngredients, recipeWarnings }, filename, sha256);
  return preview;
}

export function mergeCogsWorkbookImport(document: RecipeCostDocument, preview: CogsWorkbookPreview, importedAt: string, effectiveDate = importedAt.slice(0, 10)): RecipeCostDocument {
  if (!Number.isFinite(Date.parse(importedAt))) throw new RangeError("Import time must be valid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(Date.parse(`${effectiveDate}T00:00:00Z`))) throw new RangeError("Effective date must be a calendar date");
  if (document.importReview?.importedFiles.some((file) => file.sha256 === preview.sha256)) throw new RangeError("This workbook has already been imported");
  const safePreview = reviewCogsPreviewAgainstWorkspace(preview, document);
  const freshIngredients = safePreview.ingredients.map((ingredient) => ({ ...ingredient, effectiveDate }));
  const allReviewItems = [...(document.importReview?.items ?? []), ...safePreview.reviewItems];
  const importedFiles = [
    ...(document.importReview?.importedFiles ?? []),
    { sha256: preview.sha256, filename: preview.filename.slice(0, 240), importedAt, ingredientCount: freshIngredients.length },
  ];
  return {
    ...document,
    ingredients: [...document.ingredients, ...freshIngredients],
    unitConversions: [...document.unitConversions, ...safePreview.unitConversions],
    importReview: {
      importedFiles,
      items: allReviewItems,
      complete: allReviewItems.length === 0,
    },
  };
}
