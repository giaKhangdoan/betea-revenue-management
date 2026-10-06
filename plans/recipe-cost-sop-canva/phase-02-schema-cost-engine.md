# Phase 02 — Schema và cost engine

**ID:** `phase-02-schema-cost-engine`<br>
**Stories:** US-01–US-04 (P1), US-08 (P2)

## Mục tiêu

Tạo mô hình dữ liệu recipe độc lập với inventory và COGS POS; tính đúng cost theo unit và giữ lịch sử chỉ owner xem được.

## Công việc

1. Thiết kế migration cho ingredient purchase/cost units, batch recipes (cốt/bán thành phẩm), drink recipes/size variants, recipe component rows, version/audit records và immutable cost snapshots.
2. Gắn dữ liệu theo `owner_id`; bật RLS và grants rõ cho từng thao tác. Owner có quyền quản lý. Staff/anon không được đọc cost, giá nguyên liệu, snapshot hay công thức canonical.
3. Viết cost calculator thuần trong `src/lib/recipe-cost/`: normalize đơn vị cùng chiều, tính ingredient cost, yield unit cost, batch cost, đồ uống theo size, gross profit và margin.
4. Dùng numeric/decimal phù hợp để tránh sai số float cho tiền và định lượng; chỉ làm tròn lúc hiển thị theo rule Excel đã xác nhận.
5. Khi một giá/công thức/yield đổi, cập nhật current result phụ thuộc và tạo snapshot mới trong cùng transaction/luồng được kiểm soát; snapshot cũ không được ghi đè.
6. Có validation cho giá thiếu, lượng âm, đơn vị không tương thích, yield bằng 0, reference hỏng và chu trình recipe.
7. Giữ nguyên `monthly_costs.cogs_vnd`; module mới không sửa COGS POS, lợi nhuận hoặc các bảng chi phí tháng.

## Files/modules

- `supabase/migrations/<timestamp>_recipe_costing.sql` (mới).
- `supabase/tests/recipe_costing_boundary.sql` (mới).
- `src/lib/recipe-cost/types.ts`, `units.ts`, `calculate.ts`, `versions.ts` (mới).
- Trước khi code Next.js, đọc guide liên quan trong `node_modules/next/dist/docs/` theo `AGENTS.md`.

## Dependencies

- Phase 01 xác định schema mapping, unit conversions, yield semantics và rounding.
- Canva feasibility không chặn phần schema/calculator core.

## Quyết định kiến trúc khi triển khai

- Lưu recipe graph có kiểu rõ trong `RecipeCostDocument`, serialize định lượng và giá dưới dạng chuỗi thập phân, rồi lưu workspace và snapshot thành JSONB owner-only. Một lần lưu qua RPC tăng revision và ghi workspace cùng snapshot trong một transaction; cách này tránh trạng thái nửa cập nhật giữa nhiều bảng trong app hiện chỉ có một cửa hàng.
- RPC kiểm tra owner, shape, kích thước payload và revision; cost engine TypeScript là nguồn tính chuẩn. Màn hình/server action ở Phase 03 phải tính lại graph trước khi gọi RPC. Không cấp quyền ghi bảng trực tiếp; snapshot chỉ có quyền đọc, không có quyền update/delete.
- Cost engine dùng phân số BigInt chính xác trong toàn bộ đồ thị phụ thuộc; chuyển sang chuỗi có tối đa 8 chữ số thập phân ở đầu ra. Quy đổi đơn vị chuẩn chỉ nối cùng chiều đo; quy đổi khác chiều chỉ dùng khi có factor cụ thể do owner khai báo.

## Acceptance / verification

- Ví dụ mẫu: 1kg trà = 200.000đ; dùng 50g tính 10.000đ cost trà; yield 200g cho ra 50đ/g trước các thành phần khác.
- Cost S/M/L cho mỗi món tách biệt và hiển thị breakdown đúng nguồn.
- Đổi giá nguyên liệu tính lại mọi base/drink phụ thuộc; lịch sử cũ vẫn tái hiện đúng phiên bản đã lưu.
- RLS matrix: owner được đọc/ghi; staff và anon không đọc/ghi bảng cost dù gọi Data API trực tiếp.
- Unit tests cho phép quy đổi cùng chiều, chặn g↔ml khi thiếu hệ số, yield, dependency, rounding và lỗi data.
- pgTAP kiểm tra owner/staff/anon, quyền ghi qua RPC, revision stale và snapshot bất biến; phải chạy sau khi có local Supabase DB.
- Regression xác nhận COGS POS tháng và báo cáo hiện tại không bị thay đổi.

## Risks / notes

- Gắn component bằng ID ổn định, không dùng tên nguyên liệu làm khóa.
- Không dùng `inventory_items` làm bảng nguyên liệu recipe nếu semantics stock-unit gây lẫn.
- Tính cost lịch sử từ giá hiện tại là không chấp nhận; snapshot phải giữ đủ dữ liệu đầu vào hoặc revision IDs bất biến.
