# Phase 05 — Audit, hardening và phát hành

## Mục tiêu

Chứng minh quyền phân tách bằng request trực tiếp, triển khai migration/code theo thứ tự không gây lệch ledger và vận hành staff feature trên production.

## Phạm vi và công việc cụ thể

1. Hoàn thiện audit actor `owner`/`staff`/`system`, nhãn staff shared-account, soft-delete, trước/sau, record/date, shift/category và timestamp; không giả nhận dạng cá nhân.
2. Viết/chuẩn bị kiểm tra tự động cho anon, owner, active staff, inactive staff: quyền table/API, Server Actions direct POST, date windows, all-channel bill count, atomic increments, Storage signed URLs.
3. Chạy lint, typecheck, unit/integration tests, production build và `supabase db advisors` sau migration/policy changes; sửa critical/high trước deploy.
4. Migration rehearsal trên local/preview: backup DB, áp migration tương thích/backfill, deploy owner adapter, đối chiếu report trước/sau, rồi áp migration bỏ cột admin cũ và bật RLS staff; xác nhận ảnh existing vẫn mở được.
5. Chốt rollback point: trước khi cấp membership staff có thể quay lại release owner-only tương thích với additive migration; sau khi staff bắt đầu ghi, chỉ rollback app về compatibility release hiểu sidecar và staff writes, không restore snapshot cũ làm mất dữ liệu phát sinh sau snapshot. Nếu cần sửa dữ liệu, tạm khóa membership, backup dữ liệu mới rồi phục hồi/replay có kiểm soát.
6. Deploy app/migration theo rollout nhiều nhịp; trong giai đoạn có cả cột cũ và bảng admin sidecar, mọi route vẫn owner-only. Chỉ cấp staff membership và bật account UI sau migration cuối, owner regression và staff negative-access checks.
7. Smoke trên Vercel bằng owner và staff test account: login/redirect, entry ca, Grab/Shopee `+N`/final count, bill count, meter readings, expense, ảnh, khóa ngày, admin override, audit. Không đưa dữ liệu giả vào sổ production; xóa test artifacts đúng quy trình.
8. Cập nhật `plans/betea-revenue-management/plan.md`, owner-access/runbook và `feature_list.json`; xác nhận hướng xử lý sao lưu Storage objects và rotate/disable shared credential.

## Tệp và module dự kiến

`supabase/migrations/*`, tests trong `src/**` và `supabase/tests/**` theo conventions repo, `plans/betea-revenue-management/plan.md`, `docs/owner-access.md`, `docs/runbooks/supabase-backup-restore.md`, `feature_list.json`.

## Phụ thuộc

Phases 01–04 hoàn tất trên local/preview. Production rollout cần có server-only Auth Admin secret và lịch chuyển đổi ngắn để không có ghi đồng thời từ code cũ/mới.

## Nghiệm thu / xác minh

- Các route/API trực tiếp của staff không truy cập past week, cost/target, admin details, audit, reconciliation hoặc checklist confirmation.
- Staff inactive bị chặn DB/Storage dù access token trước đó còn hiệu lực; owner kiểm soát mọi ngày.
- Owner ledger/report/cost tổng doanh thu/lợi nhuận khớp trước và sau migration cho tất cả ngày đã lưu.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` và Supabase advisors đạt; ma trận role/date và private-image smoke đạt.
- Feature chỉ bật sau deploy khi tất cả migration, role, server guard và Storage checks đều xanh.

## Rủi ro / quyết định

- Không chạy migration phá hủy khi chưa có snapshot/restore point và đối chiếu; production data là tài chính thật.
- Supabase Auth Admin secret cấu hình server-only tại Vercel/local; không commit secret.
- Rollback trước khi có staff writes: quay lại owner-only compatibility release, giữ migration additive. Sau khi có staff writes: tắt quyền ghi/membership nếu cần, giữ schema và staff rows, rollback code chỉ tới compatibility release đã đọc schema mới; không restore DB snapshot cũ đè dữ liệu mới. Thực hiện data repair qua backup/replay được đối chiếu.

## Truy vết user story

US-01–US-08 — P1; US-09 — P2.
