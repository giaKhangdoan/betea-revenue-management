# Phase 01 — Schema và quyền truy cập

## Objective

Mở rộng schema để lưu metadata công tơ theo kỳ, cấu hình thiết bị, log hoạt động thiết bị, checklist tối và audit mà không thay nguồn kWh đang dùng.

## Stories covered

- US-01: giờ và chỉ số sáng/tối độc lập.
- US-02: trạng thái chưa ghi/không ghi được và lý do thiết bị.
- US-03: checklist tối và ghi chú.
- US-05: danh mục thiết bị linh hoạt, lịch sử còn nguyên khi ngừng theo dõi.
- US-06: audit hiệu chỉnh lịch sử.

## Scope

1. Đọc quy trình migration hiện có và xác nhận kết nối Supabase local Docker; hiện tại `supabase` CLI không có trong PATH. Tạo migration theo công cụ Supabase được repo hỗ trợ; dừng nếu chỉ có thể chạy vào project hosted.
2. Bổ sung metadata sáng/tối trên `daily_records`: giờ ghi theo giờ địa phương nghiệp vụ, trạng thái `recorded`/`unable` (giá trị null là chưa ghi), lý do bắt buộc khi `unable`, ghi chú riêng từng kỳ. Giữ nguyên hai cột kWh hiện có.
3. Thêm ba giá trị checklist ca tối dạng nullable boolean để phân biệt chưa xác nhận với đã tick/bỏ tick.
4. Tạo `electricity_devices` theo owner: tên, chế độ `timed`/`continuous`, thứ tự hiển thị, active flag, timestamps. Seed ba mặc định cho owner hiện tại: điều hòa và máy làm đá dạng timed; tủ mát/tủ đông dạng continuous.
5. Tạo `daily_electricity_device_logs` với duy nhất một dòng cho `(owner_id, business_date, period, device_id)`. Lưu snapshot tên/chế độ, bật/tắt, cờ kết thúc ngày hôm sau, buổi sáng có chạy từ đêm trước, buổi tối dự kiến để chạy sau đóng cửa, trạng thái liên tục và ghi chú.
6. Thêm RLS cho mọi bảng public. Staff chỉ đọc active device và dữ liệu cửa hàng được cấp; ghi nhật ký qua RPC theo ngày hiện tại. Owner quản lý catalog và hiệu chỉnh lịch sử bằng RPC. Không cấp quyền cho anon; function definer dùng `search_path = ''`, kiểm tra vai trò/ngày và revoke/grant rõ ràng.
7. Gắn audit cho thao tác admin thay đổi catalog và sửa log đã lưu; lưu tên/chế độ snapshot để cấu hình thay đổi không làm đổi ý nghĩa lịch sử. RPC điện upsert `daily_records` nếu ngày chưa có dòng, sau đó chỉ cập nhật đúng cột kWh của kỳ đó.
8. Giữ migration theo hướng additive, không backfill dữ liệu cũ. Nếu phải rollback ứng dụng, giữ schema mới và dữ liệu nhật ký tại chỗ cho tới khi có kế hoạch xóa riêng được xác nhận; không drop bảng/cột hoặc sửa các cột kWh hiện hữu như một phần rollback thường.

## Files/modules

- Migration mới trong `supabase/migrations/` (tạo qua migration workflow chính thức của repo).
- `src/types/database.types.ts` hoặc vị trí generated types hiện hành.
- SQL RPCs theo pattern trong `supabase/migrations/20260927010000_staff_entry_and_evidence.sql` và `20261001050000_inventory_catalog_management.sql`.

## Dependencies

Không phụ thuộc phase khác. Phase 02 và 03 cần schema/RPC này.

## Acceptance / verification

- Migration chạy trên DB local sạch và DB local có dữ liệu; hai cột kWh, lợi nhuận và số liệu cũ không bị cập nhật/xóa.
- Anon không thể đọc catalog/log; staff không thể thêm/sửa/xóa thiết bị hoặc ghi ngày đã qua; owner có thể quản lý catalog và chỉnh lịch sử.
- RPC cho phép staff lưu đúng ngày hiện tại, cập nhật đúng kỳ và không đổi kỳ đối diện.
- Deactivate/đổi tên/đổi chế độ thiết bị không làm mất snapshot log đã lưu.
- Không có backfill suy đoán giờ hoặc thiết bị cho ngày lịch sử.

## Risks / open decisions

- Dừng nếu chưa có migration runner local đáng tin cậy; không chạy SQL qua MCP đã kết nối production.
- Kiểu lưu giờ trong DB là `time` địa phương; không tự đổi timezone hoặc gắn UTC sai ngày nghiệp vụ.
- Ràng buộc: `recorded` cần giờ + kWh; `unable` cần lý do; admin sửa lịch sử cần lý do audit. Ô tick giờ tắt ngày kế tiếp dùng nhãn “Giờ tắt sang ngày hôm sau”.
