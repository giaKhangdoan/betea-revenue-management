# Private evidence images in Cloudflare R2

Day photos keep their metadata and access rules in Supabase. New image bytes are uploaded directly from the browser to the private `betea-evidence` R2 bucket using a short-lived presigned URL. The server checks the signed-in owner or staff session before issuing upload or view URLs. Supabase remains the fallback for records whose `storage_provider` is `supabase`.

## Server environment

Configure these server-only variables in local and Vercel environments:

- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME=betea-evidence`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Create a Cloudflare R2 Object Read & Write token scoped only to the `betea-evidence` bucket. Keep the Access Key ID and Secret Access Key out of `NEXT_PUBLIC_*` variables and source control. The R2 bucket should remain private. Its CORS policy should allow the production website and `http://localhost:3000`, with `GET`, `PUT`, and `HEAD` methods and the `Content-Type` request header.

## Apply and migrate

1. Apply `supabase/migrations/20261003150803_r2_day_photo_storage_provider.sql` before deploying the application code. Existing records default to `storage_provider = 'supabase'`.
2. Add the four R2 variables above to Vercel Production. Add them to Preview too if preview deployments are used, then deploy the application.
3. Sign in as the store owner and open `/storage-migration`. Select **Bắt đầu chuyển ảnh**. This owner-only page migrates one image per request, checks SHA-256 and size, then switches that image's provider to `r2`.

The migration runs in the Vercel server runtime, so the Supabase service role and R2 credentials remain in Vercel and are never pulled into a local file. If the process is interrupted, reopen the page and continue; the remaining Supabase records stay usable. Supabase copies are retained for rollback and should be kept for 30 days before any later cleanup.

The standalone `scripts/migrate-evidence-to-r2.mjs` remains available for a trusted local environment that already has all required variables. Vercel Sensitive values are intentionally unavailable to `vercel env pull`.
