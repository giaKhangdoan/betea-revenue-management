# Plan: Nhật ký theo dõi điện theo ca

- **Date:** 2026-10-15
- **Status:** Migration production đã áp dụng; đẩy `main` để phát hành bản mới.
- **Mode:** Hard — nghiên cứu, lập kế hoạch và red-team thực hiện tuần tự inline theo khả năng của Codex
- **Risk:** high-risk — thay đổi schema/RLS, luồng ghi của nhân viên và quyền xem dữ liệu; cần giữ nguyên số điện, lợi nhuận và API đang dùng
- **Test:** 35 assertion pgTAP, 167 Vitest, typecheck, lint và production build đều đạt trên local

## Mục tiêu

Bổ sung nhật ký điện sáng/tối ngay trong màn hình nhập ngày: giờ và chỉ số công tơ, thời gian hoạt động thiết bị, xác nhận thiết bị qua đêm, checklist chốt ca và ghi chú bất thường. Admin cấu hình thiết bị, xem tình trạng còn thiếu và sửa lịch sử theo quyền hiện có. Việc nhập điện không được cản trở lưu doanh thu.

## Scope challenge

- **Đã có:** `daily_records.electricity_morning_kwh` và `electricity_evening_kwh`; nhân viên nhập hai giá trị qua một form/RPC. Chưa có giờ ghi, trạng thái thiếu, nhật ký thiết bị hay checklist điện.
- **Tối thiểu cần làm:** bổ sung metadata cho hai kỳ; danh mục thiết bị có thể ngừng theo dõi; log thiết bị theo ngày/kỳ; form nhập trong sổ ngày; trạng thái dễ nhận biết cho admin; ảnh công tơ có nhãn riêng nhưng không bắt buộc.
- **Độ phức tạp:** Hard. Thay đổi liên quan DB, phân quyền staff/admin, dữ liệu lịch sử và API điện.

## Spec quality check

**Verdict: PASS.** Các story P1/P2 có tiêu chí nghiệm thu cụ thể. Người dùng đã chốt nhãn cho giờ tắt qua ngày, các trường bắt buộc cho từng trạng thái, và lý do bắt buộc khi admin sửa ngày cũ.

## Nghiên cứu — Researcher Primary

**Verdict: recommended — giữ hai chỉ số kWh hiện tại làm nguồn chuẩn, bổ sung metadata kỳ và lưu nhật ký thiết bị có cấu trúc.**

### Cách codebase hiện làm

- `supabase/migrations/202609250001_initial_schema.sql:36-54`: `daily_records` đã có một dòng cho mỗi ngày và hai cột kWh `numeric(14,3)`; phép tính/API hiện tại đọc trực tiếp hai cột này.
- `src/components/staff/staff-entry-form.tsx:79`: nhân viên hiện nhập cả hai chỉ số trong một form “Chỉ số điện trong ngày”.
- `src/app/(staff)/staff/actions.ts:110-123` và `supabase/migrations/20260927010000_staff_entry_and_evidence.sql:374-393`: RPC `staff_set_meter_readings` cập nhật đồng thời cả sáng lẫn tối, nên cần đổi sang lưu từng kỳ để không ghi đè kỳ còn lại.
- `src/app/(staff)/staff/entry/[date]/page.tsx:28,32,41`: trang đã tải dữ liệu một ngày; nhân viên chỉ được sửa ngày hiện tại, ảnh ngày được quản lý cùng trang.
- `src/app/(private)/ledger/actions.ts:34-65,150-163`: form admin hiện lưu chỉ số cùng biểu mẫu sổ ngày lớn. Cần tách lưu điện khỏi form này để một trang admin cũ không ghi đè số nhân viên vừa nhập.
- `src/components/ledger/photo-manager.tsx:9-19,44-49` và `src/app/(private)/ledger/photo-actions.ts:11-24`: nhãn ảnh và `shift_code` hiện chỉ hiểu 4 ca doanh thu; kỳ sáng/tối điện phải có metadata riêng, không tái sử dụng `shift_code`.
- `src/app/api/ai/v1/electricity/route.ts:12-16,69-120`: GET API công khai chỉ chọn các cột kWh từ `daily_records`; giữ nguyên query và response.

### Hướng thiết kế được chọn

1. Giữ hai cột kWh trên `daily_records` làm nguồn chuẩn để không đổi phép tính tiêu thụ, chi phí điện, lợi nhuận hoặc GET API.
2. Thêm giờ ghi, trạng thái, lý do không ghi được và ghi chú riêng cho sáng/tối; thêm checklist tối trên cùng bản ghi ngày.
3. Tạo danh mục `electricity_devices` và bảng log theo ngày/kỳ. Log lưu snapshot tên/kiểu thiết bị tại lúc ghi; thiết bị ngừng theo dõi chỉ bị ẩn khỏi form mới, không xóa log cũ.
4. Dùng RPC riêng cho từng kỳ và nhóm log thiết bị trong một giao dịch. Tách input điện khỏi hành động lưu sổ ngày admin để tránh stale form ghi đè chỉ số.
5. Mọi bảng ở `public` bật RLS. Staff chỉ đọc thiết bị đang hoạt động và nhật ký trong phạm vi cửa hàng; staff ghi ngày hiện tại bằng RPC; admin quản lý thiết bị và sửa lịch sử bằng RPC có kiểm tra quyền. Không cấp API điện riêng tư cho `anon`.

### Ràng buộc và chi phí

- Cần migration mới, generated types, server actions, form và giao diện admin; không thêm package.
- Các hàm `SECURITY DEFINER` phải có `search_path` rỗng, tự kiểm tra owner/staff/ngày nghiệp vụ, thu hồi quyền `public`/`anon`, chỉ cấp execute cho `authenticated`.
- `supabase` CLI hiện không có trong PATH của môi trường này. Trước khi cook phải xác nhận được cách tạo migration theo quy trình repo và kết nối đúng Supabase local Docker. Không chạy migration vào project hosted.
- AGENTS.md yêu cầu đọc hướng dẫn Next.js đang cài trong `node_modules/next/dist/docs/` trước khi viết code.

## Nghiên cứu — Researcher Alternative

**Verdict: viable with caveats — lưu cấu hình thiết bị/checklist bằng JSONB trên `daily_records` sẽ nhanh hơn nhưng kém an toàn cho lịch sử và truy vấn.**

### Phương án

- **JSONB cho log thiết bị:** ít bảng/RPC và dễ lưu cấu hình UI động. Đổi lại, khó áp ràng buộc duy nhất theo thiết bị/ngày/kỳ, khó lọc thiết bị qua đêm, và việc đổi tên/kiểu thiết bị có thể làm sai lịch sử nếu snapshot không được duy trì thủ công.
- **Chuẩn hóa hoàn toàn cả meter thành bảng period:** mô hình sạch và dễ mở rộng thêm kỳ, nhưng sẽ có hai nơi chứa kWh vì các phép tính/API hiện tại dùng `daily_records`. Đồng bộ hai nguồn tạo nguy cơ lệch số và tăng độ phức tạp migration.
- **Không đổi gì:** không có chi phí kỹ thuật nhưng không đáp ứng yêu cầu giờ, thiết bị, trạng thái thiếu và checklist.

Vì chỉ có hai kỳ cố định và cột kWh hiện tại là nguồn được tiêu thụ bởi nhiều phần của app, nên chọn metadata kỳ trên `daily_records` + log thiết bị chuẩn hóa. Cách này giữ nguồn kWh duy nhất và cho phép lưu lịch sử thiết bị ổn định.

## Phiên bản và nguồn tham chiếu

- Repo hiện dùng Next.js `16.3.6`, React `19.2.8`, `@supabase/ssr` `0.12.7`, `@supabase/supabase-js` `2.117.2`, Zod `4.6.5`; không có package mới trong plan.
- Supabase yêu cầu bật RLS cho bảng trong schema public và giới hạn quyền theo vai trò; tham khảo [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) và [Database Functions](https://supabase.com/docs/guides/database/functions).

## Danh sách phase

| Phase | Mục tiêu | Stories |
|---|---|---|
| [Phase 01 — Schema và quyền truy cập](phase-01-electricity-schema-security.md) | Hoàn tất local: metadata, RPC, RLS, migration | US-01, US-02, US-03, US-05, US-06 |
| [Phase 02 — Nhập nhật ký điện trong ngày](phase-02-daily-electricity-entry.md) | Hoàn tất local: nhập riêng sáng/tối; thiết bị, qua đêm, checklist | US-01, US-02, US-03, US-04, US-06 |
| [Phase 03 — Quản lý thiết bị, đối chiếu và tương thích](phase-03-owner-review-and-compatibility.md) | Hoàn tất local: cấu hình, xem lịch sử, nhãn ảnh, tương thích API | US-01, US-05, US-06, US-07 |

### Story IDs

Các mã dưới đây bám theo thứ tự User Stories trong `spec.md`: US-01 giờ/kWh riêng sáng tối; US-02 nhật ký thiết bị; US-03 checklist và ghi chú; US-04 không chặn doanh thu; US-05 admin cấu hình thiết bị; US-06 admin xem/sửa lịch sử; US-07 lọc ảnh công tơ.

## Rủi ro và giảm thiểu

1. **Ghi đè chéo sáng/tối hoặc thiết bị:** action/RPC chỉ cập nhật đúng kỳ; thiết bị chỉ merge các trường đã sửa dưới khóa theo cửa hàng. Payload đầy đủ từ tab cũ bị từ chối nếu đã lệch dữ liệu và cần tải lại trang; lần sửa có chủ ý từ tab cũ cũng cần tải lại để dùng payload mới.
2. **Rò dữ liệu qua RLS hoặc RPC:** cấp select tối thiểu cho staff; cấm ghi trực tiếp log; test role anon/staff/owner trên DB local trước khi xem xét phát hành.
3. **Mất lịch sử khi đổi thiết bị:** deactivate thay vì hard-delete; snapshot tên/kiểu trong từng log; có audit cho thay đổi admin.
4. **Nhầm ca điện với ca doanh thu:** metadata ảnh dùng `electricity_period`; không dùng `day_photos.shift_code` cho sáng/tối điện.
5. **Ảnh tiêu thụ thêm egress:** dùng lại luồng R2 hiện tại; ảnh tùy chọn, không bắt buộc để lưu điện/checklist.
6. **Thay đổi GET API hoặc lợi nhuận ngoài ý muốn:** route API tiếp tục chỉ chọn hai cột hiện có; không mở rộng response; giữ nguyên hàm tính điện và dữ liệu lịch sử, không backfill giờ hoặc thiết bị cho ngày cũ.
7. **Migration chạy nhầm DB:** chỉ nhắm local Docker, xác nhận URL trước khi apply; production migration/deploy là việc riêng, cần chỉ thị rõ của người dùng.
8. **Rollback gây mất nhật ký:** migration chỉ bổ sung; nếu rollback app, giữ nguyên bảng/cột mới và dữ liệu điện cho tới khi có kế hoạch cleanup được duyệt riêng.

## Red-team review (inline)

**Verdict: WARN — không có CRITICAL; các rủi ro vận hành được đưa vào phase.**

- **HIGH — `staff_set_meter_readings` cập nhật cả hai kWh:** nếu giữ nguyên đường ghi này, lưu một kỳ có thể ghi đè kỳ kia. Cách sửa: thay UI/action bằng RPC lưu riêng từng kỳ; revoke đường ghi cũ sau khi caller được chuyển.
- **HIGH — admin save sổ ngày có thể chứa giá trị công tơ cũ:** stale form có thể ghi đè dữ liệu vừa lưu. Cách sửa: tách hẳn save điện khỏi `saveDailyRecord` và chỉ cập nhật metadata/ngày điện qua action riêng.
- **HIGH — `shift_code` chỉ hợp lệ cho bốn ca bán hàng:** nhét giá trị sáng/tối vào đây sẽ phá constraint/hiển thị ảnh. Cách sửa: trường `electricity_period` độc lập.
- **MEDIUM — sửa lịch sử không có dấu vết:** bắt buộc lý do hiệu chỉnh và ghi audit event cho thay đổi admin.
- **MEDIUM — chưa xác định migration runner cục bộ:** CLI không có trong PATH; phase 01 dừng nếu chưa xác định được công cụ local an toàn.
- **MEDIUM — ngày chưa có dòng sổ:** RPC phải upsert `daily_records` nếu ngày chưa có dòng, rồi chỉ cập nhật cột kWh của kỳ đang lưu.

## Checklist cook

- [x] Phase 01 — schema, quyền truy cập, migrations đã áp dụng vào Docker Supabase local
- [x] Phase 02 — form nhập staff/admin, lưu độc lập từng kỳ
- [x] Phase 03 — cấu hình thiết bị, xem lịch sử, ảnh công tơ, tương thích API
- [x] Đọc tài liệu Next.js cài trong repo; kiểm thử trên đúng Docker local, giữ nguyên Supabase public

## Quyết định đã được người dùng chốt

1. Giờ tắt sau nửa đêm có ô tick với nhãn “Giờ tắt sang ngày hôm sau”.
2. Kỳ “Đã ghi” bắt buộc giờ ghi và kWh; “Không ghi nhận được” bắt buộc lý do; để trống là “Chưa ghi”. Các trạng thái này không chặn lưu doanh thu.
3. Admin sửa dữ liệu điện ngày cũ phải nhập lý do; hệ thống lưu lý do cùng audit event.

## Bàn giao

Cook command đã hoàn tất trên local:

```text
cook --hard plans/electricity-monitoring-log/plan.md
```

Plan này chưa bao gồm push, migration production hoặc deploy.
