import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, currentBusinessDate } from "@/lib/finance/format";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  getInventoryExportData: vi.fn(),
  createInventoryWorkbook: vi.fn(),
  isInventoryExportRangeWithinLimit: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/inventory/export", () => ({
  getInventoryExportData: mocks.getInventoryExportData,
  createInventoryWorkbook: mocks.createInventoryWorkbook,
  isInventoryExportRangeWithinLimit: mocks.isInventoryExportRangeWithinLimit,
}));

import { GET } from "./route";

const owner = { ownerId: "owner-id", supabase: {} };

function request(from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  return new Request(`https://example.test/inventory/export?${params}`);
}

describe("inventory export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue(owner);
    mocks.getInventoryExportData.mockResolvedValue({
      data: { counts: [], finalizedCounts: [], receipts: [] },
      error: false,
    });
    mocks.createInventoryWorkbook.mockReturnValue(Buffer.from("xlsx"));
    mocks.isInventoryExportRangeWithinLimit.mockReturnValue(true);
  });

  it("rejects staff and unauthenticated direct requests", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    const today = currentBusinessDate();

    const response = await GET(request(today, today));

    expect(response.status).toBe(403);
    expect(mocks.getInventoryExportData).not.toHaveBeenCalled();
  });

  it("rejects invalid or future date ranges", async () => {
    const today = currentBusinessDate();

    const invalid = await GET(request("not-a-date", today));
    const future = await GET(request(today, addDays(today, 1)));

    expect(invalid.status).toBe(400);
    expect(future.status).toBe(400);
    expect(mocks.getInventoryExportData).not.toHaveBeenCalled();
  });

  it("rejects date ranges wider than one year", async () => {
    mocks.isInventoryExportRangeWithinLimit.mockReturnValue(false);

    const response = await GET(request("2025-01-01", "2026-01-02"));

    expect(response.status).toBe(400);
    expect(mocks.getInventoryExportData).not.toHaveBeenCalled();
  });

  it("returns the workbook for an owner and the selected range", async () => {
    const today = currentBusinessDate();

    const response = await GET(request(today, today));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain(`Kho_${today}_${today}.xlsx`);
    expect(await response.text()).toBe("xlsx");
    expect(mocks.getInventoryExportData).toHaveBeenCalledWith(owner.supabase, owner.ownerId, today, today);
  });

  it("returns 413 when a valid date window exceeds an export row budget", async () => {
    const today = currentBusinessDate();
    mocks.getInventoryExportData.mockResolvedValue({
      data: { counts: [], finalizedCounts: [], receipts: [] },
      error: true,
      errorCode: "too_large",
    });

    const response = await GET(request(today, today));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Lịch sử kho vượt giới hạn an toàn của một lần xuất. Hãy thu hẹp khoảng ngày." });
    expect(mocks.createInventoryWorkbook).not.toHaveBeenCalled();
  });

  it("returns 400 when the selected snapshots have an unsafe history time span", async () => {
    const today = currentBusinessDate();
    mocks.getInventoryExportData.mockResolvedValue({
      data: { counts: [], finalizedCounts: [], receipts: [] },
      error: true,
      errorCode: "range_too_large",
    });

    const response = await GET(request(today, today));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Mốc lịch sử kiểm kê cách nhau quá xa. Hãy xuất một khoảng ngày hẹp hơn." });
    expect(mocks.createInventoryWorkbook).not.toHaveBeenCalled();
  });

  it("keeps data-source failures as 500 rather than misreporting them as a size limit", async () => {
    const today = currentBusinessDate();
    mocks.getInventoryExportData.mockResolvedValue({
      data: { counts: [], finalizedCounts: [], receipts: [] },
      error: true,
    });

    const response = await GET(request(today, today));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Chưa tải được dữ liệu kho." });
  });
});
