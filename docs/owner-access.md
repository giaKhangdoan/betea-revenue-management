# Cấp tài khoản chủ cửa hàng

Ứng dụng không có đăng ký công khai và không có nút tự nhận quyền owner. Bản MVP chỉ cấp đúng một tài khoản chủ cửa hàng bằng thao tác quản trị Supabase.

## Trạng thái project Betea hiện tại

Project production đã được cấu hình với đúng một owner trong `owner_profiles`; email owner đã xác nhận. Chủ cửa hàng tự đặt hoặc đổi mật khẩu từ trang đăng nhập bằng liên kết **Quên hoặc chưa đặt mật khẩu?**. Ứng dụng yêu cầu mật khẩu tối thiểu 12 ký tự. Không chia sẻ mật khẩu qua chat.

## Cấp lại quyền trong môi trường mới

1. Trong Supabase Auth, chỉ mời email của chủ cửa hàng. Chủ cửa hàng tự mở email mời, xác nhận email và tự đặt mật khẩu riêng. Không gửi mật khẩu qua chat và không dùng tài khoản nhân viên chung.
2. Tắt đăng ký công khai trong cài đặt Auth. Người khác vẫn có thể tạo phiên đăng nhập hợp lệ ở nơi khác, nhưng không có dòng trong `owner_profiles` nên không đọc được bảng hoặc bucket.
3. Trong SQL Editor, xác nhận email tìm được đúng một người dùng đã xác nhận:

   ```sql
   select id, email, email_confirmed_at
   from auth.users
   where lower(email) = lower('THAY_BANG_EMAIL_OWNER');
   ```

4. Nếu kết quả chỉ có một dòng và `email_confirmed_at` không rỗng, cấp quyền cho đúng người đó:

   ```sql
   insert into public.owner_profiles (user_id)
   select id
   from auth.users
   where lower(email) = lower('THAY_BANG_EMAIL_OWNER')
     and email_confirmed_at is not null;
   ```

   Bảng chỉ cho phép một owner. Nếu đã có một dòng, lệnh chèn sẽ báo xung đột và không đổi quyền sang người khác.
5. URL chuyển hướng sau khi bấm lời mời hoặc yêu cầu đặt lại mật khẩu phải được thêm trong Supabase Auth URL Configuration (localhost khi phát triển và URL website khi triển khai); route `/auth/callback` đổi mã PKCE thành phiên đăng nhập. Sau khi người dùng xác nhận email, kiểm tra Auth user rồi mới chạy lệnh cấp owner ở bước 4.
6. Đăng nhập ở `/login`, thử mở `/` và `/ledger`, sau đó đăng xuất và kiểm tra trang riêng tư chuyển về đăng nhập. Luồng quên/chưa đặt mật khẩu nằm ngay trên trang `/login`.

Không đặt service-role key vào `.env.example`, GitHub, trình duyệt hoặc Vercel client variables. Ứng dụng dùng publishable key; quyền thực tế được kiểm tra qua `auth.uid()`, hồ sơ owner, RLS và Storage policies.

Project production đang tắt public sign-up và anonymous sign-in, bật xác nhận email, bật secure password change và yêu cầu mật khẩu dài ít nhất 12 ký tự. Kiểm tra mật khẩu bị rò rỉ qua Have I Been Pwned cần gói Supabase Pro trở lên và hiện chưa bật trên gói Free.

## Đổi chủ tài khoản

Chỉ thực hiện bằng tài khoản quản trị Supabase sau khi xác nhận email mới. Bảng `owner_profiles` có một slot duy nhất; đổi `user_id` trong giao dịch có kiểm soát và lưu lại mã audit quản trị. Không bật sign-up để làm bước chuyển quyền.
