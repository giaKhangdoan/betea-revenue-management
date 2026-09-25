# Phase 03 — Công tơ, chi phí tháng và lợi nhuận

## Mục tiêu

Nhập chi phí tháng và số điện, xây một bộ quy tắc tính lợi nhuận nhất quán cho tháng, tuần, năm và khoảng ngày.

## Phạm vi và công việc cụ thể

1. Tạo monthly_financial_inputs và monthly_cost_adjustments: COGS từ POS, thuê mặc định 10 triệu, lương, nước theo bill, tiền điện bill tùy chọn và điều chỉnh tăng/giảm có ghi chú. Mỗi tháng/loại input chỉ có một giá trị hiện hành, sửa không nhân đôi.
2. Tạo meter_readings cho chỉ số sáng/tối từng ngày. Xác thực kWh là decimal không âm; cảnh báo chỉ số giảm so với bản ghi trước. Lưu điều chỉnh/reset có lý do và audit.
3. Tính mức dùng tháng = chỉ số tối ngày cuối − chỉ số sáng ngày đầu; tiền ước tính = kWh × 3.471đ. Nếu bill có, dùng bill làm chi phí điện thực tế; nếu chưa có bill dùng estimate. Giữ estimate, bill, chênh lệch tiền và tỷ lệ chênh lệch có dấu `(bill − estimate) / estimate × 100%` để đối chiếu; nếu estimate bằng 0, hiển thị phần trăm là không áp dụng khi bill > 0, hoặc 0% khi cả bill và estimate đều bằng 0. Không trừ cả hai.
4. Tạo domain calculation/allocation module: chi phí tháng chia theo số ngày lịch, bù rounding để tổng tháng khớp; tuần qua ranh giới tháng phân bổ từng ngày theo tháng tương ứng.
5. Tính lợi nhuận tháng = doanh thu − COGS − thuê − điện − nước − lương − chi phí phát sinh. Tuần/khoảng ngày tính lợi nhuận trước COGS, có nhãn rõ. Năm tổng hợp COGS theo từng tháng.
6. Trả trạng thái đầy đủ/chưa đầy đủ; thiếu doanh thu ngày, COGS, bill/năng lượng cần thiết, hoặc chi phí tháng không được mặc định là 0. Báo cáo năm chỉ cộng giá trị đủ dữ liệu và đánh dấu tháng còn thiếu.

## Tệp và module dự kiến

src/features/monthly-costs, src/features/electricity, src/lib/domain/profit.ts, src/lib/domain/allocation.ts, src/lib/domain/electricity.ts, src/lib/dal/monthly-financials.ts, supabase/migrations/*_monthly_financials.sql, supabase/migrations/*_meter_readings.sql.

## Phụ thuộc

Phase 02 để có doanh thu, chi phí phát sinh và chỉ số hằng ngày. COGS phải nhập đúng một lần theo tháng nguồn POS.

## Nghiệm thu / xác minh

- Thử ngày tháng có 28/29/30/31 ngày; tổng phần chia khớp đúng bill tháng sau rounding.
- Tuần cắt giữa hai tháng áp mẫu số đúng cho từng ngày.
- Kiểm tra công tơ tăng, thiếu đầu/cuối, âm do reset, bill có/không có. Bill thay estimate trong profit nhưng estimate vẫn hiện để so sánh; chênh lệch tiền và phần trăm khớp phép tính, gồm trường hợp estimate bằng 0.
- Tính đúng lợi nhuận tháng và lợi nhuận trước COGS cho tuần/khoảng ngày; thiếu input cho trạng thái incomplete, không xuất hiện profit variance.
- Tháng/năm trừ COGS theo tháng; không phân bổ COGS vào tuần.

## Rủi ro / quyết định

Chỉ số công tơ có thể reset hoặc nhập nhầm; không tự động chấp nhận delta âm. Làm tròn và nhập lại cùng tháng dễ gây sai số/nhân đôi nên cần constraint, một nguồn giá trị hiện hành và audit.

## Truy vết user story

US-06, US-07, US-09, US-10.
