# Brainstorm: Theo dõi tiền cá nhân ứng mua hàng và cải thiện kho

**Ngày:** 2026-10-06<br>
**Trạng thái:** Hướng sản phẩm đã chốt; sẵn sàng lập plan

## Mục tiêu

Tạo sổ giám sát tiền admin tự ứng để mua nguyên liệu, vận chuyển, sửa chữa và đồ dùng lẻ. Mỗi phiếu có tổng tiền, ghi chú, danh sách hàng/số lượng, nhiều ảnh chứng từ và theo dõi các lần hoàn tiền. Màn hình Tổng quan cần cho thấy những khoản/mặt hàng mới mua và tổng ứng trong tháng.

Song song, rà luồng Kho vì nhập liệu và quy đổi khó nhìn, định lượng có chỗ đáng ngờ. Đơn vị, hệ số quy đổi và lịch sử cần rõ hơn để admin phát hiện sai lệch trước khi xác nhận.

## Phân biệt hai nguồn tiền

| Nguồn tiền | Luồng ghi nhận | Tác động |
|---|---|---|
| Tiền bán hàng của quán trong ngày | Nhân viên ghi chi phí hoạt động theo ngày, số tiền và lý do (ví dụ đá/vận chuyển) | Là chi phí ngày và phục vụ đối chiếu tiền mặt; không sửa doanh thu gộp; không phải tiền cá nhân ứng |
| Tiền cá nhân admin ứng | Phiếu ứng riêng có hóa đơn/ảnh, ghi chú và dòng hàng | Cộng vào tổng ứng tháng; hoàn tiền được đối chiếu riêng; không ảnh hưởng lợi nhuận cho tới khi admin bấm ghi nhận |

Loại hàng không quyết định luồng. Ví dụ tiền vận chuyển có thể là chi từ tiền quán hoặc tiền cá nhân; cần chọn theo nguồn tiền thực tế, không ghi cùng khoản ở hai nơi.

## Quyết định đã chốt

1. Cho ghi nhiều lần hoàn tiền, bao gồm hoàn một phần; hiển thị số dư còn chờ hoàn.
2. Dòng nguyên liệu trong phiếu mua liên kết nhập kho để nhập số lượng một lần.
3. Nút lợi nhuận cho admin lựa chọn ghi từng khoản không phải nguyên liệu hoặc tất cả khoản đủ điều kiện; mặc định không tính tự động. Hiển thị kỳ/số tiền trước khi xác nhận và lưu dấu vết thao tác.
4. Nguyên liệu mua bằng tiền cá nhân chỉ được theo dõi/nhập kho, không đưa vào lợi nhuận. COGS từ POS vẫn là căn cứ tính giá vốn; không suy đoán dòng nguyên liệu hóa đơn nào nằm trong tổng COGS.
5. Doanh thu trên Bluebook là doanh thu gộp chưa trừ chi phí. Chi phí nhân viên note trên Bluebook được nhập riêng vào web; phép đối chiếu Bluebook giữ gross-to-gross.
6. Giao dịch hoàn tiền không tự tạo hoặc đảo chi phí lợi nhuận.
7. Phần ứng tiền và chứng từ chỉ dành cho admin; nhân viên không xem được qua giao diện hay API.
8. Hiệu chỉnh phiếu nhập/bản kiểm đã chốt tạo sự kiện lịch sử tại thời điểm hiệu chỉnh; không âm thầm đổi kết quả các kỳ đã chốt.
9. Lịch sử nhập kho chỉ được truy vấn khi người dùng mở khu vực lịch sử; không chỉ gập phần UI sau khi đã tải dữ liệu.

## Rà soát logic code hiện tại

- Phiếu nhập kho đang lưu mã/ngày/người tạo và dòng hàng/số lượng/đơn vị; chưa có tổng hóa đơn, ghi chú mua hàng, nhiều chứng từ, khoản hoàn tiền hay trạng thái ứng. Xem `supabase/migrations/20261001010000_inventory_receipts.sql`.
- Trang Kho của admin truyền `canCreateReceipts={false}`, còn trang nhân viên cho phép tạo phiếu. Luồng hiện tại vì vậy chưa hỗ trợ admin lập một phiếu mua từ tiền cá nhân. Xem `src/app/(private)/inventory/page.tsx` và `src/app/(staff)/staff/inventory/page.tsx`.
- Lịch sử biến động kho dùng thời điểm nhận ban đầu và dòng receipt hiện tại; correction bản kiểm đã chốt cũng giữ thời điểm chốt cũ nhưng thay số liệu. Cả hai loại correction có thể làm thay đổi kết quả kỳ lịch sử. Đây là rủi ro được xác minh tĩnh từ luồng mã; chưa xác minh dữ liệu thật có bị ảnh hưởng hay chưa. Xem `src/lib/inventory/counts.ts` và `supabase/migrations/20261002090000_inventory_optional_stock_units.sql`.
- Luồng chi phí ngày đã được tính trong lợi nhuận, nên cần ngăn cùng khoản bị ghi cả ở sổ chi phí ngày và phiếu ứng cá nhân. Chi phí ngày hiện nhập số tiền/lý do; không có liên kết giao dịch sang sổ ứng. Xem `src/app/(private)/page.tsx`, `src/app/(staff)/staff/actions.ts` và `src/components/staff/staff-expense-manager.tsx`.
- Endpoint ảnh Bluebook hiện cho phiên nhân viên xem ảnh trong phạm vi được phép; hóa đơn ứng cá nhân cần route/metadata riêng owner-only. Xem `src/app/api/evidence/[photoId]/url/route.ts` và `src/lib/storage/photo-url.ts`.
- Đơn vị và hệ số quy đổi được nhập tự do; số lượng lớn/lẻ là các trường riêng. Cần xác thực dữ liệu master và làm rõ phép quy đổi trong UI trước khi kết luận mọi sai lệch là lỗi tính toán. Xem `src/components/inventory/inventory-catalog-manager.tsx` và `src/components/inventory/inventory-receiving-panel.tsx`.
- Trang Kho tải truy vấn receipt ngay cả khi đang ở tab khác; lịch sử dài có thể tăng tải khi dữ liệu lớn. Xem `src/app/(private)/inventory/page.tsx` và `src/lib/inventory/receipts.ts`.

## Rà soát UX/UI hiện tại

- Nhập kho yêu cầu chọn danh mục/mặt hàng và xử lý nhiều đơn vị; màn hình chưa biến hệ số thành phép tính dễ kiểm chứng. Đề xuất hiển thị đơn vị nhập → đơn vị kho → số lượng sau quy đổi và cảnh báo khi kết quả khác thường.
- Khu vực lịch sử biến động dài đứng trước thao tác kiểm kho; nên cho nhập/kiểm kho tiếp cận sớm và chỉ tải lịch sử khi mở. Loader admin hiện vẫn tải tất cả phiếu/dòng/correction trên các tab; chỉ gập `<details>` không giảm query.
- Trang Tổng quan hiện tập trung doanh thu/lợi nhuận, chưa có mục theo dõi hàng mới mua hoặc tiền admin ứng. Đề xuất thẻ nhỏ: tổng ứng, đã hoàn, còn chờ và các phiếu gần đây.
- Thanh điều hướng có nhiều mục quản trị ở cùng một cấp; đề xuất gom Nhân viên, Chi phí tháng, Báo cáo, Lịch sử vào nhóm Quản lý, giữ các tác vụ hằng ngày dễ thấy.
- Form tạo phiếu mới nên ưu tiên điện thoại: thông tin tổng tiền/ghi chú, tải nhiều ảnh có thumbnail/preview, danh sách hàng với tìm mặt hàng và số lượng, trạng thái lưu rõ ràng.

## Mô hình và quy tắc đề xuất

- Tách phiếu ứng cá nhân khỏi chi phí hoạt động ngày và khỏi công thức COGS POS.
- Phiếu ứng có nhiều dòng hàng, có thể liên kết kho và tạo nhập kho một lần. Ghi nhận chi phí lợi nhuận lưu liên kết tới phiếu/dòng để chống ghi trùng.
- Hoàn tiền là các sự kiện con có ngày và số tiền; số dư là tổng ứng trừ tổng hoàn.
- Chọn “Ghi khoản đã chọn” hoặc “Ghi tất cả đủ điều kiện” cho chi phí không phải nguyên liệu; trước khi ghi hiển thị tiền và kỳ chịu ảnh hưởng. Nguyên liệu mua cá nhân chỉ để theo dõi/nhập kho và không cộng vào lợi nhuận.
- Chứng từ dùng lưu trữ riêng tư, quyền admin được áp dụng ở server/database và URL xem ảnh có thời hạn.
- Phiếu ứng có trạng thái nguồn tiền và liên kết tới khoản chi/phiếu nhập phù hợp; cùng giao dịch không thể tác động lợi nhuận qua cả hai luồng.
- Correction sau mốc kiểm chốt là sự kiện mới có before/after; lịch sử tổng hợp không được dùng dòng hiện tại gán ngược về ngày nhận ban đầu.

## Còn cần xác minh trong bước plan

- Giá từng dòng cần nhập trực tiếp khi hóa đơn có; nếu không, cần cho phân bổ một phần/tổng hóa đơn để hỗ trợ ghi nhận lợi nhuận theo từng khoản.
- Xác minh storage riêng tư hiện tại và cách sinh URL xem chứng từ; không dùng public URL cho hóa đơn.
- Xem lại lịch sử correction phiếu nhập và bản kiểm đã chốt cùng dữ liệu thực để xác định correction có làm thay đổi kỳ cũ nào không.
- Chốt cách ngăn cùng giao dịch bị ghi đồng thời trong chi phí ngày và sổ ứng; plan phải lưu nguồn tiền/liên kết để chỉ tác động lợi nhuận một lần.
- Thiết kế cơ chế transaction/constraint để tổng các lần hoàn không vượt khoản đã ứng.
- Tách route và metadata ảnh hóa đơn khỏi ảnh ngày để kiểm tra quyền admin-only; xác minh bucket/object path không public.

## Bước tiếp theo

Lập plan triển khai theo thứ tự: kiểm tra quyền/lưu trữ → thiết kế mô hình phiếu ứng, dòng hàng, lần hoàn và sự kiện lợi nhuận → liên kết nhập kho chống trùng → cải thiện form và Tổng quan → kiểm thử phân quyền, hoàn một phần, điều chỉnh kho và tính lợi nhuận.
