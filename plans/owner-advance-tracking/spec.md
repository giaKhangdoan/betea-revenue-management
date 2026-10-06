# Spec: Sổ theo dõi tiền cá nhân ứng mua hàng cho Betea

**Date:** 2026-10-06<br>
**Status:** Plan complete; ready for implementation after owner validation

---

## Problem Statement

Chủ cửa hàng trực tiếp dùng tiền cá nhân để mua nguyên liệu, vật dụng, vận chuyển hoặc sửa chữa. Cần một sổ riêng để lưu số tiền đã ứng, ảnh hóa đơn, ghi chú, mặt hàng và số lượng; liên kết hàng nhập kho để không phải nhập lại. Sổ phải hỗ trợ đối chiếu các lần hoàn tiền, kể cả hoàn một phần. Một khoản mua cá nhân chỉ ảnh hưởng lợi nhuận khi admin chủ động yêu cầu ghi nhận.

Luồng chi tiền quán trong ngày vẫn là chi phí hoạt động của ngày đó. Phân loại khoản chi dựa trên nguồn tiền, không chỉ loại mặt hàng.

## User Stories

- **[P1]** Là admin, tôi muốn tạo phiếu mua bằng tiền cá nhân với ngày, tổng hóa đơn, ghi chú, nhiều ảnh và dòng mặt hàng/số lượng để có bằng chứng đối chiếu.
  - Accepted when: Phiếu lưu được nhiều ảnh; có mặt hàng, đơn vị, số lượng và số tiền từng dòng khi cần phân bổ; ảnh chỉ admin được xem.
- **[P1]** Là admin, tôi muốn dòng nguyên liệu trong phiếu liên kết với danh mục kho và tạo biến động nhập kho một lần.
  - Accepted when: Người dùng không phải nhập lại mặt hàng/số lượng ở luồng nhập kho; sửa hoặc hủy phiếu không làm kho thay đổi âm thầm và có lịch sử.
- **[P1]** Là admin, tôi muốn ghi từng lần hoàn tiền, gồm hoàn một phần, để biết còn phải đối chiếu bao nhiêu.
  - Accepted when: Số còn chờ hoàn = tổng tiền cá nhân đã ứng − tổng tiền đã hoàn; từng lần hoàn lưu ngày, số tiền, ghi chú và chứng từ tùy chọn.
- **[P1]** Là admin, tôi muốn chủ động chọn từng khoản hoặc toàn bộ chi phí không phải nguyên liệu để ghi nhận vào lợi nhuận.
  - Accepted when: Không ghi nhận tự động khi tạo phiếu; nguyên liệu mua để nhập kho chỉ được theo dõi, không được cộng vào lợi nhuận từ module này; trước khi xác nhận hiển thị các dòng/số tiền và kỳ lợi nhuận sẽ thay đổi; trạng thái ghi nhận và người/thời điểm thao tác được lưu; không thể ghi trùng.
- **[P1]** Là nhân viên, tôi muốn ghi chi phí hoạt động đã trả từ tiền bán hàng trong ngày, như tiền đá/vận chuyển, theo ngày và lý do.
  - Accepted when: Khoản này nằm trong chi phí ngày và phục vụ đối chiếu tiền mặt; không sửa doanh thu gộp và không xuất hiện trong sổ tiền cá nhân admin ứng.
- **[P1]** Là admin, tôi muốn màn hình giám sát mua hàng cho biết tháng này đã ứng bao nhiêu, đã hoàn bao nhiêu, còn chờ bao nhiêu và những món mới mua.
  - Accepted when: Chỉ trong tính năng giám sát mua hàng mới hiển thị các số ứng/hoàn/còn chờ và danh sách giao dịch gần đây; mở được chi tiết hóa đơn và chứng từ. Dashboard Tổng quan chính vẫn chỉ giữ các số doanh thu/lợi nhuận hiện tại.
- **[P2]** Là người dùng kho, tôi muốn nhập và kiểm đếm dễ hơn, thấy rõ quy đổi và nhận biết số lượng bất thường.
  - Accepted when: Giao diện làm rõ đơn vị nhập, đơn vị kho, hệ số, số lượng sau quy đổi; cảnh báo giá trị bất thường để người dùng xác nhận, không tự sửa số.

## Functional Requirements

1. **FR-01 — Phiếu ứng cá nhân:** Lưu ngày mua, người chi trả, nơi mua/nhà cung cấp tùy chọn, tổng hóa đơn, ghi chú, nhiều tệp chứng từ, trạng thái phiếu và người tạo. Phiếu bắt đầu ở dạng nháp; chỉ sau khi kiểm tra nguồn tiền và chốt mới ảnh hưởng sổ ứng/nhập kho. Nháp có thể sửa/hủy và không được hoàn tiền hoặc ghi nhận lợi nhuận.
2. **FR-02 — Dòng hàng:** Lưu tên hàng, liên kết mặt hàng kho tùy chọn, phân loại rõ `nguyên liệu` hoặc `không phải nguyên liệu`, đơn vị, số lượng, giá/tiền dòng tùy chọn. Không suy ra loại từ tên/danh mục free-text. Cho phép nhập phiếu chỉ để theo dõi dù chưa biết giá từng dòng; yêu cầu tiền dòng nhập rõ hoặc phân bổ thủ công khi muốn ghi nhận riêng lẻ vào lợi nhuận.
3. **FR-03 — Nhập kho liên kết:** Khi chốt phiếu, dòng kho có thể tạo phiếu nhập kho gắn với phiếu ứng; trước khi chốt, nháp không tạo biến động kho. Nếu phiếu nhập đã tồn tại, liên kết đúng dòng kho hiện hữu một lần sau khi kiểm tra khớp mặt hàng và số lượng quy đổi. Việc ghi/sửa/hủy phải nhất quán, chống nhập hai lần và giữ dấu vết điều chỉnh. Hiệu chỉnh sau khi mốc kiểm đã chốt phải được ghi như sự kiện có thời điểm hiệu chỉnh, không âm thầm viết lại kỳ lịch sử.
4. **FR-04 — Hoàn tiền:** Một phiếu có nhiều lần hoàn; lưu ngày, số tiền, ghi chú và chứng từ tùy chọn. Hiển thị đã ứng, đã hoàn, số dư chờ hoàn và trạng thái chưa hoàn/hoàn một phần/đã hoàn. Không cho tổng hoàn vượt tổng tiền đã ứng, kể cả khi có thao tác đồng thời. Mỗi lần gửi có idempotency key duy nhất; gửi lại cùng key trả kết quả lần đầu thay vì tạo lần hoàn thứ hai.
5. **FR-05 — Ghi nhận lợi nhuận thủ công:** Admin chọn từng khoản chi không phải nguyên liệu hoặc chọn toàn bộ các khoản đủ điều kiện; xem trước kỳ và số tiền tác động; cần xác nhận rõ ràng. Dùng ngày mua làm kỳ mặc định. Lưu liên kết để không tính lại lần nữa. Việc hoàn tiền không tự thay đổi lợi nhuận.
6. **FR-06 — Nguyên liệu và COGS:** Nguyên liệu mua bằng tiền cá nhân chỉ phục vụ theo dõi tiền ứng và nhập kho, không được đưa vào lợi nhuận từ module này. Lợi nhuận tiếp tục dùng COGS tháng do admin nhập từ POS; không cố suy đoán dòng hóa đơn nào đã nằm trong tổng COGS.
7. **FR-07 — Phân loại theo nguồn tiền và Bluebook:** Chi từ tiền quán được ghi trong chi phí ngày; nhân viên chỉ được tạo/sửa khoản chi thuộc luồng tiền quán theo chính sách hiện tại. Tiền admin tự trả chỉ admin được nhập trong sổ ứng riêng; nhân viên không được tạo, xem hoặc sửa phiếu ứng. Cùng một giao dịch không được ghi ở cả hai luồng. Doanh thu Bluebook là doanh thu gộp; khoản nhân viên ghi trên Bluebook được nhập riêng thành chi phí trong ngày, không trừ khỏi doanh thu khi đối chiếu.
8. **FR-08 — Màn hình giám sát mua hàng:** Trong tính năng giám sát mua hàng (không phải Dashboard Tổng quan chính), hiển thị các phiếu đã chốt có ngày mua trong tháng đã chọn; `đã ứng` là tổng hóa đơn của nhóm phiếu đó, `đã hoàn đến cuối tháng` là các lần hoàn cho cùng nhóm đến hết ngày cuối tháng, và `còn ứng cuối tháng` là số dư nhóm phiếu đó tại mốc này. Nháp và phiếu hủy không được tính. Dùng múi giờ cửa hàng cho ranh giới ngày để xem lại tháng cũ không đổi sau này. Màn hình này có bộ lọc riêng cho toàn bộ khoản còn chờ hoàn hiện tại ở mọi tháng. Dashboard Tổng quan chính chỉ giữ doanh thu và lợi nhuận đang có, không thêm thẻ KPI hay danh sách phiếu mua.
9. **FR-09 — Quản lý điều hướng:** Gom Nhân viên, Chi phí tháng, Báo cáo, Lịch sử vào nhóm Quản lý/Thiết lập; giữ Tổng quan, Sổ ngày, Kho làm lối vào thao tác thường xuyên.
10. **FR-10 — Bảo mật:** Chỉ admin xem/tạo/sửa phiếu ứng, giá trị hoàn tiền và ảnh chứng từ. Nhân viên chỉ ghi chi phí lấy từ doanh thu quán, không có lựa chọn hoặc API để ghi khoản admin ứng. Áp dụng quyền ở server/database, không chỉ ẩn UI. Chứng từ ứng tiền dùng metadata/route truy cập riêng với ảnh Bluebook theo ngày; URL xem cần thời hạn và quyền admin; không để bucket công khai.
11. **FR-11 — Tối ưu nhập kho:** Chỉ truy vấn lịch sử phiếu nhập/biến động khi người dùng mở phần lịch sử, không tải trước rồi chỉ gập UI. Ưu tiên tác vụ nhập/kiểm kho trước lịch sử dài. Hiển thị cảnh báo khi độ lệch lớn, hệ số hoặc đơn vị chưa xác minh; người có quyền phải xác nhận.
12. **FR-12 — Lịch sử kho bất biến:** Lịch sử biến động dùng phiên bản phiếu/bản kiểm tại thời điểm hiệu lực. Mọi đường ghi ban đầu (nhân viên tạo phiếu nhập, admin tạo phiếu mua liên kết kho, chốt bản kiểm) và mọi correction đều append snapshot trong cùng giao dịch DB. Correction sau khi chốt ghi thành sự kiện mới, có before/after, người và thời điểm; không làm kỳ trước đổi số âm thầm. Cho phép người xem thấy correction ảnh hưởng từ kỳ nào.
13. **FR-13 — Không ghi trùng nguồn tiền:** Mỗi khoản mua/chi phải xác định nguồn tiền là tiền quán trong ngày hoặc tiền admin ứng. Với khoản trùng có thể xảy ra, admin chọn bản ghi chuẩn theo nguồn tiền thực tế: nếu admin tự trả, liên kết/tái phân loại bản ghi chi ngày (giữ audit, loại hiệu lực chi phí ngày đúng một lần, link receipt có sẵn nếu có); nếu đã trả bằng tiền quán, hủy bản nháp ứng và giữ chi phí ngày làm bản ghi duy nhất. Nếu là giao dịch khác thì ghi lý do để tiếp tục. Quyết định cập nhật nguồn chi, phiếu ứng, liên kết kho và audit trong một RPC transaction có idempotency key; lỗi giữa chừng phải rollback toàn bộ. Không xóa dấu vết, không để một giao dịch cùng lúc tác động hai lần tới tài chính hoặc tạo hai biến động kho.

## Non-Functional Requirements

- **Data integrity:** Tiền dùng kiểu số chính xác; hoàn từng phần và ghi nhận lợi nhuận có ràng buộc chống ghi trùng.
- **Auditability:** Ghi người thao tác, thời gian và thay đổi quan trọng; không xóa dấu vết hoàn tiền hoặc ghi nhận lợi nhuận.
- **Security:** Tài khoản nhân viên không lấy được dữ liệu ứng tiền hoặc chứng từ qua route/API/database và không thể tạo khoản ứng admin.
- **Usability:** Nhập phiếu theo thứ tự ngày → tổng tiền/ghi chú → ảnh → mặt hàng; hỗ trợ thao tác nhanh trên điện thoại và máy tính.

## Success Criteria

- [ ] Admin tạo được nháp với nhiều ảnh và nhiều dòng mặt hàng mà không tác động số liệu; sau khi kiểm tra nguồn tiền, chốt phiếu không cần nhập lại số lượng ở luồng nhập kho.
- [ ] Hoàn nhiều lần cho ra số dư chờ hoàn chính xác.
- [ ] Tổng hoàn vượt số đã ứng bị chặn an toàn; thao tác đồng thời không thể ghi vượt; retry cùng idempotency key không tạo bản ghi hoàn mới.
- [ ] Phiếu mới không đổi lợi nhuận cho đến khi admin chủ động ghi nhận; ghi nhận theo dòng hoặc toàn bộ đủ điều kiện không làm phát sinh khoản trùng.
- [ ] Bluebook được so với doanh thu gộp trên web; chi từ tiền quán hiển thị riêng thành chi phí ngày, không bị trừ khỏi doanh thu gộp.
- [ ] Hiệu chỉnh phiếu nhập/bản kiểm đã chốt xuất hiện như sự kiện ở thời điểm hiệu chỉnh; kỳ cũ không đổi âm thầm.
- [ ] Mọi đường tạo phiếu nhập và chốt bản kiểm sau migration đều tạo snapshot ban đầu, không chỉ các đường correction.
- [ ] Giao dịch đã liên kết/tái phân loại từ chi phí ngày sang ứng cá nhân chỉ xuất hiện một lần trong lợi nhuận và tồn kho.
- [ ] Nháp và phiếu hủy không xuất hiện trong sổ ứng/lợi nhuận/kho; lỗi giữa chừng khi chốt không để lại một nửa phiếu hoặc biến động kho.
- [ ] Lỗi giả lập giữa thao tác tái phân loại không để một phía cập nhật; gửi lại cùng idempotency key không lặp việc xóa chi phí ngày hoặc nhập kho.
- [ ] Chi từ tiền cá nhân không làm giảm doanh thu gộp hay số dư tiền quán; chỉ các khoản admin chủ động ghi nhận mới ảnh hưởng lợi nhuận.
- [ ] Nhân viên bị chặn khi truy cập trực tiếp dữ liệu phiếu và URL chứng từ.
- [ ] Thử URL chứng từ Bluebook bằng phiên nhân viên không mở được ảnh hóa đơn admin.
- [ ] Mở tab Kho thường không tải toàn bộ lịch sử nhập/biến động; lịch sử chỉ được truy vấn khi mở.
- [ ] Dashboard Tổng quan chính vẫn hiển thị doanh thu/lợi nhuận như hiện tại, không có số ứng/hoàn hay danh sách phiếu mua; màn hình giám sát mua hàng riêng hiển thị các KPI và giao dịch.
- [ ] Trong màn hình giám sát mua hàng, cùng một tháng lịch sử cho cùng số dư ứng tại thời điểm cuối tháng sau khi phát sinh hoàn tiền ở tháng sau.
- [ ] Phiên nhân viên chỉ tạo chi phí từ tiền quán; không thể tạo/xem/sửa phiếu ứng cá nhân qua UI, route, RPC hoặc truy vấn database.
- [ ] Giao diện nhập/kiểm kho nêu rõ quy đổi và cảnh báo bất thường mà không tự ý thay đổi số liệu.

## Out of Scope

- Tự động chuyển tiền hoặc thực hiện hoàn ứng.
- Tự nhập dữ liệu từ POS, ngân hàng hoặc Zalo.
- Tính lại COGS POS từ hóa đơn mua hàng.
- Kế toán thuế, quản lý nhiều cửa hàng hoặc tự động khấu hao tài sản.

## Assumptions

- Betea hiện dùng COGS POS để tính lợi nhuận; mọi khoản mua nguyên liệu trong sổ ứng chỉ để theo dõi và không được ghi nhận thêm vào lợi nhuận từ module này.
- Admin có thể chọn từng khoản chi không phải nguyên liệu hoặc toàn bộ khoản đủ điều kiện; mặc định thao tác không tự lặp theo tháng.
- Loại dòng nguyên liệu/không phải nguyên liệu do admin chọn rõ khi nhập, không suy ra từ danh mục kho dạng chữ tự do.
- Dashboard tháng dùng cùng nhóm phiếu theo ngày mua và số dư chốt cuối tháng; số dư hiện tại của mọi khoản đang mở xem riêng trong màn hình sổ ứng.
- Kỳ lợi nhuận mặc định là tháng/ngày mua, kể cả khi admin ghi nhận sau đó.
- Admin là người duy nhất có quyền với sổ ứng cá nhân; nhân viên chỉ nhập chi phí thanh toán từ tiền quán trong luồng ghi sổ ngày.
- Dòng hàng liên kết kho tạo biến động nhập kho một lần, với lịch sử điều chỉnh có thể truy vết.

## Decisions Locked

1. Lưu các lần hoàn tiền riêng, có hỗ trợ hoàn một phần.
2. Liên kết phiếu mua nguyên liệu với nhập kho để tránh nhập số lượng hai lần.
3. Cho phép admin chọn từng khoản không phải nguyên liệu hoặc toàn bộ khoản đủ điều kiện để ghi nhận vào lợi nhuận; không tự động.
4. Nguyên liệu mua bằng tiền cá nhân chỉ được theo dõi/nhập kho, không tính vào lợi nhuận từ module này.
5. Doanh thu Bluebook là doanh thu gộp; chi phí phát sinh được nhập riêng và không trừ khỏi doanh thu để đối chiếu.
6. Tách chi phí trả từ doanh thu quán trong ngày khỏi khoản admin tự ứng.
7. Correction của phiếu nhập/bản kiểm đã chốt phải tạo lịch sử hiệu chỉnh có thời điểm, không viết lại kỳ đã chốt một cách âm thầm.
8. Phiếu ứng và ảnh hóa đơn dùng đường truy cập admin-only, tách khỏi luồng ảnh Bluebook nhân viên xem.
9. Lịch sử kho chỉ tải khi người dùng mở phần lịch sử.
10. Tất cả RPC ghi phiếu nhập ban đầu, tạo nhập kho từ phiếu ứng và chốt bản kiểm đều ghi snapshot phiên bản ban đầu trong cùng transaction.
11. Hoàn tiền có idempotency key bắt buộc; dashboard tháng tính ứng/hoàn/số dư trên cùng nhóm phiếu mua của tháng đó.
12. Đối chiếu khoản trùng dựa vào người thực trả: cùng giao dịch chỉ giữ một bản ghi tài chính; nếu admin tự trả thì tái phân loại khoản chi ngày và link chứng từ kho sẵn có, nếu tiền quán trả thì giữ chi phí ngày và hủy bản nháp ứng.
13. KPI phiếu mua/ứng tiền chỉ xuất hiện trong màn hình giám sát mua hàng riêng; dashboard Tổng quan chính giữ nguyên các KPI doanh thu và lợi nhuận.
