# Spec: Nhật ký theo dõi điện theo ca

**Date:** 2026-10-15
**Status:** Ready

---

## Problem Statement

Màn hình nhập ngày hiện lưu chỉ số công tơ sáng/tối nhưng chưa lưu giờ ghi nhận, giờ hoạt động thiết bị hoặc xác nhận đóng ca. Chủ quán cần một nhật ký dễ nhập để đối chiếu việc sử dụng điện và phát hiện thiếu ghi nhận mà không cản trở nhân viên lưu doanh thu.

---

## User Stories

- **[P1]** Là nhân viên, tôi muốn ghi giờ và chỉ số công tơ riêng cho kỳ sáng và kỳ tối trong màn hình ngày hiện có để việc theo dõi khớp Bluebook.
  Accepted when: mỗi kỳ lưu độc lập; giờ theo múi giờ `Asia/Ho_Chi_Minh`, định dạng 24 giờ `HH:mm`; chỉ số là kWh không âm, tối đa 3 chữ số thập phân.

- **[P1]** Là nhân viên, tôi muốn ghi thiết bị nào hoạt động, thời gian bật/tắt và thiết bị còn chạy qua đêm để quản lý biết nguyên nhân tiêu thụ điện.
  Accepted when: các thiết bị đang theo dõi hiện cùng kỳ sáng/tối; thiết bị theo giờ có giờ bật/tắt; thiết bị chạy liên tục không yêu cầu nhập thời gian bật/tắt.

- **[P1]** Là nhân viên, tôi muốn hoàn thành checklist chốt ca tối và ghi chú bất thường để bàn giao rõ ràng.
  Accepted when: checklist lưu riêng trạng thái tắt thiết bị không cần thiết, kiểm tra cửa tủ mát/tủ đông và chụp ảnh công tơ; ghi chú được xem lại cùng ngày.

- **[P1]** Là nhân viên, tôi muốn lưu doanh thu ngay cả khi chưa thể hoàn tất nhật ký điện để không bị gián đoạn nhập ca.
  Accepted when: thiếu nhật ký điện không chặn lưu doanh thu; nếu chọn “Không ghi nhận được”, hệ thống yêu cầu lý do và hiển thị trạng thái cần xử lý cho admin.

- **[P1]** Là admin, tôi muốn thêm, ngừng theo dõi hoặc cấu hình thiết bị để danh sách phù hợp với cửa hàng mà không làm mất lịch sử cũ.
  Accepted when: admin có thể quản lý danh sách và loại ghi nhận; thiết bị bị ngừng theo dõi không xuất hiện trong nhật ký mới nhưng tên/cấu hình trong nhật ký cũ vẫn xem được.

- **[P1]** Là admin, tôi muốn xem tình trạng ghi nhận điện và chỉnh sửa ngày cũ để đối chiếu sổ vận hành.
  Accepted when: trạng thái kỳ sáng/tối, lý do thiếu, checklist và nhật ký thiết bị hiện trên sổ ngày; nhân viên không thể sửa ngày đã qua, admin vẫn có thể sửa theo quyền hiện có.

- **[P2]** Là admin, tôi muốn lọc ảnh công tơ trong khu ảnh ngày để tìm bằng chứng nhanh.
  Accepted when: có thể gắn nhãn ảnh công tơ và kỳ sáng/tối trong khu ảnh nhiều tệp hiện có; upload ảnh không bắt buộc để tự tick checklist.

---

## Functional Requirements

1. **FR-01 — Hai kỳ ghi nhận:** Trong trang nhập ngày hiện có, cung cấp hai kỳ sáng và tối. Mỗi kỳ có trạng thái riêng, giờ ghi công tơ, chỉ số kWh và ghi chú/bất thường. Không thay thế bốn ca doanh thu.
2. **FR-02 — Thiếu dữ liệu:** Kỳ `recorded` phải có giờ ghi và kWh; kỳ `unable` phải có lý do; không có dữ liệu là trạng thái chưa ghi. Khi nhân viên chọn không thể ghi nhận, lý do là bắt buộc. Thiếu điện không chặn lưu doanh thu; admin thấy rõ kỳ nào còn thiếu và lý do.
3. **FR-03 — Danh mục thiết bị:** Chỉ admin được thêm, sửa, sắp xếp hoặc ngừng theo dõi thiết bị. Mặc định tạo điều hòa và máy làm đá với kiểu ghi giờ bật/tắt; tủ mát/tủ đông với kiểu hoạt động liên tục. Admin có thể chọn một trong hai kiểu cho thiết bị mới.
4. **FR-04 — Nhật ký theo thiết bị:** Mỗi kỳ sáng/tối cho phép ghi trạng thái hoạt động và thời điểm bật/tắt với thiết bị kiểu theo giờ. Nếu thiết bị hoạt động qua nửa đêm, dùng ô tick có nhãn “Giờ tắt sang ngày hôm sau” để đánh dấu giờ tắt thuộc ngày kế tiếp. Thiết bị liên tục hiển thị trạng thái liên tục, không bắt nhập giờ.
5. **FR-05 — Thiết bị qua đêm:** Kỳ tối ghi rõ các thiết bị được để hoạt động sau khi đóng cửa. Kỳ sáng cho nhân viên xác nhận/ghi chú thiết bị còn hoạt động từ đêm trước. Ghi nhận cần phân biệt trạng thái dự kiến với tình trạng thực tế.
6. **FR-06 — Checklist tối:** Lưu riêng ba mục: đã tắt thiết bị không cần thiết; đã kiểm tra cửa tủ mát/tủ đông; đã chụp ảnh công tơ. Mục ảnh là tự xác nhận, không yêu cầu bằng chứng tệp đính kèm.
7. **FR-07 — Ảnh:** Tái sử dụng khu tải nhiều ảnh ngày hiện có. Bổ sung nhãn “Ảnh công tơ” và cách gắn kỳ sáng/tối nếu không làm sai metadata ca doanh thu hiện tại. Nhân viên vẫn có thể lưu nhật ký khi không tải ảnh.
8. **FR-08 — Phân quyền:** Nhân viên chỉ ghi/sửa nhật ký của ngày hiện tại; ngày đã qua chỉ xem. Admin có thể xem và hiệu chỉnh lịch sử theo quyền hiện có; mỗi lần sửa ngày cũ bắt buộc nhập lý do. Mọi kiểm tra quyền phải thực hiện phía server/database, không chỉ khóa giao diện.
9. **FR-09 — Lưu lịch sử:** Ngừng theo dõi thiết bị không xóa nhật ký cũ. Việc hiệu chỉnh của admin lưu actor, thời điểm, lý do và dấu vết trước/sau.
10. **FR-10 — Tính toán hiện tại:** Công thức tiêu thụ điện theo chỉ số công tơ, chi phí điện tháng, lợi nhuận và API GET công khai hiện có không đổi. API công khai tiếp tục chỉ trả dữ liệu công tơ/kWh, không trả ghi chú, checklist hoặc danh sách thiết bị.

---

## Non-Functional Requirements

- **Performance:** Màn hình ngày chỉ tải danh mục thiết bị đang hoạt động và nhật ký của ngày đang mở; không tải toàn bộ lịch sử điện.
- **Security:** Tài khoản nhân viên không được thêm/sửa/xóa cấu hình thiết bị. API công khai hiện có không mở rộng phạm vi dữ liệu.
- **Data integrity:** Lưu kỳ sáng không ghi đè kỳ tối và ngược lại. Nhật ký thiết bị cũ vẫn hiển thị đúng tên/kiểu tại thời điểm ghi sau khi thiết bị bị ngừng theo dõi.
- **Availability:** Lưu doanh thu không phụ thuộc việc hoàn tất checklist hoặc nhật ký thiết bị.
- **Usability:** Các mục sáng/tối nằm trong cùng màn hình nhập ngày và có trạng thái rõ “đã ghi”, “chưa ghi”, hoặc “không ghi nhận được”.

---

## Success Criteria

- [ ] Có thể ghi riêng cả giờ và chỉ số công tơ cho sáng/tối; lưu kỳ này không làm thay đổi kỳ còn lại.
- [ ] 100% mục được đánh dấu “không ghi nhận được” yêu cầu có lý do trước khi lưu.
- [ ] Nhân viên có thể lưu doanh thu khi nhật ký điện còn thiếu; admin nhìn thấy mục thiếu ngay trên sổ ngày.
- [ ] Admin thêm hoặc ngừng theo dõi thiết bị được; nhật ký lịch sử vẫn còn tên và thông tin thiết bị.
- [ ] Checklist tối lưu đủ ba xác nhận và hiển thị lại cho admin.
- [ ] Nhân viên không sửa được ngày cũ; admin sửa được theo quyền hiện tại.
- [ ] Với cùng bộ chỉ số công tơ, kết quả tiêu thụ và chi phí điện hiện tại không thay đổi.
- [ ] GET API điện công khai không trả giờ thiết bị, checklist, ghi chú hoặc dữ liệu nhân viên.

---

## Out of Scope

- Kết nối công tơ thông minh, tự đọc thiết bị hoặc tự phát hiện mức điện bất thường.
- Tự gửi thông báo Zalo/Discord; hệ thống chỉ đánh dấu dữ liệu cần admin xem.
- Bắt buộc tải ảnh mới được lưu hoặc xác thực ảnh bằng AI.
- Thay đổi công thức tính tiền điện tháng, lợi nhuận, hoặc API điện công khai.
- Theo dõi từng nhân viên cá nhân vì nhiều nhân viên đang dùng chung tài khoản.

---

## Assumptions

- Ngày nghiệp vụ và giờ ghi nhận dùng múi giờ `Asia/Ho_Chi_Minh`; giờ nhập theo 24 giờ.
- Thiết bị mặc định là điều hòa, máy làm đá, tủ mát/tủ đông; admin có thể thêm thiết bị và chọn kiểu ghi nhận.
- “Xóa” thiết bị trong giao diện có nghĩa là ngừng theo dõi/ẩn khỏi biểu mẫu mới để bảo toàn nhật ký cũ.
- Khu ảnh hiện có vẫn là nơi lưu ảnh Bluebook, vệ sinh, sắp xếp và ảnh công tơ.
- Dữ liệu theo dõi điện bổ sung bắt đầu từ ngày áp dụng; không suy đoán ngược giờ bật/tắt cho dữ liệu cũ.
- Một kỳ `recorded` cần cả giờ ghi lẫn kWh; `unable` cần lý do; trạng thái chưa ghi không ngăn lưu doanh thu.
- Giờ tắt sau nửa đêm được đánh dấu bằng ô tick “Giờ tắt sang ngày hôm sau”.
- Sửa nhật ký của ngày đã qua cần lý do và được ghi audit.

---

## Open Questions

Không còn câu hỏi nghiệp vụ chặn bước plan.
