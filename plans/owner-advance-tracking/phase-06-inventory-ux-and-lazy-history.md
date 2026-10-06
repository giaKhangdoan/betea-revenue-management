# Phase 06 — Inventory usability and lazy history

**Phase ID:** `phase-06-inventory-ux-and-lazy-history`  
**Stories:** INV-01, ADV-02  
**Depends on:** Phase 01 snapshot semantics; can proceed independently of purchase UI after Phase 01.

## Objective

Make inventory work task-first, explain unit conversions and outliers, and query long history only when the owner requests it.

## Tasks and touched modules

1. Refactor `src/app/(private)/inventory/page.tsx` so it does not call `getInventoryReceipts` on catalog/receiving pages unless that selected task needs recent receipts; split owner read paths by tab and pass only minimal data.
2. Refactor `src/lib/inventory/receipts.ts` to use cursor/keyset pagination with bounded page size for receipts, lines, and corrections. Do not load all receipt headers, all correction rows, and all lines just to render stock/catalog. Preserve export behavior by keeping a dedicated bounded export query in `src/lib/inventory/export.ts`.
3. In `src/components/inventory/inventory-workspace.tsx`, put the selected task/date/count form first. Replace always-rendered owner history with a clear “Mở lịch sử kho” action that loads a paginated history route/panel only on demand; retain staff's current-week boundary.
4. In `src/components/inventory/inventory-receiving-panel.tsx` and `src/components/inventory/inventory-catalog-manager.tsx`, show an inline conversion preview (`entered quantity × factor = stock-unit quantity`), distinguish package/loose inputs, indicate unit verification state, and preserve quantity snapshots. Add confirmation for large deviations; do not autocorrect quantities or conversions.
5. Add an explainable anomaly prompt when a converted receipt quantity is greater than 5× the median of the last five receipt quantities for that item. Show the current quantity, comparison baseline, and multiplier; owner may confirm or edit. If there are fewer than three historical receipts, show the conversion preview without a statistical warning. Never autocorrect a value or label it as loss.
6. Add query tests for catalog/receiving tabs issuing no history query, history page limits, authorization/time boundaries, conversion preview math, and outlier confirmation. Update `src/lib/inventory/counts.test.ts` only for snapshot-based history behavior.

## Acceptance

- Opening inventory catalog or receiving tab performs no full-history queries.
- Opening stock tab loads only the count task's required current data; history is fetched only after the owner opens it and each page is bounded.
- A received or counted quantity shows its entered unit, factor, canonical unit, and converted result before save; a receipt more than 5× its item baseline asks for confirmation and shows the comparison, but remains unchanged.
- Staff sees only current-week stock/receipts as before; admin receives full history only when requested.
- Excel export returns the same bounded period and totals after query refactoring.

## Verification

- `npm test -- src/lib/inventory/counts.test.ts src/lib/inventory/receipts.test.ts`
- `npm run typecheck`
- `npm run lint -- 'src/app/(private)/inventory/page.tsx' src/lib/inventory src/components/inventory`
- Local browser check with a large seeded receipt history: compare network/query count for stock, receiving, catalog, and expanded history; verify no history request occurs until opened.

## Risks and notes

- Existing unusual inventory values are not proof of a calculation defect; preserve entered values and ask for owner confirmation instead of normalizing data automatically.
- Avoid regressing the staff rule that staff can only view the current week; lazy loading is not authorization and must preserve the existing database policies.
