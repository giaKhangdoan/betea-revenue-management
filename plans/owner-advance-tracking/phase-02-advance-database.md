# Phase 02 — Owner advance schema and transactional rules

**Phase ID:** `phase-02-advance-database`  
**Stories:** ADV-01, ADV-02, ADV-03, ADV-04, ADV-05, ADV-07  
**Depends on:** Phase 01 history contract; schema stays additive.

## Objective

Create a separate owner-only financial ledger with auditable purchase lines, linked stock receipt, reimbursement events, explicit eligible profit postings, and safe database transaction boundaries.

## Tasks and touched modules

1. Add a migration, e.g. `supabase/migrations/20261007020000_owner_purchase_advances.sql`, defining owner-scoped tables:
   - `owner_purchase_vouchers`: purchase date, vendor optional, invoice total VND, note, created/updated actor/time, explicit `draft`/`finalized`/`canceled` status and transition timestamps/actor, cancel event reference, optional linked inventory receipt. Only `finalized` vouchers affect advance balances, profit eligibility, reimbursements, dashboard totals, or inventory; drafts are editable and canceled drafts remain auditable.
   - `owner_purchase_lines`: description, explicit persisted `cost_class` enum/check (`raw_material` or `non_ingredient`), inventory/non-inventory classification, optional inventory item FK, unit/quantity snapshot, optional explicit line amount, and stable line order. The database RPC uses `cost_class` as the profit-eligibility source; never infer it from the existing free-text inventory category. Enforce that stock rows have an inventory item and valid quantity; service/non-stock rows never create stock movement.
   - `owner_purchase_events`: append-only before/after snapshots and reason for voucher/line edits, cancellation, duplicate-match decisions, and corrections.
   - `owner_purchase_source_links`: unique owner-scoped link from a `daily_expenses.id` to its duplicate-resolution outcome and (when reclassified) the resulting voucher. Preserve the matched expense's before-state, resolution, actor/time, and idempotency key so one source expense cannot be reclassified twice; a retained-shop-expense decision records the audited resolution without deleting the source row.
   - `owner_purchase_reimbursements`: append-only repayment/reversal events, date, amount, note, optional evidence reference, required idempotency key, actor and time. Add a unique `(voucher_id, idempotency_key)` constraint and store enough request/result data to return the original committed result on exact retries; reject key reuse with different payload.
   - `owner_purchase_profit_postings`: append-only posting rows with unique source line key, month/date, amount, actor/time, and reversal link; raw-material lines cannot post through this feature.
   - `owner_purchase_upload_intents` and `owner_purchase_evidence`: private object path, MIME, byte size, file label/caption, upload state/expiry, and voucher/reimbursement association.
   - Add a nullable purchase-line source link on inventory receipt lines or equivalent FK mapping, with a unique constraint on non-null source-line links, so a voucher's stock quantity is traceable exactly once; allow linking matching existing receipt lines one-to-one without adding stock again. Verify owner, stock item, and converted quantity before linking; incompatible lines require a separately audited correction, never a second receipt to paper over the mismatch.
2. Add composite foreign keys/indexes for `(owner_id, id)` scope and date/month list pages; constrain integer VND to non-negative/safe bounds and quantities using existing inventory rules.
3. Enable RLS and revoke all direct table writes from anon/authenticated. Permit authenticated owner reads only when `private.is_store_owner()` and `owner_id=auth.uid()`. Staff receives no access to these tables or functions.
4. Add narrow `SECURITY DEFINER` RPCs with empty `search_path` and explicit auth/owner checks:
   - `owner_create_purchase_voucher`: validates total/lines and explicit line `cost_class`, then creates an editable draft and its lines only. It must not create a receipt, reimbursement, profit posting, or reportable advance balance.
   - `owner_finalize_purchase_voucher`: locks an owner draft, validates any required duplicate-review decision, atomically marks it finalized and either creates at most one receipt plus receipt lines for stock rows or links exact compatible existing receipt lines one-to-one. It appends the initial inventory history snapshot in the same transaction. Replays are idempotent; canceled/finalized drafts cannot be finalized again.
   - `owner_update_purchase_voucher`: edits only allowed editable fields through an auditable before/after event; changes to posted/reimbursed vouchers must use correction/reversal events and invoke the timestamped stock correction path.
   - `owner_resolve_purchase_duplicate`: required idempotency key; locks the candidate daily expense and voucher draft, verifies both belong to the owner and the expense is still active, then atomically records one resolution. For personal-paid same transactions, finalize the draft, create the unique source link, soft-delete/reclassify the active daily expense so it no longer contributes to daily-expense profit, and either link compatible pre-existing receipt lines or create the one receipt/movement if none exists; append before/after events and initial snapshot in that same transaction. For shop-cash same transactions, cancel the draft while retaining the active daily expense and audit link; create no receipt. A different-purchase decision requires a reason and atomically finalizes the draft while leaving the expense unchanged. Exact retries return the original result; key reuse with another payload fails.
   - `owner_record_purchase_reimbursement`: locks the voucher row `FOR UPDATE`, checks the required idempotency key and exact-payload replay, sums committed reimbursement events, rejects overpayment, and appends the event.
   - `owner_post_purchase_costs`: accepts selected line IDs or “all eligible”; validates each has `cost_class='non_ingredient'` and an explicit amount, enforces unique source line, and returns preview/posted amount and skipped unpriced rows. Accounting month defaults to purchase month. Reversal is a compensating event, not delete.
5. Extend `supabase/tests/owner_purchase_advances_boundary.sql` to verify owner/staff/anon access, cross-owner IDs, atomic rollback if stock lines fail, only stock rows affect inventory, owner finalization appends the initial inventory snapshot in the same transaction, no ingredient profit posting, unique posting, partial reimbursements, over-refund rejection, and idempotent retries.

## Acceptance

- Creating a draft does not affect financial/dashboard/inventory totals. Finalizing a voucher with mixed stock and service rows commits as one DB transaction; only stock rows create inventory movements and each has one source link.
- Each voucher line and existing receipt line can participate in at most one stock source link; an existing line is linked only when owner/item/converted quantity validate.
- A forced invalid stock line rolls back voucher header and all child rows.
- Staff and anon cannot select, insert, update, delete, or execute owner financial functions, including by guessing UUIDs.
- Two concurrent reimbursement requests cannot make cumulative paid amount exceed invoice total; retrying the same key and payload returns the original result without appending a duplicate, while reusing that key for a different amount/date fails.
- A raw-material line cannot be posted to profit even when an API caller bypasses the UI or its free-text inventory category resembles a non-ingredient; only persisted `cost_class='non_ingredient'` with explicit amount is eligible.
- Resolving a same-purchase daily-expense duplicate is one atomic, idempotent transaction: injected failure leaves both source and voucher unchanged; retry cannot produce a second link, expense deletion, profit effect, or stock movement. A personal-paid resolution leaves one source record and no active daily-expense effect; shop-cash resolution leaves the daily expense active and cancels the advance.
- Failure injection at voucher finalization before/after receipt creation rolls back voucher status, receipt, lines, snapshots, source expense, and links together. Draft and canceled vouchers never appear in outstanding totals or profit.
- Raw materials never create profit postings; unpriced non-stock lines are skipped with an explicit result; duplicate line posting is rejected.

## Verification

- On disposable local Supabase: `supabase db reset` then `supabase test db`
- `npm run typecheck` after generated/query types are updated if this repository generates them
- Run a local integration race check using two independent authenticated Supabase clients against one voucher; assert exactly one of two over-limit competing requests commits.

## Verification results (2026-10-06)

- Clean reset and all migrations succeeded on isolated local Supabase; all 9 pgTAP files passed (205 assertions), including the owner purchase boundary (36/36) and inventory history (29/29).
- Two authenticated clients concurrently attempted 60,000 VND repayments against one 100,000 VND voucher. One succeeded, one was rejected for exceeding the advance, and the persisted balance remained within the invoice total. The temporary race trigger was removed afterward.
- `npm test` passed (81 tests), and `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- Independent security and stock-integrity review approved with no remaining blocker. Validation used only the disposable local database; no production database, push, or deployment was changed.

## Risks and notes

- Existing `daily_expenses` has no stable shared purchase ID. Do not claim the database can perfectly deduplicate historical rows. Phase 04 provides an exact/near-match review and persists an explicit owner decision.
- The unique source link and duplicate-resolution RPC are required because daily-expense soft deletion and voucher/receipt linkage must commit or roll back together; do not split this decision into separate frontend actions.
- Do not create stock receipt rows when saving a draft; only the finalization/duplicate-resolution RPC may create or link inventory state.
- Profit-postable line amounts are entered explicitly; never distribute the invoice total among items by an implicit formula.
- The monthly POS COGS aggregate has no row-level recipe link. Keep ingredient lines excluded rather than guessing whether POS already includes them.
