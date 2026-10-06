# Phase 05 — Profit, purchase-monitoring dashboard, and navigation

**Phase ID:** `phase-05-profit-overview-navigation`  
**Stories:** ADV-04, ADV-05, ADV-06, ADV-07  
**Depends on:** Phase 04 posting API and event model.

## Objective

Reflect only explicitly posted eligible costs in profit, show purchase/advance metrics inside the dedicated purchase-monitoring feature, and reduce the flat admin navigation without disturbing the main revenue/profit Overview or gross Bluebook reconciliation.

## Tasks and touched modules

1. Extend `src/lib/finance/calculations.ts` with a clearly named owner-posted-expense input and exact integer aggregation. Update monthly profit readers in `src/app/(private)/page.tsx` and `src/app/(private)/reports/page.tsx` to fetch posted profit events for the selected range and include each source exactly once.
2. Keep current monthly POS COGS and daily expense paths unchanged. Do not subtract purchase voucher totals, repayments, raw materials, or unposted line costs. Use purchase month as the accounting month by default; store that month on each posting so later edits/reversals do not silently move the expense to another period.
3. Add `src/lib/owner-advances/overview.ts` query for the selected month's purchase cohort and latest 3–5 purchase rows. Define the dedicated purchase-monitoring dashboard metrics precisely: `đã ứng` = invoice totals for finalized vouchers whose purchase date falls in the selected month; `đã hoàn đến cuối tháng` = repayment events linked to those same vouchers with event date through the selected month's final day; `còn ứng cuối tháng` = that cohort's balance at that cutoff. Use the store timezone for date boundaries. Show current outstanding across all finalized vouchers in this feature; do not label current balances as historical month-end values. Exclude drafts/canceled.
4. Build the purchase-monitoring summary/list at `/advances`. Do not add a card or purchase metrics to `src/app/(private)/page.tsx`; keep the main Overview revenue and profit display unchanged. Do not show invoice images inline in purchase list; show evidence only on the protected detail page.
5. Group links in `src/components/layout/private-navigation.tsx` into clear admin areas (e.g. “Tổng quan”, “Vận hành” for Sổ ngày/Kho, “Sản phẩm” for Giá vốn/SOP, “Quản lý” for Nhân viên/Chi phí tháng/Báo cáo/Lịch sử/Ứng tiền). Preserve correct active-route state and mobile navigation behavior.
6. Extend `src/lib/finance/calculations.test.ts` and `src/app/(private)/reports` coverage for month/date filters, posted vs unposted lines, reimbursements not changing profit, ingredients excluded, reversals, and missing-day handling. Add a unit test proving Bluebook gross remains unchanged by daily expense rows.
7. Treat database read failures as unavailable data, not as zero or missing entries: surface an explicit error on Overview/reports/week ledger; do not render the owner day-edit form when its record cannot be loaded; hide purchase counts and disable new voucher creation when the existing-voucher list cannot be checked.

## Acceptance

- Monthly profit changes only after successful admin posting of an eligible non-ingredient line and does not change again on retry.
- Refund events never alter profit. Raw material and unpriced lines never enter profit. Shop-paid daily expenses remain counted once through the existing daily expense path.
- Gross Bluebook/web revenue comparison remains unchanged when daily expenses exist.
- The purchase-monitoring feature shows selected-month purchase-cohort advanced, repaid-through-month-end, and month-end outstanding values consistent with event history and voucher detail. Reopening a past month yields the same month-end values after later repayments; the current global balance is separately labeled in this feature.
- The main Overview continues to show revenue and profit as before and exposes no purchase/advance KPI or recent-purchase list. Staff dashboard exposes neither the purchase-monitoring feature nor its data.
- Navigation groups remain keyboard-accessible, indicate active page correctly, and fit the mobile layout.
- Failed data reads are clearly distinguished from genuinely missing rows and suppress financial totals or edits that could be misleading or overwrite existing data.
- Future-dated vouchers and repayments are rejected in SQL; moving a purchase date past an existing reimbursement is rejected; the current balance and historical month cutoff exclude future events.

## Verification

- `npm test`: 28 files / 135 tests passed.
- Isolated local Supabase Docker `supabase test db`: 10 SQL files / 243 assertions passed; includes cutoff, future-date, and date-correction guards.
- `npm run typecheck`, focused ESLint on the touched finance, advances, overview, ledger, and navigation files, `npm run build`, and `git diff --check` passed.
- Read-only local UI smoke confirmed grouped navigation and explicit unavailable/error states. The configured preview backend is the hosted Supabase project, where purchase tables are not deployed; no production migration, push, or deployment was performed.

## Risks and notes

- Week/range reports currently describe profit before COGS, while month reports use monthly POS COGS. Keep that established distinction explicit; include owner-posted non-ingredient costs in the periods where the corresponding current expenses are allocated, and add UI notes if the metric label changes.
- Consider only paid/unreimbursed amounts for advance monitoring; do not confuse “cash advanced” with “expense posted to profit.” Label each metric independently.
- Independent review found and closed a P1 overwrite path: on an owner daily-record load error, the page now hides the full-record edit form instead of submitting blank inputs. The week view now identifies read failures instead of labelling every date “Chưa nhập.”
