import "server-only";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export async function headR2Object(key: string) {
  const context = getR2Context();
  if (!context) throw new Error("R2 evidence storage is not configured.");

  try {
    const result = await context.client.send(new HeadObjectCommand({ Bucket: context.bucket, Key: key }));
    return {
      contentLength: typeof result.ContentLength === "number" ? result.ContentLength : null,
      contentType: result.ContentType?.split(";")[0]?.trim().toLowerCase() ?? null,
    };
  } catch (error) {
    const response = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (response.name === "NotFound" || response.name === "NoSuchKey" || response.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

function isPreconditionFailed(error: unknown) {
  const response = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return response.name === "PreconditionFailed" || response.$metadata?.httpStatusCode === 412;
}

/**
 * Seal an uploaded staging object into a server-only key. R2's conditional PUT
 * means concurrent/retried finalization can never replace the first sealed bytes.
 */
export async function sealR2Object(
  sourceKey: string,
  sealedKey: string,
  contentType: string,
  contentLength: number,
) {
  const context = getR2Context();
  if (!context) throw new Error("R2 evidence storage is not configured.");
  if (contentLength < 1 || contentLength > 2 * 1024 * 1024) {
    throw new Error("R2 evidence object size is outside the allowed range.");
  }

  const validateSealedObject = (object: Awaited<ReturnType<typeof headR2Object>>) => {
    if (!object || object.contentLength !== contentLength || object.contentType !== contentType) {
      throw new Error("R2 sealed evidence does not match the expected metadata.");
    }
    return object;
  };

  const existing = await headR2Object(sealedKey);
  if (existing) return validateSealedObject(existing);

  const source = await context.client.send(new GetObjectCommand({ Bucket: context.bucket, Key: sourceKey }));
  if (!source.Body || source.ContentLength !== contentLength || source.ContentType?.split(";")[0]?.trim().toLowerCase() !== contentType) {
    throw new Error("R2 staging evidence does not match the expected metadata.");
  }
  const bytes = Buffer.from(await source.Body.transformToByteArray());
  if (bytes.byteLength !== contentLength) throw new Error("R2 staging evidence has an unexpected byte length.");

  try {
    await context.client.send(new PutObjectCommand({
      Bucket: context.bucket,
      Key: sealedKey,
      Body: bytes,
      ContentLength: contentLength,
      ContentType: contentType,
      IfNoneMatch: "*",
    }));
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    // Another finalization already sealed these bytes. Never replace them.
  }

  return validateSealedObject(await headR2Object(sealedKey));
}

export async function deleteR2Object(key: string) {
  const context = getR2Context();
  if (!context) throw new Error("R2 evidence storage is not configured.");
  await context.client.send(new DeleteObjectCommand({ Bucket: context.bucket, Key: key }));
}
