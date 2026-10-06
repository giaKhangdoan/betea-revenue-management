# Phase 01 — Preserve inventory history

**Phase ID:** `phase-01-inventory-history`  
**Stories:** ADV-02, INV-01  
**Depends on:** None. This is the data-integrity prerequisite for purchase-to-stock links.

## Objective

Make historical stock movement reproducible as of each count/correction timestamp. Fix the confirmed issue where current receipt lines and corrected finalized-count rows can be projected backward into already closed periods.

## Tasks and touched modules

1. Add an additive migration, e.g. `supabase/migrations/20261007010000_inventory_history_versions.sql`:
   - Add immutable receipt snapshot/event rows keyed by owner, receipt, effective timestamp, and a global transactionally assigned sequence; retain canonical item name/unit/conversion/quantity snapshots.
   - Add immutable finalized-count snapshot/version rows for each item and effective timestamp, ordered with the same owner-wide event sequence so receipt/count writes that share a timestamp have a deterministic cutoff order.
   - Enable RLS, revoke direct table writes, add owner-only reads, and revoke direct execute on `private.append_inventory_receipt_snapshot(...)` and `private.append_inventory_count_snapshot(...)`. Only the approved `SECURITY DEFINER` initial-write and correction RPCs may call those helpers. Use explicit event types `receipt_created`, `count_finalized`, `receipt_corrected`, and `count_corrected`; backfill rows may use `receipt_backfill`/`count_backfill`.
   - Backfill without modifying/deleting existing `inventory_receipt_corrections` or `inventory_count_corrections`. For a receipt, derive initial state from first `prior_lines`; derive each correction's resulting state from the following correction's `prior_lines`, and the last from current lines. For a receipt with no correction rows, treat current lines as initial only if the existing timestamps/source prove they are still the creation state (including an explicit bounded creation-time tolerance); if `updated_at` or line timestamps indicate a possible pre-audit edit, or evidence is ambiguous, flag the timeline unverified rather than assigning current lines to `received_at`. For counts, use first `prior_items` as the original state and each correction's `updated_items` at `corrected_at`.
   - Record backfill status/ambiguity rather than fabricating snapshots when ordering/state is not recoverable. Verify counts of source headers, correction rows, and generated snapshots before switching readers.
2. Replace the relevant SQL entry points/functions in the additive migration so every inventory state change receives a snapshot in the same transaction: initial receipt creation through existing `staff_create_inventory_receipt(jsonb)`, count finalization through authoritative `finalize_inventory_count(uuid)`, and corrections through `owner_correct_inventory_receipt`, `staff_update_inventory_receipt`, and `owner_correct_inventory_count`. Set effective timestamps and allocate sequence numbers only after acquiring `private.lock_inventory_owner`; do not trust a `received_at` default assigned before a BEFORE INSERT trigger waits for that lock. Initial snapshots capture canonical item/unit/conversion/quantity state; correction snapshots capture before/after state, actor, time, and reason. Phase 02 must call the receipt snapshot helper from `owner_finalize_purchase_voucher`, and its boundary test must verify this owner-linked path. Direct callers cannot execute the helper or append table rows.
3. Refactor `src/lib/inventory/counts.ts` so `summarizeInventoryMovement` consumes event snapshots and selects each finalized count/receipt state as of period boundaries; retain a compatibility path for flagged legacy rows.
4. Extend `src/lib/inventory/receipts.ts` and `src/lib/inventory/count-corrections.ts` types/readers to carry version/correction timestamps and make historical differences inspectable.
5. Add regression coverage in `src/lib/inventory/counts.test.ts` and a new `supabase/tests/inventory_history_versions.sql` for corrections before/after count cutoffs, multiple receipt corrections, multiple count corrections, ties, and non-reconstructable legacy rows.

## Acceptance

- A correction at time `t` changes only movement periods whose cutoff is at or after `t`; a period finalized before `t` returns the same values before and after the correction.
- Every snapshot/event is append-only and includes actor, effective time, and event type; correction events also include reason and before/after quantities.
- Post-migration staff receipt creation and count finalization append their initial snapshot in the same database transaction; a forced snapshot-write failure rolls back the corresponding receipt/count write. Phase 02's owner-linked finalization path calls the same helper and is verified in its boundary test.
- A receipt created concurrently with count finalization receives an effective time/sequence after its owner lock is acquired; it cannot appear before the count merely because its column default ran before the trigger waited.
- The private snapshot helper and snapshot tables reject direct `authenticated`/`anon` writes or invocation; only the approved RPCs can append.
- The backfill query reports a deterministic result for every reconstructable receipt/count and flags every unresolved one without dropping its legacy audit data.
- Staff correction remains limited to existing same-day policy; owner correction remains owner-only.

## Verification

- `npm test -- src/lib/inventory/counts.test.ts`
- `npm run typecheck`
- On disposable local Supabase: `supabase db reset` then `supabase test db`
- Review migration output against source receipt/count/correction counts; do not execute on linked or production DB during development.

## Risks and notes

- The old receipt correction table stores `prior_lines` but not explicit after-state rows. The backfill depends on timestamp ordering and the next before-snapshot. If any receipt has inconsistent/tied ordering, preserve the old view and mark that timeline as legacy/unverified until reviewed.
- Older receipts may have been edited before correction auditing existed. When existing timestamps cannot prove current lines are the original receipt lines, do not backfill a guessed initial state; keep the legacy display and flag that receipt as unverified.
- This phase must not “fix” historic counts by editing source rows; append-only snapshots establish the new as-of truth without erasing previous evidence.
