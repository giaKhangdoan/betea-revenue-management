# Brainstorm: Nhật ký theo dõi điện theo ca

**Date:** 2026-10-15

## Ideas Explored

- **Bổ sung tối thiểu vào hai ô công tơ hiện có:** thêm giờ đọc và ghi chú. Cách này ít thao tác nhưng không lưu được thời gian hoạt động từng thiết bị hoặc checklist chốt ca.
- **Nhật ký có hai kỳ sáng/tối trong trang nhập ngày hiện có:** mỗi kỳ lưu giờ đọc, chỉ số kWh và tình hình thiết bị. Đây là hướng được chọn; dữ liệu doanh thu bốn ca vẫn độc lập.
- **Danh sách thiết bị cố định hoặc do admin quản lý:** chọn cho admin thêm/bớt thiết bị; khởi tạo điều hòa và máy làm đá theo giờ, tủ mát/tủ đông chạy liên tục.
- **Checkbox ảnh có bắt buộc kèm file hay không:** chọn tự xác nhận; không chặn tick nếu chưa tải ảnh. Khu ảnh nhiều tệp hiện có vẫn dùng để lưu ảnh.
- **Bắt hoàn tất điện trước khi lưu doanh thu hay theo dõi thiếu riêng:** chọn không chặn doanh thu. Mục điện thiếu được đánh dấu cần xử lý; khi nhân viên chọn không thể ghi nhận thì phải nêu lý do.

## User's Direction

- Đặt tính năng trong màn hình nhập ngày nhân viên hiện có, với hai kỳ **Ca sáng** và **Ca tối** như mẫu ảnh; không gắn số công tơ vào từng một trong bốn ca doanh thu.
- Ghi giờ đọc công tơ và chỉ số kWh, thời điểm bật/tắt thiết bị theo dõi, ghi chú bất thường và tình trạng thiết bị qua đêm.
- Admin quản lý danh sách thiết bị. Thiết bị mặc định: điều hòa và máy làm đá ghi giờ bật/tắt; tủ mát/tủ đông được đánh dấu hoạt động liên tục.
- Checklist chốt ca tối gồm: đã tắt thiết bị không cần thiết; đã kiểm tra tủ mát/tủ đông; đã chụp ảnh công tơ. Checkbox ảnh là xác nhận của nhân viên, không bắt buộc liên kết với file ảnh.
- Nếu thiếu dữ liệu, nhân viên vẫn có thể lưu doanh thu. Trạng thái điện cần xử lý hiển thị cho admin; lý do bắt buộc khi chọn không thể ghi nhận.
- Giữ quyền hiện có: nhân viên sửa ngày hiện tại, ngày đã qua chỉ xem; admin có thể điều chỉnh dữ liệu lịch sử.

## Open Questions

- Không còn câu hỏi nghiệp vụ chặn bước plan. Plan cần chốt cách nhập giờ thiết bị chạy qua nửa đêm và lưu lịch sử khi admin ngừng theo dõi một thiết bị.

## Risks

- Checkbox tự xác nhận không chứng minh ảnh đã tải lên; nếu cần đối chiếu, ảnh công tơ nên được phân loại rõ trong khu ảnh hiện có nhưng không bắt buộc để lưu.
- Xóa hẳn thiết bị có thể làm mất ngữ cảnh của nhật ký cũ; nên ngừng kích hoạt thiết bị thay vì xóa bản ghi lịch sử.
- API điện hiện công khai chỉ trả chỉ số/kWh. Không đưa ghi chú, checklist hoặc nhật ký thiết bị vào API không xác thực này.
- Nhập giờ thủ công có thể sai hoặc qua ngày; form cần thể hiện rõ ca/kỳ và hỗ trợ mốc qua nửa đêm.
