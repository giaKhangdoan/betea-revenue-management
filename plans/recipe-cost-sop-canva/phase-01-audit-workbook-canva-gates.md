# Phase 01 — Audit workbook và gate Canva

**ID:** `phase-01-audit-workbook-canva-gates`<br>
**Stories:** US-05 (P1), US-07 (P2)

## Mục tiêu

Xác định chính xác dữ liệu và phép tính trong `COGS BETEA.xlsx`; chứng minh Canva có thể tạo/cập nhật một bản sao an toàn trên tài khoản cửa hàng trước khi đưa tích hợp vào lộ trình phát hành.

## Công việc

1. Lập manifest mọi sheet có dữ liệu: nguyên liệu, bán thành phẩm, Menu, các sheet món và summary; ghi source cell/range, kiểu dữ liệu, đơn vị, công thức Excel, giá trị cached và quan hệ tham chiếu.
2. Rà từng đơn vị mua, đơn vị cost, hệ số quy đổi, sản lượng cốt dùng được, giá bán và cost theo S/M/L. Đánh dấu alias/trùng tên, công thức lỗi, cell merge/ẩn hoặc giá trị không xác định; không tự đoán.
3. Chọn ít nhất 5 công thức đại diện gồm cốt và món có nhiều thành phần để tạo bảng expected cost/rounding phục vụ đối chiếu.
4. Giữ nguyên workbook gốc; ghi mapping trong artifact riêng, không ghi dữ liệu nhạy cảm vào repo nếu không cần.
5. Với link Canva `https://canva.link/bgiepgr891xcw85`, kiểm tra quyền mở/chỉnh, data fields/dataset, quyền Autofill/OAuth và thao tác tạo/cập nhật trên bản sao riêng. Không edit hoặc publish thiết kế gốc.
6. Xác nhận bản sao test có thể được kiểm tra và publish thủ công; ghi rõ thao tác/API, job status, giới hạn gói và URL trước/sau.
7. Nếu Canva không cấp quyền/API hoặc bản publish làm đổi URL, dừng nhánh tích hợp; không thay đổi URL nhân viên hay dùng phương án thay thế khi chưa có quyết định mới của chủ cửa hàng.

## Files/modules

- Nguồn đọc: `C:/Users/khang/Downloads/COGS BETEA.xlsx` (không chỉnh sửa file nguồn).
- Artifact mới: `plans/recipe-cost-sop-canva/workbook-mapping.md`.
- Artifact mới: `plans/recipe-cost-sop-canva/canva-feasibility.md`.
- Có thể tạo tiện ích audit/import trong `scripts/` sau khi chốt parser; không đưa file workbook vào git.

## Dependencies

- Spec đã chốt; link Canva người dùng cung cấp.
- Canva account/API access cần được xác minh trước phần tích hợp. Các phase core khác có thể tiếp tục nếu Canva bị block.

## Acceptance / verification

- Mọi dòng có dữ liệu trong sheet thuộc ingredient, bases, menu và recipe được nhập vào manifest hoặc gắn trạng thái “cần mapping”; không có dòng mất không giải thích.
- Mỗi công thức mẫu có input quantities, units, yield, formula result và rounding expectation được xác định.
- Conversion khác chiều (g ↔ ml) được đánh dấu chờ density, không tự tạo hệ số.
- Canva test chạy trên design copy; mẫu gốc không đổi; account plan, OAuth, autofill fields, update job và URL result được ghi nhận.
- Nếu gate Canva không đạt, phase đánh dấu blocker rõ nhưng không chặn thiết kế cost engine; rollout Canva chưa được phép. URL nhân viên phải giữ nguyên.

## Risks / notes

- Excel có thể chứa formulas nhưng cached values cũ; phải phân biệt và đối chiếu thay vì chỉ đọc một dạng.
- Canva cập nhật thiết kế hiện có qua `update_design` được ghi là preview; khả năng phải được xác thực trực tiếp trên copy.
