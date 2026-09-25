# Phase 05 — Dashboard, báo cáo và mục tiêu

## Mục tiêu

Giúp chủ cửa hàng nắm tháng hiện tại nhanh, đồng thời xem chi tiết tuần, năm và khoảng ngày mà không hiểu nhầm kỳ thiếu dữ liệu.

## Phạm vi và công việc cụ thể

1. Tạo dashboard mặc định tháng hiện tại với doanh thu, lợi nhuận, mục tiêu và trạng thái dữ liệu; phần % chênh lệch lợi nhuận là thông tin thứ cấp.
2. Bộ lọc tháng, tuần lịch Thứ 2–Chủ nhật, năm và ngày tùy chọn. Tuần hiển thị tổng và từng ngày; mở ngày tới sổ ca, kênh giao hàng, ảnh, điện và đối soát.
3. Tạo targets: doanh thu tuần/tháng, lợi nhuận tháng; cho nhập/chỉnh. Tỷ lệ đạt doanh thu và % chênh lệch lợi nhuận = (lợi nhuận thực tế − mục tiêu lợi nhuận) ÷ mục tiêu lợi nhuận × 100%; chỉ tính khi dữ liệu đủ và mục tiêu lợi nhuận > 0. Hiển thị % chênh lệch ở vị trí thứ cấp, dưới KPI doanh thu/lợi nhuận chính.
4. Báo cáo tuần/khoảng ngày hiển thị lợi nhuận trước COGS và ghi nhãn ngay cạnh số; tháng/năm sau COGS. Không cộng dữ liệu trước 01/09/2026.
5. Báo trạng thái incomplete ở các kỳ có ngày/chi phí thiếu; năm nhận diện tháng chưa đầy đủ. Không tô màu hoặc biểu đồ gây hiểu nhầm; ưu tiên bảng ngày dễ rà.
6. Tối ưu query phân trang/server aggregation cho tối đa 10.000 bản ghi ngày; bảo đảm mọi query đều qua owner DAL/RLS, không cache dùng chung.

## Tệp và module dự kiến

src/app/(private)/dashboard/page.tsx, src/app/(private)/reports/page.tsx, src/features/reports, src/features/targets, src/components/charts-and-tables, src/lib/dal/reports.ts, src/lib/domain/report-period.ts.

## Phụ thuộc

Phases 02–04 cung cấp ngày, chi phí, attachments và công thức lợi nhuận. Nếu thiếu dữ liệu tháng thì không hiển thị profit variance như kết quả thật.

## Nghiệm thu / xác minh

- Dashboard mở tháng hiện tại; bộ lọc tuần dùng Thứ 2–Chủ nhật và tổng tuần bằng tổng ngày.
- Báo cáo tháng/năm/khoảng ngày khớp tổng dòng nguồn; tuần qua ranh giới tháng phân bổ đúng.
- Mục tiêu doanh thu tuần/tháng và lợi nhuận tháng lưu/sửa được; không tính % khi thiếu dữ liệu hoặc target bằng 0.
- Lợi nhuận trước COGS được ghi rõ; tháng/năm trừ COGS; annual chỉ tiêu rõ các tháng thiếu.
- Rà checklist UX: sáng, một font, phân cấp rõ, ít màu, nhãn chữ, thao tác nhập/sửa/filter phù hợp desktop và mobile.
- Đo dashboard ở tập dữ liệu kiểm chứng có tối đa 10.000 bản ghi ngày; thời gian tải p95 dưới 2 giây trong môi trường và cách đo được ghi lại.

## Rủi ro / quyết định

Báo cáo có thể sai nếu query bỏ ngày không kinh doanh hoặc coi ngày chưa chốt là 0. Các trạng thái phải đi xuyên từ database tới nhãn báo cáo.

## Truy vết user story

US-01, US-02, US-11; hiển thị kết quả US-09.
