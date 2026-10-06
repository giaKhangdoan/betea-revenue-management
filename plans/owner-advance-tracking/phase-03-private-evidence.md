# Phase 03 — Private R2 evidence lifecycle

**Phase ID:** `phase-03-private-evidence`  
**Stories:** ADV-01, ADV-07  
**Depends on:** Phase 02 evidence metadata and upload-intent tables.

## Objective

Reuse the existing private R2 signer while isolating owner purchase evidence from Bluebook day photos and making uploads recoverable when R2 and Postgres operations fail separately.

## Tasks and touched modules

1. Add owner-only routes, separate from day evidence:
   - `src/app/api/admin/advances/evidence/upload/route.ts` creates a DB upload intent before returning a short-lived R2 PUT URL.
   - `src/app/api/admin/advances/evidence/[evidenceId]/url/route.ts` authenticates via `requireOwnerClient`, checks metadata ownership, and returns a short-lived signed GET URL with `private, no-store`.
   - Add a finalize route/action that checks R2 object existence/type/size, then atomically binds verified metadata to a voucher or reimbursement event.
2. Reuse `src/lib/storage/r2.ts` for signed R2 operations. Give the browser a short-lived PUT URL only for `{ownerId}/owner-advances-staging/{voucherId}/{uuid}.{ext}`. Before attaching metadata, verify the upload then read its bounded bytes through the server and write them to a separate `{ownerId}/owner-advances/{voucherId}/{intentId}.{ext}` key with conditional `If-None-Match: *`; only the latter key may be stored in evidence metadata. Never make a public URL.
3. Restrict each voucher to at most 10 images and 2 MB per image, JPEG/PNG/WebP, matching the current route's content rules unless product acceptance requires a different size. Store sanitized file label, MIME and byte size in metadata; never trust client-supplied object paths.
4. On known finalize/DB failure, expire the intent and delete its staging and sealed objects. Add an owner-only cleanup endpoint that sweeps stale intents after a grace period and removes pending orphan objects. For attached intents, it removes only the staging key after the PUT URL has expired plus a safety delay, so a replay cannot leave a permanent orphan; document the invocation until a deployment scheduler is selected.
5. Add route tests for owner success, staff/anonymous denial, wrong owner ID, expired intent, invalid MIME/size, missing object, direct day-photo route isolation, and cleanup idempotency. Add tests beside new route handlers or under `src/lib/storage`.

## Acceptance

- Owner can upload multiple images and see thumbnails/temporary previews; finalized evidence resolves through the owner-only signed-read route.
- Staff cannot create an upload intent, finalize evidence, read evidence metadata, or obtain a signed URL even when given a valid evidence UUID.
- Final evidence metadata points only to a server-sealed key that the browser upload URL cannot write; conditional creation prevents concurrent or retried finalization from replacing its bytes. All read links expire and responses are non-cacheable.
- A failed DB finalize removes the known uploaded object; expired pending intents are safely swept without deleting finalized evidence.

## Verification

- `npm test -- src/app/api/admin/advances/evidence`
- `npm run typecheck`
- Manual local browser/API check with one owner and one staff session; inspect requests and confirm staff responses contain no private path or signed URL.
- Use a disposable R2 bucket/prefix for upload/delete checks; do not test cleanup against production evidence.

## Risks and notes

- R2 object upload and Postgres metadata cannot be one atomic transaction. Pending intents, an immutable server-sealed object key, idempotent finalize, compensating deletion, and orphan cleanup bound this gap. A replayed presigned URL can recreate only a staging object, which delayed cleanup removes.
- The existing `/api/evidence/[photoId]/url` intentionally supports Bluebook staff access. Do not broaden or reuse it for owner purchases.
