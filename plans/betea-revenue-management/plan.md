# Kế hoạch triển khai website quản lý Betea

Ngày: 25/09/2026  
Chế độ: Hard  
Risk: **high-risk** — có đăng nhập, dữ liệu tài chính, RLS, ảnh riêng tư, triển khai và sao lưu.  
Trạng thái: Ứng dụng và các luồng chính đã dựng tại workspace. Organization Supabase riêng tên Betea đã tạo trên gói Free; project trống `Betea Revenue Management` đã được chuyển vào organization Betea và hai migration đã áp dụng. Public signup đã tắt, lời mời owner đã gửi, callback email đã có. Còn chờ owner nhận lời mời để bootstrap quyền, nạp dữ liệu Excel, tạo GitHub private repo và triển khai Vercel.

## Phạm vi và điểm xuất phát

Lúc bắt đầu workspace chưa có codebase hoặc Git root; ứng dụng Next.js App Router hiện đã được khởi tạo cho duy nhất cửa hàng Betea. Bắt đầu sổ riêng từ ngày 01/09/2026; dữ liệu trước ngày này không đi vào báo cáo riêng. Không tích hợp POS, Grab/Shopee API hay tự nhập từ Zalo. COGS vẫn do chủ cửa hàng nhập theo tháng từ POS.

## Ngoài phạm vi MVP

- Không quản lý danh sách nhân viên, ca làm/chấm công, hoặc tài khoản nhân viên tự nhập dữ liệu; chỉ chủ cửa hàng đăng nhập và nhập sổ.
- Không ghi riêng tiền mặt, doanh thu trước giảm giá, giảm giá, số bill/đơn, số lượng sản phẩm, tồn kho hay nguyên liệu.
- Không đồng bộ POS, Grab, Shopee hoặc Zalo; COGS do chủ cửa hàng chép tổng tháng từ POS.
- Không đưa Deer Coffee hoặc số liệu Betea trước 01/09/2026 vào báo cáo quản lý riêng.

Spec đã khóa theo câu trả lời của chủ cửa hàng. Yêu cầu UX được chuyển thành guardrails: giao diện sáng, một font hỗ trợ tiếng Việt, ít màu, nhãn chữ rõ, icon tối giản chỉ khi có ích, góc bo vừa phải, chuyển động ngắn, không glow/parallax. Tập trung form và báo cáo dễ thao tác trên desktop lẫn màn hình nhỏ.

## Kiến trúc đề xuất

- Next.js App Router, React/TypeScript, Supabase Auth, Postgres và Storage. Dùng @supabase/ssr với browser/server client tách biệt; xác minh claims tại server data-access layer và các mutation, còn proxy chỉ làm mới phiên/điều hướng nhẹ. Không cache trang dữ liệu riêng tư.
- Tắt đăng ký công khai; chỉ cấp tài khoản chủ cửa hàng thủ công. Mỗi bảng ứng dụng có RLS, grants tối thiểu và điều kiện owner cụ thể; authenticated đơn thuần không cấp quyền dữ liệu. Không bao giờ gửi service-role key tới trình duyệt.
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

## Việc còn chờ

1. Owner nhận email mời, xác nhận tài khoản và tự đặt mật khẩu. Sau đó bootstrap đúng một dòng `owner_profiles`; không yêu cầu người dùng gửi mật khẩu.
2. Tạo GitHub repository private và đẩy mã nguồn sau khi xác nhận workbook, `.env.local` và dữ liệu seed đều bị loại khỏi commit.
3. Triển khai Vercel, thêm URL callback production vào Supabase Auth, xác minh owner login.
4. Nạp 23 ngày có số liệu từ Excel và đối chiếu số dòng/tổng nguồn; không nhập COGS/P&L cũ.
5. Hoàn thiện runbook backup/restore cho dữ liệu database và ảnh riêng tư.
6. Giới hạn ảnh là 5 MiB/tệp; ảnh lớn được nén trên trình duyệt. Mỗi lượt có thể tải tối đa 20 ảnh; không có giới hạn số lượng tích lũy ở cấp ứng dụng.

Bạn đã xác nhận Grab/Shopee được cộng ngoài bốn ca; nhập các dòng có dữ liệu trong tháng 9; vệ sinh/sắp xếp xác nhận một lần mỗi ngày. Vì vậy dữ liệu Excel sẽ nạp 23 ngày có số liệu từ 03/09 đến 25/09; ngày trống 01–02 và 26–30 không tạo dòng doanh thu. Không nhập công thức P&L cũ hoặc COGS từ workbook.

## Review rủi ro và cách xác minh khi triển khai

Rủi ro lớn nhất là phân quyền RLS sai, cộng doanh thu hai lần, biến dữ liệu thiếu thành 0, tính điện hai lần khi có bill, làm tròn lệch khi phân bổ qua ranh giới tháng và mất ảnh khi phục hồi. Các phase yêu cầu xác minh bằng ma trận anon/owner/tài khoản khác, phép tính trên tháng 28/29/30/31 ngày, tuần giao tháng, công tơ tăng/giảm, bill có/không có, ngày thiếu/đóng cửa, signed URL hết hạn và thử khôi phục ảnh.

## Session Notes

- Khởi tạo Next.js 16.3.6 / React 19.2.8 / TypeScript; Node.js hiện tại 24.17.0. Next 16 dùng `proxy.ts`; auth server-side dùng `@supabase/ssr`.
- Đã có khung đăng nhập/owner gate và giao diện sáng; ứng dụng đã kết nối project Supabase riêng. Đăng nhập hoạt động khi owner nhận lời mời và được bootstrap trong `owner_profiles`.
- Hai migration owner-only RLS, audit trigger, doanh thu theo ngày/ca, chi phí tháng/ngày, mục tiêu và private Storage bucket đã áp dụng.
- Rà soát bảo mật lần hai: signed URL hết hạn sau 5 phút; bootstrap owner thủ công; đường dẫn ảnh phải khớp owner/ngày. Storage policy ngăn xóa object còn metadata để tránh phá vỡ đối chiếu; action ghi audit trước khi dọn ảnh.
- Đã trích và đối chiếu 23 dòng doanh thu tháng 9: bốn ca 36.262.000 ₫, Grab 665.684 ₫, Shopee 0 ₫, tổng nguồn 36.927.684 ₫. Workbook gốc và dữ liệu nhập vẫn bị loại khỏi Git.
- Organization `Betea` gói Free đã tạo; project `Betea Revenue Management` trống đã chuyển từ `QuanLiStem` vào Betea. Đã áp dụng migration `initial_schema` và `audit_actor_index`; bucket `betea-evidence` private giới hạn 5 MiB/tệp.
- Public signup và anonymous sign-in đã tắt; email owner đã được mời. Chờ người dùng xác nhận lời mời và tự đặt mật khẩu; chưa có owner profile.
- Callback PKCE `/auth/callback` đã bổ sung; typecheck và lint qua. Chưa import Excel, chưa push mã nguồn hoặc deploy. Workbook và `.env.local` đang được Git ignore.

Tài liệu tham khảo chính thức: [Next.js authentication](https://nextjs.org/docs/app/guides/authentication), [Supabase SSR cho Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Vercel environments](https://vercel.com/docs/deployments/environments).
