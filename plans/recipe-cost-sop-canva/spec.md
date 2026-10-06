# Spec: Tính cost công thức và SOP Canva cho Betea

**Date:** 2026-10-05<br>
**Status:** Approved

---

## Problem Statement

Chủ cửa hàng đang có dữ liệu nguyên liệu, bán thành phẩm và công thức món theo size trong Excel, nhưng cần một nơi duy nhất để cập nhật và xem cost được tính lại nhất quán. Người quản lý muốn sửa SOP trên Betea và đưa hướng dẫn sang Canva cho nhân viên xem, trong khi giá cost và lợi nhuận vẫn chỉ dành cho quản lý.

## User Stories

- **[P1]** Là quản lý, tôi muốn nhập giá và đơn vị mua của nguyên liệu để Betea tính giá theo đơn vị định lượng trong công thức.
  Accepted when: Một nguyên liệu mua theo kg có thể quy đổi sang g; hệ thống hiển thị phép quy đổi và cost trên mỗi đơn vị, không làm mất giá trị gốc đã nhập; ngày hiệu lực mặc định là ngày nhập và có thể chỉnh lùi về ngày mua.

- **[P1]** Là quản lý, tôi muốn khai báo công thức và sản lượng của cốt/bán thành phẩm để biết cost trên mỗi g/ml thành phẩm.
  Accepted when: Tổng cost mẻ bằng tổng lượng từng thành phần nhân với unit cost; cost đơn vị đầu ra bằng tổng cost mẻ chia cho sản lượng dùng được.

- **[P1]** Là quản lý, tôi muốn xem và chỉnh công thức món riêng cho S, M, L để so sánh cost với giá bán.
  Accepted when: Size map cố định ban đầu là S=12oz, M=17oz, L=22oz; từng size hiển thị định lượng và cost theo từng nguyên liệu/cốt, topping và bao bì đã cấu hình.

- **[P1]** Là quản lý, tôi muốn thay giá nguyên liệu hoặc công thức và thấy các cost phụ thuộc được tính lại.
  Accepted when: Một lần lưu cập nhật các cost bị ảnh hưởng theo đồ thị công thức; lỗi thiếu giá, đơn vị không tương thích hoặc vòng lặp công thức được báo rõ và không lưu kết quả cost sai như dữ liệu hợp lệ.

- **[P1]** Là quản lý, tôi muốn chỉnh hướng dẫn pha chế trên Betea và tạo bản SOP Canva từ một bản sao riêng.
  Accepted when: Thiết kế gốc không bị thay đổi; Betea hiển thị trạng thái bản nháp Canva, lỗi đồng bộ và liên kết thiết kế; người quản lý mở và kiểm tra bản nháp trong Canva rồi tự bấm Publish. Hệ thống không tự publish.

- **[P1]** Là nhân viên, tôi muốn xem SOP và định lượng pha chế rõ ràng theo size.
  Accepted when: Nhân viên xem được bước pha chế/định lượng cần thiết nhưng không nhận được giá nguyên liệu, cost, lãi gộp hoặc tỷ suất lãi qua UI, API hay dữ liệu Canva.

- **[P2]** Là quản lý, tôi muốn nhập workbook hiện tại để tránh dựng lại toàn bộ công thức.
  Accepted when: Hệ thống tạo báo cáo đối soát số dòng nhập thành công, số dòng cần mapping và lỗi; không âm thầm bỏ qua giá trị hoặc dòng công thức.

- **[P2]** Là quản lý, tôi muốn xem lịch sử thay đổi giá, công thức và cost để đối chiếu khi cần.
  Accepted when: Mỗi phiên bản lưu thời điểm, người thao tác, dữ liệu giá/công thức và cost được tính tại phiên bản đó; màn hình thông thường chỉ hiển thị cost hiện tại, cost cũ chỉ hiển thị trong màn hình lịch sử.

## Functional Requirements

1. **FR-01 — Nguyên liệu:** Lưu tên, nhà cung cấp tùy chọn, đơn vị mua, lượng mua, giá mua, đơn vị cost và quy đổi. Hỗ trợ đơn vị khối lượng, thể tích và đơn vị đếm; cấm quy đổi khác chiều nếu chưa có quy tắc được quản lý khai báo.
2. **FR-02 — Bán thành phẩm:** Lưu thành phần đầu vào, định lượng, đơn vị và sản lượng đầu ra sử dụng được. Cost mẻ là tổng cost thành phần; cost trên đơn vị đầu ra là cost mẻ chia sản lượng.
3. **FR-03 — Công thức món:** Lưu phiên bản công thức riêng cho S/M/L. Hỗ trợ dùng nguyên liệu gốc, bán thành phẩm, topping và bao bì; hiển thị dòng cost và tổng cost từng size.
4. **FR-04 — Giá bán và lãi gộp:** Cho phép nhập giá bán theo size; hiển thị cost, lãi gộp = giá bán − cost và tỷ suất lãi gộp cho quản lý.
5. **FR-05 — Tính lại phụ thuộc:** Khi nguyên liệu/công thức/sản lượng đổi, tính lại toàn bộ bán thành phẩm và món phụ thuộc. Lưu dữ liệu theo đơn vị chuẩn và quy tắc làm tròn hiển thị nhất quán.
6. **FR-06 — Kiểm tra công thức:** Chặn hoặc đánh dấu rõ giá thiếu, đơn vị không hợp lệ, lượng âm, sản lượng bằng 0 và chu trình phụ thuộc; không trình bày cost chưa đủ dữ liệu như cost hoàn chỉnh.
7. **FR-07 — SOP:** Cho phép quản lý sửa tên món, size, nguyên liệu/định lượng dùng cho pha chế, thứ tự bước, ghi chú và nội dung hướng dẫn. Nội dung nhân viên xem không chứa trường giá/cost/lợi nhuận.
8. **FR-08 — Canva:** Chỉ sau khi xác minh quyền truy cập, tạo/cập nhật bản thiết kế tách biệt với mẫu gốc; dùng trường dữ liệu được template hỗ trợ; theo dõi trạng thái tác vụ và lỗi. Quản lý phải mở và kiểm tra bản nháp trong Canva rồi tự bấm Publish; hệ thống không tự publish.
9. **FR-09 — Phân quyền:** Chỉ role quản lý được truy cập danh mục giá, công thức cost, báo cáo cost và thao tác tạo/publish SOP. Nhân viên chỉ truy cập phần SOP được phép; bảo vệ ở backend/database/API, không chỉ ẩn thành phần giao diện.
10. **FR-10 — Nhập workbook:** Hỗ trợ mapping dữ liệu trong `COGS BETEA.xlsx`; lưu kết quả đối soát và yêu cầu xử lý các tên/đơn vị chưa khớp trước khi đánh dấu nhập hoàn tất.
11. **FR-11 — Phiên bản và lịch sử cost:** Ghi người sửa, thời điểm, dữ liệu giá/công thức và cost được tính ở mỗi phiên bản, cùng trạng thái Canva. Màn hình tính cost và báo cáo thông thường chỉ hiển thị phiên bản hiện tại; chỉ màn hình lịch sử mới hiển thị cost/giá trị cũ. Bản publish đang dùng phải phân biệt với bản nháp chưa publish.
12. **FR-12 — Không ảnh hưởng sổ thu chi:** Module recipe costing độc lập với COGS tổng tháng nhập từ POS và không tự sửa số liệu sổ thu chi hiện có.

## Non-Functional Requirements

- **Performance:** Với workbook hiện tại sau khi mapping xong, thay đổi một giá nguyên liệu phải hiển thị cost phụ thuộc mới trong tối đa 2 giây ở điều kiện hoạt động bình thường.
- **Security:** Kiểm tra quyền trên server/database; nhân viên không thể lấy trường cost bằng cách gọi trực tiếp API hoặc đổi route. Không gửi dữ liệu cost sang thiết kế Canva dùng cho nhân viên.
- **Data integrity:** Tính toán dùng số thập phân chính xác cho tiền và định lượng; chỉ làm tròn ở nơi hiển thị theo một quy tắc thống nhất.
- **Availability:** Lỗi Canva không làm mất thay đổi đã lưu trên Betea; người quản lý có thể xem trạng thái lỗi và thử đồng bộ lại.
- **Auditability:** Các thay đổi giá và công thức có người thực hiện, thời gian và dữ liệu phiên bản để truy vết.

## Success Criteria

- [ ] Tất cả dòng workbook thuộc nguyên liệu, bán thành phẩm, menu và sheet công thức đều được nhập hoặc được ghi rõ vào danh sách cần mapping; không có dòng bị bỏ qua âm thầm.
- [ ] Cost của ít nhất 5 công thức đại diện ở cả S/M/L đối chiếu với Excel theo quy tắc làm tròn đã thống nhất; mọi sai khác đều có giải thích được.
- [ ] Thay đổi giá của một nguyên liệu cập nhật đúng cost tất cả bán thành phẩm và món phụ thuộc trong ≤2 giây với tập dữ liệu workbook hiện tại.
- [ ] Quản lý xem được breakdown cost và lãi gộp theo từng size; nhân viên không đọc được các trường này qua giao diện, API hoặc Canva.
- [ ] Tạo và cập nhật được bản Canva thử nghiệm mà không làm thay đổi mẫu gốc; người quản lý có thể kiểm tra rồi bấm Publish cuối cùng.
- [ ] Khi Canva/API lỗi hoặc thiếu quyền, nội dung đã lưu trên Betea vẫn còn và trạng thái lỗi có thể nhận biết.

## Out of Scope

- Theo dõi tồn kho, đặt hàng, trừ kho theo doanh số, kiểm kê hoặc dự báo hao hụt.
- Tự publish Canva Website hoàn toàn không cần người thao tác.
- Tự đồng bộ doanh số từ POS hoặc ghi đè COGS theo tháng trong sổ thu chi.
- Multi-store, phân tích cost theo chi nhánh hoặc kế toán thuế.

## Assumptions

- Betea là nguồn dữ liệu chuẩn cho giá hiện tại, công thức và SOP; Excel là nguồn nhập ban đầu.
- Mapping size ban đầu là S=12oz, M=17oz, L=22oz.
- Canva vẫn là nơi nhân viên mở xem SOP; quản lý chấp nhận một bước Publish thủ công sau khi xem bản nháp.
- Giá cost hiện tại được tính lại khi dữ liệu đầu vào thay đổi; các phiên bản cost cũ được giữ để đối chiếu và chỉ hiện khi người quản lý mở lịch sử.
- Tính cost này không thay thế số COGS tháng lấy từ POS trong sổ thu chi.
- Mẫu Canva gốc được giữ nguyên. Dùng một bản sao riêng làm thiết kế SOP đích và giữ nguyên link cho nhân viên; nếu Canva không cho cập nhật/publish mà vẫn giữ link, dừng rollout để chủ cửa hàng chọn hướng khác.
- Import workbook được chia phần: nạp các dòng đã xác minh, đưa dòng còn thiếu mapping vào danh sách chờ; không đánh dấu import hoàn tất cho tới khi các dòng bắt buộc đã được xử lý.

## Integration Gates

- Trước khi phát triển phần Canva, kiểm tra link `https://canva.link/bgiepgr891xcw85`, quyền Autofill/OAuth và tạo bản sao riêng. Nếu thiếu quyền, dừng phần tích hợp để xin quyền cần thiết; không chỉnh hoặc publish mẫu gốc.
- Trước rollout, xác minh cập nhật và publish bản sao giữ đúng URL nhân viên cần dùng. Nếu Canva không giữ được URL hoặc chỉ có thể tạo thiết kế mới, dừng trước khi đổi link nhân viên; chủ cửa hàng đã chốt không chấp nhận tự đổi link.
