import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  getActiveInventoryItems: vi.fn(),
  getInventoryCatalog: vi.fn(),
  getInventoryCount: vi.fn(),
  getInventoryItemsNeedingRecountForCount: vi.fn(),
  getInventoryCountCorrections: vi.fn(),
  getInventoryReceiptPage: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/inventory/catalog", () => ({
  getActiveInventoryItems: mocks.getActiveInventoryItems,
  getInventoryCatalog: mocks.getInventoryCatalog,
}));
vi.mock("@/lib/inventory/counts", () => ({
  getInventoryCount: mocks.getInventoryCount,
  getInventoryItemsNeedingRecountForCount: mocks.getInventoryItemsNeedingRecountForCount,
  isInventoryBusinessDate: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value),
}));
vi.mock("@/lib/inventory/count-corrections", () => ({ getInventoryCountCorrections: mocks.getInventoryCountCorrections }));
vi.mock("@/lib/inventory/receipts", () => ({ getInventoryReceiptPage: mocks.getInventoryReceiptPage }));

import OwnerInventoryPage from "./page";

describe("owner inventory tab reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue({ supabase: {}, ownerId: "owner-id" });
    mocks.getActiveInventoryItems.mockResolvedValue({ data: [], error: null });
    mocks.getInventoryCatalog.mockResolvedValue({ data: [], error: null });
    mocks.getInventoryCount.mockResolvedValue({ count: null, items: [], error: false });
    mocks.getInventoryItemsNeedingRecountForCount.mockResolvedValue({ itemIds: [], error: false });
    mocks.getInventoryCountCorrections.mockResolvedValue({ data: [], error: false });
    mocks.getInventoryReceiptPage.mockResolvedValue({ data: [], error: false, hasMore: false, nextCursor: null });
  });

  it("loads only the catalog when the catalog tab opens", async () => {
    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "catalog" }) });

    expect(mocks.getInventoryCatalog).toHaveBeenCalledOnce();
    expect(mocks.getInventoryReceiptPage).not.toHaveBeenCalled();
    expect(mocks.getInventoryCount).not.toHaveBeenCalled();
    expect(mocks.getInventoryItemsNeedingRecountForCount).not.toHaveBeenCalled();
  });

  it("loads a bounded receipt page but no stock snapshots or audit history on receiving", async () => {
    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "receiving" }) });

    expect(mocks.getActiveInventoryItems).toHaveBeenCalledOnce();
    expect(mocks.getInventoryReceiptPage).toHaveBeenCalledWith({}, "owner-id");
    expect(mocks.getInventoryCount).not.toHaveBeenCalled();
    expect(mocks.getInventoryItemsNeedingRecountForCount).not.toHaveBeenCalled();
    expect(mocks.getInventoryCountCorrections).not.toHaveBeenCalled();
  });

  it("shows a receiving read failure when the item catalog query fails", async () => {
    mocks.getActiveInventoryItems.mockResolvedValue({ data: [], error: new Error("catalog unavailable") });

    const page = await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "receiving" }) }) as { props: { receivingError: boolean } };

    expect(page.props.receivingError).toBe(true);
  });

  it("loads only the selected count task on stock and does not scan receipt or count history", async () => {
    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "stock", date: "2026-10-06" }) });

    expect(mocks.getActiveInventoryItems).toHaveBeenCalledOnce();
    expect(mocks.getInventoryCount).toHaveBeenCalledOnce();
    expect(mocks.getInventoryReceiptPage).not.toHaveBeenCalled();
    expect(mocks.getInventoryItemsNeedingRecountForCount).not.toHaveBeenCalled();
    expect(mocks.getInventoryCountCorrections).not.toHaveBeenCalled();
  });

  it("does not fetch correction history when opening a finalized stock count", async () => {
    mocks.getInventoryCount.mockResolvedValue({
      count: { id: "count-id", business_date: "2026-10-06", status: "finalized", finalized_at: "2026-10-06T12:00:00Z" },
      items: [],
      error: false,
    });

    await OwnerInventoryPage({ searchParams: Promise.resolve({ tab: "stock", date: "2026-10-06" }) });

    expect(mocks.getInventoryCountCorrections).not.toHaveBeenCalled();
  });
});
