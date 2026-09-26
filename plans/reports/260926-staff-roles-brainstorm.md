# Brainstorm: Role nhân viên và nhập doanh thu theo ca

**Date:** 2026-09-26

## Ideas Explored

- **Tài khoản nhân viên có membership riêng trong cửa hàng Betea.** Giữ chủ cửa hàng làm admin duy nhất; tài khoản nhân viên chỉ truy cập dữ liệu trong phạm vi một tuần hiện tại và không chạm vào chi phí/lợi nhuận.
- **Tách luồng nhập theo ca khỏi màn hình quản trị.** Nhân viên gửi số liệu sau mỗi ca; doanh thu từng ca được lưu riêng để không ghi đè dữ liệu ca khác. Số bill được nhập cuối ngày, còn điện và chi phí phát sinh được ghi trong ngày.
- **Giữ cùng bảng và chỉ ẩn trường ở giao diện.** Hướng này có vẻ nhanh nhưng bị loại vì RLS giới hạn theo hàng, không tự che các cột đối soát, xác nhận vệ sinh hay số liệu chi phí trong bảng `daily_records`.
- **Khóa bằng nút trên giao diện so với khóa ở cơ sở dữ liệu.** Chọn khóa theo ngày nghiệp vụ `Asia/Ho_Chi_Minh` ở server/database; chỉ admin có đường sửa ngày đã qua.
- **Ảnh Bluebook dùng vùng lưu riêng tư.** Nhân viên chỉ tải bằng chứng Bluebook; admin được xem sau khi tải xong. Xác nhận vệ sinh, sắp xếp và đối soát vẫn thuộc admin.

## User's Direction

- Một cửa hàng Betea; admin tạo, cập nhật, đặt lại mật khẩu, phân quyền và khóa tài khoản nhân viên. Có thể dùng chung một tài khoản staff cho nhiều nhân viên để thao tác nhanh.
- Nhân viên nhập bốn ca theo giờ 06:00–10:00, 10:00–14:00, 14:00–18:00 và 18:00–22:00; mỗi ca nhập một lần khi ca kết thúc.
- Grab/Shopee thường nhập cuối ngày; số đơn có thể cộng dồn trong ngày hoặc nhập con số cuối ngày. Doanh thu Grab/Shopee được ghi vào tổng ngày. Tổng bill bao gồm đơn tại quầy, Grab và Shopee; nhân viên nhập thủ công một lần cuối ngày.
- Nhân viên ghi chỉ số điện ca sáng/tối, thêm chi phí phát sinh có lý do và tải ảnh Bluebook. Admin thấy ảnh sau khi tải.
- Nhân viên có thể chỉnh số liệu trong ngày; sau khi ngày kết thúc, chỉ admin được sửa.
- Dashboard nhân viên hiển thị doanh thu từng ngày từ Thứ 2 đến Chủ nhật của tuần hiện tại; không hiện tổng tuần, tổng tháng hay lợi nhuận. Ngày đã qua chỉ xem. Không xem tháng khác, COGS, tiền thuê, lương, bill nước hoặc phép tính/chi phí tiền điện.
- Chỉ admin đối soát Bluebook và xác nhận vệ sinh/sắp xếp.
- Đã chọn hướng triển khai bảo mật: role/member riêng, server checks và RLS/đường đọc ghi giới hạn; không dựa vào việc ẩn thành phần giao diện.

## Chốt phạm vi và đánh đổi

- Tài khoản dùng chung giúp nhân viên không phải nhớ nhiều thông tin đăng nhập. Đổi lại, audit log chỉ xác định tài khoản staff dùng chung chứ không xác định được cá nhân nào thao tác.
- Nhân viên dùng chung quyền staff: được sửa dữ liệu staff của ngày hiện tại trước 00:00 giờ Việt Nam; sau thời điểm đó chỉ admin được sửa ngày cũ.
- Dashboard staff chỉ hiển thị doanh thu theo ngày của tuần hiện tại; không hiển thị tổng tuần, tổng tháng hay lợi nhuận.
- Đếm đơn Grab/Shopee hỗ trợ hai cách cập nhật: cộng thêm số đơn hoặc nhập số chốt cuối ngày. Số đơn từng nền tảng hiện riêng để đối chiếu.
- Tổng bill bao gồm đơn tại quầy, Grab và Shopee; nhân viên nhập thủ công cuối ngày trên website để đối chiếu. Hệ thống không tự tính tổng bill bằng cách cộng lại số đơn nền tảng.
- Staff có bộ quyền cố định. Trong ngày hiện tại, staff được tạo/sửa/xóa mềm dữ liệu staff; lịch sử xóa vẫn lưu. Sau khi hết ngày chỉ admin chỉnh được.
- Nhân viên chỉ nhập chỉ số điện thô ca sáng/ca tối; phép tính mức dùng điện, chênh qua đêm và chi phí điện do admin xem/quản lý.

## Resolved Implementation Choices

- Grab/Shopee thường chốt cuối ngày; order count hỗ trợ cộng dồn hoặc nhập số chốt. Doanh thu hai kênh nhập theo ngày.
- Admin tạo và quản lý tài khoản/role staff; không có đăng ký công khai. Một tài khoản staff dùng chung được chấp nhận. Admin có thể đặt lại mật khẩu, không thể xem mật khẩu hiện tại.
- Vì dùng chung tài khoản, mọi nhân viên có cùng quyền staff và có thể cập nhật các mục staff trong ngày hiện tại trước hạn khóa; admin có thể sửa ngày cũ.
- Màn hình staff xem doanh thu từng ngày trong tuần hiện tại (Thứ 2–Chủ nhật), không xem tổng tuần, tổng tháng hay lợi nhuận.
- Nhân viên nhập tổng bill thủ công cuối ngày để đối chiếu; số này bao gồm đơn tại quầy, Grab và Shopee, còn số đơn mỗi nền tảng được lưu riêng làm chi tiết.
- Dữ liệu staff xóa trong ngày được xóa mềm để admin vẫn tra được lịch sử.
- Staff chỉ nhập chỉ số điện; admin quản lý các phép tính liên quan.

## Risks

- `daily_records` hiện chứa cùng lúc doanh thu, công tơ, đối soát và xác nhận vận hành. Mở quyền đọc trực tiếp cho nhân viên có thể làm lộ trường nhạy cảm; cần projection/RPC an toàn hoặc mô hình bảng phù hợp.
- Quyền hiện tại giả định một owner duy nhất; việc thêm staff phải đổi membership, RLS, storage policies và audit trail đồng bộ.
- Tài khoản staff dùng chung không cung cấp quy trách nhiệm theo từng cá nhân. Nếu sau này cần biết ai nhập/sửa, cần chuyển sang tài khoản riêng hoặc một bước xác nhận danh tính khác.
- Khóa chỉ ở frontend có thể bị vượt qua bằng request trực tiếp. Quy tắc thời gian và admin override cần được kiểm tra phía server/database theo giờ Việt Nam.

