import { describe, expect, it } from "vitest";
import { getInventoryCountCorrections } from "./count-corrections";

describe("inventory count correction history pages", () => {
  it("loads one stable, bounded page and returns a cursor when older corrections exist", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      corrected_at: "2026-10-06T12:00:00.000000Z",
      corrected_by: "owner-id",
      corrected_by_label: "Chủ",
      reason: `Lần ${index + 1}`,
      prior_items: [],
      updated_items: [],
    }));
    const orders: { column: string; options: { ascending: boolean } }[] = [];
    const calls = { limit: 0, cursor: "" };
    const query = {
      select: () => query,
      eq: () => query,
      order: (column: string, options: { ascending: boolean }) => { orders.push({ column, options }); return query; },
      limit: (value: number) => { calls.limit = value; return query; },
      or: (value: string) => { calls.cursor = value; return query; },
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    const client = { from: () => query };

    const page = await getInventoryCountCorrections(client as never, "owner-id", "count-id", { limit: 20 });

    expect(calls.limit).toBe(21);
    expect(orders).toEqual([
      { column: "corrected_at", options: { ascending: false } },
      { column: "id", options: { ascending: false } },
    ]);
    expect(page.data).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ correctedAt: rows[19].corrected_at, id: rows[19].id });

    await getInventoryCountCorrections(client as never, "owner-id", "count-id", {
      beforeAt: rows[19].corrected_at,
      beforeId: rows[19].id,
    });
    expect(calls.cursor).toBe(`corrected_at.lt.${rows[19].corrected_at},and(corrected_at.eq.${rows[19].corrected_at},id.lt.${rows[19].id})`);
  });

  it("rejects malformed cursor pairs without querying", async () => {
    const calls: string[] = [];
    const client = { from: () => { calls.push("from"); return {} as never; } };

    const page = await getInventoryCountCorrections(client as never, "owner-id", "count-id", {
      beforeAt: "2026-10-06T12:00:00Z",
      beforeId: "not-a-uuid",
    });

    expect(page).toEqual({ data: [], error: true, hasMore: false, nextCursor: null });
    expect(calls).toEqual([]);
  });
});
