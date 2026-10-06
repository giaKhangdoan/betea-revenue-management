import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  getInventoryCountCorrections: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/inventory/count-corrections", () => ({ getInventoryCountCorrections: mocks.getInventoryCountCorrections }));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getInventoryCountCorrectionsAction } from "./actions";

const countId = "b4000000-0000-4000-8000-000000000001";
const ownerId = "b5000000-0000-4000-8000-000000000001";

function createOwner(finalized = true) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: vi.fn().mockResolvedValue({ data: finalized ? { id: countId } : null, error: null }),
  };
  const supabase = { from: vi.fn(() => query) };
  return { owner: { ownerId, supabase }, query };
}

describe("getInventoryCountCorrectionsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInventoryCountCorrections.mockResolvedValue({ data: [], error: false, hasMore: false, nextCursor: null });
  });

  it("requires an owner session and a finalized count before loading a history page", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    const denied = await getInventoryCountCorrectionsAction(countId);
    expect(denied.error).toBe(true);
    expect(mocks.getInventoryCountCorrections).not.toHaveBeenCalled();

    const { owner } = createOwner(false);
    mocks.requireOwnerClient.mockResolvedValue(owner);
    const draft = await getInventoryCountCorrectionsAction(countId);
    expect(draft.error).toBe(true);
    expect(mocks.getInventoryCountCorrections).not.toHaveBeenCalled();
  });

  it("loads the requested bounded cursor page only for an owner-scoped finalized count", async () => {
    const { owner, query } = createOwner();
    mocks.requireOwnerClient.mockResolvedValue(owner);
    const cursor = { correctedAt: "2026-10-06T12:00:00.123456Z", id: "b6000000-0000-4000-8000-000000000001" };

    const result = await getInventoryCountCorrectionsAction(countId, cursor);

    expect(result.error).toBe(false);
    expect(owner.supabase.from).toHaveBeenCalledWith("inventory_counts");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    expect(mocks.getInventoryCountCorrections).toHaveBeenCalledWith(owner.supabase, ownerId, countId, {
      beforeAt: cursor.correctedAt,
      beforeId: cursor.id,
    });
  });

  it("rejects malformed count identifiers before querying", async () => {
    const result = await getInventoryCountCorrectionsAction("invalid");

    expect(result.error).toBe(true);
    expect(mocks.requireOwnerClient).not.toHaveBeenCalled();
    expect(mocks.getInventoryCountCorrections).not.toHaveBeenCalled();
  });
});
