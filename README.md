# Sổ doanh thu Betea

Ứng dụng Next.js riêng tư để chủ cửa hàng ghi doanh thu theo bốn ca, Grab/Shopee theo ngày, chi phí, công tơ và ảnh đối chiếu.

## Chạy ứng dụng

1. Cài Node.js 24 trở lên.
2. Sao chép `.env.example` thành `.env.local` và điền Supabase URL cùng publishable key.
3. Áp dụng migration trong `supabase/migrations/` vào project Supabase.
4. Tạo tài khoản owner theo [hướng dẫn cấp quyền](docs/owner-access.md).
5. Chạy `npm install`, `npm run dev`, rồi mở `http://localhost:3000`.

Không commit `.env.local` hoặc workbook gốc. Không đưa service-role key vào website.

## Công thức đang triển khai

- Doanh thu ngày = bốn ca + tổng Grab + tổng Shopee; nguồn được lưu riêng để dễ đối chiếu.
- Tuần tính từ Thứ 2 đến Chủ nhật. Dữ liệu thiếu giữ trạng thái chưa đủ, không tự coi là 0.
- COGS lấy tổng tháng từ POS và chỉ trừ trong lợi nhuận tháng/năm; tuần/khoảng ngày ghi rõ lợi nhuận trước COGS.
- Thuê, lương, nước và điện phân bổ theo đúng số ngày lịch của tháng. Chi phí điện dùng bill nếu đã nhập; nếu chưa thì dùng ước tính từ công tơ.
- Chi phí phát sinh ghi ngày, số tiền và lý do; ảnh lưu ở bucket private theo ngày/ca.

Chi tiết yêu cầu và các điểm quyết định còn chờ nằm trong `plans/betea-revenue-management/`.
