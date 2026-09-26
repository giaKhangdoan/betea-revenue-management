# Sao lưu và khôi phục Betea

Trạng thái: đã tạo bản sao ứng dụng trước migration ngày 26/09/2026 và xác minh giải mã/các số dòng trên chính tài khoản Windows này. Migration `daily_reconciliation_and_meter_reset` đã được áp dụng vào production ngày 26/09/2026. Kiểm tra sau migration xác nhận 23 dòng doanh thu còn nguyên, cả 23 dòng nhận trạng thái mặc định chưa đối chiếu, bảng điều chỉnh bật RLS và `anon` không có quyền đọc. Chưa khôi phục thử, chưa có bản sao độc lập khỏi máy này; chưa đủ điều kiện coi đây là bản sao lưu có thể khôi phục hoàn chỉnh.

## Snapshot ứng dụng trước migration

Snapshot nằm trong thư mục bị Git bỏ qua `private-backups/`, được mã hóa bằng Windows DPAPI `CurrentUser`, ACL chỉ cấp quyền cho tài khoản Windows hiện tại và `SYSTEM`. Manifest kèm theo có checksum SHA-256 và số dòng. Giải mã thử xác nhận dữ liệu hợp lệ:

- `daily_records`: 23; `audit_events`: 23; `owner_profiles`: 1.
- `monthly_costs`, `daily_expenses`, `weekly_targets`, `monthly_targets`, `day_photos`: 0.
- Bucket riêng `betea-evidence`: 0 object.

Đây là snapshot dữ liệu ứng dụng trong các bảng `public`, không chứa `auth.users`, cấu hình Supabase, schema của dịch vụ hoặc nội dung Storage. Migrations trong Git là nguồn khôi phục schema; owner cần được cấp lại trên project khôi phục. DPAPI chỉ giải mã được bằng tài khoản Windows hiện tại trên máy này. Vì vậy snapshot này là lớp bảo vệ trước migration, chưa thay thế bản dump độc lập và chưa phải bằng chứng restore.

## Phạm vi cần sao lưu

- PostgreSQL: schema, dữ liệu và các migration đã áp dụng.
- Storage: toàn bộ tệp trong bucket riêng `betea-evidence`. Bản sao database không chứa nội dung ảnh.
- Lưu bản sao mã hóa ở nơi riêng tư, không commit vào Git và không đưa mật khẩu database, access token hay signed URL vào tài liệu này.

## Sao lưu

1. Cài Docker và Node.js, rồi đăng nhập Supabase CLI bằng tài khoản có quyền quản lý project.
2. Trong thư mục dự án, liên kết CLI tới project `zjevysaovkxdvwvarebv`. Nhập database password tại dấu nhắc CLI; không ghi password vào lệnh hoặc Git.
3. Tạo một thư mục sao lưu riêng, đặt tên theo ngày giờ và chỉ cho tài khoản chủ cửa hàng truy cập.
4. Chạy lệnh xuất database:

   ```powershell
   npx supabase db dump --linked --file .\private-backups\betea-database.sql
   ```

5. Sao chép toàn bộ ảnh trong bucket riêng xuống thư mục sao lưu:

   ```powershell
   npx supabase storage cp -r ss:///betea-evidence .\private-backups\betea-evidence --linked
   ```

6. Kiểm tra file SQL không rỗng, đếm số ảnh đã sao chép, mở thử một ảnh và lưu bản sao ở vị trí độc lập với máy đang chạy website. Ghi ngày sao lưu, người thực hiện và số dòng/ảnh đã kiểm tra vào nhật ký riêng.

## Khôi phục thử

Thực hiện trên một project khôi phục riêng, không ghi đè project production. Tạo project mới có thể phát sinh chi phí theo gói Supabase đang chọn; kiểm tra giá trước khi tạo.

1. Liên kết CLI tới project khôi phục và xác nhận lại project ref trước khi chạy bất kỳ lệnh ghi nào.
2. Khôi phục SQL bằng `psql` tới database của project khôi phục. Thay `<host-cua-project-khoi-phuc>` bằng database host trong trang Settings, rồi nhập password khi được hỏi:

   ```powershell
   psql -h "<host-cua-project-khoi-phuc>" -p 5432 -U postgres -d postgres -W -v ON_ERROR_STOP=1 -f .\private-backups\betea-database.sql
   ```

3. Tạo bucket `betea-evidence` ở chế độ private, giới hạn MIME JPEG/PNG/WebP và 5 MiB mỗi ảnh; áp dụng policies từ migration của dự án.
4. Tải lại thư mục ảnh bằng lệnh:

   ```powershell
   npx supabase storage cp -r .\private-backups\betea-evidence ss:///betea-evidence --linked
   ```

5. Xác minh số bản ghi và ảnh, thử đăng nhập owner, mở signed URL mới, đối chiếu một ngày có Bluebook và tính lại một tháng có COGS/chi phí. Chỉ đánh dấu khôi phục đạt sau khi kiểm tra thành công.

## Điều kiện cho các lần phát hành schema tiếp theo

- Tạo được bản sao database và toàn bộ ảnh.
- Khôi phục thành công trên project tách biệt và đối chiếu số bản ghi/ảnh.
- Xác nhận RLS, private bucket và signed URL sau khi khôi phục.
- Chỉ áp dụng migration mới vào production sau khi các bước trên hoàn tất.

Ghi chú lần migration hiện tại: Supabase Free không hỗ trợ database branch. Theo yêu cầu hoàn thiện và kiểm tra website bằng tài khoản chủ cửa hàng, migration bổ sung (chỉ thêm cột, constraint, bảng, RLS, trigger và index; không xóa bảng hoặc dòng hiện hữu) đã được áp dụng sau khi tạo snapshot ứng dụng. Đây chưa phải quy trình thay thế cho bản dump database/Storage và khôi phục thử; hoàn tất các bước đó trước những migration production kế tiếp.

CLI/database password chưa được cấu hình. Supabase Free không hỗ trợ database branch; việc khôi phục thử cần một project tạm hoặc project khôi phục riêng và được xác nhận chi phí trước khi tạo.
