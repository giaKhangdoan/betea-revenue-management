# Sổ doanh thu Betea

Ứng dụng Next.js riêng tư để chủ cửa hàng ghi doanh thu theo bốn ca, Grab/Shopee theo ngày, chi phí, công tơ và ảnh đối chiếu.

## Chạy ứng dụng

1. Cài Node.js 24 trở lên.
2. Sao chép `.env.example` thành `.env.local` và điền Supabase URL, publishable key cùng URL gốc của ứng dụng (`APP_BASE_URL`) để luồng email xác thực/đặt lại mật khẩu quay về đúng website.
3. Áp dụng migration trong `supabase/migrations/` vào project Supabase.
4. Tạo tài khoản owner theo [hướng dẫn cấp quyền](docs/owner-access.md).
5. Chạy `npm install`, `npm run dev`, rồi mở `http://localhost:3000`.

Không commit `.env.local` hoặc workbook gốc. Không đưa service-role key vào website.

## Bản đang triển khai

Website production: <https://betea-revenue-management.vercel.app>. Tài khoản owner đã được cấp quyền. Nếu chưa đặt mật khẩu hoặc quên mật khẩu, mở trang đăng nhập và chọn **Quên hoặc chưa đặt mật khẩu?** để tự nhận email đặt lại; không gửi mật khẩu qua chat.

Sổ hiện có các ngày đã ghi trong workbook từ 03/09 đến 25/09/2026. Ngày không có dòng trong workbook vẫn để trống để chủ cửa hàng bổ sung; chưa nạp COGS, mục tiêu hay chi phí tháng nên lợi nhuận chỉ đầy đủ sau khi nhập các dữ liệu đó.

## Công thức đang triển khai

- Doanh thu ngày = bốn ca + tổng Grab + tổng Shopee; nguồn được lưu riêng để dễ đối chiếu.
- Tuần tính từ Thứ 2 đến Chủ nhật. Dữ liệu thiếu giữ trạng thái chưa đủ, không tự coi là 0.
- COGS lấy tổng tháng từ POS và chỉ trừ trong lợi nhuận tháng/năm; tuần/khoảng ngày ghi rõ lợi nhuận trước COGS.
- Thuê, lương, nước và điện phân bổ theo đúng số ngày lịch của tháng. Chi phí điện dùng bill nếu đã nhập; nếu chưa thì dùng ước tính từ công tơ.
- Chi phí phát sinh ghi ngày, số tiền và lý do; ảnh lưu ở bucket private theo ngày/ca.

Chi tiết yêu cầu và các điểm quyết định còn chờ nằm trong `plans/betea-revenue-management/`.

## Cost công thức và SOP

Quản lý cấu hình nguyên liệu, cốt/bán thành phẩm, công thức theo size S/M/L và giá bán trong `/product-costs`. Lịch sử cost chỉ xem tại `/product-costs/history`; phần này độc lập với COGS tháng lấy từ POS. Nhập workbook có bước đối soát; dữ liệu chưa rõ mapping chưa được xem là đã nhập hoàn tất.

Quản lý sửa và xem trước hướng dẫn pha tại `/sop`, rồi chủ động xuất bản bản SOP an toàn cho nhân viên xem tại `/staff/sop`. Nhân viên chỉ nhận nội dung và định lượng pha, không nhận giá mua, cost, giá bán hoặc lợi nhuận. Đồng bộ với Canva chưa được bật; xem [hướng dẫn cost và SOP](docs/recipe-costs-and-sop.md) trước khi thay đổi dữ liệu hoặc quyền truy cập.
