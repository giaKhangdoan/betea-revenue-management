# Kế hoạch triển khai role nhân viên Betea

Ngày: 26/09/2026  
Mode: Hard  
Risk: high-risk — thay đổi xác thực, RLS, schema tài chính, Storage riêng tư và luồng cấp tài khoản.  
Trạng thái: Phase 01–05 đã triển khai và kiểm chứng trên local; các migration staff đã áp dụng production tới `staff_policy_hardening`; ứng dụng đã được push lên `main` và deploy production. Chưa tạo membership staff production vì chưa cần cấp tài khoản thật.

## Scope challenge

- **Exists?** App đã có ledger, ảnh nhiều tệp, chi phí, báo cáo và audit cho owner; role staff chưa có. Auth, layout, server actions, policies và đường dẫn Storage hiện đều giả định người đăng nhập là owner.
- **Minimum?** Thêm một role staff cố định và một tài khoản dùng chung do admin quản lý; chỉ đọc doanh thu theo ngày trong tuần hiện tại; nhập/sửa/xóa mềm dữ liệu của hôm nay; giữ toàn bộ chi phí, lợi nhuận, đối soát và xác nhận vận hành ở phía admin.
- **Complexity?** Hard. Thay đổi chạy xuyên DB/RLS, Auth Admin, Next.js server actions, UI, Storage và kiểm tra phát hành.

## Spec quality check

- `[NEEDS CLARIFICATION]`: không còn.
- User stories P1/P2/P3: có; phạm vi P3 đã ghi out of scope.
- Acceptance criteria: kiểm tra được theo role, ngày nghiệp vụ, loại dữ liệu và khả năng truy cập trực tiếp.
- Đã xử lý mâu thuẫn ảnh: staff được tải ảnh Bluebook/vệ sinh/sắp xếp; chỉ admin đánh dấu xác nhận.
- **Verdict: PASS**; các quyết định còn mở đã được chủ cửa hàng chốt ở cuối phiên brainstorm.

## Risk classification

**Risk: high-risk** — sai membership/RLS có thể lộ doanh thu hoặc thông tin admin; sai migration có thể làm lệch ledger; sai quyền Auth/Storage có thể cho phép người ngoài cửa hàng truy cập.

## Tình trạng hiện tại và các ràng buộc

Ứng dụng chạy Next.js 16.3.6, React 19.2.8, Supabase JS 2.117.2 và `@supabase/ssr` 0.12.7. Owner truy cập qua `getOwnerAccess()`/`requireOwnerClient()` và private layout. Bảng `daily_records` trộn doanh thu, chỉ số điện với xác nhận vệ sinh, đối soát, trạng thái ngày và ghi chú admin. `daily_expenses`, `day_photos`, cost/target tables và audit hiện là owner-only. Bucket ảnh private đã hỗ trợ chọn nhiều ảnh; policy và object path đang gắn với Auth UID owner.

Kế hoạch này mở rộng `plans/betea-revenue-management/plan.md`; dòng “không có tài khoản staff” ở plan cũ được thay bằng phạm vi staff trong `spec.md` này. Không thay đổi tài khoản owner, cách tính lợi nhuận/điện tháng hay báo cáo owner ngoài việc cập nhật truy vấn để đọc các trường admin đã tách.

## Hướng kiến trúc được chọn

Giữ **một nguồn chuẩn** cho dữ liệu ngày. Tách `daily_records` thành phần dữ liệu vận hành an toàn mà staff được phép đọc theo RLS và một bảng chi tiết admin-only cho đối soát, vệ sinh/sắp xếp, ghi chú/trạng thái và thông tin reset công tơ. Chuyển dữ liệu đang có sang bảng admin-only trước khi bật staff access; không tạo hàng chờ phê duyệt hoặc bản sao doanh thu thứ hai. Các thao tác staff chỉ ghi qua cột được cấp quyền rõ ràng hoặc RPC allowlist; không cấp table-wide `INSERT`/`UPDATE`, không dùng upsert nguyên hàng của ledger admin. RLS và RPC/column grants đều kiểm tra active membership cùng ngày nghiệp vụ.

Không cấp staff `SELECT` trên `daily_records` khi các cột admin cũ còn ở đó. Rollout schema theo hai nhịp: migration tương thích tạo/bơm dữ liệu admin-only; deploy owner app đọc/ghi bảng admin-only; sau khi kiểm tra, migration tiếp theo bỏ bản cột nhạy cảm cũ và mới mở RLS staff trên phần daily safe. Trong giai đoạn tương thích, mọi route vẫn owner-only.

`store_memberships` liên kết Auth user staff với `owner_id` cửa hàng Betea và trạng thái active. Mọi truy cập staff xác định cửa hàng qua membership được lưu trong DB; không lấy owner ID hoặc role từ FormData/user metadata. Supabase RLS giới hạn theo membership và ngày; Server Actions/DAL kiểm tra role và validate payload riêng. Nếu dùng RPC qua Supabase API, chỉ expose function cần thiết, grant `EXECUTE` tối thiểu, và harden `SECURITY DEFINER` bằng `search_path = ''` cùng schema-qualified references; không để endpoint RPC callable có quyền rộng hơn allowlist.

Staff chỉ thấy dòng doanh thu theo từng ngày từ Thứ 2 đến Chủ nhật hiện tại, không trả hoặc render tổng tuần/tháng/lợi nhuận. Vì từng doanh thu ngày được hiển thị, người dùng có thể tự cộng bằng tay; kế hoạch chỉ bảo đảm app/API không tạo hoặc hiển thị chỉ số tổng đó.

## So sánh hướng đã xem

| Hướng | Kết quả | Vì sao |
|---|---|---|
| Tách trường admin khỏi phần dữ liệu ngày staff-safe, membership + RLS | **Chọn** | Bảo vệ trường nhạy cảm ngay ở schema/DB và vẫn giữ một nguồn dữ liệu cho ledger hiện tại. Cần migration cùng cập nhật màn hình admin đọc phần chi tiết mới. |
| Giữ nguyên hàng trộn trường và chỉ đọc/ghi qua RPC hẹp | Dự phòng | Ít chuyển dữ liệu hơn, nhưng mọi RPC phải duy trì allowlist và function đặc quyền dễ sai; xóa mềm các giá trị theo ca khó gọn. Chỉ dùng nếu tách schema phát sinh rủi ro tương thích lớn. |
| Ẩn trường trên giao diện hoặc chỉ thêm page guard | Loại | Không ngăn gọi API, Server Action trực tiếp hay đọc bảng qua Supabase Data API. |
| Inbox staff rồi admin duyệt/chuyển sang ledger | Loại | Tạo nguồn số liệu thứ hai và workflow duyệt không được yêu cầu; có nguy cơ báo cáo admin và form staff lệch nhau. |

## Phases

| Phase | Mục tiêu | Stories |
|---|---|---|
| [Phase 01 — Ranh giới dữ liệu và membership](phase-01-data-boundary-membership.md) | Tách trường admin, membership, migration và RLS nền | US-01, US-07, US-08 — P1 |
| [Phase 02 — Quản lý tài khoản staff](phase-02-staff-account-management.md) | Admin tạo/sửa/reset/khóa tài khoản dùng chung | US-01 — P1 |
| [Phase 03 — Nhập liệu cuối ca và khóa ngày](phase-03-staff-entry-workflow.md) | Nhập bốn ca, kênh giao hàng, bill, điện thô, phát sinh; soft delete | US-02–US-05 — P1 |
| [Phase 04 — Dashboard và ảnh chứng từ](phase-04-staff-dashboard-evidence.md) | Màn hình tuần staff, ảnh private, admin thấy cập nhật và xác nhận | US-06–US-08 — P1; US-09 — P2 |
| [Phase 05 — Audit, hardening và phát hành](phase-05-security-rollout.md) | Kiểm tra quyền, migration production và phát hành an toàn | US-01–US-09 — P1/P2 cross-cutting |

## Trạng thái thực hiện

- [x] Phase 01 — Ranh giới dữ liệu và membership
- [x] Phase 02 — Quản lý tài khoản staff
- [x] Phase 03 — Nhập liệu cuối ca và khóa ngày
- [x] Phase 04 — Dashboard staff và ảnh chứng từ
- [x] Phase 05 — Audit, hardening và phát hành

## Quyết định đã chốt

1. **Tài khoản staff:** admin tạo tài khoản, đặt/cấp thông tin đăng nhập email và mật khẩu cho nhân viên; không có tự đăng ký hay tự cấp quyền. App không hiển thị lại mật khẩu cũ; admin có thể đặt lại khi cần.
2. **Dữ liệu của tuần khi bật role:** staff xem các số liệu an toàn đã có của tuần hiện tại, không chỉ dữ liệu nhập sau ngày phát hành; ngày đã qua chỉ xem.
3. **Khôi phục mục đã xóa:** xóa staff là xóa mềm có audit; admin có thể xem lịch sử và khôi phục từng ca hoặc chi phí phát sinh đã xóa.

## Risks and mitigations

- **Critical — đọc nhầm trường nhạy cảm:** tách admin-only detail trước khi cấp quyền; chạy ma trận anon/staff/admin trên Data API, Server Actions, routes và Storage.
- **Critical — khóa ngày chỉ ở UI:** tính ngày theo `Asia/Ho_Chi_Minh`; enforce server/DB để staff chỉ ghi ngày hiện tại trước 00:00, admin được sửa ngày cũ.
- **High — mất hoặc nhân đôi dữ liệu khi tách bảng:** migration có đối chiếu trước/sau theo ngày và tổng tiền; rollout theo thứ tự backward-compatible; chưa bỏ bản cột cũ hoặc bật staff cho tới khi owner ledger đọc đúng từ bảng admin-only và dữ liệu đã đối chiếu.
- **High — role không thu hồi ngay:** mọi policy/action kiểm tra membership `active`; vô hiệu membership chặn data ngay cả khi JWT cũ còn hạn; sau đó xử lý Auth session/account ở server.
- **High — cộng đơn đồng thời:** `+N` dùng một thao tác DB nguyên tử; nhập tổng cuối ngày là lệnh thay thế riêng. Tổng bill all-channel vẫn nhập tay, không tính từ đơn nền tảng.
- **High — ảnh và audit theo shared login:** policy Storage kiểm tra membership/ngày/nhóm ảnh; audit hiển thị “Nhân viên (tài khoản dùng chung)” và không nhận là biết cá nhân.
- **High — service-role key:** chỉ dùng trong module server-only cho admin Auth provisioning; không có prefix `NEXT_PUBLIC_`, không trả giá trị về browser, yêu cầu secret cấu hình riêng ở Vercel trước khi bật chức năng.
- **High — public signup:** config local đặt `auth.enable_signup = false` và vẫn bật đăng nhập email; trước khi bật staff trên hosted Supabase, xác nhận mục Auth General cũng tắt đăng ký người dùng mới. Auth Admin do server gọi vẫn tạo tài khoản được.
- **Data protection:** Supabase database backup không bao gồm Storage objects; giữ bucket private và bổ sung kiểm tra backup/restore ảnh vào runbook hiện có.

## Handoff checklist

- [x] Hoàn thành từng phase theo thứ tự; không bật membership staff production trước khi kiểm tra RLS/Storage.
- [x] Đặt `SUPABASE_SERVICE_ROLE_KEY` ở Vercel server-side; public signup vẫn tắt và Email/Password sign-in vẫn bật.
- [x] Cập nhật `feature_list.json` theo đúng phase IDs trong file này.
- [x] Xác minh app build/typecheck/lint, ma trận quyền, migration production và release production.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-09-27 01:15 Asia/Ho_Chi_Minh
**Phase in progress:** none — phase-01 through phase-05 complete
**Status:** Phase 01–05 đã hoàn tất; local Supabase reset/pgTAP/advisors và production migration/advisors đã kiểm tra. App build/lint/typecheck/test pass; `main` đã push và Vercel production đã Ready. `SUPABASE_SERVICE_ROLE_KEY` đã được cấu hình dạng Secret ở Production; chưa tạo membership staff thật.

### Decisions made this session
- Giữ `daily_records` làm nguồn doanh thu; chuyển trường admin sang side table trước khi cấp staff.
- Các migration staff đã được áp dụng tuần tự vào project Supabase production và kiểm tra lại danh sách migration.
- Owner lưu sổ ngày qua RPC allowlist để hai bảng cập nhật trong cùng transaction; các báo cáo đã lọc chi phí phát sinh bị xóa mềm.
- Supabase connector truy cập được project Betea theo ID; người dùng từ chối nhánh có phí nên dùng Supabase CLI/Docker local để kiểm chứng mà không tạo nhánh hoặc chạm production.
- Backfill giữ nguyên doanh thu 1.205.000đ và các trường admin của dòng mẫu; kiểm tra RLS xác nhận staff không đọc tuần cũ, chi phí tháng hoặc admin details, không sửa ngày cũ/hard delete, và mất quyền ngay khi membership inactive.
- Kiểm tra ứng dụng: `npm run typecheck`, `npm run build`, `npm run lint`, `npm test` đều đạt; 14 tests passed.
- Phase 02: tạo Auth Admin server-only client, role-aware access helpers, route staff riêng, trang cấp/quản lý tài khoản và migration RPC kiểm tra owner/audit; kiểm chứng đầu tiên trên local xác nhận RPC/RLS, đang hoàn thiện xử lý auth và rà soát UI.
- Phase 03: thêm RPC allowlist staff cho bốn ca, Grab/Shopee doanh thu và đơn, tổng bill thủ công, công tơ, chi phí phát sinh, soft-delete/restore ca; owner action chuyển chi phí sang RPC.
- Phase 04: thêm staff dashboard tuần hiện tại, multi-photo private evidence theo ngày, Storage policies và owner live refresh; staff không có checklist/đối soát.
- Phase 05: thêm hardening policy/index migration, pgTAP role boundary test và backup/owner access runbook. Production đã áp migration staff tới `staff_policy_hardening`; chưa cấp staff membership production.

### Next immediate action
Khi chủ cửa hàng sẵn sàng, mở **Tài khoản nhân viên** để cấp một tài khoản dùng chung; không tạo membership hoặc dữ liệu thử trong production trước khi có yêu cầu vận hành thật.
