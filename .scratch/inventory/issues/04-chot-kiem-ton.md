# 04: Chốt kiểm tồn và lập mốc đầu kỳ

**What to build:** Nhân viên chốt bản kiểm chỉ khi mọi mặt hàng bắt buộc đã được đếm. Lần chốt đầu tạo mốc tồn ban đầu; mỗi lần chốt ghi thời điểm cắt kỳ để phân bổ phiếu nhập.

**Blocked by:** 02 — Ghi phiếu nhập cho từng lần giao; 03 — Lưu bản kiểm tồn đang dở.

**Status:** ready-for-human

- [x] Chốt là thao tác nguyên tử và từ chối bản kiểm còn ô trống, kể cả khi ô khác được nhập số 0.
- [x] Phiếu nhập trước hoặc đúng thời điểm chốt thuộc kỳ của bản kiểm đó; nếu hàng đến sau khi một mặt hàng đã được đếm, nhân viên phải kiểm lại mặt hàng ấy trước khi chốt.
- [x] Bản kiểm đầu tiên được chốt thiết lập mốc tồn ban đầu, không suy ra tồn từ phiếu cũ hoặc ô trống.
- [x] Bản đã chốt lưu người thao tác, thời gian chốt và không cho nhân viên sửa; phiếu đã nằm trong bản kiểm chốt cũng không còn thuộc diện nhân viên tự sửa, kể cả trong hôm nay.
- [x] Kiểm tra đường gọi trực tiếp để xác nhận giới hạn quyền và điều kiện chốt được giữ tại máy chủ/cơ sở dữ liệu.

## Comments

Implementation and pgTAP boundary coverage are in place. Running the pgTAP test is pending because no local Supabase database is available in this environment.
