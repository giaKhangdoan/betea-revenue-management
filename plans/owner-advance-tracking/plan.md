# Implementation Plan: Sổ ứng tiền cá nhân và cải thiện kho

**Date:** 2026-10-06  
**Mode:** hard  
**Risk:** high-risk — financial schema, owner-only evidence, RLS and profit/inventory calculations  
**Project root:** `E:/quản lí thu chi` (git root; resolved by artifact-layout rule 2)  
**Spec:** `plans/owner-advance-tracking/spec.md`  
**Research inputs:** brainstorm/independent review plus two hard-mode research reports returned in chat.  
**Stack:** Next.js 16.3.6, React 19.2.8, Supabase JS 2.117.2, existing private Cloudflare R2 helpers. No new dependency planned.  
**Test mode:** default; `--tdd` was not requested. Each phase includes verification, with no “Tests to Write First” sections.

## Scope challenge

- **Exists?** Inventory receiving, daily expenses, monthly profit, and day-photo storage exist. Owner advances, reimbursements, purchase evidence, and explicit profit postings do not.
- **Minimum complete slice?** An owner-only voucher with evidence, line items, optional stock receipt, append-only partial repayments, explicit eligible-cost posting, and a monthly summary. Inventory history correctness and existing inventory-loading issues are separate hardening work because the new stock link depends on trustworthy history.
- **Complexity:** Hard/high-risk. The work changes database authorization and transaction boundaries and feeds owner-visible profit and stock movement.

## Locked business rules

1. Bluebook compares gross revenue with gross web revenue. Staff-paid daily ice/delivery stays in `daily_expenses`, separate from gross revenue and from the personal advance ledger.
2. Owner-paid raw materials link to stock but never enter profit through this feature. Monthly POS COGS remains authoritative; the system must not guess invoice-to-COGS matches.
3. Every purchase line stores an explicit persisted cost classification (`raw_material` or `non_ingredient`); free-text inventory categories never determine profit eligibility. Admin may post a priced `non_ingredient` line, or all priced eligible lines, to profit only after preview and explicit confirmation. Unpriced lines are not silently allocated. Posting is separate from `daily_expenses`; each source line can post once.
4. Repayments are append-only events and may be partial. Every request requires an idempotency key unique per voucher: replaying the same key and payload returns its original result, while reusing a key with a different payload fails. A transaction locks the voucher and rejects repayment totals above the advance, including concurrent submissions.
5. Owner purchase evidence is stored in R2 and readable only through an admin-only route. It has separate metadata and object paths from day evidence.
6. A purchase voucher creates at most one linked stock receipt; service/non-stock lines do not create stock movement. Receipt corrections and finalized count corrections become timestamped history events.
7. Vouchers start as drafts. A draft has no effect on advances, profit, reimbursements, or inventory. Finalization commits its financial state and exactly one stock effect together; canceling a draft leaves no active voucher or receipt.
8. Daily expenses and owner advances are distinct money sources. Since legacy daily expenses have no shared transaction ID, exact/near matches are surfaced for owner review before finalization. For the same real purchase, owner must select one canonical record according to who paid: reclassify/link an existing daily expense as a personal advance when paid personally, or cancel the advance draft and retain the daily expense when paid from shop cash. In one atomic transaction, audit the choice, remove the duplicate financial effect, and link any existing stock receipt or create exactly one new stock movement. A genuinely different purchase may proceed only with an audited reason.
9. The purchase-monitoring page (not the main Overview dashboard) shows `đã ứng` as the invoice total of finalized vouchers whose purchase date is in the selected month; `đã hoàn đến cuối tháng` is reimbursements against those same vouchers recorded on or before that month's final day; `còn ứng cuối tháng` is their balance at that cutoff. Label these as purchase-cohort metrics. Drafts and canceled vouchers are excluded. The same feature separately shows current outstanding across all finalized vouchers. Keep the main Overview dashboard's existing revenue and profit presentation unchanged; do not add purchase/advance KPIs or recent-purchase rows there.

## Story IDs

- **ADV-01 (P1):** Create and review an owner advance voucher with total, note, multiple evidence files, and item/quantity rows.
- **ADV-02 (P1):** Link inventory rows to stock once; preserve correction history.
- **ADV-03 (P1):** Record partial reimbursements and outstanding balance safely.
- **ADV-04 (P1):** Manually post selected/all eligible non-ingredient costs to profit without duplication.
- **ADV-05 (P1):** Keep shop-paid daily expenses and gross Bluebook reconciliation separate from personal advances.
- **ADV-06 (P1):** Show monthly advances, reimbursements, outstanding balance, and recent purchases inside the purchase-monitoring feature, separate from the main Overview.
- **ADV-07 (P1):** Enforce owner-only data and evidence access at server and database layers.
- **INV-01 (P2):** Make inventory input/conversion anomalies easier to detect and defer history queries until requested.

## Phase map

| Phase ID | Objective | Stories | Depends on |
|---|---|---|---|
| `phase-01-inventory-history` | Preserve timestamped receipt/count history and correct as-of summaries | ADV-02, INV-01 | None |
| `phase-02-advance-database` | Add owner-only draft/final voucher, line, reimbursement, posting schema and atomic RPCs | ADV-01–05, ADV-07 | Phase 01 contract agreed; migration is additive |
| `phase-03-private-evidence` | Add private R2 upload/read/finalize and orphan cleanup | ADV-01, ADV-07 | Phase 02 metadata schema |
| `phase-04-owner-advance-workflows` | Build owner entry, purchase detail, stock linkage, repayment, posting, and duplicate review | ADV-01–05, ADV-07 | Phases 02–03 |
| `phase-05-profit-overview-navigation` | Integrate posted costs into existing profit/reporting, build the separate purchase-monitoring summary, and update navigation | ADV-04–06 | Phase 04 posting API |
| `phase-06-inventory-ux-and-lazy-history` | Reorder inventory tasks, clarify conversions/anomalies, and query history on demand | INV-01, ADV-02 | Phase 01 |

## Cross-cutting invariants

- Store VND as integer `bigint`; validate all sums as safe integers in the app and database. Do not use floating-point arithmetic for money.
- All new tables have RLS enabled, revoke direct writes from `anon` and `authenticated`, and expose only owner-scoped `SELECT` plus narrowly scoped `SECURITY DEFINER` RPCs. RPCs check `auth.uid()`, owner profile, row ownership, and use an empty `search_path`.
- Do not use a service-role client in user-facing routes. Staff sessions must receive no purchase, repayment, posting, or evidence metadata through SQL, server components, APIs, or signed URLs.
- Only the owner/admin may create or access a personal advance. Staff daily-expense actions remain limited to costs paid from shop sales; there is no staff control or RPC for admin-paid purchases.
- Never calculate net purchase amount from quantity × inferred item price. Invoice total is authoritative; line amount is optional and entered/allocated explicitly by the admin when profit posting is desired.
- Draft/canceled vouchers create no inventory movement and do not appear in financial totals. On finalization, only stock lines create inventory movements. A finalized voucher with only non-stock lines creates no stock receipt.
- Every consequential edit, cancel, repayment, profit post, and stock correction is append-only or has a before/after event; no destructive deletion of financial history.

## Migration and rollback strategy

1. Ship additive migrations only. Keep legacy tables and columns readable; never rewrite old vouchers/counts in place or drop staff-facing receipt RPCs as part of this feature.
2. For inventory history, backfill new snapshots from existing correction records without deleting them. Receipt initial state is reconstructed from the first `prior_lines`, each post-correction state from the next correction's `prior_lines`, and the final state from current lines. Finalized count corrections already retain both `prior_items` and `updated_items`. Record/flag any row whose ordering or snapshots cannot be reconstructed deterministically; do not invent a past value. In the same transaction, add initial snapshots to every new-write path: `staff_create_inventory_receipt`, `finalize_inventory_count`, and owner-linked receipt creation, as well as all correction RPCs. Keep the legacy reader available until backfill checks pass.
3. Deploy the additive schema/RPCs before app code. Draft creation stores no inventory movement; finalization/duplicate resolution commits voucher state, daily-expense disposition, stock receipt/link, and audit in one database transaction. Reimbursement and profit-posting events are each committed in one transaction. R2 uses pending upload intents and compensating deletion; DB/R2 are not treated as a distributed transaction.
4. Rollback is application rollback only: redeploy the previous app while retaining additive tables/RPCs and all saved data. Correct schema defects with a forward migration. Do not drop new tables, delete evidence, or roll back financial events to “undo” a release.
5. Keep old and new inventory correction RPC behavior compatible by writing legacy correction rows and new timestamped snapshots in the same transaction. This lets an old UI build continue to use existing receipt/count reads after app rollback.

## Risks and mitigations

- **Historical backfill ambiguity:** existing receipt correction rows contain before-snapshots, not explicit after-snapshots. Reconstruct only when the sequence is deterministic; flag unresolved records and retain legacy display for them until owner review.
- **Concurrent reimbursements:** lock the parent voucher `FOR UPDATE`, compute outstanding from committed events inside the same RPC, and require a unique idempotency key so retries do not duplicate repayment events.
- **R2/DB partial failures:** create an upload intent before signing, verify the uploaded object before finalizing metadata, delete on known DB failure, and sweep expired intents/objects after a grace period.
- **False duplicate matches:** exact date/amount/reason matching is only a warning because legacy daily expenses lack a shared ID. Resolve candidates before draft finalization. For confirmed same transactions, reclassify the existing row according to the actual payer, retain a before/after audit, reverse its prior P&L effect as needed, and link any existing stock receipt; for a shop-cash purchase cancel the draft and keep the expense. For different purchases, require an audited reason before finalizing. Never create a second stock movement or silently drop the source record.
- **Profit allocation:** persisted `cost_class` is the sole eligibility authority. `raw_material` lines are rejected by the database RPC even if a caller bypasses the UI; `non_ingredient` posting requires an explicit line amount. “Post all eligible” previews only priced non-ingredient lines and clearly lists unpriced/excluded rows.
- **Historical purchase-monitoring consistency:** compute selected-month advance/repaid/outstanding metrics from the finalized purchase cohort and month-end cutoff, so reopening an old month gives the same values. Exclude drafts/canceled vouchers. The current global open balance is a separate metric within the purchase-monitoring feature.
- **Dashboard scope:** do not add purchase-monitoring metrics to the main revenue/profit Overview; keep the new month-end metrics in the dedicated purchase-monitoring screen.
- **Storage privacy:** test direct R2 signed-read route using staff and unauthenticated sessions, not just UI visibility. Keep path non-public and response cache `private, no-store`.

## Verification commands (to run during implementation, not during planning)

- Unit/type/lint: `npm test -- <phase test file>`, `npm run typecheck`, `npm run lint -- <touched paths>`.
- Database: against a disposable local Supabase/Docker project only, run `supabase db reset` then `supabase test db`; never point reset at a linked/production database.
- Release acceptance: run the owner/staff browser matrix in the phase files against local seeded accounts; verify evidence and finance data do not appear in staff network responses.

## Open questions

No product decisions block implementation. Operationally, the team must decide where to schedule the expired-upload cleanup invocation in the deployment environment; until then, expose an owner-only maintenance action/command and keep intents visible as pending rather than leaving objects untracked.

## Execution checklist

- [x] Phase 01 — inventory history
- [x] Phase 02 — advance database
- [x] Phase 03 — private evidence
- [x] Phase 04 — owner workflows
- [x] Phase 05 — profit, purchase monitoring, and navigation
- [x] Phase 06 — inventory UX and lazy history

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-10-06 23:06
**Phase in progress:** phase-06-inventory-ux-and-lazy-history
**Status:** Owner approved Cook Step 5. Phase 06 implementation, docs, and tracking are complete locally under the high-risk hard lane. Re-run verification: Vitest 160/160; isolated Docker pgTAP 259/259; typecheck, focused lint, production build, diff check, and `feature_list.json` validation passed. Browser smoke confirmed inventory, receiving, catalog, and history screens render. The inventory page shows the saved count and lazy correction history opens with zero events; receiving/catalog/history list data reads still show the app's load-error state because localhost is configured to use hosted Supabase without the Phase 06 migration. No browser writes were made. Per owner instruction, Git handoff/push, production migration, and Vercel publish/deploy remain deferred.

### Decisions made this session
- Preserve the main Overview page's existing revenue/profit-only surface; purchase cohort and current advance balances stay inside `/advances`.
- Add posted non-ingredient costs to profit by their saved accounting month; reimbursement events do not alter profit, and reversals are reported in their recorded accounting month.
- Phase 05 uses the hard lane derived from the plan's high-risk classification; automated tests run after implementation because this plan did not request `--tdd`.
- Phase 06 history reads are task-first and bounded, including owner correction history which loads only after opening a 20-row keyset page. Export queries use deterministic tie-breakers, explicit row budgets, and owner-scoped timestamp indexes.

### Next immediate action
Stop at the locally verified deliverable. Keep Git handoff/push, production Supabase migration, and Vercel publish/deploy deferred until the owner asks for them.
