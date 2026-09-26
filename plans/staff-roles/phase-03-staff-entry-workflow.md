# Phase 03 — Nhập liệu cuối ca và khóa ngày

## Mục tiêu

Nhân viên nhập nhanh số liệu của ngày hiện tại; DB/server chặn sửa quá hạn, ngày cũ và field admin-only.

## Phạm vi và công việc cụ thể

1. Tạo form staff ưu tiên mobile: bốn thẻ ca 06–10, 10–14, 14–18, 18–22; mỗi ca nhập một số doanh thu tổng và lưu riêng để không ghi đè ca khác.
2. Tạo phần Grab/Shopee nhập doanh thu cuối ngày; số đơn có nút cộng thêm và ô nhập số chốt cuối ngày. `+N` là thao tác DB atomic; số chốt thay thế count cùng kênh.
3. Nhập tổng bill thủ công cuối ngày cho toàn bộ kênh quầy + Grab + Shopee để đối chiếu. Không derive bill count từ doanh thu hoặc cộng platform counters.
4. Cho nhập chỉ số điện sáng/tối thô, không render usage/overnight delta/đơn giá/bill điện cho staff. Cho thêm, sửa, xóa mềm chi phí phát sinh của hôm nay với lý do bắt buộc.
5. Server Action từng thao tác tự gọi role guard, parse/validate bằng schema, lấy owner/store từ membership; không tin owner ID/date/role do client gửi.
6. Bảo đảm nhân viên tạo/sửa/xóa mềm dữ liệu staff của ngày hiện tại trước cutoff `Asia/Ho_Chi_Minh` 00:00; quá hạn và ngày qua chỉ admin sửa. Xóa một ca chỉ ẩn/đánh dấu ca đó và giữ giá trị cũ trong audit để admin khôi phục; không ảnh hưởng ba ca còn lại. Chi phí phát sinh xóa mềm theo từng dòng. Lọc mục đã xóa khỏi form staff thường.
7. Cập nhật thao tác sửa owner để tiếp tục sửa mọi ngày, kể cả sau giờ khóa; không mở staff quyền đối soát, checklist vệ sinh hoặc cost.

## Tệp và module dự kiến

`src/app/(staff)/entry/**`, `src/components/staff/*`, staff Server Actions, `src/app/(private)/ledger/actions.ts`, `src/components/ledger/daily-entry-form.tsx`, `src/components/ledger/daily-expense-form.tsx`, `src/lib/finance/*`, `supabase/migrations/*` và RLS tests.

## Phụ thuộc

Phase 01 cho schema/policies và Phase 02 cho route/role access. Có thể làm UI tĩnh trong khi Auth Admin secret chưa cấu hình, nhưng không bật nhập live cho tới khi hai phase đạt.

## Nghiệm thu / xác minh

- Nhập một ca không đổi ba ca còn lại; sửa/xóa mềm có audit trước/sau và actor staff.
- `+N` đồng thời từ nhiều client không mất đơn; nhập số cuối ngày thay đúng count kênh.
- Total bill được nhập riêng, bao gồm mọi kênh, không tự khớp bằng phép cộng Grab/Shopee.
- Staff chỉ nhập meter readings, incident reason/amount và sales; thử gửi field admin, owner khác, ngày cũ và sau cutoff bị chặn ở Server Action và DB.
- Staff chỉ quản lý incidental expenses của ngày hiện tại trước cutoff; không đọc được expense/cost admin ngoài luồng ghi phát sinh đã nhập.
- Owner vẫn sửa được tất cả ngày và xác nhận/đối soát như hiện tại.

## Rủi ro / quyết định

- Đừng lưu doanh thu ca ở hai nơi. Xóa mềm theo từng ca là mô hình đã chốt; giữ giá trị trước khi xóa trong `daily_shift_deletions` và audit, không làm mất ba ca còn lại. Chi phí phát sinh xóa mềm từng dòng.
- Thiếu dữ liệu khác 0; không tự ghi 0 cho ca chưa nhập. Ca đã xóa mềm khác với ca chưa nhập: staff thấy trạng thái trống, còn admin tra được giá trị cũ trong audit/history.

## Truy vết user story

US-02, US-03, US-04, US-05 — P1.
