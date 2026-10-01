# 02: Ghi phiếu nhập cho từng lần giao

**What to build:** Nhân viên lập một phiếu riêng cho mỗi lần giao, thêm nhiều mặt hàng và nhập số lượng theo đơn vị lớn hoặc lẻ. Chủ và nhân viên xem được phiếu theo phạm vi ngày của vai trò mình.

**Blocked by:** 01 — Mở Kho và xem danh mục 43 mặt hàng.

**Status:** implemented; pgTAP verification pending

- [x] Mỗi phiếu có mã duy nhất, thời gian do máy chủ ghi, tài khoản tạo và ít nhất một dòng; cho phép nhiều phiếu trong cùng ngày.
- [x] Mỗi dòng giữ bản chụp đơn vị và hệ số tại lúc lưu, quy đổi chính xác sang đơn vị gốc; từ chối số âm, hệ số sai, tràn số và phần lẻ không hợp lệ cho đơn vị không chia nhỏ.
- [x] Nhân viên chỉ sửa phiếu còn đủ điều kiện trong ngày hôm nay theo ngày kinh doanh Việt Nam; chủ xem mọi ngày. Quyền này được chặn ở thao tác máy chủ và chính sách dữ liệu, kể cả khi gọi trực tiếp.
- [x] Phiếu đã nằm trước mốc chốt chỉ được chủ hiệu chỉnh với lý do; lưu các dòng cũ, người sửa và lý do trong lịch sử.
- [x] Ghi phiếu không tạo chi phí, COGS hay thay đổi lợi nhuận.
