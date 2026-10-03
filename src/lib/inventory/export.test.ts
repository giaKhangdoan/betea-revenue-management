import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInventoryWorkbook, type InventoryExportData } from "./export";

function readStoredZip(buffer: Buffer) {
  const files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const filenameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const size = buffer.readUInt32LE(offset + 22);
    const filenameStart = offset + 30;
    const bodyStart = filenameStart + filenameLength + extraLength;
    const filename = buffer.toString("utf8", filenameStart, filenameStart + filenameLength);
    files.set(filename, buffer.toString("utf8", bodyStart, bodyStart + size));
    offset = bodyStart + size;
  }
  return files;
}

async function reopenWorkbook(workbook: Buffer) {
  const path = join(tmpdir(), `betea-inventory-${randomUUID()}.xlsx`);
  try {
    await writeFile(path, workbook);
    return readStoredZip(await readFile(path));
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

describe("inventory workbook", () => {
  it("writes and reopens two sheets, preserving zero separately from uncounted draft cells", async () => {
    const item = {
      item_id: "tea",
      item_name: "Trà",
      category: "Nguyên liệu",
      large_unit: "Bao",
      conversion_factor: "1000",
      small_unit: "Gr",
      large_quantity: null,
      small_quantity: null,
      counted_quantity: null,
    };
    const data: InventoryExportData = {
      counts: [{
        id: "draft",
        business_date: "2026-10-01",
        status: "draft",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
        finalized_at: null,
        items: [
          { ...item, large_quantity: "0", counted_quantity: "0", counted_at: "2026-10-01T01:00:00Z" },
          { ...item, item_id: "sugar", item_name: "Đường" },
        ],
      }],
      finalizedCounts: [],
      receipts: [],
    };
    const files = await reopenWorkbook(createInventoryWorkbook(data, "2026-10-01", "2026-10-01"));
    const workbook = files.get("xl/workbook.xml") ?? "";
    const stock = files.get("xl/worksheets/sheet2.xml") ?? "";

    expect(workbook).toContain('name="Nhập kho"');
    expect(workbook).toContain('name="Tồn kho"');
    expect(stock).toContain("Chưa hoàn tất · bản nháp (1/2 đã đếm)");
    expect(stock).toContain('<c r="I2"><v>0</v></c>');
    expect(stock).not.toContain('r="I3"');
  });

  it("saves and reopens receipt snapshots with their historical factor and selected date", async () => {
    const line = {
      id: "line-1",
      receipt_id: "receipt-1",
      item_id: "tea",
      item_name: "Trà",
      category: "Nguyên liệu",
      large_unit: "Hộp",
      large_quantity: "1",
      conversion_factor: "1200",
      small_unit: "Ml",
      loose_quantity: "0",
      converted_quantity: "1200",
    };
    const data: InventoryExportData = {
      counts: [],
      finalizedCounts: [{
        id: "baseline",
        business_date: "2026-10-02",
        finalized_at: "2026-10-02T10:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "Ml", counted_quantity: "10" }],
      }],
      receipts: [
        {
          id: "receipt-1",
          receipt_code: "PN-20261003-000001",
          received_at: "2026-10-03T10:00:00.000Z",
          created_by: "owner",
          created_by_label: "Chủ",
          updated_at: "2026-10-03T10:00:00.000Z",
          lines: [line, {
            ...line,
            id: "line-single",
            item_id: "cup",
            item_name: "Ly 12oz",
            large_unit: null,
            large_quantity: "0",
            conversion_factor: null,
            small_unit: "Cái",
            loose_quantity: "7",
            converted_quantity: "7",
          }, {
            ...line,
            id: "line-no-factor",
            item_id: "trash-bag",
            item_name: "Bao rác",
            large_unit: "Túi",
            large_quantity: "2",
            conversion_factor: null,
            small_unit: "Cuộn",
            loose_quantity: "5",
            converted_quantity: null,
          }],
          corrections: [],
          staff_editable: false,
        },
        {
          id: "receipt-2",
          receipt_code: "PN-20261004-000002",
          received_at: "2026-10-04T10:00:00.000Z",
          created_by: "owner",
          created_by_label: "Chủ",
          updated_at: "2026-10-04T10:00:00.000Z",
          lines: [{ ...line, id: "line-2", receipt_id: "receipt-2" }],
          corrections: [],
          staff_editable: false,
        },
      ],
    };
    const files = await reopenWorkbook(createInventoryWorkbook(data, "2026-10-03", "2026-10-03"));
    const receiving = files.get("xl/worksheets/sheet1.xml") ?? "";

    expect(receiving).toContain("PN-20261003-000001");
    expect(receiving).not.toContain("PN-20261004-000002");
    expect(receiving).toContain('<c r="I2"><v>1</v></c>');
    expect(receiving).not.toContain('r="I3"');
    expect(receiving).toContain('<c r="J3"><v>7</v></c>');
    expect(receiving).toContain('<c r="I4"><v>2</v></c>');
    expect(receiving).toContain('<c r="J4"><v>5</v></c>');
    expect(receiving).not.toContain('r="K4"');
    expect(receiving).toContain("Hai đơn vị được lưu riêng, không quy đổi");
    expect(receiving).toContain("1200");
    expect(receiving).toContain("2026-10-02 · 10 Ml");
    expect(receiving).toContain("1.210 Ml");
  });
});
