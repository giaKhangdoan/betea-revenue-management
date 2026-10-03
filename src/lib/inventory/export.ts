import { Buffer } from "node:buffer";
import type { createClient } from "@/lib/supabase/server";
import { currentBusinessDate } from "../finance/format";
import {
  compareInventoryTimestamps,
  formatInventoryMicros,
  formatInventoryQuantity,
  getFinalizedInventoryCountHistory,
  sameInventoryUnit,
  summarizeInventoryMovement,
  toInventoryMicros,
  type InventoryCount,
  type InventoryCountItem,
  type InventoryFinalizedCount,
} from "./counts";
import { getInventoryReceipts, type InventoryReceipt } from "./receipts";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryExportCount = InventoryCount & { items: InventoryCountItem[] };

export type InventoryExportData = {
  counts: InventoryExportCount[];
  finalizedCounts: InventoryFinalizedCount[];
  receipts: InventoryReceipt[];
};

async function getCountsInRange(supabase: ServerSupabaseClient, ownerId: string, from: string, to: string) {
  const headers: InventoryCount[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("inventory_counts")
      .select("id,business_date,status,created_at,updated_at,finalized_at")
      .eq("owner_id", ownerId).gte("business_date", from).lte("business_date", to)
      .order("business_date").order("id").range(offset, offset + 999);
    if (error) return { data: [] as InventoryExportCount[], error: true };
    headers.push(...data ?? []);
    if ((data?.length ?? 0) < 1000) break;
  }

  const itemsByCount = new Map<string, InventoryCountItem[]>();
  for (let offset = 0; offset < headers.length; offset += 1000) {
    const ids = headers.slice(offset, offset + 1000).map(({ id }) => id);
    for (let itemOffset = 0; ; itemOffset += 1000) {
      const { data, error } = await supabase.from("inventory_count_items")
        .select("count_id,item_id,item_name,category,large_unit,conversion_factor,small_unit,large_quantity,small_quantity,counted_quantity,counted_at,sort_order")
        .eq("owner_id", ownerId).in("count_id", ids)
        .order("count_id").order("sort_order").order("category").order("item_name").range(itemOffset, itemOffset + 999);
      if (error) return { data: [] as InventoryExportCount[], error: true };
      for (const item of data ?? []) {
        const items = itemsByCount.get(item.count_id) ?? [];
        items.push(item);
        itemsByCount.set(item.count_id, items);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  return {
    data: headers.map((count) => ({ ...count, items: itemsByCount.get(count.id) ?? [] })),
    error: false,
  };
}

export async function getInventoryExportData(supabase: ServerSupabaseClient, ownerId: string, from: string, to: string) {
  const [counts, finalized, receipts] = await Promise.all([
    getCountsInRange(supabase, ownerId, from, to),
    getFinalizedInventoryCountHistory(supabase, ownerId),
    getInventoryReceipts(supabase, ownerId),
  ]);
  return {
    data: { counts: counts.data, finalizedCounts: finalized.data, receipts: receipts.data },
    error: counts.error || finalized.error || receipts.error,
  };
}

type ReceiptLineResult = { reference: string; result: string };

function receiptResults(data: InventoryExportData) {
  const finalized = [...data.finalizedCounts]
    .sort((a, b) => compareInventoryTimestamps(a.finalized_at, b.finalized_at) || a.id.localeCompare(b.id));
  const receipts = [...data.receipts].sort((a, b) => compareInventoryTimestamps(a.received_at, b.received_at) || a.id.localeCompare(b.id));
  const resultByLineId = new Map<string, ReceiptLineResult>();
  let countIndex = 0;
  let baseline: InventoryFinalizedCount | null = null;
  let receivedByItem = new Map<string, { quantity: bigint; unit: string; compatible: boolean }>();

  for (const receipt of receipts) {
    while (countIndex < finalized.length && compareInventoryTimestamps(finalized[countIndex].finalized_at, receipt.received_at) < 0) {
      baseline = finalized[countIndex++];
      receivedByItem = new Map();
    }
    const baselineItems = new Map(baseline?.items.map((item) => [item.item_id, item]) ?? []);
    for (const line of receipt.lines) {
      const quantity = toInventoryMicros(line.converted_quantity);
      if (quantity === null) {
        resultByLineId.set(line.id, { reference: "", result: "Hai đơn vị được lưu riêng, không quy đổi" });
        continue;
      }
      const priorReceived = receivedByItem.get(line.item_id);
      const received = (priorReceived?.quantity ?? BigInt(0)) + quantity;
      const compatible = (priorReceived?.compatible ?? true)
        && (!priorReceived || sameInventoryUnit(priorReceived.unit, line.small_unit));
      receivedByItem.set(line.item_id, {
        quantity: received,
        unit: priorReceived?.unit ?? line.small_unit,
        compatible,
      });
      const referenceItem = baselineItems.get(line.item_id);
      const referenceQuantity = referenceItem ? toInventoryMicros(referenceItem.counted_quantity) : null;
      const unitsMatch = compatible && (!referenceItem || sameInventoryUnit(referenceItem.small_unit, line.small_unit));
      resultByLineId.set(line.id, {
        reference: referenceItem && referenceQuantity !== null
          ? `${baseline!.business_date} · ${formatInventoryQuantity(referenceItem.counted_quantity)} ${referenceItem.small_unit}`
          : "",
        result: referenceQuantity === null
          ? ""
          : unitsMatch
            ? `${formatInventoryMicros(referenceQuantity + received)} ${line.small_unit}`
            : "Không so sánh được do đổi đơn vị",
      });
    }
  }
  return resultByLineId;
}

function xmlEscape(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function excelNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const text = String(value);
  if (text.replace(/\D/g, "").replace(/^0+/, "").length > 15) return text;
  const number = Number(value);
  return Number.isFinite(number) ? number : text;
}

function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function worksheetXml(rows: (string | number | null | undefined)[][]) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const columns = Array.from({ length: width }, (_, column) => {
    const maxLength = Math.max(10, ...rows.map((row) => String(row[column] ?? "").length));
    return `<col min="${column + 1}" max="${column + 1}" width="${Math.min(48, maxLength + 2)}" customWidth="1"/>`;
  }).join("");
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === undefined || value === "") return "";
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${reference}"${rowIndex === 0 ? ' s="1"' : ""}><v>${value}</v></c>`;
      }
      return `<c r="${reference}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastCell = `${columnName(width - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ponytail: store-only ZIP avoids a dependency; use ZIP64 if exports outgrow classic ZIP limits.
function zip(files: [string, string][]) {
  const localFiles: Buffer[] = [];
  const directoryEntries: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const filename = Buffer.from(name, "utf8");
    const body = Buffer.from(content, "utf8");
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localFiles.push(local, filename, body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    directoryEntries.push(directory, filename);
    offset += local.length + filename.length + body.length;
  }

  const directory = Buffer.concat(directoryEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localFiles, directory, end]);
}

export function createInventoryWorkbook(data: InventoryExportData, from: string, to: string) {
  const allReceipts = data.receipts;
  const selectedReceipts = allReceipts.filter((receipt) => {
    const date = currentBusinessDate(new Date(receipt.received_at));
    return date >= from && date <= to;
  });
  const results = receiptResults(data);
  const movement = summarizeInventoryMovement(data.finalizedCounts, allReceipts);
  const movementByCount = new Map(movement.periods.map((period) => [period.current_count.id,
    new Map(period.items.map((item) => [item.item_id, item.movement_quantity === null
      ? item.unit_changed ? "Không so sánh được do đổi đơn vị" : item.conversion_unavailable ? "Không có hệ số quy đổi" : ""
      : `${item.movement_sign === -1 ? "−" : item.movement_sign === 1 ? "+" : ""}${item.movement_quantity} ${item.small_unit}`])),
  ]));

  const receivingRows: (string | number | null)[][] = [[
    "Mã phiếu", "Thời điểm", "Mặt hàng", "Nhóm", "Mốc kiểm tham chiếu", "Đơn vị 1", "Hệ số quy đổi",
    "Đơn vị 2", "Số lượng ĐV1", "Số lượng ĐV2", "Lượng quy đổi (nếu có)", "Tổng mốc + nhập quy đổi (nếu có)",
  ]];
  for (const receipt of selectedReceipts) {
    for (const line of receipt.lines) {
      const result = results.get(line.id);
      receivingRows.push([
        receipt.receipt_code,
        new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(receipt.received_at)),
        line.item_name,
        line.category,
        result?.reference ?? "",
        line.large_unit ?? "",
        excelNumber(line.conversion_factor),
        line.small_unit,
        line.large_unit == null ? null : excelNumber(line.large_quantity),
        excelNumber(line.loose_quantity),
        excelNumber(line.converted_quantity),
        result?.result ?? "",
      ]);
    }
  }

  const stockRows: (string | number | null)[][] = [[
    "Ngày", "Mặt hàng", "Nhóm", "Đơn vị 1", "Hệ số quy đổi", "Đơn vị 2", "Số lượng ĐV1", "Số lượng ĐV2",
    "Tổng quy đổi (nếu có)", "Trạng thái", "Biến động giữa hai mốc",
  ]];
  for (const count of data.counts) {
    const counted = count.items.filter((item) => item.counted_at != null).length;
    const status = count.status === "finalized" ? "Đã chốt" : `Chưa hoàn tất · bản nháp (${counted}/${count.items.length} đã đếm)`;
    const movements = movementByCount.get(count.id);
    if (count.items.length === 0) {
      stockRows.push([count.business_date, "", "", "", "", "", null, null, null, status, ""]);
      continue;
    }
    for (const item of count.items) {
      stockRows.push([
        count.business_date,
        item.item_name,
        item.category,
        item.large_unit ?? "",
        excelNumber(item.conversion_factor),
        item.small_unit,
        item.large_quantity === null ? null : excelNumber(item.large_quantity),
        item.small_quantity === null ? null : excelNumber(item.small_quantity),
        excelNumber(item.counted_quantity),
        status,
        movements?.get(item.item_id) ?? "",
      ]);
    }
  }

  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Nhập kho" sheetId="1" r:id="rId1"/><sheet name="Tồn kho" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", worksheetXml(receivingRows)],
    ["xl/worksheets/sheet2.xml", worksheetXml(stockRows)],
  ]);
}
