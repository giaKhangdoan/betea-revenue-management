import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.R2_BUCKET_NAME?.trim();
const dryRun = process.argv.includes("--dry-run");

if (!supabaseUrl || !serviceRoleKey || !accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("Missing Supabase or R2 environment variables. See docs/r2-evidence-storage.md.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 2,
});

function contentTypeFor(path) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  throw new Error("A stored evidence image has an unsupported extension.");
}

function checksum(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function migrateOne(photo) {
  const { data: source, error: downloadError } = await supabase.storage
    .from("betea-evidence")
    .download(photo.object_path);
  if (downloadError || !source) throw new Error("Could not read a source image from Supabase Storage.");

  const sourceBytes = Buffer.from(await source.arrayBuffer());
  const sourceHash = checksum(sourceBytes);
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: photo.object_path,
    Body: sourceBytes,
    ContentLength: sourceBytes.byteLength,
    ContentType: contentTypeFor(photo.object_path),
  }));

  const stored = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: photo.object_path }));
  if (!stored.Body) throw new Error("R2 returned an empty object during verification.");
  const storedBytes = Buffer.from(await stored.Body.transformToByteArray());
  if (storedBytes.byteLength !== sourceBytes.byteLength || checksum(storedBytes) !== sourceHash) {
    throw new Error("R2 image verification failed; the Supabase record was left unchanged.");
  }

  const { data: updated, error: updateError } = await supabase.from("day_photos")
    .update({ storage_provider: "r2" })
    .eq("id", photo.id)
    .eq("storage_provider", "supabase")
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error("The image copied correctly, but its storage marker could not be updated.");
  return { marked: Boolean(updated), bytes: sourceBytes.byteLength };
}

async function main() {
  let processed = 0;
  let totalBytes = 0;
  let offset = 0;
  const pageSize = 50;

  while (true) {
    let query = supabase.from("day_photos")
      .select("id,object_path,storage_provider")
      .eq("storage_provider", "supabase")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(dryRun ? offset : 0, (dryRun ? offset : 0) + pageSize - 1);
    const { data: photos, error } = await query;
    if (error) throw new Error("Could not list evidence metadata from Supabase.");
    if (!photos?.length) break;

    if (dryRun) {
      processed += photos.length;
      offset += photos.length;
      if (photos.length < pageSize) break;
      continue;
    }

    for (const photo of photos) {
      const result = await migrateOne(photo);
      if (result.marked) {
        processed += 1;
        totalBytes += result.bytes;
      }
    }
  }

  if (dryRun) {
    console.log(`Dry run complete: ${processed} Supabase evidence records are waiting for migration.`);
  } else {
    console.log(`Migration complete: ${processed} images verified in R2 (${totalBytes} bytes). Supabase copies were retained.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evidence migration failed.");
  process.exitCode = 1;
}).finally(() => r2.destroy());
