# Phase 04 — Owner purchase, reimbursement, and posting workflows

**Phase ID:** `phase-04-owner-advance-workflows`  
**Stories:** ADV-01, ADV-02, ADV-03, ADV-04, ADV-05, ADV-07  
**Depends on:** Phases 02–03.

## Objective

Give the admin a fast, auditable place to enter personal purchases, link purchased stock once, add evidence, record partial repayments, and explicitly choose eligible non-ingredient costs for profit posting.

## Tasks and touched modules

1. Add owner-only purchase-monitoring route/page `src/app/(private)/advances/page.tsx` and detail route `src/app/(private)/advances/[voucherId]/page.tsx`; gate both with `requireOwnerClient`. This feature is the only place for purchase/advance KPIs and purchase lists; do not place a purchase card on the main Overview dashboard. Add data loaders in `src/lib/owner-advances/` with owner scoping and pagination by month/date; avoid loading all vouchers/photos at once.
2. Add server actions in `src/app/(private)/advances/actions.ts` and validated domain helpers in `src/lib/owner-advances/` for draft create/update/cancel, finalize, reimbursement append, profit preview/commit, and duplicate resolution. All writes call the Phase 02 owner RPCs; UI never writes tables directly. Duplicate resolution sends a required idempotency key and makes one call to `owner_resolve_purchase_duplicate`; never perform a separate expense update, voucher cancel, or receipt link from the browser.
3. Build `src/components/owner-advances/` forms:
   - Voucher header: date, vendor, total invoice amount, note, multi-image upload/progress/preview. Saving first creates a draft; drafts are visibly marked and excluded from totals and inventory until finalized.
   - Repeating purchase rows: choose explicit cost class (`raw_material` or `non_ingredient`), then a stock item or non-stock description, quantity/unit snapshot, optional exact line amount. Display the stock conversion result before save. Do not derive cost class from an inventory category label.
   - Voucher detail: original evidence, draft/final/canceled state, stock receipt link, paid/reimbursed/outstanding amounts and append-only refund history. Draft view offers an explicit duplicate review and finalization action.
   - Profit panel: select eligible non-ingredient rows or all priced eligible rows; show month/date and exact amount before confirmation; list excluded raw materials and unpriced rows; require explicit confirm and show actor/time afterward.
4. Keep shop-paid daily expense entry in current staff/owner daily expense flow (`src/app/(staff)/staff/actions.ts`, `src/app/(private)/ledger/actions.ts`, `src/components/staff/staff-expense-manager.tsx`, `src/components/ledger/daily-expense-form.tsx`). Label this as paid from shop sales/cash. Staff can only use this flow and has no UI/action/RPC for creating a personal advance; personal advances and their evidence remain owner-only. Keep Bluebook revenue gross.
5. Add a duplicate warning lookup when a personal voucher/line matches a `daily_expenses` row by date, exact amount, and normalized reason/item text. Show matched expense/payment-source details and require the owner to choose the canonical record based on who actually paid:
   - If it is the same transaction and the admin paid personally, reclassify/link the existing daily-expense row to the advance with a before/after audit, remove its previous daily-expense profit effect exactly once, and link any existing stock receipt instead of creating another movement.
   - If it is the same transaction and shop cash paid, cancel the uncommitted advance draft and retain the daily expense as the sole record.
   - If it is a different purchase, continue only after entering a short audited reason.
   Do not hard-block legitimate equal transactions, silently delete history, or leave both records contributing to finance/inventory totals.
   For a later shop-paid daily expense that matches already-finalized purchases, block staff entry and let the owner explicitly confirm “different purchase” with a reason. Recompute the complete match set under the shared owner lock, audit each matching voucher, and fail closed if the lookup reaches its 1,000-row safety cap. An exact retry must return the recorded result before examining current voucher state. Once linked to a review decision, the daily expense is immutable in this phase; disclose the edit/delete lock in the owner and staff UI.
6. Add focused tests for action input validation, date/month filters, duplicate warning/acknowledgment, line eligibility, reimbursement display, and UI behavior for no/one/many images and mixed stock/service rows.

## Acceptance

- Owner can create a draft with multiple images and mixed stock/non-stock rows without affecting totals or stock; after duplicate review, finalization creates or links one receipt for stock lines and service lines do not affect stock.
- The owner can edit/correct a voucher without deleting history; edits after reimbursement or profit posting use a correction event.
- Multiple repayment entries calculate the outstanding amount correctly; the UI refreshes from server-returned balance after each successful save.
- Profit is unchanged on voucher creation and repayment. Only an explicit confirmed post of eligible priced non-ingredient line(s) creates a profit event; repeated post is rejected.
- A same-day expense match displays payer/source before finalization. A confirmed same personal purchase finalizes the draft, has one financial effect and at most one stock movement with an audit trail; a shop-cash purchase cancels the draft and remains solely a daily expense; a different purchase requires a reason and finalizes the draft without changing that expense. Corrections retain the prior row state in history. Replaying the same resolution request is safe, and a failed database transaction changes neither record.
- Draft and canceled vouchers cannot receive reimbursements or profit postings and are absent from financial/stock totals; only a finalized voucher can transition to reimbursable/postable state.
- A separate daily expense entered after a purchase is finalized is written only through the owner's explicit, audited review path when it matches; stale candidate sets are rejected, and exact retries remain idempotent after later voucher correction. Reviewed expenses are visibly locked from edit/delete.
- Staff can still enter shop-paid daily expenses but cannot create personal advances or access `/advances`, voucher APIs, evidence URLs, reimbursement details, or profit-post data. Attempts through direct action/RPC/API calls are denied.

## Verification

- `npm test -- src/lib/owner-advances`
- `npm test -- 'src/app/(private)/advances'`
- `npm run typecheck`
- `npm run lint -- 'src/app/(private)/advances' src/components/owner-advances src/lib/owner-advances`
- Browser acceptance with owner/staff accounts on desktop and mobile widths; verify invalid form submission preserves user-entered values and shows field-specific errors.

## Risks and notes

- Voucher total may not equal the sum of line amounts because line allocations are optional and receipts may combine inventory and other items. Show both totals and never silently force equality; profit posting only uses explicit line amounts.
- Reimbursement and profit-post records are financial history. Corrections must append compensating events rather than editing/deleting previous events.
- An expense already linked to a duplicate-review decision cannot be edited/deleted and has no dedicated correction/reversal workflow in Phase 04. Keep this limitation visible; a separate audited correction flow can be planned if the owner needs to correct a reviewed expense.
- Do not infer who paid from expense description. The owner must confirm the actual source of funds; the atomic RPC enforces the selected transition and source link.
