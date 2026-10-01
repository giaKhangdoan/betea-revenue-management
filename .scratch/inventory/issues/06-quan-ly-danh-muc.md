# 06: Quản lý danh mục

**What to build:** Chủ thêm, sửa và ngừng dùng mặt hàng trong Kho mà vẫn xem đúng lịch sử kiểm và nhập đã lưu.

**Blocked by:** 02 — Ghi phiếu nhập cho từng lần giao; 04 — Chốt kiểm tồn và lập mốc đầu kỳ.

**Status:** ready-for-human

- [x] Chỉ chủ thêm, sửa, ngừng dùng mặt hàng; hệ số quy đổi và đơn vị được kiểm tra hợp lệ ở máy chủ/cơ sở dữ liệu.
- [x] Mặt hàng ngừng dùng không nằm trong tập yêu cầu của bản kiểm tạo sau đó, nhưng vẫn xuất hiện trong bản kiểm và phiếu nhập cũ.
- [x] Đổi tên, đơn vị hoặc hệ số không viết lại giá trị và bản chụp quy đổi của lịch sử đã lưu.
- [x] Nhân viên, người không còn quyền và người chưa đăng nhập không thể thay đổi danh mục bằng gọi trực tiếp.

## Comments

Implementation and boundary coverage are in place. `npm run typecheck` and `npm run lint` pass. The full Vitest suite currently has one failure in the inventory movement cutoff test, outside this ticket. The pgTAP test was added but could not be run because the Supabase CLI is unavailable and Docker access is denied in this environment.
