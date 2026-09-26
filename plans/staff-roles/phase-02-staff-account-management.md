# Phase 02 — Quản lý tài khoản staff

## Mục tiêu

Cho owner/admin quản lý một tài khoản staff dùng chung, giữ đăng ký công khai tắt và điều hướng người đăng nhập theo role.

## Phạm vi và công việc cụ thể

1. Tạo `requireAdmin` và `requireStaff`/role-aware access dựa trên user session + `store_memberships.active`; giữ `requireOwnerClient()` cho các màn admin hiện tại.
2. Thêm route/layout riêng cho staff; callback/login chuyển staff vào staff dashboard, owner vào dashboard admin; không dựa vào Proxy/layout làm ranh giới authorization.
3. Tạo màn admin quản lý tài khoản staff: tạo/cập nhật tên hiển thị, đặt/cấp thông tin email và mật khẩu ban đầu, đặt lại mật khẩu, kích hoạt/khóa; role staff cố định, không có permission editor tùy ý.
4. Gọi Supabase Auth Admin create/update/ban từ module server-only sau khi `requireAdmin`; cấu hình secret phía server riêng, tuyệt đối không đưa service-role key vào client bundle hoặc response.
5. Trên create, tạo Auth user và membership trong thứ tự an toàn; xử lý rollback/cleanup nếu tạo Auth user thành công nhưng membership thất bại. Disable membership trước để chặn DB ngay, sau đó xoay credential và chặn đăng nhập. Khi mở lại phải đặt mật khẩu mới.
6. Kiểm tra `session_id` và thời điểm phát hành JWT với Auth sessions/mốc thu hồi trong mọi policy staff; token cũ không được sống lại khi membership được kích hoạt lại.
7. Ghi audit lần lượt yêu cầu và kết quả reset; nếu Auth đã đổi mật khẩu mà ghi kết quả lỗi, giao diện phải báo cảnh báo thay vì trạng thái thành công.
8. Giao diện ghi rõ đây là credential dùng chung để admin hiểu log không xác định nhân viên cá nhân.

## Tệp và module dự kiến

`src/lib/auth/owner-access.ts`, `src/lib/auth/require-owner.ts`, module `src/lib/auth/require-admin.ts` và `require-staff.ts`, `src/app/login/actions.ts`, `src/app/auth/callback/route.ts`, route group `src/app/(staff)/`, route quản lý nhân viên trong `src/app/(private)/`, module server-only Supabase Admin client, `.env.example`, `supabase/migrations/*`.

## Phụ thuộc

Phase 01 hoàn tất và local/preview policies đã xác nhận. Trước Vercel smoke, owner cấu hình Auth Admin secret server-side.

## Nghiệm thu / xác minh

- Owner tạo, cập nhật, reset và khóa tài khoản staff được; staff không gọi được endpoint/action quản lý tài khoản.
- Public signup vẫn tắt; không có form đăng ký staff công khai.
- Staff đăng nhập đi thẳng vùng staff; anon chuyển login; staff không vào route admin; owner không bị chặn khỏi admin.
- Membership inactive chặn staff ngay cả khi access token còn hợp lệ.
- Mở lại tài khoản buộc đặt mật khẩu mới; JWT và Auth session cũ không được cấp lại quyền.
- Audit có yêu cầu reset trước thao tác Auth và kết quả thành công/thất bại; lỗi ghi kết quả không hiển thị màu thành công.
- Quét source/client bundle không tìm thấy service-role secret; response không trả password hoặc secret.

## Rủi ro / quyết định

- Admin tạo và cấp thông tin đăng nhập cho nhân viên; có thể đặt lại password nhưng không thể xem password đang dùng.
- Shared login tiện cho ca làm nhưng audit chỉ gắn tới tài khoản chung.
- Dùng email/password theo luồng đăng nhập hiện tại; không xây username riêng. Email tài khoản staff do admin quản lý.

## Truy vết user story

US-01 — P1.
