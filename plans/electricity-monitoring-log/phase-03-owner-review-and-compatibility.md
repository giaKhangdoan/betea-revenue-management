# Phase 03 — Quản lý thiết bị, đối chiếu và tương thích

## Objective

Hoàn thiện thao tác admin: quản lý thiết bị, xem tình trạng điện theo ngày, tìm ảnh công tơ và đảm bảo số liệu/tính toán/API đang chạy giữ nguyên.

## Stories covered

- US-05: admin thêm/sửa/sắp xếp/ngừng theo dõi thiết bị.
- US-06: admin xem nhật ký và hiệu chỉnh lịch sử.
- US-07: admin lọc ảnh công tơ theo sáng/tối.
- US-01: bảo toàn hai cột kWh, công thức điện, lợi nhuận và API GET.

## Scope

1. Thêm trang/khối cài đặt trong khu admin hiện có để tạo, sửa tên/chế độ/thứ tự, bật hoặc ngừng theo dõi thiết bị. Không có thao tác xóa cứng log cũ.
2. Trong sổ ngày admin, thể hiện trạng thái sáng/tối, giờ đọc, kWh, lý do chưa ghi, checklist tối, ghi chú và log thiết bị; cho phép xem cả device snapshot đã inactive.
3. Khi admin sửa log lịch sử, bắt buộc nhập lý do; lưu actor, thời gian, lý do và dữ liệu trước/sau bằng audit hiện có hoặc trigger phù hợp.
4. Mở rộng metadata ảnh ngày hiện tại để hỗ trợ category “Ảnh công tơ” và kỳ `morning/evening` riêng. Không đặt kỳ điện vào `shift_code` bốn ca; cập nhật schema, server action, RPC owner/staff R2 và nhánh khôi phục bản ghi; giữ upload tùy chọn và dùng lại luồng R2 hiện tại.
5. Giữ nguyên `src/app/api/ai/v1/electricity/route.ts`: response không thêm giờ, checklist, ghi chú, nhân viên hoặc log thiết bị. Giữ nguyên phép tính hiện tại dựa trên hai cột kWh.
6. Thực hiện kiểm tra phân quyền, dữ liệu biên, phép tính và UI trên local Supabase/Docker; không chạy production migration, push hay deploy trong scope plan này.

## Files/modules

- `src/components/admin/` và `src/app/(private)/` cho trang cấu hình thiết bị.
- `src/components/ledger/` và `src/app/(private)/ledger/[date]/page.tsx` cho admin xem/sửa.
- `src/components/ledger/photo-manager.tsx`
- `src/app/(private)/ledger/photo-actions.ts`
- Migration điều chỉnh `day_photos` metadata/validation theo cách tương thích.
- `src/app/api/ai/v1/electricity/route.ts` chỉ kiểm tra hồi quy; không mở rộng response.
- UI styles trong stylesheet hiện có của app.

## Dependencies

Phase 01 và 02.

## Acceptance / verification

- Admin thêm/sửa/thứ tự/ngừng thiết bị được; staff chỉ thấy thiết bị active; log cũ vẫn hiện snapshot gốc.
- Admin lọc được ảnh công tơ buổi sáng/tối; nhân viên vẫn có thể lưu điện khi không tải ảnh.
- Một kỳ hoặc thiết bị chưa nhập hiển thị rõ là thiếu; không coi giá trị thiếu là số 0 và không sửa hồi tố dữ liệu cũ.
- Cùng dữ liệu kWh đầu vào cho kết quả điện/lợi nhuận như trước khi thêm tính năng.
- GET `/api/ai/v1/electricity?fromDate=...&toDate=...` giữ nguyên shape và chỉ trả dữ liệu hiện đã công bố; kiểm tra không xuất hiện trường mới.
- Vai trò staff, owner và anon được kiểm tra trên local; app build/lint/typecheck theo scripts hiện có sau khi người dùng yêu cầu kiểm thử.

## Risks / open decisions

- `day_photos.shift_code` đang giới hạn bốn mã ca; migration cần bổ sung trường kỳ điện riêng mà không làm thay đổi metadata ảnh đã có.
- Cần xác minh route cấu hình phù hợp với navigation admin hiện hành trước khi code; ưu tiên đặt dưới khu Cài đặt/Quản lý, không tạo mục top-level dư thừa.
- Phát hành production được tách riêng và chỉ làm khi người dùng yêu cầu sau khi xem kết quả local.
