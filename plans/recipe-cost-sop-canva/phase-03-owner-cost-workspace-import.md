# Phase 03 — Màn hình quản lý và import workbook

**ID:** `phase-03-owner-cost-workspace-import`<br>
**Stories:** US-01–US-04 (P1), US-07–US-08 (P2)

## Mục tiêu

Cho chủ cửa hàng nhập/sửa giá và công thức nhanh, đọc breakdown cost theo size và nạp workbook hiện có với bước đối soát.

## Công việc

1. Thêm owner-only route `/product-costs` hoặc tương đương dưới `src/app/(private)` và thêm navigation theo pattern hiện hữu.
2. Tạo workspace nguyên liệu: giá mua, lượng mua, đơn vị mua, đơn vị cost, quy đổi, ngày hiệu lực; báo trạng thái thiếu giá hoặc conversion.
3. Tạo editor cốt/bán thành phẩm: thành phần, lượng, unit và output yield; hiển thị cost mẻ và cost/g/ml.
4. Tạo menu recipe per S/M/L (S=12oz, M=17oz, L=22oz); hỗ trợ ingredient, base, topping, packaging, sale price; hiển thị từng cost line, total COGS, gross profit và margin.
5. Thêm màn hình Lịch sử riêng. Màn hình workspace mặc định chỉ hiện current cost; trang lịch sử hiện ngày, người sửa, version và snapshot cũ.
6. Xây importer một lần từ workbook: parse theo mapping Phase 01; có `dry-run`/preview báo số dòng hợp lệ, lỗi, alias cần mapping và tổng cost; chỉ nhập khi owner xác nhận.
7. Nhập phần dữ liệu đã xác minh; giữ dòng lỗi/thiếu mapping trong danh sách chờ để xử lý tiếp. Không đánh dấu import hoàn tất cho tới khi mọi dòng bắt buộc đã được xử lý.
8. Dùng form/action server-side theo cấu trúc hiện có; validate inputs bằng schema; mọi read/write owner-only.

## Files/modules

- `src/app/(private)/product-costs/page.tsx` và `actions.ts` (mới).
- `src/components/recipe-cost/ingredient-manager.tsx`, `batch-recipe-editor.tsx`, `drink-recipe-editor.tsx`, `cost-breakdown.tsx`, `cost-history.tsx` (mới).
- `scripts/import-cogs-workbook.*` và mapping artifact từ Phase 01.
- `src/components/layout/private-navigation.tsx`.

## Dependencies

- Phase 02 schema/calculator hoàn tất.
- Phase 01 mapping có trạng thái cho tất cả sheet/dòng.

## Acceptance / verification

- Owner có thể tạo/cập nhật nguyên liệu, cốt và công thức; các cost bị ảnh hưởng hiển thị cập nhật trong ≤2 giây trên tập workbook hiện tại.
- Mỗi size có breakdown thành phần, total cost, giá bán và lãi gộp.
- Cost cũ không hiện ở workspace mặc định; mở Lịch sử mới xem được phiên bản cũ.
- Import dry-run không ghi DB; sau xác nhận, dòng hợp lệ được nhập và dòng unresolved nằm trong danh sách chờ; import chỉ hoàn tất khi các dòng bắt buộc đã map; mọi thao tác có thể audit lại.
- Nhập 5 công thức đại diện qua S/M/L cho kết quả khớp workbook theo quy tắc làm tròn đã xác nhận.
- Nhân viên gọi route/actions của owner bị từ chối ở server, không chỉ bị ẩn link.

## Risks / notes

- File COGS nguồn nằm ngoài repo; không lưu workbook, credential hoặc giá trị bí mật vào git.
- Giữ màn hình dễ đọc cho chủ cửa hàng: nhập theo nhóm đơn giản, có trạng thái thiếu dữ liệu và không bắt người dùng nhập lặp lại cost suy ra.

## Implementation record — 2026-10-06

- [x] Owner-only workspace for ingredients, batch recipes, products and S/M/L cost breakdown; saved snapshots are shown on a separate history page.
- [x] XLSX import preview compares candidate ingredient names with the saved workspace, shows the exact total purchase price for candidates, offers a complete review CSV, and binds confirmation to the current workspace revision.
- [x] Owner can record a resolution note for each saved review item; server checks the owner, revision and item state and saves the note in the versioned document.
- [x] Parser bounds XLSX size/ZIP expansion, holds the populated `Bảng NVl!A43:K58` block, and does not trust formula cache values. CSV export neutralizes formula-leading cells.
- [x] `npm test` (64 tests), `npm run typecheck`, `npm run lint`, and `npm run build` pass. A temporary, removed smoke test parsed the supplied workbook without storing it: 16 importable ingredient candidates totaling 2,274,576₫; 972 review items including 965 recipe/source warnings; completion remains false.
- [x] Read-only code review closed all findings (10/10): server controls review metadata, non-menu and hidden populated sheets enter the queue, request bodies are bounded, and CSV formula injection is neutralized.
- [ ] Reconcile five representative S/M/L formulas against owner-approved source values. Current workbook has errors, external links, suspicious lookups, unit/yield conflicts and size/packaging mismatches, so recipes and bases remain unimported.
- [ ] Owner reviews and approves the local implementation before Phase 04. No production workbook import, deployment or Canva change was made.
