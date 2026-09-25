# Spec: Website quản lý doanh thu và đối soát Betea

**Date:** 2026-09-25  
**Status:** Draft

## Problem Statement

Chủ cửa hàng đang dùng Excel để ghi doanh thu theo ngày, bốn ca, kênh giao hàng và theo dõi mục tiêu. Workbook cũ theo dõi P&L từ tháng 3, nhưng người dùng bắt đầu tự quản lý và ghi nhận từ tháng 9/2026; số liệu trước tháng 9 thuộc giai đoạn quản lý cũ. Cần một website riêng tư để nhập tổng doanh thu theo ca/ngày, đối chiếu Bluebook cùng ảnh vệ sinh/sắp xếp, và xem doanh thu/lợi nhuận theo kỳ.

## User Stories

- **[P1]** Là chủ cửa hàng, tôi muốn xem doanh thu và lợi nhuận tháng ngay trên màn hình chính để nắm kết quả trong một lần nhìn.
  Accepted when: màn hình chính mặc định chọn tháng hiện tại, hiển thị doanh thu, lợi nhuận, mục tiêu và phần chênh lệch so với mục tiêu.

- **[P1]** Là chủ cửa hàng, tôi muốn chọn tuần, năm hoặc khoảng ngày để xem doanh thu/lợi nhuận theo kỳ.
  Accepted when: bộ lọc tuần theo lịch Thứ 2–Chủ nhật; trong một tuần có các dòng ngày; tổng kỳ khớp với tổng các ngày thuộc kỳ.

- **[P1]** Là chủ cửa hàng, tôi muốn nhập tổng doanh thu cuối cùng của từng ca và tổng Grab/Shopee trong ngày.
  Accepted when: biểu mẫu có bốn trường doanh thu ca, hai trường doanh thu Grab/Shopee theo ngày; không yêu cầu tách giảm giá, tiền mặt, số đơn hay số sản phẩm; tổng ngày được cộng tự động và tránh cộng trùng.

- **[P1]** Là chủ cửa hàng, tôi muốn tổng doanh thu được tính tự động và đúng để đối chiếu với sổ tay.
  Accepted when: tổng doanh thu ngày bằng tổng doanh thu cuối cùng của bốn ca cộng doanh thu Grab và Shopee; không cần lưu doanh thu trước giảm, giảm giá, TC, tiền mặt, số bill/đơn hoặc số lượng sản phẩm.

- **[P1]** Là chủ cửa hàng, tôi muốn lưu nhiều ảnh minh chứng cho một ngày hoặc ca, gồm Bluebook, vệ sinh và sắp xếp.
  Accepted when: có thể tải nhiều ảnh lên cùng một ngày/ca, gắn nhãn Bluebook, vệ sinh, sắp xếp hoặc khác, xem chúng trong cùng một bộ sưu tập; trạng thái vệ sinh và sắp xếp có thể đánh dấu đã xác nhận/chưa xác nhận.

- **[P1]** Là chủ cửa hàng, tôi muốn nhập tổng COGS tháng mà hệ thống POS đã tính để website dùng chung số liệu đó khi tính lợi nhuận.
  Accepted when: số COGS được lưu theo đúng tháng nguồn POS; có thể truy vết thời điểm nhập và tránh cộng trùng khi sửa hoặc nhập lại.

- **[P1]** Là chủ cửa hàng, tôi muốn nhập tiền thuê, lương và hóa đơn nước theo tháng; tiền điện được tính từ chỉ số công tơ và có thể điều chỉnh theo bill.
  Accepted when: tiền thuê, lương, nước và các điều chỉnh lưu theo tháng; có chỉ số điện ca sáng/tối từng ngày; hệ thống tính ước tính điện tháng và cho nhập số tiền thực tế theo bill.

- **[P1]** Là chủ cửa hàng, tôi muốn ghi lại các chi phí phát sinh vào đúng ngày cùng lý do để đối chiếu theo tuần/tháng.
  Accepted when: mỗi khoản có ngày, số tiền và lý do bắt buộc; ví dụ vận chuyển, mua đá, sửa chữa; khoản chi được cộng vào các kỳ chứa ngày phát sinh.

- **[P1]** Là chủ cửa hàng, tôi muốn xem lợi nhuận tháng từ doanh thu, COGS trên POS và các chi phí tôi tự quản lý.
  Accepted when: lợi nhuận tháng = doanh thu tháng − COGS tháng từ POS − tiền thuê (mặc định 10.000.000đ) − điện − nước − lương − chi phí phát sinh; nếu khoản chi phí chưa được nhập thì trạng thái lợi nhuận được đánh dấu chưa đầy đủ thay vì coi là 0.

- **[P1]** Là chủ cửa hàng, tôi muốn theo dõi số điện và chi phí điện.
  Accepted when: ghi được chỉ số công tơ ca sáng và ca tối từng ngày; lượng điện tháng = chỉ số ca tối ngày cuối tháng − chỉ số ca sáng ngày đầu tháng; tiền điện ước tính = lượng điện tháng × 3.471đ/kWh; có thể sửa số tiền cuối cùng theo bill điện và xem số tiền/tỷ lệ chênh lệch; báo khi thiếu chỉ số đầu hoặc cuối tháng.

- **[P2]** Là chủ cửa hàng, tôi muốn đặt mục tiêu doanh thu tuần/tháng và mục tiêu lợi nhuận tháng, rồi so sánh lợi nhuận dự tính với thực tế.
  Accepted when: mục tiêu có thể nhập/chỉnh theo kỳ; doanh thu có số thực tế, mục tiêu và tỷ lệ đạt; lợi nhuận tháng có mức dự tính, số thực tế và phần trăm chênh lệch. Phần chênh lệch được trình bày nhỏ, thứ cấp; chỉ tính khi dữ liệu lợi nhuận tháng đầy đủ và mục tiêu lớn hơn 0.

- **[P2]** Là chủ cửa hàng, tôi muốn xem lại thay đổi trên các bản ghi đã chốt để hiểu lý do chênh lệch.
  Accepted when: các sửa đổi doanh thu/chi phí sau khi chốt lưu người sửa, thời điểm và giá trị trước/sau.

- **[P3]** Tích hợp POS hoặc nền tảng giao hàng để tự đồng bộ doanh thu — chưa nằm trong MVP.

## Functional Requirements

1. **FR-01:** Lưu tổng doanh thu cuối cùng theo ngày cho 4 ca 6–10h, 10–14h, 14–18h, 18–22h; lưu doanh thu Grab và Shopee theo tổng ngày; cho phép ghi chú ngày/ca về chương trình hoặc diễn biến nếu cần. Không lưu riêng giảm giá, doanh thu tiền mặt, số đơn/bill hoặc số lượng sản phẩm.
2. **FR-02:** Hiển thị trực quan doanh thu theo ca và kênh giao hàng; tổng doanh thu ngày = tổng bốn ca + Grab + Shopee. Các khoản phải được trình bày để tránh cộng doanh thu giao hàng hai lần.
3. **FR-03:** Dashboard mở mặc định ở tháng hiện tại; bộ lọc gồm tháng, tuần lịch Thứ 2–Chủ nhật, năm và khoảng ngày tùy chọn.
4. **FR-04:** Trong chế độ tuần, hiển thị tổng tuần và các ngày trong tuần; cho phép mở một ngày để xem từng ca, Grab/Shopee, các ảnh và trạng thái đối chiếu.
5. **FR-05:** Quản lý mục tiêu doanh thu tuần/tháng và mục tiêu lợi nhuận tháng; người dùng tự nhập/chỉnh số mục tiêu. Với lợi nhuận tháng, tính phần trăm chênh lệch = (lợi nhuận thực tế − lợi nhuận dự tính) ÷ lợi nhuận dự tính × 100%; chỉ tính khi lợi nhuận đã đủ dữ liệu và mục tiêu lớn hơn 0. Hiển thị phần trăm này ở vị trí thứ cấp, không nổi bật hơn KPI doanh thu/lợi nhuận chính.
6. **FR-06:** Nhập COGS theo số liệu hệ thống POS; lưu số tiền, ngày/kỳ nguồn, ghi chú và thời điểm nhập; hỗ trợ chỉnh sửa mà vẫn tránh cộng trùng.
7. **FR-07:** Lưu tiền thuê (mặc định 10 triệu), lương và hóa đơn nước theo tháng; cho phép thêm điều chỉnh tăng/giảm có ghi chú. Hóa đơn nước nhập theo bill tháng, không nhập mức dùng hằng ngày.
8. **FR-08:** Lưu chỉ số công tơ điện hai lần mỗi ngày: ca sáng và ca tối. Mức dùng điện tháng = chỉ số ca tối ngày cuối tháng − chỉ số ca sáng ngày đầu tháng; tiền điện ước tính = mức dùng × 3.471đ/kWh. Lưu riêng mức tính tự động và số tiền bill có thể chỉnh; hiển thị chênh lệch tiền và tỷ lệ so với ước tính, đồng thời cảnh báo nếu thiếu chỉ số đầu hoặc cuối tháng.
9. **FR-09:** Tải nhiều ảnh lên cho một ngày hoặc ca; mỗi ảnh có nhãn Bluebook, vệ sinh, sắp xếp hoặc khác, metadata gồm ngày, ca/kỳ tùy chọn, người tải lên và thời điểm tải lên. Lưu ảnh trong kho riêng tư.
10. **FR-10:** Theo dõi trạng thái đối chiếu doanh thu cho ngày/ca: chưa đối chiếu, chờ kiểm tra, khớp, lệch; cho phép ghi chú số lệch. Theo dõi riêng trạng thái xác nhận vệ sinh và sắp xếp.
11. **FR-11:** Từ chối truy cập dữ liệu và ảnh khi chưa đăng nhập; chỉ tài khoản chủ cửa hàng được cấp quyền trong MVP.
12. **FR-12:** Mốc báo cáo riêng của người dùng bắt đầu ngày 1/9/2026; các tháng trước không được cộng vào doanh thu, lợi nhuận, mục tiêu hoặc thống kê xu hướng của người dùng. Dữ liệu cũ chỉ được lưu riêng như tài liệu tham khảo nếu được nhập.
13. **FR-13:** Khi xem tuần hoặc khoảng ngày, phân bổ tiền thuê, lương, điện, nước và khoản điều chỉnh tháng theo số ngày lịch trong tháng (28/29/30/31); tổng phân bổ đủ tháng phải khớp chính xác số tiền tháng sau làm tròn. COGS POS vẫn ở cấp tháng và không phân bổ. Chế độ tuần/khoảng ngày hiển thị lợi nhuận trước COGS và ghi rõ; chế độ tháng/năm hiển thị lợi nhuận sau khi trừ COGS tháng.
14. **FR-14:** Cho phép ghi chi phí phát sinh theo ngày, số tiền và lý do bắt buộc (ví dụ vận chuyển, mua đá, sửa chữa); tổng hợp theo đúng ngày phát sinh.

## Non-Functional Requirements

- Performance: Dashboard tải trong dưới 2 giây ở phân vị 95 với tối đa 10.000 bản ghi ngày.
- UI/UX: giao diện sáng, phân cấp thông tin rõ, ít màu và dùng thống nhất một font; ưu tiên nhãn chữ dễ hiểu và thao tác trực tiếp cho người không rành công nghệ. Không dùng icon trang trí; nếu icon giúp nhận diện thao tác thì dùng kiểu đơn giản, tối giản và không thay nhãn chữ. Góc bo vừa phải, animation chuyển trạng thái nhẹ; tránh hiệu ứng nền, glow, parallax hoặc chuyển động phô trương. Các biểu mẫu và tải ảnh cần dễ dùng trên màn hình nhỏ.
- Security: mọi bảng dữ liệu thuộc schema truy cập từ ứng dụng phải bật RLS và giới hạn grants/policies theo thao tác; ảnh Bluebook nằm trong bucket riêng tư, chỉ tải qua phiên đã xác thực hoặc signed URL thời hạn ngắn; không gửi secret/service-role key tới trình duyệt. Tham khảo [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) và [Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).
- Availability: yêu cầu sao lưu và thời gian phục hồi mục tiêu chưa được xác định.

## Success Criteria

- [ ] 100% tổng doanh thu ngày khớp với phép cộng doanh thu cuối cùng của bốn ca + Grab + Shopee; không có trường giảm giá, tiền mặt hay số đơn bắt buộc.
- [ ] 100% tổng tuần/tháng/năm/khoảng ngày khớp với tổng các ngày thuộc phạm vi lọc.
- [ ] Lợi nhuận tháng khớp với công thức doanh thu trừ COGS POS, tiền thuê, điện, nước, lương và chi phí phát sinh; thiếu dữ liệu chi phí được gắn trạng thái chưa đầy đủ.
- [ ] Mục tiêu doanh thu tuần/tháng và lợi nhuận tháng có thể nhập, chỉnh sửa; phần trăm chênh lệch lợi nhuận dùng đúng công thức và không hiển thị như KPI chính. Không tính phần trăm khi thiếu dữ liệu hoặc mục tiêu lợi nhuận bằng 0.
- [ ] Tiền điện tính đúng theo chênh lệch chỉ số đầu/cuối tháng × 3.471đ/kWh; số tiền bill cuối cùng có thể sửa mà vẫn giữ được số ước tính và hiển thị chênh lệch để đối chiếu. Hệ thống báo thiếu chỉ số đầu/cuối. Nước nhập từ bill tháng, không có yêu cầu ghi hằng ngày.
- [ ] Tổng chi phí phân bổ theo ngày cho từng tháng khớp với tổng chi phí tháng; các tuần cắt qua hai tháng dùng đúng mẫu số ngày của từng tháng.
- [ ] 100% chi phí phát sinh có ngày và lý do; khi lọc tuần/tháng/khoảng ngày, các khoản được cộng đúng theo ngày phát sinh.
- [ ] 100% tuần được hiển thị theo Thứ 2–Chủ nhật và có thể xem từng ngày bên trong.
- [ ] Truy cập ẩn danh bị từ chối với 100% dữ liệu kinh doanh và ảnh.
- [ ] Có thể gắn nhiều ảnh Bluebook/vệ sinh/sắp xếp vào ngày hoặc ca và mở được cho người dùng đã đăng nhập có quyền.
- [ ] Bộ lọc không tính các bản ghi trước ngày bắt đầu quản lý riêng của người dùng.

## Out of Scope

- POS, Grab/Shopee API, đồng bộ tự động từ Zalo.
- Tự tính COGS từ kho nguyên liệu, định lượng công thức món hoặc tích hợp API POS.
- Quản lý danh sách nhân viên, giờ vào/ra và quy trình nhân viên tự nhập dữ liệu trong MVP; chỉ lưu ảnh minh chứng và trạng thái vệ sinh/sắp xếp.
- Tự động nhập dữ liệu Excel trước tháng 9/2026 vào báo cáo riêng của người dùng.

## Assumptions

- MVP tập trung vào cửa hàng trà sữa Betea; dữ liệu Deer Coffee trong workbook không đưa vào báo cáo của cửa hàng này.
- Người dùng chính là chủ cửa hàng; ảnh Bluebook được chủ cửa hàng tải lên.
- Mốc bắt đầu ngày 1/9/2026 đã được xác nhận.
- Dữ liệu trước tháng 9/2026 là giai đoạn quản lý cũ, không dùng làm lịch sử lợi nhuận hay mục tiêu riêng của người dùng.
- Mỗi tuần tính từ Thứ 2 đến Chủ nhật. Tuần đầu/cuối tháng vẫn hiển thị đúng ngày thuộc tháng được chọn.
- Đơn giá điện mặc định 3.471đ/kWh theo hướng dẫn mới; tiền thuê mặt bằng mặc định 10 triệu đồng/tháng.
- Mục tiêu doanh thu tuần/tháng và lợi nhuận tháng do người dùng nhập, có thể sửa; không hard-code hoặc tự lấy mục tiêu từ công thức workbook cũ.
- POS đã tính COGS; website chỉ lưu/nhập số COGS từ POS, không tính COGS từ phiếu mua hàng.
- COGS được nhập tổng theo tháng và không được phân bổ ra ngày/tuần.
- Tiền thuê, lương, tiền điện cuối cùng và nước được tổng hợp theo tháng rồi phân bổ đều theo số ngày lịch của tháng; điều chỉnh tháng đi theo cùng quy tắc. Điện có chỉ số công tơ sáng/tối hằng ngày; số tiền ước tính dựa trên chênh lệch đầu/cuối tháng và có thể chỉnh theo bill. Nước chỉ nhập bill tháng.
- Chi phí phát sinh được nhập theo ngày, không phân bổ.
- Doanh thu nhập là số cuối cùng để quản lý; không cần theo dõi giảm giá, tiền mặt, số đơn/bill, số lượng sản phẩm hoặc NVL sắp hết.
- Ảnh có thể gắn ở cấp ngày hoặc ca để phù hợp với Bluebook chia thành ca sáng/ca tối trong khi sổ doanh thu hiện có bốn khung ca; mỗi ngày/ca có thể lưu nhiều ảnh với nhãn mục đích.
- Báo cáo tuần và khoảng ngày hiển thị lợi nhuận trước COGS; báo cáo tháng và năm trừ COGS theo tháng.
- Kiến trúc dự kiến: Next.js/React; Supabase Auth, Postgres và Storage. Bật RLS trên các bảng dữ liệu truy cập từ ứng dụng, dùng bucket riêng tư cho ảnh và signed URL có thời hạn. Cần xác minh quyền/grants cùng RLS cho từng thao tác theo [tài liệu Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) trước khi triển khai.


