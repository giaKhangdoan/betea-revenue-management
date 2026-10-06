import { describe, expect, it } from "vitest";
import { formatInventoryQuantity, getInventoryItemsNeedingRecount, summarizeInventoryMovement, type InventoryCountHistoryVersion, type InventoryFinalizedCount, type InventoryMovementReceipt, type InventoryReceiptHistoryVersion } from "./counts";
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

  it("keeps pre-correction periods stable and applies receipt/count versions to later cutoffs", () => {
    type VersionedCount = InventoryFinalizedCount & {
      versions: InventoryCountHistoryVersion[];
    };
    type VersionedReceipt = InventoryMovementReceipt & {
      versions: InventoryReceiptHistoryVersion[];
    };
    const makeCount = (id: string, finalizedAt: string, quantity: string): InventoryFinalizedCount => ({
      id,
      business_date: finalizedAt.slice(0, 10),
      finalized_at: finalizedAt,
      items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: quantity }],
    });
    const counts: VersionedCount[] = [
      makeCount("a", "2026-09-01T00:00:00.000Z", "100") as VersionedCount,
      makeCount("b", "2026-09-02T00:00:00.000Z", "80") as VersionedCount,
      {
        ...makeCount("c", "2026-09-03T00:00:00.000Z", "50"),
        versions: [
          {
            effective_at: "2026-09-03T00:00:00.000Z",
            sequence_no: 3,
            event_type: "count_finalized",
            items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "60" }],
          },
          {
            effective_at: "2026-09-03T12:00:00.000Z",
            sequence_no: 5,
            event_type: "count_corrected",
            items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "50" }],
          },
        ],
      },
      makeCount("d", "2026-09-04T00:00:00.000Z", "40") as VersionedCount,
    ];
    const makeReceipt = (
      id: string,
      receivedAt: string,
      quantity: string,
      versions: VersionedReceipt["versions"],
    ): VersionedReceipt => ({
      id,
      receipt_code: id,
      received_at: receivedAt,
      created_by_label: "Chủ",
      lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: quantity }],
      versions,
    });
    const receipts = [
      makeReceipt("r1", "2026-09-01T12:00:00.000Z", "15", [
        {
          effective_at: "2026-09-01T12:00:00.000Z",
          sequence_no: 2,
          event_type: "receipt_created",
          lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "5" }],
        },
        {
          effective_at: "2026-09-02T12:00:00.000Z",
          sequence_no: 4,
          event_type: "receipt_corrected",
          lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "15" }],
        },
      ]),
      makeReceipt("r2", "2026-09-02T06:00:00.000Z", "2", [
        {
          effective_at: "2026-09-02T06:00:00.000Z",
          sequence_no: 3,
          event_type: "receipt_created",
          lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "6" }],
        },
        {
          effective_at: "2026-09-03T12:00:00.000Z",
          sequence_no: 6,
          event_type: "receipt_corrected",
          lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "2" }],
        },
      ]),
    ];

    const summary = summarizeInventoryMovement(counts, receipts);

    expect(summary.periods.map(({ items }) => items[0].movement_quantity)).toEqual(["25", "36", "6"]);
    expect(summary.periods[0].items[0].received_quantity).toBe("5");
    expect(summary.periods[1].items[0].received_quantity).toBe("16");
    expect(summary.periods[2].items[0].received_quantity).toBe("−4");
    expect(summary.periods[1].current_count.items[0].counted_quantity).toBe("60");
    expect(summary.periods[2].previous_count.items[0].counted_quantity).toBe("50");
  });

  it("uses the global sequence to place events with the same effective timestamp", () => {
    const summary = summarizeInventoryMovement([
      {
        id: "before",
        business_date: "2026-09-01",
        finalized_at: "2026-09-01T10:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "100" }],
        versions: [{
          effective_at: "2026-09-01T10:00:00.000Z",
          sequence_no: 1,
          event_type: "count_finalized",
          items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "100" }],
        }],
      },
      {
        id: "after",
        business_date: "2026-09-02",
        finalized_at: "2026-09-02T10:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "90" }],
        versions: [{
          effective_at: "2026-09-02T10:00:00.000Z",
          sequence_no: 5,
          event_type: "count_finalized",
          items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "90" }],
        }],
      },
    ], [{
      id: "tied-receipt",
      receipt_code: "PN-tied",
      received_at: "2026-09-02T10:00:00.000Z",
      created_by_label: "Chủ",
      lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "5" }],
      versions: [{
        effective_at: "2026-09-02T10:00:00.000Z",
        sequence_no: 6,
        event_type: "receipt_created",
        lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "5" }],
      }],
    }]);

    expect(summary.periods[0].items[0].received_quantity).toBe("0");
    expect(summary.periods[0].items[0].movement_quantity).toBe("10");
  });

  it("preserves existing movement behavior for inputs without event versions", () => {
    const summary = summarizeInventoryMovement([
      {
        id: "before",
        business_date: "2026-09-01",
        finalized_at: "2026-09-01T00:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "10" }],
      },
      {
        id: "after",
        business_date: "2026-09-02",
        finalized_at: "2026-09-02T00:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "7" }],
      },
    ], [{
      id: "legacy-receipt",
      receipt_code: "PN-legacy",
      received_at: "2026-09-01T12:00:00.000Z",
      created_by_label: "Chủ",
      lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "2" }],
    }]);

    expect(summary.periods[0].items[0].movement_quantity).toBe("5");
  });

  it("suppresses movement that depends on non-reconstructable legacy history", () => {
    const counts: InventoryFinalizedCount[] = [
      {
        id: "verified-opening",
        business_date: "2026-09-01",
        finalized_at: "2026-09-01T00:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "100" }],
        history_integrity: { status: "verified", reason: null },
      },
      {
        id: "unverified-count",
        business_date: "2026-09-02",
        finalized_at: "2026-09-02T00:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "80" }],
        history_integrity: { status: "unverified", reason: "Không khôi phục được lần kiểm kho ban đầu." },
      },
      {
        id: "verified-closing",
        business_date: "2026-09-03",
        finalized_at: "2026-09-03T00:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "70" }],
        history_integrity: { status: "verified", reason: null },
      },
    ];
    const receipts: InventoryMovementReceipt[] = [{
      id: "unverified-receipt",
      receipt_code: "PN-uncertain",
      received_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-09-02T12:00:00.000Z",
      created_by_label: "Chủ",
      lines: [{ item_id: "tea", item_name: "Trà", small_unit: "g", converted_quantity: "20" }],
      history_integrity: { status: "unverified", reason: "Không xác định được số lượng tại thời điểm nhập." },
    }];

    const summary = summarizeInventoryMovement(counts, receipts);

    expect(summary.periods.map((period) => period.history_unverified)).toEqual([true, true]);
    expect(summary.periods.map((period) => period.items[0].received_quantity)).toEqual(["—", "—"]);
    expect(summary.periods.map((period) => period.items[0].movement_quantity)).toEqual([null, null]);
    expect(summary.periods[0].history_unverified_reasons).toContain("Không khôi phục được lần kiểm kho ban đầu.");
    expect(summary.periods[0].history_unverified_reasons).toContain("Không xác định được số lượng tại thời điểm nhập.");
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
