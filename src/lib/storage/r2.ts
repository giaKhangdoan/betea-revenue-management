import "server-only";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type R2Context = { bucket: string; client: S3Client };

let cachedContext: R2Context | null = null;
let cachedSignature = "";

function getR2Context(): R2Context | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  const signature = `${accountId}:${accessKeyId}:${secretAccessKey}:${bucket}`;
  if (!cachedContext || cachedSignature !== signature) {
    cachedContext?.client.destroy();
    cachedContext = {
      bucket,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 2,
      }),
    };
    cachedSignature = signature;
  }
  return cachedContext;
}

export function isR2StorageConfigured() {
  return Boolean(getR2Context());
}

export async function createR2UploadUrl(key: string, contentType: string, contentLength: number) {
  const context = getR2Context();
  if (!context) return null;
  return getSignedUrl(
    context.client,
    new PutObjectCommand({
      Bucket: context.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: 120, signableHeaders: new Set(["content-length", "content-type"]) },
  );
}

export async function putAndVerifyR2Object(key: string, source: Uint8Array, contentType: string) {
  const context = getR2Context();
  if (!context) throw new Error("R2 evidence storage is not configured.");
  const sourceBytes = Buffer.from(source);
  await context.client.send(new PutObjectCommand({
    Bucket: context.bucket,
    Key: key,
    Body: sourceBytes,
    ContentLength: sourceBytes.byteLength,
    ContentType: contentType,
  }));

  const stored = await context.client.send(new GetObjectCommand({ Bucket: context.bucket, Key: key }));
  if (!stored.Body) throw new Error("R2 returned an empty evidence object.");
  const storedBytes = Buffer.from(await stored.Body.transformToByteArray());
  return {
    sourceBytes,
    storedBytes,
  };
}

export async function createR2ReadUrl(key: string) {
  const context = getR2Context();
  if (!context) return null;
  return getSignedUrl(
    context.client,
    new GetObjectCommand({ Bucket: context.bucket, Key: key }),
    { expiresIn: 300 },
  );
}

export async function deleteR2Object(key: string) {
  const context = getR2Context();
  if (!context) throw new Error("R2 evidence storage is not configured.");
  await context.client.send(new DeleteObjectCommand({ Bucket: context.bucket, Key: key }));
}
