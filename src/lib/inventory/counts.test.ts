import { describe, expect, it } from "vitest";
import { formatInventoryQuantity, getInventoryItemsNeedingRecount, summarizeInventoryMovement, type InventoryFinalizedCount, type InventoryMovementReceipt } from "./counts";
import type { InventoryCountItem } from "./counts";
import type { InventoryReceipt } from "./receipts";

describe("inventory movement", () => {
  it("uses the exclusive previous and inclusive next cutoff with exact signed quantities", () => {
    const counts: InventoryFinalizedCount[] = [
      {
        id: "first",
        business_date: "2026-09-01",
        finalized_at: "2026-09-01T10:00:00.000500Z",
        items: [
          { item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "10.125" },
          { item_id: "cup", item_name: "Ly", small_unit: "cái", counted_quantity: "1" },
          { item_id: "syrup", item_name: "Siro", small_unit: "ml", counted_quantity: "10.123456" },
        ],
      },
      {
        id: "second",
        business_date: "2026-09-05",
        finalized_at: "2026-09-05T10:00:00.000500Z",
        items: [
          { item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "8.125" },
          { item_id: "cup", item_name: "Ly", small_unit: "cái", counted_quantity: "5" },
          { item_id: "syrup", item_name: "Siro", small_unit: "ml", counted_quantity: "10.123457" },
        ],
      },
    ];
    const receipts: InventoryMovementReceipt[] = [
      { id: "before-first-cutoff", receipt_code: "PN-0", received_at: "2026-09-01T10:00:00.000499Z", created_by_label: "Chủ", lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "99" }] },
      { id: "at-first-cutoff", receipt_code: "PN-1", received_at: counts[0].finalized_at, created_by_label: "Chủ", lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "99" }] },
      { id: "just-after-first-cutoff", receipt_code: "PN-1A", received_at: "2026-09-01T10:00:00.000501Z", created_by_label: "Chủ", lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "0.001" }] },
      { id: "between", receipt_code: "PN-2", received_at: "2026-09-03T10:00:00.000Z", created_by_label: "Chủ", lines: [
        { item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "0.250" },
        { item_id: "cup", item_name: "Ly", small_unit: "cái", converted_quantity: "3" },
        { item_id: "syrup", item_name: "Siro", small_unit: "ml", converted_quantity: "0.001" },
      ] },
      { id: "at-second-cutoff", receipt_code: "PN-3", received_at: counts[1].finalized_at, created_by_label: "Chủ", lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "0.500" }] },
      { id: "after-second-cutoff", receipt_code: "PN-4", received_at: "2026-09-05T10:00:00.000501Z", created_by_label: "Chủ", lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "99" }] },
    ];

    const summary = summarizeInventoryMovement([...counts].reverse(), receipts);

    expect(summary.latest?.id).toBe("second");
    expect(summary.receiptsSinceLatest.map(({ id }) => id)).toEqual(["after-second-cutoff"]);
    expect(summary.periods[0].items.find(({ item_id }) => item_id === "tea")).toEqual({
      item_id: "tea", item_name: "Trà", small_unit: "g", previous_quantity: "10,125", received_quantity: "0,751", current_quantity: "8,125", movement_quantity: "2,751", movement_sign: 1,
    });
    expect(summary.periods[0].items.find(({ item_id }) => item_id === "cup")).toEqual({
      item_id: "cup", item_name: "Ly", small_unit: "cái", previous_quantity: "1", received_quantity: "3", current_quantity: "5", movement_quantity: "1", movement_sign: -1,
    });
    expect(summary.periods[0].items.find(({ item_id }) => item_id === "syrup")).toEqual({
      item_id: "syrup", item_name: "Siro", small_unit: "ml", previous_quantity: "10,123456", received_quantity: "0,001", current_quantity: "10,123457", movement_quantity: "0,000999", movement_sign: 1,
    });
    expect(summarizeInventoryMovement([], receipts)).toMatchObject({ latest: null, periods: [], receiptsSinceLatest: receipts });
  });

  it("formats large database decimals without converting through floating point", () => {
    expect(formatInventoryQuantity("999999999999999999999999.999")).toBe("999.999.999.999.999.999.999.999,999");
    expect(formatInventoryQuantity("0.000001")).toBe("0,000001");
  });

  it("does not combine or infer movement for items without a conversion factor", () => {
    const counts: InventoryFinalizedCount[] = ["before", "after"].map((id, index) => ({
      id,
      business_date: `2026-09-0${index + 1}`,
      finalized_at: `2026-09-0${index + 1}T10:00:00.000Z`,
      items: [{
        item_id: "trash-bag",
        item_name: "Bao rác",
        large_unit: "Túi",
        conversion_factor: null,
        large_quantity: index ? "3" : "2",
        small_quantity: index ? "7" : "5",
        small_unit: "Cuộn",
        counted_quantity: null,
      }],
    }));
    const receipts: InventoryMovementReceipt[] = [{
      id: "receipt",
      receipt_code: "PN-1",
      received_at: "2026-09-01T11:00:00.000Z",
      created_by_label: "Chủ",
      lines: [{ item_id: "trash-bag", item_name: "Bao rác", small_unit: "Cuộn", converted_quantity: null }],
    }];

    const item = summarizeInventoryMovement(counts, receipts).periods[0].items[0];
    expect(item).toMatchObject({
      item_name: "Bao rác",
      previous_quantity: null,
      received_quantity: "—",
      current_quantity: null,
      movement_quantity: null,
      movement_sign: null,
      conversion_unavailable: true,
    });
  });
});

describe("inventory recount requirements", () => {
  it("flags an item when a receipt was created or corrected after its saved count", () => {
    const makeItem = (itemId: string, countedAt: string | null): InventoryCountItem => ({
      item_id: itemId,
      item_name: itemId,
      category: "Nguyên liệu",
      large_unit: null,
      conversion_factor: null,
      small_unit: "Kg",
      large_quantity: null,
      small_quantity: "0",
      counted_quantity: "0",
      counted_at: countedAt,
    });
    const makeReceipt = (itemId: string, receivedAt: string, updatedAt: string): InventoryReceipt => ({
      id: `receipt-${itemId}`,
      receipt_code: `PN-${itemId}`,
      received_at: receivedAt,
      updated_at: updatedAt,
      created_by: "owner",
      created_by_label: "Chủ",
      staff_editable: true,
      lines: [{
        id: `line-${itemId}`,
        receipt_id: `receipt-${itemId}`,
        item_id: itemId,
        item_name: itemId,
        category: "Nguyên liệu",
        large_unit: null,
        large_quantity: "0",
        conversion_factor: null,
        small_unit: "Kg",
        loose_quantity: "1",
        converted_quantity: "1",
      }],
      corrections: [],
    });

    const items = [
      makeItem("received-later", "2026-10-06T09:00:00.000Z"),
      makeItem("corrected-later", "2026-10-06T09:00:00.000Z"),
      makeItem("same-cutoff", "2026-10-06T11:00:00.000Z"),
      makeItem("not-counted", null),
    ];
    const receipts = [
      makeReceipt("received-later", "2026-10-06T10:00:00.000Z", "2026-10-06T10:00:00.000Z"),
      makeReceipt("corrected-later", "2026-10-06T08:00:00.000Z", "2026-10-06T10:00:00.000Z"),
      makeReceipt("same-cutoff", "2026-10-06T11:00:00.000Z", "2026-10-06T11:00:00.000Z"),
      makeReceipt("not-counted", "2026-10-06T10:00:00.000Z", "2026-10-06T10:00:00.000Z"),
    ];

    expect([...getInventoryItemsNeedingRecount(items, receipts, true)]).toEqual(["received-later", "corrected-later"]);
    expect([...getInventoryItemsNeedingRecount(items, receipts, false)]).toEqual([]);
  });
});
