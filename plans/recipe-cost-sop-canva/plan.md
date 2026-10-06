# Kế hoạch: Cost công thức và SOP Canva cho Betea

Ngày: 05/10/2026<br>
Mode: Hard<br>
Risk: high-risk — thêm schema dữ liệu giá/công thức, lưu lịch sử cost, phân quyền owner/staff và kết nối OAuth/API Canva.
Trạng thái: Phase 04 đã hoàn tất cục bộ, được duyệt hard-mode và ghi nhận. Phase 06 đang được xác minh cục bộ: RLS/Data API và bộ kiểm thử hiện có đạt; chưa thể hoàn tất vì Phase 03 còn 972 mục workbook cần owner đối soát, Phase 05 chưa bắt đầu, và các cổng Canva/preview chưa qua. Không có production migration, deploy hoặc push.

## Session Notes

<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-10-06 14:29 +07
**Phase in progress:** phase-06-security-validation-rollout
**Status:** Local security validation passed: 140 pgTAP assertions across 7 files, 9 direct PostgREST role-boundary checks, 76 unit tests, lint, typecheck, build, and a local recipe-save regression preserving monthly POS COGS. A local app-database dump restored into a disposable database with Supabase-managed `realtime` and `vault` schemas excluded; R2 image recovery remains unverified. Phase 06 stays active: workbook reconciliation, accepted-data performance, Canva, and preview review remain open. No production migration, deployment, or push.

### Decisions made this session
- Keep the owner workspace and immutable history snapshot in one JSONB document transaction with optimistic revision checks.
- Keep internal cost arithmetic exact with rational BigInt values and serialize results to at most eight decimal places.
- Reject inconsistent conversion graphs even when a conflicting route is longer than the selected route.
- Keep a full review export for importable rows, hold the populated `Bảng NVl!A43:K58` cost block, and allow owner resolution only with a saved note and revision check.
- Bind preview/confirm to the workspace revision, enforce upload limits while reading the request body, neutralize formula-like CSV values, and display gross margin by size.
- For draft inventory counts, identify entries made stale by a later receipt/correction, allow an explicit same-value physical recount, and keep finalized counts free of stale warnings.
- Canva remains unchanged until its Phase 01 integration gate is verified.
- Use isolated local Supabase project `betea-sop-verify-20261006` with Studio excluded after the container health check failed; pgTAP and direct Data API checks passed. Stop and delete its test data after verification; do not touch the separate local stack on port 54322.
- Bind staff SOP publication to the saved, locked recipe and SOP revisions in the database RPC; verify forged payload rejection and preserve a same-ID ingredient/batch regression fixture.
- Keep Phase 06 active until workbook owner review, Canva gates, performance/recovery checks, and the planned preview review are complete.

### Next immediate action
Wait for owner review of the 972 workbook items and Canva's permission/API/employee-URL gates. Once those inputs are resolved, run representative formula comparisons, accepted-workbook performance checks, R2 recovery verification, and preview review. Do not push or deploy production as part of this local validation.

## Scope challenge

- **Exists?** Repo đã có chi phí tháng, trong đó `monthly_costs.cogs_vnd` là COGS tổng tháng lấy từ POS. Chưa có mô hình nguyên liệu → cốt/bán thành phẩm → cost đồ uống theo size. Catalog tồn kho hiện có phục vụ đếm/nhập kho, không phải bảng giá cost công thức.
- **Minimum?** Thêm dữ liệu cost riêng cho owner; tính cost cho nguyên liệu, cốt và món theo S/M/L; lưu phiên bản lịch sử nhưng chỉ hiện cost hiện tại ở màn hình thường; nhập workbook có báo cáo đối soát; sửa SOP ở Betea và tạo bản nháp Canva an toàn cho nhân viên xem.
- **Complexity?** Hard. Thay đổi xuyên migration/RLS, tính toán tiền và đơn vị, nhập dữ liệu Excel, UI owner/staff và API Canva.

## Spec quality check

- `[NEEDS CLARIFICATION]`: không còn. Quyền Canva và URL được chuyển thành integration gates cần kiểm chứng trước rollout.
- User stories P1/P2/P3: có P1/P2 và out of scope rõ.
- Acceptance criteria: có công thức, role, thời gian tính, import mapping và hành vi kiểm tra/publish cụ thể.
- **Verdict: PASS** cho lập kế hoạch; tích hợp Canva chưa được coi là khả thi cho tới khi vượt gate ở Phase 01.

## Risk classification

**Risk: high-risk** — lỗi công thức có thể làm người quản lý dựa vào cost sai; lỗi RLS có thể làm lộ giá vốn/lợi nhuận cho nhân viên; kết nối Canva phụ thuộc quyền tài khoản và API preview.

## Phát hiện trong repo và các ràng buộc

- App dùng Next.js 16.3.6, React 19.2.8, Supabase JS 2.117.2 và `@supabase/ssr` 0.12.7.
- Owner routes nằm trong `src/app/(private)` và kiểm tra qua `requireAdmin`/owner access; staff routes nằm trong `src/app/(staff)` và xác định membership qua `getAppAccess()`.
- Migration/RLS tests nằm trong `supabase/migrations` và `supabase/tests`. Mọi bảng Data API mới cần grants và RLS rõ ràng; không xem việc ẩn nút trên giao diện là biện pháp phân quyền.
- `inventory_items` quản lý catalog tồn kho; không tái sử dụng để lưu giá cost nguyên liệu vì đơn vị/ý nghĩa nghiệp vụ khác.
- `monthly_costs.cogs_vnd` tiếp tục là COGS tháng nhập từ POS. Module cost công thức không đọc/ghi đè trường đó.
- Trước khi sửa Next.js code, tuân theo `AGENTS.md` và đọc tài liệu phù hợp trong `node_modules/next/dist/docs/` của đúng bản 16.3.6.

## Hướng kiến trúc được chọn

1. Betea là nguồn chuẩn cho giá hiện tại, công thức và SOP. Mô hình dữ liệu recipe riêng cho nguyên liệu, bán thành phẩm, công thức món/size và thành phần công thức.
2. Tính cost dùng hàm thuần có đơn vị chuẩn và số thập phân; chỉ tự quy đổi cùng chiều đo. Không tự đổi g ↔ ml nếu chưa có hệ số/khối lượng riêng do quản lý nhập.
3. Mỗi thay đổi ảnh hưởng cost tạo phiên bản/snapshot bất biến đủ dữ liệu để xem lại. Màn hình cost bình thường chỉ lấy phiên bản hiện tại; lịch sử chỉ hiển thị trong khu vực Lịch sử.
4. Canonical cost/price tables owner-only ở DB/RLS. Staff nhận một projection/SOP revision chỉ chứa hướng dẫn và định lượng pha; không trả fields giá, cost, lãi hoặc biên lợi nhuận.
5. Import workbook dùng quy trình một lần có dry-run và manifest đối soát; không tự đoán đơn vị hay im lặng bỏ dòng. Workbook nguồn bên ngoài repo và không được sửa.
6. Canva chỉ nhận dữ liệu SOP đã lọc. Tạo bản sao của mẫu; dùng Autofill để tạo/cập nhật bản nháp. Sau khi Betea báo hoàn tất, chủ cửa hàng mở bản nháp kiểm tra và tự bấm Publish. Không tự publish và không đụng thiết kế gốc.

## So sánh hướng

| Hướng | Đánh giá | Kết luận |
|---|---|---|
| A. Mô hình dữ liệu recipe chuẩn hóa ở Betea, tính cost trong app/DB, dùng Canva bản sao làm đích SOP | Giữ được lịch sử, unit checks, quyền owner/staff và đối soát; cần migration/import và xác minh Canva access | **Chọn** |
| B. Giữ Excel làm nguồn chính, Betea chỉ nhận tổng cost và chép công thức sang Canva | Ít thay đổi ban đầu nhưng cập nhật nhiều nơi, khó audit dependency/size và không đạt mục tiêu sửa trên web | Không chọn |
| C. Chuyển SOP hoàn toàn sang trang staff Betea, không sync Canva | Dễ đảm bảo URL/quyền và không lệ thuộc Canva API | Chỉ là phương án dự phòng cần chủ cửa hàng duyệt nếu gate Canva thất bại |

## Nghiên cứu kỹ thuật inline

- **Hướng chính:** repo đã có owner-only actions, staff route group, migrations và boundary tests. Mở rộng những mẫu này; tách recipe costing khỏi monthly POS COGS; cung cấp staff-safe SOP projection riêng.
- **Canva và phương án thay thế:** Autofill cần template/design có data fields, job API chạy bất đồng bộ và tài khoản có quyền Autofill. Canva changelog ghi `update_design` cập nhật thiết kế tại chỗ nhưng hiện là preview; vì vậy thử trước trên bản sao, không dựa vào đây như API ổn định nếu chưa chứng minh được trong tài khoản Betea. Nếu gate fail, giữ nguyên core recipe/SOP tại Betea và chờ quyết định; không âm thầm đổi sang C.
- **Cơ sở bảo mật:** Supabase yêu cầu kiểm soát grants cùng RLS trên từng bảng/view. Không cấp bảng giá/cost cho staff; không tạo view staff từ bảng nhạy cảm trừ khi bảo đảm semantics RLS đúng. Dùng tests cho allow/deny và truy cập API trực tiếp.
- **Fallback quy trình:** subagent bị tắt trong phiên; research, lập plan và red-team review được thực hiện inline theo skill `plan`.

## Implementation Progress

- [x] Phase 02: Schema and cost engine — local migrations, 24 pgTAP assertions, 39 unit tests, typecheck, lint and build pass.
- [ ] Phase 03: Owner cost workspace and import — implemented locally; code review 10/10; awaiting owner review. Workbook S/M/L recipe reconciliation remains open.
- [x] Phase 04: SOP editor and staff-safe view — owner editor, revision-checked save/publish, and database-bound staff projection implemented; 76 unit tests, all 140 pgTAP assertions across 7 SQL files, lint, typecheck, build and read-only code review pass. Direct owner RPC rejects a staff projection that differs from the saved recipe/SOP; same-ID ingredient/batch regression passes. Recount follow-up fixes a full-suite inventory UI gap; no production migration or deployment.
- [ ] Phase 06: Kiểm chứng quyền và rollout — local role/API tests, application checks and database restore rehearsal pass; pending workbook review, Canva gates, accepted-data performance, R2 image recovery and preview owner review. No production migration, deploy or push.

## Phases

| Phase | Mục tiêu | Stories |
|---|---|---|
| [Phase 01 — Audit workbook và gate Canva](phase-01-audit-workbook-canva-gates.md) | Lập manifest dữ liệu, rà soát công thức/đơn vị và chứng minh quyền/API trên bản sao Canva trước khi cam kết tích hợp | US-05, US-07 — P1/P2 |
| [Phase 02 — Schema và cost engine](phase-02-schema-cost-engine.md) | Thêm mô hình recipe riêng, tính cost chuẩn hóa và snapshot lịch sử owner-only | US-01–US-04, US-08 — P1/P2 |
| [Phase 03 — Màn hình quản lý và import](phase-03-owner-cost-workspace-import.md) | Cho owner quản lý giá, bán thành phẩm, công thức/size, giá bán và import có đối soát | US-01–US-04, US-07–US-08 — P1/P2 |
| [Phase 04 — Biên tập SOP và màn hình staff](phase-04-sop-staff-safe-view.md) | Chỉnh SOP từ công thức và cho staff xem hướng dẫn an toàn không có cost | US-05–US-06 — P1 |
| [Phase 05 — Đồng bộ bản nháp Canva](phase-05-canva-draft-sync.md) | Gắn Canva account, cập nhật bản sao/template bất đồng bộ và chờ owner kiểm tra/publish | US-05 — P1 |
| [Phase 06 — Kiểm chứng quyền và rollout](phase-06-security-validation-rollout.md) | Đối chiếu Excel, xác nhận ranh giới dữ liệu, hiệu năng và phát hành có kiểm soát | US-01–US-08 — P1/P2 cross-cutting |

## Red-team review — thực hiện inline

- **Accepted — lọt cost qua staff:** không để staff đọc bảng recipe/cost canonical; chỉ trả projection SOP allowlist và kiểm tra trực tiếp Data API, route và action.
- **Accepted — sai quy đổi:** không chuyển khối lượng sang thể tích khi thiếu density/conversion factor; giữ đơn vị nguồn và báo lỗi mapping.
- **Accepted — lịch sử bị viết lại:** lưu snapshot phiên bản có dữ liệu đầu vào/revisions và cost lines; không tính lịch sử bằng giá hiện tại.
- **Accepted — import sai nhưng trông có vẻ thành công:** dry-run, báo đầy đủ dòng/món bị thiếu mapping; chỉ commit phần hợp lệ sau khi người quản lý xem báo cáo.
- **Accepted — Canva cập nhật nhầm/gây đổi link:** chỉ thao tác trên copy; gate kiểm tra design ID và link; không publish tự động; nếu URL đổi hoặc API preview không khả dụng thì dừng trước rollout.
- **Accepted — lẫn với COGS POS:** dùng bảng, route và nhãn riêng; regression check để không thay đổi `monthly_costs.cogs_vnd` và dashboard lợi nhuận hiện tại.

## Checklist triển khai

- [ ] Hoàn tất Phase 01 và ghi rõ mọi dữ liệu Excel chưa map.
- [x] Hoàn tất schema/calculator trước khi bật import production.
- [ ] Owner-only cost và staff-safe SOP đã được xác minh ở DB/API/UI.
- [ ] Canva chỉ dùng bản sao; owner đã review draft và tự publish.
- [ ] Đối chiếu 5 công thức đại diện ở cả S/M/L với quy tắc làm tròn Excel.
- [ ] Chạy lint, typecheck, test, build và rollout theo môi trường preview trước production.

## Quyết định đã chốt

1. Dùng một bản sao Canva cố định và giữ link cho nhân viên. Nếu update/publish không thể giữ link, dừng rollout để chủ cửa hàng chọn hướng khác; không tự đổi link.
2. Nhập các dòng Excel đã được xác minh; dòng lỗi/thiếu mapping ở danh sách chờ. Chỉ đánh dấu import hoàn tất khi mọi dòng bắt buộc đã được xử lý.
3. Ngày hiệu lực giá mặc định là ngày nhập theo múi giờ cửa hàng, nhưng owner có thể sửa lùi về ngày mua.

## Sources

- [Canva Autofill API](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/)
- [Canva Autofill guide](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/)
- [Canva REST API changelog](https://www.canva.dev/docs/apps/rest-apis/changelog/)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Handoff

Plan map tới 6 phase files; `feature_list.json` tại project root được cập nhật với đúng 6 phase IDs. Kế hoạch đã được owner xác nhận; khuyến nghị bắt đầu implementation bằng `cook --hard --tdd plans/recipe-cost-sop-canva/plan.md` vì có schema mới, RLS và công thức tài chính.
