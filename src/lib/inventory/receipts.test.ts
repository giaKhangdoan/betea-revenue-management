import { describe, expect, it } from "vitest";
import {
  calculateConvertedReceiptQuantity,
  calculateInventoryReceiptOutlier,
  getInventoryReceiptPage,
  parseInventoryHistoryCursor,
} from "./receipts";

type QueryLog = { table: string; filters: [string, unknown, unknown?][] };

function createSupabaseMock(headers: Record<string, unknown>[]) {
  const queries: QueryLog[] = [];
  const client = {
    from(table: string) {
      const log: QueryLog = { table, filters: [] };
      queries.push(log);
      const query = {
        select: (...values: unknown[]) => { log.filters.push(["select", values[0]]); return query; },
        eq: (column: string, value: unknown) => { log.filters.push(["eq", column, value]); return query; },
        gte: (column: string, value: unknown) => { log.filters.push(["gte", column, value]); return query; },
        lt: (column: string, value: unknown) => { log.filters.push(["lt", column, value]); return query; },
        in: (column: string, value: unknown) => { log.filters.push(["in", column, value]); return query; },
        or: (value: string) => { log.filters.push(["or", value]); return query; },
        order: (column: string, options?: unknown) => { log.filters.push(["order", column, options]); return query; },
        limit: (value: number) => { log.filters.push(["limit", value]); return query; },
        range: (from: number, to: number) => { log.filters.push(["range", from, to]); return query; },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
          let data: unknown[] = [];
          if (table === "inventory_receipts") data = headers;
          if (table === "inventory_receipt_lines") data = headers.map((header, index) => ({
            id: `line-${index}`,
            receipt_id: header.id,
            item_id: "item-1",
            item_name: "Trà",
            category: "Nguyên liệu",
            large_unit: "Gói",
            large_quantity: "1",
            conversion_factor: "500",
            small_unit: "Gr",
            loose_quantity: "0",
            converted_quantity: "500",
          })).filter((line) => headers.some((header) => header.id === line.receipt_id));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client: client as never, queries };
}

const receipt = (id: string, index: number) => ({
  id,
  receipt_code: `PN-${index}`,
  received_at: `2026-10-0${index}T10:00:00.123456Z`,
  created_by: "owner",
  created_by_label: "Chủ",
  updated_at: `2026-10-0${index}T10:00:00.123456Z`,
});

describe("inventory receipt math", () => {
  it("previews package, conversion factor, and loose amount with exact decimal arithmetic", () => {
    expect(calculateConvertedReceiptQuantity("2", "500", "50.5")).toBe("1050.5");
    expect(calculateConvertedReceiptQuantity("3", "0.333", "0.001")).toBe("1");
    expect(calculateConvertedReceiptQuantity("2", null, "4")).toBeNull();
  });

  it("prompts only beyond five times the median and after three prior receipts", () => {
    expect(calculateInventoryReceiptOutlier("500", "100", 5)).toBeNull();
    expect(calculateInventoryReceiptOutlier("500.001", "100", 3)).toMatchObject({
      currentQuantity: "500.001",
      medianQuantity: "100",
      ratio: "5,01×",
    });
    expect(calculateInventoryReceiptOutlier("1000", "100", 2)).toBeNull();
    expect(calculateInventoryReceiptOutlier("2", "0", 5)).toBeNull();
  });
});

describe("bounded inventory receipt pages", () => {
  it("loads one bounded receipt page and no audit or count history on the receiving view", async () => {
    const headers = [receipt("00000000-0000-4000-8000-000000000003", 3), receipt("00000000-0000-4000-8000-000000000002", 2), receipt("00000000-0000-4000-8000-000000000001", 1)];
    const { client, queries } = createSupabaseMock(headers);
    const page = await getInventoryReceiptPage(client, "owner-id", { limit: 2 });

    expect(page.data).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ receivedAt: headers[1].received_at, id: headers[1].id });
    expect(queries.find((query) => query.table === "inventory_receipts")?.filters).toContainEqual(["limit", 3]);
    expect(queries.filter((query) => query.table === "inventory_receipt_lines")).toHaveLength(2);
    expect(queries.every((query) => !["inventory_counts", "inventory_count_versions", "inventory_receipt_versions", "inventory_receipt_corrections"].includes(query.table))).toBe(true);
  });

  it("uses a precision-preserving keyset cursor and bounded audit readers only on request", async () => {
    const headers = [receipt("00000000-0000-4000-8000-000000000002", 2)];
    const { client, queries } = createSupabaseMock(headers);
    const cursor = { beforeAt: "2026-10-02T10:00:00.123456Z", beforeId: "00000000-0000-4000-8000-000000000003" };
    expect(parseInventoryHistoryCursor(cursor.beforeAt, cursor.beforeId)?.beforeAt).toBe(cursor.beforeAt);
    const page = await getInventoryReceiptPage(client, "owner-id", { ...cursor, includeHistory: true, limit: 60 });

    expect(page.error).toBe(false);
    expect(queries.find((query) => query.table === "inventory_receipts")?.filters).toContainEqual([
      "or", `received_at.lt.${cursor.beforeAt},and(received_at.eq.${cursor.beforeAt},id.lt.${cursor.beforeId})`,
    ]);
    expect(queries.filter((query) => ["inventory_receipt_versions", "inventory_receipt_corrections"].includes(query.table))
      .every((query) => query.filters.some(([method, value]) => method === "limit" && value === 51))).toBe(true);
    expect(parseInventoryHistoryCursor("2026-10-02T10:00:00.123456Z", "not-a-uuid")).toBeNull();
  });
});
