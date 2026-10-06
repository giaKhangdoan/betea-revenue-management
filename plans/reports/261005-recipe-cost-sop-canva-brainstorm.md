# Brainstorm: Tính cost công thức và SOP đồng bộ Canva

**Ngày:** 2026-10-05<br>
**Trạng thái:** Đã chốt hướng sản phẩm; còn một số điều kiện cần xác minh trước khi lập kế hoạch triển khai.

## Mục tiêu

Thêm vào Betea một khu vực quản lý nguyên liệu, cốt/bán thành phẩm và công thức món theo size. Betea tính giá cost từ dữ liệu gốc; SOP được chỉnh sửa trên Betea, sau đó tạo bản thiết kế Canva cho nhân viên xem. Tài khoản nhân viên chỉ nhận được hướng dẫn pha chế, không nhận giá cost hay lợi nhuận.

## Những gì workbook hiện có

- `Bảng NVl` đã có nguyên liệu, nhà cung cấp, đơn vị mua và thông tin giá/đơn vị tính cost. Đây là cơ sở để chuẩn hóa giá theo g, ml hoặc đơn vị dùng trong công thức. :codex-file-citation{path="C:/Users/khang/Downloads/COGS BETEA.xlsx" purpose="source" artifact_kind="workbook" sheet="Bảng NVl" range="A13:H58"}
- `Bán Thành Phẩm` mô tả công thức cốt/bán thành phẩm và lượng thành phẩm thu được từ nguyên liệu đầu vào. :codex-file-citation{path="C:/Users/khang/Downloads/COGS BETEA.xlsx" purpose="source" artifact_kind="workbook" sheet="Bán Thành Phẩm" range="A8:K70"}
- `Menu` tổng hợp giá bán và cost theo món/size; các sheet món chứa định lượng chi tiết, gồm nguyên liệu, thành phần thêm và bao bì. :codex-file-citation{path="C:/Users/khang/Downloads/COGS BETEA.xlsx" purpose="source" artifact_kind="workbook" sheet="Menu" range="A10:N33"} :codex-file-citation{path="C:/Users/khang/Downloads/COGS BETEA.xlsx" purpose="source" artifact_kind="workbook" sheet="Hồng Trà Sữa" range="A13:T31"}
- Đã xác nhận mapping size: **S = 12oz, M = 17oz, L = 22oz**.
- Khi nhập dữ liệu cần rà soát tên nguyên liệu trùng/khác cách viết và các công thức/đơn vị chưa quy đổi được; không nên import im lặng nếu dữ liệu không khớp.

## Hướng đã chọn

**Betea là nơi quản lý dữ liệu gốc và tính cost; Canva là nơi nhân viên xem SOP.** Người quản lý sửa giá nguyên liệu, công thức, size và nội dung SOP trên Betea. Hệ thống tính lại cost theo các công thức phụ thuộc, tạo bản thiết kế từ một bản sao/template Canva; người quản lý mở và kiểm tra bản nháp rồi tự bấm Publish trong Canva. Hệ thống không tự publish.

Không chỉnh sửa thiết kế Canva gốc. Link Canva mới người dùng cung cấp là [canva.link/bgiepgr891xcw85](https://canva.link/bgiepgr891xcw85); link trước đó được thay thế. Chưa thể mở link mới bằng các kết nối hiện có nên chưa tạo được bản sao kiểm thử.

### Luồng tính cost

1. Nguyên liệu gốc lưu giá mua, lượng mua và đơn vị mua; quy đổi sang đơn vị định lượng dùng trong công thức như g, ml hoặc cái.
2. Cốt/bán thành phẩm lưu công thức đầu vào và sản lượng thành phẩm dùng được. Cost mẻ bằng tổng cost các thành phần; cost đơn vị đầu ra bằng cost mẻ chia sản lượng đầu ra.
3. Mỗi món có công thức riêng cho S/M/L. Cost món gồm cốt, nguyên liệu trực tiếp, topping và bao bì nếu có trong công thức.
4. Khi giá đầu vào, định lượng, sản lượng hoặc công thức đổi, Betea tính lại các cost phụ thuộc và trình bày chi tiết phần đóng góp của từng thành phần.
5. Betea hiển thị cost, giá bán, lãi gộp và tỷ suất lãi gộp cho quản lý. Các giá trị này không được đưa vào trang SOP dành cho nhân viên.

Ví dụ theo cấu trúc người dùng mô tả: trà khô 1 kg giá 200.000đ tương đương 200đ/g; mẻ dùng 50g có cost trà 10.000đ. Nếu mẻ thu được 200g cốt dùng được, cost trà trong cốt là 50đ/g, trước khi cộng các nguyên liệu khác.

## Các lựa chọn đã cân nhắc

| Phương án | Ưu điểm | Hạn chế | Kết luận |
|---|---|---|---|
| A. Betea quản lý dữ liệu, tạo Canva từ bản sao/template; người dùng Publish cuối | Tránh nhập cost ở nhiều nơi; SOP và cost liên kết; nhân viên tiếp tục dùng Canva | Cần quyền Canva/API phù hợp và template có trường dữ liệu; phải kiểm tra quy trình giữ URL website | **Chọn** |
| B. SOP hiển thị trên Betea, Canva chỉ làm bản xuất | Ít phụ thuộc Canva API; sửa web có hiệu lực ngay | Không đáp ứng việc nhân viên tiếp tục xem SOP tại Canva | Dự phòng kỹ thuật nếu API không khả dụng, cần người dùng chấp thuận trước khi đổi hướng |
| C. Tiếp tục dùng Excel và cập nhật Canva thủ công | Bắt đầu nhanh, không cần kết nối Canva | Dễ lệch giá/công thức và phải cập nhật nhiều nơi | Không chọn làm hướng vận hành chính |

## Khả năng Canva và giới hạn đã xác minh

- Canva có tài liệu API Autofill để tạo thiết kế từ Brand Template/thiết kế có cấu hình trường dữ liệu. Tài khoản và thiết kế phải đủ quyền; các trường dữ liệu cần được gắn đúng trong template. [Canva Autofill guide](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/) · [Create design autofill job](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/)
- Canva có API xuất thiết kế, nhưng xuất file không đồng nghĩa với publish Website. [Canva Export API](https://www.canva.dev/docs/apps/rest-apis/reference/exports/create-design-export-job/)
- Tài liệu changelog hiện ghi API Autofill có chế độ `update_design` để cập nhật trực tiếp thiết kế hiện có; tính năng này đang ở trạng thái preview. Vì vậy có thể kiểm tra trên bản sao để giữ cùng design, nhưng không xem đây là khả năng đã ổn định cho đến khi thử với tài khoản của cửa hàng. [Canva API changelog](https://www.canva.dev/docs/apps/rest-apis/changelog/)
- Trong tài liệu công khai đã xem, chưa tìm thấy API chung được tài liệu hóa để tự publish Canva Website. Vì vậy spec giữ thao tác Publish cuối cùng trong Canva như người dùng đã đồng ý. Đây là kết luận dựa trên tài liệu công khai đã rà soát, không phải xác nhận rằng mọi chương trình/đối tác Canva đều không có khả năng đó. [Canva Content Publisher intent](https://www.canva.dev/docs/apps/intents/content-publisher/implementation-guide/)
- Có thể tạo bản sao kiểm thử để bảo vệ tài liệu gốc. Việc tự động điền bản sao có thể cần biến bản sao thành template phù hợp hoặc dùng luồng API được cấp quyền; cần xác minh với chính tài khoản Canva của Betea.

## Phạm vi MVP đề xuất

- Danh mục nguyên liệu và quy đổi đơn vị.
- Công thức cốt/bán thành phẩm có sản lượng đầu ra.
- Công thức món theo S/M/L và bảng phân rã cost dễ đối chiếu.
- Chỉnh sửa hướng dẫn SOP trên Betea, tách nội dung nhân viên xem khỏi trường cost.
- Tạo bản nháp Canva từ bản sao/template, trạng thái xử lý rõ ràng và thao tác Publish cuối cùng do quản lý thực hiện.
- Nạp dữ liệu workbook có bước đối soát: ghi nhận dòng đã nhập, dòng không khớp và các giá trị cần xác nhận.

## Chưa nằm trong MVP

- Theo dõi tồn kho, nhập-xuất kho, hao hụt tồn kho hay tự trừ tồn theo số ly bán.
- Tự publish Canva Website hoàn toàn không cần thao tác của người dùng.
- Gộp cost công thức này vào sổ doanh thu/lợi nhuận hiện tại hoặc tự lấy COGS từ POS.
- Quản lý nhiều cửa hàng.

## Điều kiện cần làm rõ trước khi lập plan

1. Gói Canva “dùng bình thường” chưa cho biết tài khoản có quyền Autofill/API và có thể kết nối OAuth hay không; link Canva mới cũng chưa truy cập được từ phiên làm việc này. Cần xác minh quyền và khả năng tạo bản sao riêng trước khi cam kết đồng bộ tự động.
2. **Giả định để lập kế hoạch:** dùng một bản sao làm thiết kế SOP đích và giữ link nhân viên ổn định; bước thử tích hợp phải xác nhận điều này trước rollout. Nếu không đáp ứng, cần chủ cửa hàng chọn hướng khác trước khi đổi link.
3. **Đã chốt:** lưu lịch sử giá/công thức/cost theo thời điểm để đối chiếu; giao diện thường chỉ hiển thị cost hiện tại, cost cũ chỉ xuất hiện khi quản lý mở màn hình lịch sử.

## Bước tiếp theo

Khi các điều kiện trên được xác minh, lập kế hoạch theo thứ tự: rà soát/mapping workbook → mô hình dữ liệu và quyền → tính cost phụ thuộc → chỉnh SOP → thử Canva trên bản sao → kiểm tra quyền nhân viên và đối soát công thức.

## Quyết định bổ sung sau brainstorm — 2026-10-05

- Lịch sử giá/công thức/cost được lưu; chỉ hiện khi quản lý mở mục Lịch sử.
- Chủ cửa hàng sẽ mở và kiểm tra bản nháp Canva rồi tự bấm Publish.
- Dùng một bản sao Canva cố định và giữ URL nhân viên; nếu không thể cập nhật/publish mà giữ URL thì dừng rollout để chọn lại.
- Import các dòng Excel đã xác minh; giữ dòng lỗi/chưa rõ mapping trong danh sách chờ; chỉ đánh dấu import hoàn tất khi các dòng bắt buộc đã xử lý.
- Ngày hiệu lực giá mặc định là ngày nhập theo múi giờ cửa hàng, nhưng có thể sửa lùi theo ngày mua.
- Gói/quyền Autofill/OAuth Canva vẫn là gate kỹ thuật phải xác minh trên tài khoản trước khi bật tích hợp.
