import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  isR2StorageConfigured: vi.fn(),
  createR2UploadUrl: vi.fn(),
  createR2ReadUrl: vi.fn(),
  headR2Object: vi.fn(),
  sealR2Object: vi.fn(),
  deleteR2Object: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  lastQuery: null as null | { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> },
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/storage/r2", () => ({
  isR2StorageConfigured: mocks.isR2StorageConfigured,
  createR2UploadUrl: mocks.createR2UploadUrl,
  createR2ReadUrl: mocks.createR2ReadUrl,
  headR2Object: mocks.headR2Object,
  sealR2Object: mocks.sealR2Object,
  deleteR2Object: mocks.deleteR2Object,
}));

import { POST as cleanupEvidence } from "./cleanup/route";
import { POST as finalizeEvidence } from "./finalize/route";
import { GET as readEvidence } from "./[evidenceId]/url/route";
import { POST as createUpload } from "./upload/route";

const ownerId = "93000000-0000-4000-8000-000000000001";
const voucherId = "94000000-0000-4000-8000-000000000001";
const uploadIntentId = "95000000-0000-4000-8000-000000000001";
const evidenceId = "96000000-0000-4000-8000-000000000001";
const objectPath = `${ownerId}/owner-advances-staging/${voucherId}/${uploadIntentId}.png`;
const sealedObjectPath = `${ownerId}/owner-advances/${voucherId}/${uploadIntentId}.png`;
const owner = { ownerId, supabase: { rpc: mocks.rpc, from: mocks.from } };

function post(path: string, value: unknown, origin = "https://example.test") {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function query() {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: mocks.maybeSingle,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  mocks.lastQuery = chain;
  return chain;
}

describe("owner purchase evidence routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lastQuery = null;
    mocks.requireOwnerClient.mockResolvedValue(owner);
    mocks.isR2StorageConfigured.mockReturnValue(true);
    mocks.createR2UploadUrl.mockResolvedValue("https://r2.example.test/signed-put");
    mocks.createR2ReadUrl.mockResolvedValue("https://r2.example.test/signed-get");
    mocks.headR2Object.mockResolvedValue({ contentLength: 1200, contentType: "image/png" });
    mocks.sealR2Object.mockResolvedValue({ contentLength: 1200, contentType: "image/png" });
    mocks.deleteR2Object.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: evidenceId, error: null });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: uploadIntentId, voucher_id: voucherId, object_path: objectPath, sealed_object_path: sealedObjectPath, mime_type: "image/png", byte_size: 1200, status: "pending", expires_at: "2099-01-01T00:00:00.000Z" },
      error: null,
    });
    mocks.from.mockImplementation(() => query());
  });

  it("creates a scoped upload intent for an owner without returning the raw object path", async () => {
    const response = await createUpload(post("/api/admin/advances/evidence/upload", {
      voucherId,
      contentType: "image/png",
      size: 1200,
      fileName: "C:\\fakepath\\receipt.png",
      caption: "  Hóa đơn tháng 10  ",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ uploadIntentId: evidenceId, uploadUrl: "https://r2.example.test/signed-put", expiresInSeconds: 120 });
    expect(JSON.stringify(body)).not.toContain("owner-advances");
    expect(mocks.rpc).toHaveBeenCalledWith("owner_create_purchase_upload_intent", expect.objectContaining({
      p_voucher_id: voucherId,
      p_mime_type: "image/png",
      p_byte_size: 1200,
      p_file_name: "receipt.png",
      p_caption: "Hóa đơn tháng 10",
      p_object_path: expect.stringMatching(new RegExp(`^${ownerId}/owner-advances-staging/${voucherId}/[0-9a-f-]+\\.png$`)),
    }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("blocks cross-origin and non-owner requests before writing metadata", async () => {
    const crossOrigin = await createUpload(post("/api/admin/advances/evidence/upload", {}, "https://attacker.example"));
    mocks.requireOwnerClient.mockResolvedValue(null);
    const nonOwner = await createUpload(post("/api/admin/advances/evidence/upload", {}));

    expect(crossOrigin.status).toBe(403);
    expect(nonOwner.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.createR2UploadUrl).not.toHaveBeenCalled();
  });

  it("rejects unsupported and oversized uploads before creating an intent", async () => {
    const unsupported = await createUpload(post("/api/admin/advances/evidence/upload", {
      voucherId, contentType: "application/pdf", size: 100, fileName: "invoice.pdf",
    }));
    const oversized = await createUpload(post("/api/admin/advances/evidence/upload", {
      voucherId, contentType: "image/png", size: 2 * 1024 * 1024 + 1, fileName: "large.png",
    }));

    expect(unsupported.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("finalizes only when the R2 object matches expected size and MIME, and retries idempotently", async () => {
    const first = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toEqual({ evidenceId, alreadyFinalized: false });
    expect(mocks.headR2Object).toHaveBeenCalledWith(objectPath);
    expect(mocks.sealR2Object).toHaveBeenCalledWith(objectPath, sealedObjectPath, "image/png", 1200);
    expect(objectPath).not.toBe(sealedObjectPath);
    expect(mocks.rpc).toHaveBeenCalledWith("owner_finalize_purchase_upload", { p_upload_intent_id: uploadIntentId });
    expect(mocks.deleteR2Object).toHaveBeenCalledWith(objectPath);

    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: uploadIntentId, status: "attached" }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: evidenceId }, error: null });
    const retry = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ evidenceId, alreadyFinalized: true });
    expect(mocks.sealR2Object).toHaveBeenCalledTimes(1);
  });

  it("keeps attached evidence on a server-sealed key after the upload capability is replayed", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { id: uploadIntentId, voucher_id: voucherId, object_path: objectPath, sealed_object_path: sealedObjectPath, mime_type: "image/png", byte_size: 1200, status: "pending", expires_at: "2099-01-01T00:00:00.000Z" },
      error: null,
    });
    const firstFinalize = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));
    expect(firstFinalize.status).toBe(200);
    expect(mocks.sealR2Object).toHaveBeenCalledWith(objectPath, sealedObjectPath, "image/png", 1200);
    expect(objectPath).not.toBe(sealedObjectPath);

    // Retrying after the upload URL was used returns attached metadata without
    // sealing or changing the evidence object a second time.
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: uploadIntentId, status: "attached" }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: evidenceId }, error: null });
    const retry = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));
    expect(retry.status).toBe(200);
    expect(mocks.sealR2Object).toHaveBeenCalledTimes(1);
  });

  it("expires and deletes a missing or mismatched upload without finalizing it", async () => {
    mocks.headR2Object.mockResolvedValueOnce(null);
    mocks.rpc.mockResolvedValueOnce({ data: objectPath, error: null });
    const missing = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));
    expect(missing.status).toBe(409);
    expect(mocks.deleteR2Object).toHaveBeenCalledWith(objectPath);

    mocks.maybeSingle.mockResolvedValueOnce({
      data: { id: uploadIntentId, voucher_id: voucherId, object_path: objectPath, sealed_object_path: sealedObjectPath, mime_type: "image/png", byte_size: 1200, status: "pending", expires_at: "2099-01-01T00:00:00.000Z" }, error: null,
    });
    mocks.headR2Object.mockResolvedValueOnce({ contentLength: 1201, contentType: "image/png" });
    mocks.rpc.mockResolvedValueOnce({ data: objectPath, error: null });
    const mismatch = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));
    expect(mismatch.status).toBe(422);
    expect(mocks.deleteR2Object).toHaveBeenCalledWith(objectPath);
    expect(mocks.rpc).not.toHaveBeenCalledWith("owner_finalize_purchase_upload", expect.anything());
  });

  it("does not finalize an expired intent", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { id: uploadIntentId, voucher_id: voucherId, object_path: objectPath, sealed_object_path: sealedObjectPath, mime_type: "image/png", byte_size: 1200, status: "pending", expires_at: "2020-01-01T00:00:00.000Z" }, error: null,
    });
    mocks.rpc.mockResolvedValueOnce({ data: objectPath, error: null });
    const response = await finalizeEvidence(post("/api/admin/advances/evidence/finalize", { uploadIntentId }));

    expect(response.status).toBe(410);
    expect(mocks.headR2Object).not.toHaveBeenCalled();
    expect(mocks.deleteR2Object).toHaveBeenCalledWith(objectPath);
    expect(mocks.rpc).not.toHaveBeenCalledWith("owner_finalize_purchase_upload", expect.anything());
  });

  it("returns private signed reads only for owner-scoped purchase evidence", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { object_path: objectPath, mime_type: "image/png", file_name: "receipt.png", byte_size: 1200, caption: "Invoice" }, error: null,
    });
    const response = await readEvidence(new Request(`https://example.test/api/admin/advances/evidence/${evidenceId}/url`), {
      params: Promise.resolve({ evidenceId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://r2.example.test/signed-get");
    expect(body.expiresInSeconds).toBe(300);
    expect(JSON.stringify(body)).not.toContain("owner-advances");
    expect(mocks.from).toHaveBeenCalledWith("owner_purchase_evidence");
    expect(mocks.lastQuery?.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(mocks.lastQuery?.eq).toHaveBeenCalledWith("id", evidenceId);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not reveal another owner's evidence or allow staff to request a signed URL", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const missing = await readEvidence(new Request(`https://example.test/api/admin/advances/evidence/${evidenceId}/url`), {
      params: Promise.resolve({ evidenceId }),
    });
    mocks.requireOwnerClient.mockResolvedValue(null);
    const staff = await readEvidence(new Request(`https://example.test/api/admin/advances/evidence/${evidenceId}/url`), {
      params: Promise.resolve({ evidenceId }),
    });

    expect(missing.status).toBe(404);
    expect(staff.status).toBe(403);
    expect(mocks.createR2ReadUrl).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("owner_purchase_evidence");
  });

  it("sweeps claimed expired keys idempotently and exposes counts only", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ upload_intent_id: uploadIntentId, object_path: objectPath, sealed_object_path: sealedObjectPath, attached: false }], error: null });
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    const first = await cleanupEvidence(post("/api/admin/advances/evidence/cleanup", {}));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ claimed: 1, deleted: 1, failed: 0 });
    expect(mocks.deleteR2Object).toHaveBeenCalledWith(objectPath);

    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    const second = await cleanupEvidence(post("/api/admin/advances/evidence/cleanup", {}));
    expect(await second.json()).toMatchObject({ claimed: 0, deleted: 0, failed: 0 });
    expect(mocks.deleteR2Object).toHaveBeenCalledTimes(2);
  });

  it("blocks staff and unsafe cleanup keys", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ upload_intent_id: uploadIntentId, object_path: `someone-else/${objectPath}`, sealed_object_path: sealedObjectPath, attached: false }], error: null });
    const unsafe = await cleanupEvidence(post("/api/admin/advances/evidence/cleanup", {}));
    expect(unsafe.status).toBe(200);
    expect(await unsafe.json()).toMatchObject({ failed: 1, deleted: 0 });
    expect(mocks.deleteR2Object).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({ data: [{ upload_intent_id: uploadIntentId, object_path: objectPath, sealed_object_path: sealedObjectPath, attached: true }], error: null });
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    const attachedCleanup = await cleanupEvidence(post("/api/admin/advances/evidence/cleanup", {}));
    expect(attachedCleanup.status).toBe(200);
    expect(mocks.deleteR2Object).toHaveBeenCalledWith(objectPath);
    expect(mocks.deleteR2Object).not.toHaveBeenCalledWith(sealedObjectPath);

    mocks.requireOwnerClient.mockResolvedValue(null);
    const staff = await cleanupEvidence(post("/api/admin/advances/evidence/cleanup", {}));
    expect(staff.status).toBe(403);
  });
});
