# Kế hoạch triển khai website quản lý Betea

Ngày: 25/09/2026
Chế độ: Hard  
Risk: high-risk — có đăng nhập, dữ liệu tài chính, RLS, ảnh riêng tư, triển khai và sao lưu.
Trạng thái: Website đã triển khai tại <https://betea-revenue-management.vercel.app>; mã nguồn ở GitHub private repo <https://github.com/giaKhangdoan/betea-revenue-management>. Organization Supabase `Betea` gói Free đang quản lý project production; migration thứ ba `daily_reconciliation_and_meter_reset` đã áp dụng ngày 26/09/2026. Public sign-up và anonymous sign-in đã tắt; owner đã xác nhận email và có đúng một hồ sơ owner. Luồng tự đặt/đặt lại mật khẩu đã triển khai. Đã nạp và đối chiếu 23 ngày có số liệu từ Excel (03/09–25/09/2026). Lợi nhuận chưa hoàn chỉnh cho tới khi nhập các đầu vào chi phí và mục tiêu còn thiếu.

## Phạm vi và điểm xuất phát

Lúc bắt đầu workspace chưa có codebase hoặc Git root; ứng dụng Next.js App Router hiện đã được khởi tạo cho duy nhất cửa hàng Betea. Bắt đầu sổ riêng từ ngày 01/09/2026; dữ liệu trước ngày này không đi vào báo cáo riêng. Không tích hợp POS, Grab/Shopee API hay tự nhập từ Zalo. COGS vẫn do chủ cửa hàng nhập theo tháng từ POS.

## Ngoài phạm vi MVP

- Không quản lý chấm công, lịch ca nhân sự, tính lương theo nhân viên hoặc nhiều cửa hàng. Role staff để nhập số liệu doanh thu theo ca được đặc tả riêng tại [kế hoạch role nhân viên](../staff-roles/plan.md); đây là phần bổ sung cho MVP, không mở quyền xem chi phí/lợi nhuận.
- Không ghi riêng tiền mặt, doanh thu trước giảm giá, giảm giá, số bill/đơn, số lượng sản phẩm, tồn kho hay nguyên liệu.
- Không đồng bộ POS, Grab, Shopee hoặc Zalo; COGS do chủ cửa hàng chép tổng tháng từ POS.
- Không đưa Deer Coffee hoặc số liệu Betea trước 01/09/2026 vào báo cáo quản lý riêng.

Spec quản lý thu chi đã khóa theo câu trả lời của chủ cửa hàng; role staff bổ sung được đặc tả tại kế hoạch riêng ở trên. Yêu cầu UX được chuyển thành guardrails: giao diện sáng, một font hỗ trợ tiếng Việt, ít màu, nhãn chữ rõ, icon tối giản chỉ khi có ích, góc bo vừa phải, chuyển động ngắn, không glow/parallax. Tập trung form và báo cáo dễ thao tác trên desktop lẫn màn hình nhỏ.

## Kiến trúc đề xuất

- Next.js App Router, React/TypeScript, Supabase Auth, Postgres và Storage. Dùng @supabase/ssr với browser/server client tách biệt; xác minh claims tại server data-access layer và các mutation, còn proxy chỉ làm mới phiên/điều hướng nhẹ. Không cache trang dữ liệu riêng tư.
- Tắt đăng ký công khai; cấp tài khoản owner và staff qua luồng server-side do admin quản lý, theo phạm vi phân quyền riêng trong kế hoạch role staff. Mỗi bảng ứng dụng có RLS, grants tối thiểu và điều kiện owner/membership cụ thể; authenticated đơn thuần không cấp quyền dữ liệu. Không bao giờ gửi service-role key tới trình duyệt.
- Lưu migrations trong repository. Bucket ảnh private, policies theo owner, đường dẫn UUID, signed URL ngắn hạn. Nén ảnh, xác thực loại/kích thước, tải nhiều ảnh có tiến độ và retry. Database backups không bao gồm Storage objects; lập backup ảnh riêng trước production.
- Mô hình hóa dữ liệu nguồn riêng; tổng ngày/tuần/tháng và lợi nhuận là giá trị tính từ dòng nguồn, không lưu lặp. Lưu tiền dưới dạng số nguyên VND, kWh dạng decimal, ngày nghiệp vụ theo Asia/Ho_Chi_Minh.

## Bất biến tài chính

1. Doanh thu ngày là tổng bốn ca + Grab + Shopee; Grab/Shopee được nhập tổng theo ngày, tách ngoài bốn ca rồi cộng vào tổng ngày.
2. Thiếu dữ liệu khác số 0. Mỗi ngày có trạng thái đang nhập, đã chốt hoặc không kinh doanh; báo cáo đánh dấu incomplete khi thiếu ngày hoặc đầu vào bắt buộc. Không hiện lợi nhuận/variance như số đầy đủ nếu dữ liệu chưa đủ.
3. Tách trạng thái chốt ngày, đối soát doanh thu và checklist vệ sinh/sắp xếp. Tuần là Thứ 2–Chủ nhật.
4. COGS nhập một tổng tháng từ POS, không chia ngày. Tuần/khoảng ngày hiển thị lợi nhuận trước COGS; tháng/năm trừ COGS theo từng tháng.
5. Thuê, lương, nước, điện phân bổ theo số ngày lịch của từng tháng. Tuần cắt qua tháng dùng mẫu số riêng từng tháng; bù phần làm tròn để tổng phân bổ cả tháng khớp chính xác.
6. Điện ước tính = (chỉ số tối ngày cuối tháng − chỉ số sáng ngày đầu tháng) × 3.471đ/kWh. Nếu có bill thì bill thay estimate trong lợi nhuận, nhưng vẫn lưu cả hai để đối chiếu. Cảnh báo thiếu hoặc giảm chỉ số công tơ.
7. Chi phí phát sinh ghi theo ngày, số tiền, lý do bắt buộc. Báo cáo năm phải đánh dấu tháng thiếu dữ liệu; không coi là 0. Excel tháng 9 có tổng nguồn 36.927.684đ nhưng tab P&L chỉ lấy 8.932.314đ do tham chiếu nhóm tổng tuần sai; không tái sử dụng công thức P&L cũ.

## Phases và truy vết stories

ID được đặt theo thứ tự stories trong spec: US-01 dashboard tháng; US-02 bộ lọc kỳ; US-03 nhập 4 ca và Grab/Shopee; US-04 tự cộng; US-05 nhiều ảnh; US-06 COGS tháng; US-07 chi phí tháng; US-08 phát sinh; US-09 lợi nhuận; US-10 công tơ; US-11 mục tiêu; US-12 lịch sử chỉnh sửa. US-13 đồng bộ POS/API ngoài MVP. RLS/Auth là yêu cầu xuyên suốt US-01–US-12.

| Phase | Phạm vi | Stories |
|---|---|---|
| phase-01-nen-tang-bao-mat | Bootstrap, login, owner-only, RLS nền, UI shell | US-01–US-12 nền tảng |
| phase-02-so-doanh-thu-chi-phi-ngay | Sổ ngày/ca, kênh giao hàng, chi phí phát sinh, trạng thái ngày | US-03, US-04, US-08 |
| phase-03-cong-to-va-loi-nhuan | Công tơ, chi phí tháng, COGS, phân bổ và công thức | US-06, US-07, US-09, US-10 |
| phase-04-anh-va-xac-nhan | Bluebook, nhiều ảnh, vệ sinh/sắp xếp | US-05 |
| phase-05-dashboard-va-muc-tieu | Tháng/tuần/năm/khoảng ngày, mục tiêu và đối chiếu | US-01, US-02, US-11 |
| phase-06-kiem-toan-va-phat-hanh | Audit, hardening, deploy, backup/restore | US-12 và kiểm soát toàn hệ thống |

## Cook Progress

- [x] Phase 01: Nền tảng và bảo mật
- [x] Phase 02: Sổ doanh thu và chi phí theo ngày
- [x] Phase 03: Công tơ, chi phí tháng và lợi nhuận
- [ ] Phase 04: Ảnh Bluebook và xác nhận vận hành — giao diện đã xác minh; chưa tải thử ảnh lên production.
- [x] Phase 05: Dashboard, báo cáo và mục tiêu
- [ ] Phase 06: Audit, hardening và phát hành

## Việc còn chờ

1. Nhập bổ sung các ngày còn thiếu nếu cần. Workbook chỉ có 23 dòng từ 03/09 đến 25/09; ngày 01–02 và 26–30 không được tự tạo thành doanh thu 0.
2. Nhập COGS POS, tiền thuê (mặc định 10 triệu, có thể chỉnh), lương, bill nước, bill điện/chỉ số công tơ và mục tiêu tháng. Chỉ khi đủ dữ liệu theo kỳ, báo cáo lợi nhuận và độ lệch mục tiêu mới có thể coi là hoàn chỉnh.
3. Hoàn thiện bản sao database/Storage độc lập và khôi phục thử. Snapshot ứng dụng trước migration đã được xác minh; chưa có kiểm thử phục hồi đầy đủ.
4. Tải ảnh Bluebook/vệ sinh/sắp xếp thật trong kỳ vận hành. Trang production đã xác minh nút chọn nhiều ảnh và trạng thái trống; chưa tải ảnh thử để tránh thêm chứng từ giả vào sổ production.
5. Supabase Advisor báo leaked-password protection đang tắt; Supabase chỉ cung cấp kiểm tra mật khẩu rò rỉ trên gói Pro trở lên. Không nâng cấp gói nếu chưa được yêu cầu.
6. Kết nối GitHub auto-deploy nếu muốn; hiện có thể phát hành production bằng Vercel CLI.

Bạn đã xác nhận Grab/Shopee được cộng ngoài bốn ca; nhập các dòng có dữ liệu trong tháng 9; vệ sinh/sắp xếp xác nhận một lần mỗi ngày. Vì vậy dữ liệu Excel sẽ nạp 23 ngày có số liệu từ 03/09 đến 25/09; ngày trống 01–02 và 26–30 không tạo dòng doanh thu. Không nhập công thức P&L cũ hoặc COGS từ workbook.

## Review rủi ro và cách xác minh khi triển khai

Rủi ro lớn nhất là phân quyền RLS sai, cộng doanh thu hai lần, biến dữ liệu thiếu thành 0, tính điện hai lần khi có bill, làm tròn lệch khi phân bổ qua ranh giới tháng và mất ảnh khi phục hồi. Các phase yêu cầu xác minh bằng ma trận anon/owner/tài khoản khác, phép tính trên tháng 28/29/30/31 ngày, tuần giao tháng, công tơ tăng/giảm, bill có/không có, ngày thiếu/đóng cửa, signed URL hết hạn và thử khôi phục ảnh.

## Session Notes

- Khởi tạo Next.js 16.3.6 / React 19.2.8 / TypeScript; Node.js hiện tại 24.17.0. Next 16 dùng `proxy.ts`; auth server-side dùng `@supabase/ssr`.
- Đã có khung đăng nhập/owner gate và giao diện sáng; ứng dụng đã kết nối project Supabase riêng. Đăng nhập hoạt động khi owner nhận lời mời và được bootstrap trong `owner_profiles`.
- Ba migration owner-only RLS, audit trigger, doanh thu theo ngày/ca, chi phí tháng/ngày/điều chỉnh, đối chiếu Bluebook và công tơ đã áp dụng.
- Rà soát bảo mật lần hai: signed URL hết hạn sau 5 phút; bootstrap owner thủ công; đường dẫn ảnh phải khớp owner/ngày. Storage policy ngăn xóa object còn metadata để tránh phá vỡ đối chiếu; action ghi audit trước khi dọn ảnh.
- Đã trích và đối chiếu 23 dòng doanh thu tháng 9: bốn ca 36.262.000 ₫, Grab 665.684 ₫, Shopee 0 ₫, tổng nguồn 36.927.684 ₫. Workbook gốc và dữ liệu nhập vẫn bị loại khỏi Git.
- Organization `Betea` gói Free đã tạo; project `Betea Revenue Management` trống đã chuyển từ `QuanLiStem` vào Betea. Migrations `initial_schema`, `audit_actor_index` và `daily_reconciliation_and_meter_reset` đã áp dụng; bucket `betea-evidence` private giới hạn 5 MiB/tệp.
- Dữ liệu đã nạp idempotent vào `daily_records`, xác minh 23 ngày từ 03/09 đến 25/09; các ngày ngoài khoảng vẫn thiếu. Tổng tháng được lưu: 36.927.684 ₫. Chưa nạp COGS, mục tiêu, bill điện/nước, công tơ, lương hay chi phí khác.
- Owner đã xác nhận email; đã kiểm tra khớp đúng một dòng `owner_profiles`. `/auth/callback`, `/auth/forgot-password`, `/auth/set-password` đã triển khai; owner tự đặt mật khẩu từ liên kết trên trang đăng nhập.
- Production đã triển khai trên Vercel; Supabase Auth Site URL và redirect allowlist chứa callback production/local cần thiết. Mã nguồn ở GitHub private; workbook và `.env.local` bị Git ignore.
- Tùy chọn minimum password length 12 và secure password change đã bật; public sign-up, anonymous sign-in tắt, email confirmation bật. HIBP leaked-password protection hiện không có trên gói Free (Supabase Security Advisor ghi nhận một cảnh báo giới hạn gói); không nâng cấp gói khi chưa có yêu cầu.
- Sau khi phát hiện production trả 404, đã sửa framework preset Vercel thành Next.js, tắt SSO protection của Vercel để owner không cần tài khoản Vercel, và triển khai lại. Đã kiểm tra production: `/` chuyển tới `/login`, trang đăng nhập/quên mật khẩu tải được, còn `/ledger` khi chưa đăng nhập chuyển về `/login`.
- Đã áp dụng migration thứ ba; xác nhận 23 dòng vẫn nguyên, RLS bật cho bảng điều chỉnh và anon không đọc được. Giao diện trắng chủ đạo, biểu đồ tuần/ngày/tháng, bộ lọc kỳ gọn và thao tác xem ảnh đã phát hành. Build production READY; phiên owner xác minh trang tổng quan, báo cáo tháng/tuần/năm/khoảng ngày và sổ ngày ở chế độ chỉ đọc.
- Còn kiểm thử khôi phục database/Storage, kiểm tra end-to-end tải/xem ảnh thật và đánh giá leaked-password protection (tính năng Supabase Pro+). Trang production hiện không có ảnh chứng từ nên chưa xác minh modal với ảnh đã lưu.
- Snapshot ứng dụng trước migration đã mã hóa và kiểm tra được; chưa có bản dump độc lập, tải bản sao Storage hoặc khôi phục thử. Full restore runbook còn là việc cần hoàn thành.
- GitHub auto-deploy chưa nối; lần phát hành giao diện mới đang dùng Vercel CLI.

Tài liệu tham khảo chính thức: [Next.js authentication](https://nextjs.org/docs/app/guides/authentication), [Supabase SSR cho Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Vercel environments](https://vercel.com/docs/deployments/environments).
