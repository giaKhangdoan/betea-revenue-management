import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send(command: { commandName: string; input: Record<string, unknown> }) {
      return mocks.send(command);
    }
    destroy() {}
  }
  class Command {
    readonly input: Record<string, unknown>;
    readonly commandName: string;
    constructor(commandName: string, input: Record<string, unknown>) {
      this.commandName = commandName;
      this.input = input;
    }
  }
  return {
    S3Client,
    DeleteObjectCommand: class extends Command { constructor(input: Record<string, unknown>) { super("DeleteObject", input); } },
    GetObjectCommand: class extends Command { constructor(input: Record<string, unknown>) { super("GetObject", input); } },
    HeadObjectCommand: class extends Command { constructor(input: Record<string, unknown>) { super("HeadObject", input); } },
    PutObjectCommand: class extends Command { constructor(input: Record<string, unknown>) { super("PutObject", input); } },
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

import { sealR2Object } from "@/lib/storage/r2";

const stageKey = "93000000-0000-4000-8000-000000000001/owner-advances-staging/94000000-0000-4000-8000-000000000001/95000000-0000-4000-8000-000000000001.png";
const sealedKey = "93000000-0000-4000-8000-000000000001/owner-advances/94000000-0000-4000-8000-000000000001/95000000-0000-4000-8000-000000000001.png";

function missingObject() {
  const error = new Error("Not found") as Error & { $metadata: { httpStatusCode: number } };
  error.name = "NotFound";
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

describe("sealR2Object", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-access-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.R2_BUCKET_NAME = "test-bucket";
  });

  it("writes to a private sealed key once and refuses to replace it on upload replay", async () => {
    let headCount = 0;
    mocks.send.mockImplementation(async (command: { commandName: string; input: Record<string, unknown> }) => {
      if (command.commandName === "HeadObject") {
        headCount += 1;
        if (headCount === 1) throw missingObject();
        expect(command.input.Key).toBe(sealedKey);
        return { ContentLength: 4, ContentType: "image/png" };
      }
      if (command.commandName === "GetObject") {
        expect(command.input.Key).toBe(stageKey);
        return {
          ContentLength: 4,
          ContentType: "image/png",
          Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3, 4]) },
        };
      }
      if (command.commandName === "PutObject") return {};
      throw new Error(`Unexpected R2 command: ${command.commandName}`);
    });

    await expect(sealR2Object(stageKey, sealedKey, "image/png", 4)).resolves.toMatchObject({ contentLength: 4, contentType: "image/png" });
    const put = mocks.send.mock.calls.map(([command]) => command as { commandName: string; input: Record<string, unknown> })
      .find((command) => command.commandName === "PutObject");
    expect(put?.input).toMatchObject({ Key: sealedKey, IfNoneMatch: "*", ContentLength: 4, ContentType: "image/png" });

    mocks.send.mockClear();
    mocks.send.mockImplementation(async (command: { commandName: string; input: Record<string, unknown> }) => {
      if (command.commandName === "HeadObject") return { ContentLength: 4, ContentType: "image/png" };
      throw new Error("A replay must not read or write the sealed key again.");
    });
    await expect(sealR2Object(stageKey, sealedKey, "image/png", 4)).resolves.toMatchObject({ contentLength: 4, contentType: "image/png" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("accepts an already sealed object after a concurrent conditional PUT", async () => {
    let headCount = 0;
    const precondition = new Error("Precondition failed") as Error & { $metadata: { httpStatusCode: number } };
    precondition.name = "PreconditionFailed";
    precondition.$metadata = { httpStatusCode: 412 };
    mocks.send.mockImplementation(async (command: { commandName: string }) => {
      if (command.commandName === "HeadObject") {
        headCount += 1;
        if (headCount === 1) throw missingObject();
        return { ContentLength: 4, ContentType: "image/png" };
      }
      if (command.commandName === "GetObject") return {
        ContentLength: 4,
        ContentType: "image/png",
        Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3, 4]) },
      };
      if (command.commandName === "PutObject") throw precondition;
      throw new Error("Unexpected R2 command.");
    });

    await expect(sealR2Object(stageKey, sealedKey, "image/png", 4)).resolves.toMatchObject({ contentLength: 4, contentType: "image/png" });
  });
});
