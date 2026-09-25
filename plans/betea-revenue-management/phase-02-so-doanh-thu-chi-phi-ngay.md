# Phase 02 — Sổ doanh thu và chi phí theo ngày

## Mục tiêu

Cho phép chủ cửa hàng nhập doanh thu theo ngày/ca và các khoản phát sinh; giữ rõ ngày thiếu, ngày không kinh doanh và ngày đã chốt.

## Phạm vi và công việc cụ thể

1. Tạo migration cho daily_records, shift_sales, daily_delivery_sales và daily_incidental_expenses cùng foreign keys, unique constraints, check constraints, grants và RLS owner.
2. Nhập tổng cuối cùng cho 4 ca 06–10, 10–14, 14–18, 18–22; nhập Grab/Shopee tổng ngày; tính tổng ngày từ các dòng nguồn. Không tạo trường giảm giá, tiền mặt, số bill/đơn hay sản phẩm.
3. Tạo trạng thái ngày đang nhập/đã chốt/không kinh doanh. Thiếu một ca khác với ca có doanh thu 0; ngày không kinh doanh phải được đánh dấu rõ.
4. Tạo form chi phí phát sinh theo ngày, số tiền dương và lý do bắt buộc; cho phép xem/tổng hợp theo tuần và tháng.
5. Thêm trạng thái đối soát doanh thu riêng: chưa kiểm tra, chờ kiểm tra, khớp, lệch; ghi chú số lệch. Không gộp với trạng thái ngày.
6. Mutation dùng upsert/unique key để chống tạo dòng ca/kênh trùng khi lưu lại; lưu audit event cho bản ghi tài chính đã chốt.

## Tệp và module dự kiến

src/features/daily-ledger, src/features/incidental-expenses, src/app/(private)/days/[date]/page.tsx, src/lib/domain/money.ts, src/lib/domain/business-date.ts, src/lib/dal/daily-ledger.ts, supabase/migrations/*_daily_ledger.sql.

## Phụ thuộc

Phase 01. Câu hỏi validation Q1 bắt buộc chốt phép tính: bốn ca phải loại Grab/Shopee hoàn toàn nếu website cộng hai tổng kênh ngày. Q2 chỉ quyết định có nạp dữ liệu seed hay không; không chặn xây form.

## Nghiệm thu / xác minh

- Tổng ngày khớp chính xác tổng 4 ca + Grab + Shopee; không đếm trùng.
- Ngày được đánh dấu không kinh doanh đóng góp doanh thu 0 và được xem là đầy đủ mà không cần bốn dòng ca; ngày mở nhưng thiếu ca, hoặc ngày trong kỳ chưa được ghi nhận, khiến kỳ hiển thị incomplete. Doanh thu 0 của ca đã nhập vẫn khác dữ liệu thiếu.
- Chi phí phát sinh thiếu lý do/ngày/số tiền bị từ chối; tổng hợp đúng ngày phát sinh.
- Bản ghi unique; truy cập dữ liệu trực tiếp với anon/tài khoản không phải owner bị RLS chặn.
- Form không yêu cầu trường Excel đã bỏ; nhãn và đơn vị VND dễ đọc, dùng được ở màn hình nhỏ.

## Rủi ro / quyết định

Workbook nguồn có công thức P&L tổng tuần sai; chỉ dùng dòng doanh thu chi tiết đã xác nhận. Trước nạp Excel, đối chiếu các dòng và không coi ô trống tương lai là 0. Q1 phải trả lời trước khi khóa tổng ngày hoặc đối chiếu dữ liệu nhập lại.

## Truy vết user story

US-03, US-04, US-08.
