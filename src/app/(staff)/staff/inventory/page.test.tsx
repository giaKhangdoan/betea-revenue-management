import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  getActiveInventoryItems: vi.fn(),
  getInventoryCount: vi.fn(),
  getInventoryItemsNeedingRecountForCount: vi.fn(),
  getInventoryReceiptPage: vi.fn(),
}));

vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/lib/inventory/catalog", () => ({ getActiveInventoryItems: mocks.getActiveInventoryItems }));
vi.mock("@/lib/inventory/counts", () => ({
  getInventoryCount: mocks.getInventoryCount,
  getInventoryItemsNeedingRecountForCount: mocks.getInventoryItemsNeedingRecountForCount,
  isInventoryBusinessDate: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value),
}));
vi.mock("@/lib/inventory/receipts", () => ({ getInventoryReceiptPage: mocks.getInventoryReceiptPage }));

import StaffInventoryPage from "./page";

describe("staff inventory tab reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ supabase: {}, ownerId: "owner-id" });
    mocks.getActiveInventoryItems.mockResolvedValue({ data: [], error: null });
    mocks.getInventoryCount.mockResolvedValue({ count: null, items: [], error: false });
    mocks.getInventoryItemsNeedingRecountForCount.mockResolvedValue({ itemIds: [], error: false });
    mocks.getInventoryReceiptPage.mockResolvedValue({ data: [], error: false, hasMore: false, nextCursor: null });
  });

  it("shows a receiving read failure when the item catalog query fails", async () => {
    mocks.getActiveInventoryItems.mockResolvedValue({ data: [], error: new Error("catalog unavailable") });

    const page = await StaffInventoryPage({ searchParams: Promise.resolve({ tab: "receiving" }) }) as { props: { receivingError: boolean } };

    expect(page.props.receivingError).toBe(true);
  });

  it("bounds staff receipt reads to Monday through next Monday in Vietnam time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:00:00+07:00"));

    await StaffInventoryPage({ searchParams: Promise.resolve({ tab: "receiving" }) });

    expect(mocks.getInventoryReceiptPage).toHaveBeenCalledWith({}, "owner-id", {
      beforeAt: undefined,
      beforeId: undefined,
      receivedFrom: "2026-10-04T17:00:00.000Z",
      receivedUntil: "2026-10-11T17:00:00.000Z",
    });
  });

  afterEach(() => vi.useRealTimers());
});
