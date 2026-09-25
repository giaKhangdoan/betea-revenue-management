# Phase 04 — Ảnh Bluebook và xác nhận vận hành

## Mục tiêu

Lưu nhiều ảnh riêng tư cho ngày hoặc ca để chủ cửa hàng đối chiếu Bluebook và xem bằng chứng vệ sinh/sắp xếp.

## Phạm vi và công việc cụ thể

1. Tạo bucket private và Storage policies owner-only. Chỉ nhận jpeg/png/webp; nén phía trình duyệt và đặt ngưỡng mỗi ảnh ở cấu hình, với 5 MB là mức khởi đầu đề xuất để kiểm chứng độ rõ của chữ trên Bluebook trước khi chốt.
2. Tạo attachments metadata trong Postgres: business date, ca tùy chọn, nhãn Bluebook/vệ sinh/sắp xếp/khác, storage key UUID, người tải và thời điểm tải.
3. Làm giao diện tải nhiều ảnh với preview, tiến độ từng ảnh, retry và thông báo lỗi; resize/nén phía client trước upload. Lưu metadata sau upload thành công; có xử lý dọn object mồ côi nếu metadata thất bại.
4. Xem ảnh qua signed URL ngắn hạn hoặc phiên owner; không public bucket, không lưu URL có quyền lâu dài.
5. Checklist riêng cho vệ sinh và sắp xếp với hai trạng thái đã xác nhận/chưa xác nhận theo spec; trạng thái ban đầu là chưa xác nhận. Hỗ trợ phạm vi ngày hoặc ca theo quyết định Q4; quy tắc ảnh bắt buộc cũng theo Q4.

## Tệp và module dự kiến

src/features/attachments, src/features/evidence-checks, src/app/(private)/days/[date]/attachments, src/lib/storage/private-uploads.ts, supabase/migrations/*_attachments.sql, cấu hình bucket/policies trong migrations hoặc deployment setup có kiểm soát.

## Phụ thuộc

Phase 01 cho owner auth; phase 02 cho ngày và ca. Q4 phải chốt checklist theo ngày hay ca và có bắt buộc ảnh khi đánh dấu done hay không trước khi khóa UX/acceptance.

## Nghiệm thu / xác minh

- Owner tải nhiều ảnh, gắn nhãn ngày/ca và xem lại được; anon/tài khoản khác không đọc object hoặc metadata.
- Signed URL hết hạn theo cấu hình; file ngoài loại/dung lượng từ chối; retry không tạo duplicate metadata.
- Có thể đánh dấu xác nhận hoặc để chưa xác nhận cho checklist; chưa xác nhận luôn được xem là chưa hoàn tất. Quy tắc bắt buộc ảnh tuân theo Q4.
- Ảnh xem được trên điện thoại; UI luôn có nhãn chữ, không phụ thuộc icon.

## Rủi ro / quyết định

Upload object và insert metadata không phải một transaction; cần làm rõ đường phục hồi upload dở và dọn orphan. Chủ cửa hàng cần kiểm tra ảnh đã nén vẫn đủ rõ để đọc Bluebook trước khi chốt ngưỡng upload; không có luồng tải ảnh của nhân viên trong MVP.

## Truy vết user story

US-05; phần ảnh minh chứng của checklist vận hành.
