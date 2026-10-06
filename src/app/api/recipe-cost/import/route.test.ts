import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  parseCogsWorkbook: vi.fn(),
  reviewCogsPreviewAgainstWorkspace: vi.fn(),
  mergeCogsWorkbookImport: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/recipe-cost/workbook-import", () => ({
  parseCogsWorkbook: mocks.parseCogsWorkbook,
  reviewCogsPreviewAgainstWorkspace: mocks.reviewCogsPreviewAgainstWorkspace,
  mergeCogsWorkbookImport: mocks.mergeCogsWorkbookImport,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

const preview = {
  filename: "COGS BETEA.xlsx", sha256: "a".repeat(64), ingredients: [], unitConversions: [], reviewItems: [],
  summary: { importableIngredients: 0, reviewItems: 0, recipeWarnings: 0, canMarkComplete: true },
};
const document = { ingredients: [], batches: [], products: [], unitConversions: [] };
const owner = {
  ownerId: "owner-id",
  supabase: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  },
};

function request(mode: string, options: { expectedRevision?: string; expectedHash?: string; origin?: string } = {}) {
  const data = new FormData();
  data.set("mode", mode);
  data.set("file", new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01])], "COGS BETEA.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  if (options.expectedRevision) data.set("expectedRevision", options.expectedRevision);
  if (options.expectedHash) data.set("expectedHash", options.expectedHash);
  if (mode === "confirm") data.set("effectiveDate", "2026-10-06");
  return new Request("https://example.test/api/recipe-cost/import", {
    method: "POST", body: data, headers: { origin: options.origin ?? "https://example.test" },
  });
}

describe("recipe workbook import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue(owner);
    mocks.parseCogsWorkbook.mockResolvedValue(preview);
    mocks.reviewCogsPreviewAgainstWorkspace.mockImplementation((rawPreview) => ({
      ...rawPreview,
      ingredients: [],
      summary: { ...rawPreview.summary, importableIngredients: 0, totalPurchasePriceVnd: "0", reviewItems: 1, canMarkComplete: false },
    }));
    mocks.mergeCogsWorkbookImport.mockReturnValue(document);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
  });

  it("rejects cross-origin and non-owner requests before parsing", async () => {
    const origin = await POST(request("preview", { origin: "https://attacker.example" }));
    mocks.requireOwnerClient.mockResolvedValue(null);
    const staff = await POST(request("preview"));

    expect(origin.status).toBe(403);
    expect(staff.status).toBe(403);
    expect(mocks.parseCogsWorkbook).not.toHaveBeenCalled();
  });

  it("returns a workspace-aware dry-run preview after a read-only database lookup", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { revision: 3, document }, error: null });
    const response = await POST(request("preview"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.parseCogsWorkbook).toHaveBeenCalledOnce();
    expect(mocks.maybeSingle).toHaveBeenCalledOnce();
    expect(mocks.reviewCogsPreviewAgainstWorkspace).toHaveBeenCalledWith(preview, document);
    expect(body.preview.summary).toMatchObject({ importableIngredients: 0, totalPurchasePriceVnd: "0", reviewItems: 1, canMarkComplete: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails the dry run closed when the current workspace cannot be read", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "read failed" } });
    const response = await POST(request("preview"));
    expect(response.status).toBe(503);
    expect(mocks.reviewCogsPreviewAgainstWorkspace).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("enforces the request limit while reading a body without a content-length header", async () => {
    const oversized = new Request("https://example.test/api/recipe-cost/import", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/octet-stream" },
      body: new Uint8Array(4 * 1024 * 1024 + 128 * 1024 + 1),
    });
    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(mocks.requireOwnerClient).toHaveBeenCalledOnce();
    expect(mocks.parseCogsWorkbook).not.toHaveBeenCalled();
  });

  it("requires the unchanged preview hash and current workspace revision at confirmation", async () => {
    const stale = await POST(request("confirm", { expectedRevision: "1", expectedHash: "a".repeat(64) }));
    expect(stale.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.maybeSingle.mockResolvedValue({ data: { revision: 0, document }, error: null });
    const confirmed = await POST(request("confirm", { expectedRevision: "0", expectedHash: "b".repeat(64) }));
    expect(confirmed.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("recalculates and writes through the revision-checked owner RPC only after confirmation", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { revision: 0, document }, error: null });
    const response = await POST(request("confirm", { expectedRevision: "0", expectedHash: "a".repeat(64) }));
    expect(response.status).toBe(200);
    expect(mocks.mergeCogsWorkbookImport).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("owner_save_recipe_cost_workspace", expect.objectContaining({ p_expected_revision: 0 }));
  });
});
