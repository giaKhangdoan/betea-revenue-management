import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  getActiveInventoryItems: vi.fn(),
  getInventoryCatalog: vi.fn(),
  getLatestFinalizedInventoryCount: vi.fn(),
  getInventoryReceiptPage: vi.fn(),
  getLatestInventoryReceiptsForItems: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/inventory/catalog", () => ({
  getActiveInventoryItems: mocks.getActiveInventoryItems,
  getInventoryCatalog: mocks.getInventoryCatalog,
}));
vi.mock("@/lib/inventory/counts", () => ({
  getLatestFinalizedInventoryCount: mocks.getLatestFinalizedInventoryCount,
}));
vi.mock("@/lib/inventory/receipts", () => ({
  getInventoryReceiptPage: mocks.getInventoryReceiptPage,
  getLatestInventoryReceiptsForItems: mocks.getLatestInventoryReceiptsForItems,
}));

import OwnerInventoryPage from "./page";

describe("owner inventory tab reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue({ supabase: {}, ownerId: "owner-id" });
    mocks.getActiveInventoryItems.mockResolvedValue({ data: [], error: null });
    mocks.getInventoryCatalog.mockResolvedValue({ data: [], error: null });
    mocks.getLatestFinalizedInventoryCount.mockResolvedValue({ data: null, error: false });
    mocks.getInventoryReceiptPage.mockResolvedValue({ data: [], error: false, hasMore: false, nextCursor: null });
    mocks.getLatestInventoryReceiptsForItems.mockResolvedValue({ data: [], error: false });
  });

  it("loads only the catalog when the catalog tab opens", async () => {
    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "catalog" }) });

    expect(mocks.getInventoryCatalog).toHaveBeenCalledOnce();
    expect(mocks.getInventoryReceiptPage).not.toHaveBeenCalled();
    expect(mocks.getLatestFinalizedInventoryCount).not.toHaveBeenCalled();
    expect(mocks.getLatestInventoryReceiptsForItems).not.toHaveBeenCalled();
  });

  it("loads a bounded receipt page but no stock snapshot on receiving", async () => {
    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "receiving" }) });

    expect(mocks.getActiveInventoryItems).toHaveBeenCalledOnce();
    expect(mocks.getInventoryReceiptPage).toHaveBeenCalledWith({}, "owner-id");
    expect(mocks.getLatestFinalizedInventoryCount).not.toHaveBeenCalled();
    expect(mocks.getLatestInventoryReceiptsForItems).not.toHaveBeenCalled();
  });

  it("shows a receiving read failure when the item catalog query fails", async () => {
    mocks.getActiveInventoryItems.mockResolvedValue({ data: [], error: new Error("catalog unavailable") });

    const page = await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "receiving" }) }) as { props: { receivingError: boolean } };

    expect(page.props.receivingError).toBe(true);
  });

  it("includes all active items and fetches the latest receipt for items added after the last count", async () => {
    const items = Array.from({ length: 47 }, (_, index) => ({
      id: `item-${index + 1}`,
      name: `Mặt hàng ${index + 1}`,
      category: "Nguyên liệu",
      small_unit: "Gr",
      large_unit: null,
      conversion_factor: null,
      count_large_unit_only: false,
      sort_order: index,
      conversion_verified_at: null,
    }));
    const checkedItems = items.slice(0, 43).map((item) => ({
      item_id: item.id,
      item_name: item.name,
      category: item.category,
      small_unit: "Gr",
      large_unit: null,
      conversion_factor: null,
      count_large_unit_only: false,
      large_quantity: null,
      small_quantity: null,
      counted_quantity: "100",
      counted_at: "2026-10-06T10:00:00.000Z",
      sort_order: item.sort_order,
    }));
    mocks.getActiveInventoryItems.mockResolvedValue({ data: items, error: null });
    mocks.getLatestFinalizedInventoryCount.mockResolvedValue({
      data: { id: "count-id", business_date: "2026-10-06", finalized_at: "2026-10-06T12:00:00Z", items: checkedItems },
      error: false,
    });

    const page = await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "stock", date: "2026-10-06" }) }) as { props: Record<string, unknown> };

    expect(mocks.getActiveInventoryItems).toHaveBeenCalledOnce();
    expect(mocks.getLatestFinalizedInventoryCount).toHaveBeenCalledOnce();
    expect(mocks.getLatestInventoryReceiptsForItems).toHaveBeenCalledWith({}, "owner-id", items.slice(43).map((item) => item.id));
    expect(mocks.getInventoryReceiptPage).not.toHaveBeenCalled();
    expect(page.props.items).toHaveLength(47);
    expect((page.props.latestStockSnapshot as { items: unknown[] }).items).toHaveLength(43);
  });

  it("does not offer owner count editing or load receipt history on stock", async () => {
    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "stock" }) });

    expect(mocks.getLatestFinalizedInventoryCount).toHaveBeenCalledOnce();
    expect(mocks.getLatestInventoryReceiptsForItems).toHaveBeenCalledWith({}, "owner-id", []);
    expect(mocks.getInventoryReceiptPage).not.toHaveBeenCalled();
  });
});
