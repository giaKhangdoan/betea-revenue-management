# Spec: Role nhân viên và nhập sổ theo ca

**Date:** 2026-09-26
**Status:** Ready for implementation

---

## Problem Statement

Chủ cửa hàng cần cho nhân viên nhập doanh thu và thông tin vận hành tại thời điểm kết thúc từng ca, đồng thời giữ riêng quyền quản lý lợi nhuận, chi phí nhạy cảm, đối soát và xác nhận vệ sinh. Nhân viên cần thao tác nhanh trên điện thoại và chỉ được xem dữ liệu của tuần hiện tại.

---

## User Stories

- **[US-01] [P1]** As an admin, I want to create, update, and deactivate staff access so that access stays under my control.
  Accepted when: public sign-up stays disabled; only the authenticated admin can create/update/reset-password/deactivate staff accounts; every staff account receives the fixed staff permission set; account actions are audited. A shared staff login is supported, so the audit trail identifies that shared account, not the individual employee using it.

- **[US-02] [P1]** As a staff member, I want to submit the sales figures for one shift when it ends so that the next shift can be entered without overwriting the earlier shift.
  Accepted when: the four shift windows are 06:00–10:00, 10:00–14:00, 14:00–18:00 and 18:00–22:00; the system stores each shift separately and computes daily revenue from the saved amounts.

- **[US-03] [P1]** As a staff member, I want to enter the daily bill count at the end of the day so that the order count is recorded separately from revenue.
  Accepted when: bill count is a non-negative integer entered manually once at day end and includes all orders from the counter, Grab, and Shopee; it is never inferred from revenue or platform counts.

- **[US-04] [P1]** As a staff member, I want to record Grab and Shopee revenue and orders at the end of the day, while being able to add orders during the day or enter the final order count, so that online orders are captured without losing the closing total.
  Accepted when: each platform has a revenue amount entered/updated at day close and an order count that supports both `+N` and direct final-count entry; the two entry modes update the same count; the separately entered total bill count includes counter, Grab, and Shopee orders and is manually entered on this site at day end for reconciliation, not calculated by adding platform counters.

- **[US-05] [P1]** As a staff member, I want to enter morning/evening meter readings and add dated incidental expenses with a reason so that the daily ledger is complete.
  Accepted when: meter readings are stored as kWh readings, not bill amounts; every incidental expense has a positive amount and a reason; staff may manage only records inside the allowed write window.

- **[US-06] [P1]** As a staff member, I want to upload Bluebook photos so that the admin can verify the handwritten record.
  Accepted when: the bucket remains private; staff can upload multiple photos categorized as Bluebook, cleaning, or arrangement evidence; and the admin can view each saved image within 5 seconds of successful upload. Only admin can mark cleaning or arrangement as confirmed.

- **[US-07] [P1]** As an admin, I want to review and change daily entries after the day ends, and own Bluebook reconciliation and cleaning/arrangement confirmations, so that sensitive decisions stay with me.
  Accepted when: staff cannot read or mutate reconciliation and cleaning/arrangement fields; admin can amend any date; changes retain actor and timestamp in audit history.

- **[US-08] [P1]** As a staff member, I want a current Monday–Sunday dashboard with daily revenue so that I can review this week's entries without accessing older periods or private costs.
  Accepted when: staff can read only the current week; dates before today are read-only; the dashboard shows per-day revenue without a weekly or monthly total; no profit, other-month or older-week dashboard, COGS, rent, wages, water bill, electricity calculations, or monthly electricity cost is exposed in UI or API.

- **[US-09] [P2]** As an admin, I want to see staff uploads and changes as they arrive so that I can review shift completion during the day.
  Accepted when: staff saves and photos become visible to the admin within 5 seconds at p95 under normal connection conditions.

- **[P3]** _(out of scope — noted for future)_ Multiple stores, employee scheduling, payroll computation, and employee-facing monthly profit reports.

---

## Functional Requirements

1. FR-01: Keep the store owner as the single admin anchor. Add a trusted membership model for staff users; retain `owner_id` as the Betea store identity instead of treating every staff `auth.uid()` as a store owner.
2. FR-02: Add distinct admin and staff authorization helpers and route areas. Existing admin pages and actions must remain admin-only; role checks must run on the server for each mutation.
3. FR-03: Provide a staff-safe current-week read path that returns only approved per-day sales information. Do not grant staff broad `SELECT` on the existing `daily_records` row because it also contains reconciliation, operating confirmations, and meter-reset notes.
4. FR-04: Store per-shift submissions independently or expose a database RPC with a strict field allowlist. A staff save must not overwrite another shift or any admin-owned field.
5. FR-05: Allow staff to enter four shift revenue values, Grab/Shopee revenue at day close, Grab/Shopee order counts either incrementally (`+N`) or as a final count, and the total bill count manually at day end for reconciliation. The total bill count includes counter, Grab, and Shopee orders, while platform counters remain separate breakdowns; do not calculate the bill count by adding platform counters or infer it from revenue. Also allow staff to enter the two daily meter readings, dated incidental expenses with reasons, and multiple Bluebook/cleaning/arrangement evidence photos.
6. FR-06: Make the write window authoritative in the database/server using `Asia/Ho_Chi_Minh`: staff may create/update/delete today's staff-entered data only before the day cutoff. Staff deletes must be soft deletes retained in audit history; deleting one shift must preserve the other three, and admin can restore a deleted shift or incidental expense from history. Past days and requests after the cutoff are denied even when sent directly to Supabase or a Server Action. Admin may override the date lock.
7. FR-07: Keep Bluebook reconciliation and cleaning/arrangement confirmations on the admin surface only. Staff routes must not render these controls or expose the underlying values through staff-safe queries.
8. FR-08: Keep cost tables and monthly target/profit calculations inaccessible to staff at both UI and RLS/API levels, including COGS, rent, wages, water bills, and electricity calculations/bills/cost estimates. Staff may submit raw morning/evening meter readings; electricity usage, overnight variance, and cost calculations are admin-only.
9. FR-09: Keep evidence Storage private. Staff may upload multiple Bluebook, cleaning, and arrangement evidence images for the current business date before cutoff; signed URLs must be store-member checked and short-lived. Only admin may confirm cleaning/arrangement. Never expose a Supabase service-role key to the browser.
10. FR-10: Record account identity, date, shift, action, and timestamp for create/update/soft-delete. Extend audit actor types and labels instead of presenting staff edits as owner edits. For a shared login, do not imply that the audit trail identifies which employee acted.
11. FR-11: Staff may view daily revenue for each date in the current Monday–Sunday week with no aggregate total; dates before today are read-only. Do not expose month navigation, weekly or monthly aggregates, profit, or older weeks.
12. FR-12: Staff account creation, profile/role changes, password setup/reset, and deactivation must be server-side and admin-only; no public self-registration. Never display or retrieve a current password; the admin can set/reset it.

---

## Non-Functional Requirements

- **Performance:** Staff weekly view shows the seven-day range (or applicable current-week days since ledger start) in ≤ 3 seconds at p95 under normal Supabase latency.
- **Security:** 100% of staff attempts to read cost tables, older periods, admin-only columns, or write a past date are rejected by server/database policy checks.
- **Security:** Evidence objects are private; signed image access expires within 5 minutes and is checked against store membership and permitted scope.
- **Availability:** Existing admin ledger access and data remain available through migration; staff access is not enabled until membership/RLS policies are applied and verified.

---

## Success Criteria

- [ ] A staff user can save each of the four shift submissions separately; the saved amount for one shift does not alter the other three.
- [ ] Staff can enter or update Grab/Shopee revenue at day close, increment platform orders or enter a final count, and manually enter a total bill count that includes counter, Grab, and Shopee orders while keeping platform counts as separate breakdowns.
- [ ] The staff dashboard shows daily revenue for the current Monday–Sunday week with no weekly/monthly aggregate or profit.
- [ ] Staff manually enter the all-channel total bill count at day end for reconciliation and cannot access profit, monthly costs, electricity calculations, reconciliation, or cleaning/arrangement fields via UI or direct API.
- [ ] Staff can view daily entries only for the current Monday–Sunday week; attempts to open another week or write a past date are rejected.
- [ ] Staff writes after the `Asia/Ho_Chi_Minh` day cutoff are rejected; an admin can still correct the record and the audit history identifies the admin.
- [ ] Admin can view uploaded Bluebook photos within 5 seconds p95; unauthenticated users and non-members cannot retrieve the private image.
- [ ] Automated permission checks cover admin, staff, unauthenticated, current-day, past-day, and post-cutoff requests.

---

## Out of Scope

- Employee access to monthly revenue totals or any profit figure.
- Employee access to COGS, rent, wages, water bill, electricity bill/cost estimates, targets, reconciliation, or cleaning/arrangement confirmation.
- Multiple store locations, shift scheduling, payroll calculations, public account registration, or migrating old owner-only history into the employee dashboard.

---

## Assumptions

- Betea remains a one-store application with one admin owner and a staff role. Staff may share one login; audit history therefore identifies the shared account, not the actual employee.
- “Hết ngày” means the end of the business date at 00:00 Vietnam time; admin may edit at any time.
- The staff dashboard shows each date from Monday through Sunday of the current week and that day's revenue only; it shows no weekly/monthly aggregate or profit.
- When staff access is enabled, staff can see safe figures already entered for the current week; dates before today are read-only.
- Grab/Shopee revenue is recorded at day close. Their order counts can be incremented during the day or entered as the final count. The daily total bill count is entered manually and includes counter, Grab, and Shopee orders; platform counts are separate breakdowns, not inputs to an automatic sum.
- Because the staff credential is shared, every staff member using it has the same fixed staff permissions and can create/update/soft-delete current-day staff entries before the cutoff; only admin can edit past days.
- Staff may enter raw meter readings only. Admin reviews daily usage and overnight differences and owns electricity cost calculations.
- Existing monthly electricity cost formula and private image-storage bucket remain admin-controlled.
- Current photo format/size rules remain JPEG, PNG, or WebP up to 5 MB per image unless the admin changes those settings.

---

## Implementation Notes

- Admin creates and provides the shared staff account credentials; the app uses the existing email/password sign-in flow, does not enable public registration, and never reveals an existing password.
- Supabase Auth Admin operations (create/update/reset password/disable) must run only on a trusted server. The service-role key must never be exposed to the browser. Admins can reset a password but cannot read an existing password.

