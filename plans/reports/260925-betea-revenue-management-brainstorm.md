# Brainstorm: Website quản lý doanh thu và đối soát Betea

**Date:** 2026-09-25

## Ideas Explored

- **Sổ doanh thu theo ngày và ca:** nhập bốn khung giờ 6–10h, 10–14h, 14–18h, 18–22h; Grab và Shopee là tổng theo ngày. Đây là cấu trúc người dùng muốn giữ, nhưng trình bày trực quan hơn.
- **Theo dõi và đối chiếu Bluebook:** lưu ảnh bảng ghi tay cùng doanh thu ngày/ca, giúp xem chứng từ và chênh lệch ngay cạnh dữ liệu nhập.
- **Báo cáo theo thời gian:** màn hình chính mặc định theo tháng; có lựa chọn tuần lịch Thứ 2–Chủ nhật, năm và khoảng ngày tùy chọn. Trong từng tuần xem được các ngày.
- **Chi phí và lợi nhuận:** nhập COGS đã được hệ thống POS tính; website quản lý riêng tiền thuê, lương, điện, nước theo tháng và các khoản điều chỉnh tăng/giảm.
- **Chi phí phát sinh:** ghi từng khoản theo ngày, số tiền và lý do, ví dụ vận chuyển, mua đá hoặc sửa chữa; khoản này cộng vào đúng tuần/tháng phát sinh.
- **Nhiều ảnh minh chứng:** có thể lưu nhiều ảnh theo ngày hoặc ca và gắn nhãn Bluebook, vệ sinh, sắp xếp hoặc khác; có trạng thái xác nhận vệ sinh/sắp xếp.
- **Điện, nước và bảo mật:** ghi chỉ số điện ca sáng/tối mỗi ngày; tính tiền điện tháng theo chênh lệch đầu/cuối tháng × 3.471đ/kWh và cho sửa theo hóa đơn (có thể lệch khoảng 5%). Nước chỉ nhập theo bill tháng. Ảnh lưu riêng tư trên Supabase.
- **Hướng sản phẩm:** làm sổ quản lý và đối soát cho chủ cửa hàng trước; chưa cần tích hợp POS hoặc quy trình vận hành đầy đủ cho nhân viên.
- **Mốc ghi nhận của người dùng:** bắt đầu ngày 1/9/2026; doanh thu được ghi theo ngày/ca và tổng hợp lên các kỳ lớn hơn. Các tháng trước là số liệu giai đoạn quản lý cũ và không đưa vào lợi nhuận riêng của người dùng.
- **Cách nhập doanh thu:** chỉ lưu doanh thu cuối cùng theo từng ca và Grab/Shopee tổng ngày; bỏ giảm giá, doanh thu tiền mặt, số đơn/bill và số lượng sản phẩm.
- **Mục tiêu:** người dùng tự nhập mục tiêu doanh thu tuần/tháng và lợi nhuận tháng; phần trăm chênh giữa lợi nhuận thực tế với mức dự tính được hiển thị nhỏ, không làm KPI chính.
- **Phạm vi cửa hàng:** MVP chỉ phục vụ Betea hiện tại; chưa quản lý Deer Coffee.
- **Định hướng giao diện:** sáng, ít màu, một font xuyên suốt, bố cục phân cấp rõ ràng và thao tác dễ hiểu với người không rành công nghệ; tránh icon trang trí, bo góc quá nhiều và hiệu ứng chuyển động phô trương. Chỉ dùng icon tối giản khi giúp nhận diện thao tác.
- **Ảnh Bluebook:** ảnh mẫu chia theo hai buổi, sáng 6:30–14:00 và tối 14:00–22:00, khác với bốn khung ca doanh thu trong Excel. Vì vậy, ảnh nên được gắn tùy chọn ở cấp ngày hoặc ca, thay vì bắt buộc đúng từng khung doanh thu.
- **Mục được loại khỏi MVP theo yêu cầu:** không nhập giảm giá, tiền mặt, đơn/bill, số lượng sản phẩm hoặc NVL sắp hết. Ảnh xác nhận vệ sinh/sắp xếp vẫn được lưu cùng các ảnh Bluebook.

## User's Direction

Người dùng muốn website phục vụ quản lý và đối chiếu doanh thu. Bốn ca được nhập riêng; Grab/Shopee nhập tổng cả ngày. Màn hình chính ưu tiên doanh thu và lợi nhuận tháng, với các lựa chọn tuần, năm và khoảng thời gian. Tuần chạy từ Thứ 2 đến Chủ nhật và có danh sách ngày bên trong. Doanh thu được nhập theo ngày/ca rồi cộng lên các kỳ. COGS được nhập tổng theo tháng từ hệ thống POS và không phân bổ ra ngày. Tiền thuê và lương nhập theo tháng; tiền nước nhập từ bill tháng. Chỉ số điện ghi hai lần mỗi ngày (ca sáng và ca tối); điện tháng tính bằng (chỉ số ca tối ngày cuối tháng − chỉ số ca sáng ngày đầu tháng) × 3.471đ/kWh, sau đó cho phép chỉnh số tiền cuối cùng theo bill vì có thể lệch khoảng 5%. Các chi phí tháng được phân bổ theo số ngày lịch để xem kỳ ngắn hơn. Chi phí phát sinh được nhập theo ngày với lý do, ví dụ vận chuyển, mua đá, sửa chữa. Theo lựa chọn A, lợi nhuận tuần/khoảng ngày hiển thị trước COGS; báo cáo tháng/năm trừ COGS đầy đủ theo tháng. Workbook cũ có cách theo dõi P&L từ tháng 3; người dùng bắt đầu tự ghi nhận ngày 1/9/2026, nên số liệu trước tháng 9 thuộc giai đoạn quản lý cũ và không tính vào lợi nhuận riêng. Stack dự kiến là React/Next.js và Supabase cho backend cùng lưu trữ ảnh.

## Đối chiếu ảnh Bluebook

- **Đã có trong phạm vi website:** ngày, doanh thu, mục tiêu tuần/tháng, ghi chú sự việc, chi phí phát sinh có lý do và ảnh Bluebook.
- **Bổ sung theo ảnh và yêu cầu mới:** lưu nhiều ảnh cho ngày/ca, phân loại Bluebook/vệ sinh/sắp xếp/khác và đánh dấu trạng thái xác nhận vệ sinh, sắp xếp.
- **Bỏ theo yêu cầu:** giảm giá, doanh thu tiền mặt/ngân hàng, số đơn/bill, số lượng sản phẩm và mục NVL sắp hết.
- **Không đưa vào MVP:** danh sách nhân viên, số lượng nhân sự và giờ vào/ra trong từng ca. Mục tiêu doanh thu theo từng ca trong ảnh cũng không đưa vào vì người dùng ưu tiên target tuần/tháng; website có mục tiêu doanh thu tuần/tháng và lợi nhuận tháng.
- **Đã chốt:** lưu chỉ số điện theo ca sáng và tối mỗi ngày; dùng chênh lệch chỉ số sáng đầu tháng/tối cuối tháng × 3.471đ/kWh để ước tính bill điện; cho phép chỉnh theo bill. Nước nhập theo bill tháng.

## Risks

- Sheet Betea tháng 9/2026 ghi tổng doanh thu 36.927.684đ, nhưng sheet P&L liên kết chỉ lấy 8.932.314đ do tham chiếu sai các ô tổng tuần. Không nên mang nguyên các công thức tổng hợp này sang website.
- Dữ liệu trước tháng 9 thuộc giai đoạn quản lý cũ; dùng để so sánh lợi nhuận hoặc mục tiêu có thể làm sai lệch kết quả riêng của người dùng.
- Lợi nhuận tuần/khoảng ngày được hiển thị trước COGS; cần ghi nhãn rõ để người dùng không nhầm với lợi nhuận ròng tháng. Người dùng đã chốt cách trình bày này; chế độ tháng/năm trừ COGS tháng.
- Bluebook chia hai buổi sáng/tối trong khi doanh thu Excel chia bốn ca; cần cho phép ảnh gắn ở cấp ngày hoặc ca để tránh bắt người dùng gắn ảnh vào một khung giờ không khớp.
- Tiền điện tính từ công tơ có thể lệch khoảng 5% so với bill; cần giữ cả số ước tính và số bill đã chỉnh để không mất dấu phần chênh lệch.
