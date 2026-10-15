# Phase 02 — Nhập nhật ký điện trong ngày

## Objective

Cho nhân viên và admin nhập hai kỳ điện trong màn hình ngày, mỗi kỳ lưu độc lập; cung cấp ghi nhận thiết bị/chạy qua đêm và checklist mà không ảnh hưởng form doanh thu.

## Stories covered

- US-01: nhân viên ghi giờ/kWh sáng và tối trong cùng màn hình nhập ngày.
- US-02: ghi hoạt động thiết bị và bất thường.
- US-03: checklist chốt ca tối.
- US-04: thiếu log điện không chặn nhập doanh thu.
- US-06: nhân viên chỉ sửa ngày hiện tại, admin sửa lịch sử.

## Scope

1. Thay khối chỉ số điện gộp trong `StaffEntryForm` thành hai thẻ/khu vực rõ “Ca sáng” và “Ca tối”. Mỗi phần có giờ ghi (`HH:mm`), kWh không âm tối đa 3 chữ số thập phân, trạng thái và ghi chú.
2. Hiển thị “Chưa ghi”, “Đã ghi”, “Không ghi nhận được” và lý do. Không làm checklist hoặc trạng thái điện thành điều kiện lưu doanh thu.
3. Tải thiết bị active cùng log của đúng ngày hiện mở; chỉ hiện danh mục ngắn của ngày, không tải lịch sử nhiều ngày. Thiết bị timed nhập giờ bật/tắt; thiết bị continuous dùng trạng thái hoạt động; ca sáng ghi nhận chạy từ đêm trước, ca tối ghi thiết bị dự kiến còn hoạt động sau đóng cửa.
4. Lưu riêng mỗi kỳ bằng RPC mới, cập nhật đúng `daily_records` kWh hiện có cùng metadata trong một giao dịch; log thiết bị của kỳ đó lưu atomically. Không gọi RPC cũ cập nhật cả hai kWh.
5. Tách meter khỏi form/action `saveDailyRecord` phía admin để tránh một form sổ ngày cũ ghi đè kWh staff mới lưu. Admin dùng cùng hai khu vực theo kỳ và có thể sửa ngày cũ theo quyền hiện có.
6. Thêm checklist tối: đã tắt thiết bị không cần thiết; đã kiểm tra cửa tủ mát/tủ đông; đã chụp ảnh công tơ. Tick ảnh chỉ là tự xác nhận.
7. Server action xác thực dữ liệu lại; staff bị từ chối nếu gọi trực tiếp với ngày đã qua. Hiển thị feedback rõ sau lưu hoặc lỗi và revalidate đúng ngày/sổ.

## Files/modules

- `src/components/staff/staff-entry-form.tsx`
- `src/app/(staff)/staff/entry/[date]/page.tsx`
- `src/app/(staff)/staff/actions.ts`
- `src/components/ledger/daily-entry-form.tsx`
- `src/app/(private)/ledger/actions.ts`
- `src/app/(private)/ledger/[date]/page.tsx`
- Module types/validation theo pattern hiện có trong `src/lib/`.

## Dependencies

Phase 01 (schema, RPC, RLS).

## Acceptance / verification

- Staff lưu ca sáng không thay đổi số điện/metadata ca tối; lưu ca tối không thay đổi ca sáng.
- Thiếu log điện, chưa tick checklist hoặc kỳ “không ghi được” không chặn lưu bốn ca, Grab/Shopee, tổng bill hoặc chi phí ngày.
- “Không ghi nhận được” không lưu được khi thiếu lý do; khi status là “Đã ghi” phải có kWh và giờ ghi theo quy tắc người dùng chốt.
- Thiết bị timed có ô tick “Giờ tắt sang ngày hôm sau” để phân biệt giờ tắt thuộc ngày kế tiếp; continuous không yêu cầu giờ bật/tắt.
- Nhân viên gọi trực tiếp action/RPC với ngày cũ bị từ chối; admin vẫn sửa ngày cũ và thấy feedback.
- Màn hình admin không có đường lưu chung gửi số kWh cũ để ghi đè dữ liệu mới.

## Risks / open decisions

- UI staff phải phân biệt “thiết bị không chạy trong kỳ” với “chưa ghi thiết bị”; không tự mặc định hai trạng thái này giống nhau.
- Trường tối thiểu đã chốt: `Đã ghi` cần giờ + kWh; `Không ghi nhận được` cần lý do; để trống là `Chưa ghi`.
