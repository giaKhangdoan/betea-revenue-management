# Phase 01 — Ranh giới dữ liệu và membership

## Mục tiêu

Tạo ranh giới DB để staff chỉ thấy trường vận hành được phép và owner vẫn giữ toàn bộ quyền admin. Giữ một nguồn chuẩn, bảo toàn các số đã nhập.

## Phạm vi và công việc cụ thể

1. Thêm `store_memberships` liên kết `auth.users.id` với `owner_profiles.user_id`, role cố định `staff`, trạng thái active/inactive và metadata tối thiểu do admin quản lý.
2. Thêm helper membership/admin trong `private` schema; dùng `auth.uid()` và membership DB, không dùng `user_metadata`. Hạn chế quyền execute, đặt `search_path = ''` nếu function chạy với quyền definer.
3. Tách đối soát Bluebook, cờ vệ sinh/sắp xếp, business status, ghi chú/reset công tơ ra bảng một-một admin-only. Giữ doanh thu ca/kênh và chỉ số công tơ thô ở nguồn ngày staff-safe.
4. Thêm trường Grab/Shopee order count, bill count nhập tay all-channel và dấu vết xóa mềm cần thiết. Xóa mềm một ca chỉ đánh dấu/ẩn giá trị ca đó; lưu giá trị cũ cùng shift/date/actor trong audit để admin khôi phục, không xóa các ca khác trong ngày. Chi phí phát sinh xóa mềm theo từng dòng. Bill count gồm quầy + Grab + Shopee, nhưng không suy ra bằng cách cộng platform counts.
5. Dùng migration tương thích để backfill admin fields sang side table; đối chiếu số dòng và các trường trước/sau. Deploy owner queries/actions để dùng bảng side table trong khi route vẫn owner-only.
6. Sau khi owner ledger/report/cost/confirmation đã đọc đúng side table, tạo migration hoàn tất tách schema: bỏ các bản cột nhạy cảm cũ khỏi `daily_records`, thêm total bill/order fields và soft-delete metadata, rồi mới bật staff RLS read cùng quyền ghi hẹp/RPC allowlist trên daily-safe data. Không cấp staff read trong giai đoạn hai cấu trúc cũ/mới cùng tồn tại.
7. Bật membership/date RLS/grants theo bảng: staff chỉ đọc daily-safe rows của current week; chỉ ghi ngày hiện tại trước 00:00 VN. Không cấp table-wide `INSERT`/`UPDATE`; dùng grants theo cột hoặc RPC allowlist có kiểm tra membership/date để chỉ ghi trường staff được phép, áp dụng cho cả `daily_records` lẫn `daily_expenses`. Cho staff create/update/soft-delete chi phí phát sinh của hôm nay trước cutoff; không cho staff đọc/ghi monthly costs, cost adjustments, targets, audit hay admin-only details. Chặn hard delete của staff.
8. Mở rộng audit actor type/trigger để phân biệt owner, staff shared-account và system; audit soft-delete và lưu actor/timestamp.

## Tệp và module dự kiến

`supabase/migrations/*` (tạo migration bằng Supabase CLI sau khi kiểm tra `--help`), `src/lib/auth/owner-access.ts`, module membership/auth mới dưới `src/lib/auth/`, các owner queries ở `src/app/(private)/ledger/**`, `src/app/(private)/page.tsx`, `reports/page.tsx`, `costs/page.tsx`, `audit/page.tsx`, các file liên quan `day_photos`/`daily_expenses`.

## Phụ thuộc

Không phụ thuộc phase trước. Phải hoàn tất trước mọi route hoặc account staff thật.

## Nghiệm thu / xác minh

- Owner đăng nhập vẫn đọc/sửa ngày cũ, đối soát, xác nhận vận hành, cost và reports như trước.
- Staff test account chỉ đọc safe columns trong current Mon–Sun; truy vấn khác tuần hoặc bảng admin-only trả rỗng/lỗi quyền.
- Staff tạo/sửa/xóa mềm được incidental expense của hôm nay; không xem được monthly costs, COGS, lương, rent, water/electricity bill hoặc cost adjustments.
- Tài khoản chưa active và anon không đọc/ghi dữ liệu; đổi membership sang inactive làm request tiếp theo bị chặn dù session còn.
- Migration đối chiếu từng hàng nguồn và tổng doanh thu trước/sau; không mất hoặc cộng trùng dữ liệu.
- Không có grant broad cho staff vào monthly costs/targets/audit/admin details; staff không thể hard-delete daily rows.

## Rủi ro / quyết định

- RLS lọc hàng, không lọc cột; tách admin fields và bỏ mọi bản cột nhạy cảm khỏi bảng staff-readable trước khi bật membership read. RLS cũng không giới hạn cột được sửa; staff mutation cần grants hẹp/RPC allowlist và direct Data API negative checks.
- Tránh hai nguồn chuẩn hoặc dual-write. Nếu tách trường làm ảnh hưởng owner query quá rộng, dừng rollout và dùng fallback RPC đã allowlist thay vì mở bảng trộn trường.
- Cần chạy thử migration hai nhịp trên backup/local/preview trước production; không xóa cột cũ trong bước backfill đầu và không bật staff access trước migration hoàn tất.

## Truy vết user story

US-01, US-07, US-08 — P1.
