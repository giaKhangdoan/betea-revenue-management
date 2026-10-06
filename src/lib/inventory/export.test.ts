import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInventoryWorkbook, getInventoryExportData, getInventoryReceiptEventIdsBetween, isInventoryExportRangeWithinLimit, type InventoryExportData } from "./export";

type QueryLog = { table: string; filters: [string, string, unknown?][] };

function createEmptyExportSupabase() {
  const queries: QueryLog[] = [];
  const client = {
    from(table: string) {
      const log: QueryLog = { table, filters: [] };
      queries.push(log);
      const query = {
        select: (columns: string) => { log.filters.push(["select", columns]); return query; },
        eq: (column: string, value: unknown) => { log.filters.push(["eq", column, value]); return query; },
        gte: (column: string, value: unknown) => { log.filters.push(["gte", column, value]); return query; },
        lte: (column: string, value: unknown) => { log.filters.push(["lte", column, value]); return query; },
        lt: (column: string, value: unknown) => { log.filters.push(["lt", column, value]); return query; },
        not: (column: string, operator: string, value: unknown) => { log.filters.push(["not", column, `${operator}:${value}`]); return query; },
        order: (column: string) => { log.filters.push(["order", column]); return query; },
        range: (from: number, to: number) => { log.filters.push(["range", String(from), to]); return query; },
        limit: (value: number) => { log.filters.push(["limit", String(value)]); return query; },
        in: (column: string, value: unknown) => { log.filters.push(["in", column, value]); return query; },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return query;
    },
  };
  return { client: client as never, queries };
}

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
  it("bounds an export to its selected date window and rejects spans over one year", async () => {
    expect(isInventoryExportRangeWithinLimit("2026-01-01", "2026-01-01")).toBe(true);
    expect(isInventoryExportRangeWithinLimit("2025-01-01", "2026-01-02")).toBe(false);
    expect(isInventoryExportRangeWithinLimit("2026-02-30", "2026-03-01")).toBe(false);

    const { client, queries } = createEmptyExportSupabase();
    const result = await getInventoryExportData(client, "owner-id", "2026-10-01", "2026-10-31");

    expect(result.error).toBe(false);
    expect(queries.filter((query) => query.table === "inventory_receipt_versions")).toHaveLength(0);
    expect(queries.filter((query) => query.table === "inventory_receipts")
      .every((query) => query.filters.some(([method, column]) => method === "gte" && column === "received_at")
        && query.filters.some(([method, column]) => method === "lt" && column === "received_at"))).toBe(true);
    expect(queries.some((query) => query.table === "inventory_counts"
      && query.filters.some(([method, column]) => method === "gte" && column === "business_date")
      && query.filters.some(([method, column]) => method === "lte" && column === "business_date"))).toBe(true);
  });

  it("uses stable sort keys when same-time receipt events cross an export page boundary", async () => {
    const versions = Array.from({ length: 1001 }, (_, index) => ({ receipt_id: "receipt-1", sequence_no: index + 1 }));
    const orders: { table: string; column: string }[] = [];
    const ranges: { table: string; from: number; to: number }[] = [];
    const client = {
      from(table: string) {
        let from = 0;
        let to = 999;
        const query = {
          select: () => query,
          eq: () => query,
          gte: () => query,
          lte: () => query,
          order: (column: string) => { orders.push({ table, column }); return query; },
          range: (rangeFrom: number, rangeTo: number) => { from = rangeFrom; to = rangeTo; ranges.push({ table, from, to }); return query; },
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve({ data: table === "inventory_receipt_versions" ? versions.slice(from, to + 1) : [], error: null }).then(resolve, reject),
        };
        return query;
      },
    };

    const result = await getInventoryReceiptEventIdsBetween(client as never, "owner-id", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");

    expect(result).toEqual({ ids: ["receipt-1"], error: false });
    expect(ranges.filter(({ table }) => table === "inventory_receipt_versions")).toEqual([
      { table: "inventory_receipt_versions", from: 0, to: 999 },
      { table: "inventory_receipt_versions", from: 1000, to: 1999 },
    ]);
    expect(orders.filter(({ table }) => table === "inventory_receipt_versions").map(({ column }) => column)).toEqual([
      "effective_at", "receipt_id", "sequence_no", "effective_at", "receipt_id", "sequence_no",
    ]);
  });

  it("returns a safe size-limit error when selected stock-count items exceed the export budget", async () => {
    const count = {
      id: "count-1",
      business_date: "2026-10-01",
      status: "draft",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      finalized_at: null,
    };
    const oversizedItems = Array.from({ length: 50_001 }, (_, index) => ({
      count_id: "count-1",
      item_id: `item-${index}`,
      item_name: `Item ${index}`,
      category: "Nguyên liệu",
      large_unit: "Hộp",
      conversion_factor: "1",
      small_unit: "Cái",
      large_quantity: null,
      small_quantity: null,
      counted_quantity: null,
      counted_at: null,
      sort_order: index,
    }));
    const queryOrders: { table: string; column: string }[] = [];
    const client = {
      from(table: string) {
        const filters: [string, string][] = [];
        const query = {
          select: () => query,
          eq: (column: string) => { filters.push(["eq", column]); return query; },
          gte: (column: string) => { filters.push(["gte", column]); return query; },
          lte: (column: string) => { filters.push(["lte", column]); return query; },
          lt: () => query,
          not: () => query,
          order: (column: string) => { queryOrders.push({ table, column }); return query; },
          range: () => query,
          limit: () => query,
          in: () => query,
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) => {
            const data = table === "inventory_counts" && filters.some(([method, column]) => method === "gte" && column === "business_date")
              ? [count]
              : table === "inventory_count_items" ? oversizedItems : [];
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };

    const result = await getInventoryExportData(client as never, "owner-id", "2026-10-01", "2026-10-01");

    expect(result.error).toBe(true);
    expect(result.errorCode).toBe("too_large");
    expect(result.data.counts).toEqual([]);
    expect(queryOrders.filter(({ table }) => table === "inventory_count_items").map(({ column }) => column)).toEqual([
      "count_id", "sort_order", "category", "item_name", "item_id",
    ]);
  });

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
