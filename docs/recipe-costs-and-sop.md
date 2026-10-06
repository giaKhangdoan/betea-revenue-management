# Cost công thức và SOP

Tài liệu này mô tả phần cost nguyên liệu/công thức và SOP đã triển khai trong Betea. Nó không thay thế sổ doanh thu, COGS POS theo tháng hoặc quy trình kiểm kê tồn kho.

## Quản lý cost

- Mở `/product-costs` để quản lý nguyên liệu, giá mua, đơn vị, cốt/bán thành phẩm, công thức món theo size và giá bán.
- Size hiện map S=12oz, M=17oz, L=22oz.
- Cost được tính từ nguyên liệu và định lượng công thức; chi phí phụ thuộc được tính lại khi dữ liệu đầu vào đổi.
- Phiên bản cũ chỉ xem tại `/product-costs/history`.
- COGS tổng tháng nhập từ POS trong sổ thu chi vẫn là trường riêng; module này không ghi đè `monthly_costs.cogs_vnd`.
- Workbook nhập qua dry-run và báo cáo đối soát. Tên, đơn vị hoặc công thức chưa được xác minh phải ở trạng thái chờ xử lý; không coi số candidate đã nhận diện là dữ liệu đã nhập.

## Sửa và xuất bản SOP

1. Quản lý cập nhật món, size, định lượng, thứ tự bước, hướng dẫn và ghi chú tại `/sop`.
2. Xem trước nội dung và lưu bản nháp. Hệ thống gắn revision để nhận biết khi dữ liệu recipe thay đổi sau SOP.
3. Chọn xuất bản khi đã kiểm tra bản xem trước.
4. Nhân viên xem bản đang xuất bản tại `/staff/sop`; họ chỉ có quyền đọc.

Projection cho nhân viên chỉ gồm tên món, size, nguyên liệu, định lượng, đơn vị, bước pha và ghi chú. Không thêm giá mua, giá bán, cost, lãi, margin, snapshot hay dữ liệu recipe canonical vào projection này.

## Bảo mật và rollout

- Owner pages/actions kiểm tra quyền ở server. Các bảng owner-only dùng grants và RLS; ẩn nút trên giao diện không thay cho kiểm soát database.
- Staff page chỉ đọc bảng `staff_sop_publications`. Khi mở rộng schema hoặc thêm trường, cập nhật allowlist và boundary test trước.
- Các migration trong repo gồm `20261005165742_recipe_costing.sql`, `20261006060737_sop_safe_revisions.sql` và `20261006141400_bind_sop_publish_to_saved_sources.sql`. Migration mới dựng projection nhân viên từ recipe và SOP đã lưu, đồng thời từ chối payload publish khác nguồn đã khóa revision. Chỉ áp vào môi trường đã được chọn rõ; chưa có xác nhận áp migration này lên production hoặc deploy tính năng.
- Đồng bộ Canva chưa được bật. Chỉ tiếp tục sau khi Phase 01 xác minh quyền/API trên bản sao, giữ nguyên design gốc và link nhân viên; quản lý sẽ tự bấm Publish theo quyết định đã chốt.

## Kiểm tra local

Khi dùng Supabase local riêng cho kiểm thử và Docker đang chạy:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npx supabase test db --local
```

Trạng thái xác minh tại 06/10/2026: 76 unit tests, 140 pgTAP assertions qua 7 SQL files; lint, typecheck và build thành công. Không chạy `supabase test db --local` khi CLI đang trỏ tới project production.
