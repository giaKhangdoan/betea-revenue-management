# Phase 06 — Kiểm chứng quyền và rollout

**ID:** `phase-06-security-validation-rollout`<br>
**Stories:** US-01–US-08 (P1/P2, cross-cutting)

## Mục tiêu

Đối chiếu công thức với workbook, chứng minh không lộ cost cho staff, kiểm tra Canva draft flow và phát hành theo môi trường có thể khôi phục.

## Công việc

1. Chạy migration rehearsal bằng local Supabase/Docker trước; kiểm tra dữ liệu hiện hữu và không thay đổi `monthly_costs.cogs_vnd`.
2. Chạy RLS/grants matrix cho anon, owner và staff trên ingredient, recipe, cost history, SOP safe revisions và Canva metadata.
3. Kiểm tra role boundary trực tiếp qua Supabase Data API, page/route handler và Server Actions; không chỉ kiểm tra giao diện.
4. So cost ít nhất 5 công thức đại diện cho cả 3 size với workbook; rà tất cả sai lệch, unit mapping và rounding trước import final.
5. Kiểm tra import reconciliation totals, idempotency/duplicate detection và phục hồi snapshot/audit.
6. Kiểm tra perf target: workbook hiện tại được tính lại trong ≤2s sau khi lưu giá; kiểm tra UI loading/error behavior.
7. Kiểm tra Canva copy draft, stale job, API failure/retry, preview link và manual publish; xác nhận employee URL giữ nguyên trước rollout.
8. Triển khai preview, nhận owner review, chạy `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; chỉ sau khi đạt mới đề xuất production rollout.
9. Ghi lại migrations, env setup, import evidence, owner publish step và rollback plan; không tạo paid Supabase branch nếu chưa được đồng ý.

## Files/modules

- `supabase/tests/recipe_costing_boundary.sql`, `supabase/tests/sop_staff_boundary.sql`.
- Các test của `src/lib/recipe-cost/` và import script.
- `feature_list.json` tại git root: entry theo từng phase.
- `plans/recipe-cost-sop-canva/` evidence/runbook cập nhật theo kết quả thực tế.

## Dependencies

- Phase 01–05 hoàn tất; Canva gate đã pass nếu bật integration.
- Preview environment, local Docker/Supabase và workbook source sẵn sàng.

## Acceptance / verification

- Không có staff/anon path nào đọc được purchase price, cost, gross profit, margin hoặc historical snapshots.
- Cost import/sample checks khớp workbook theo quy tắc làm tròn; unresolved rows được liệt kê và owner biết.
- Existing finance dashboard/COGS POS tests pass; schema change không làm lệch ledger.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` đều pass trước production.
- Canva draft đã được owner xem và owner tự publish; không publish hoặc đổi employee URL tự động.
- Có bằng chứng backup/migration/rollback được rà trước production.

## Risks / notes

- Không chạy production import hoặc migration destructive trong phase này nếu preview chưa đối chiếu đủ.
- Nếu bất kỳ security boundary hoặc URL-preservation check nào fail, giữ tính năng ở preview và xử lý trước khi phát hành.
