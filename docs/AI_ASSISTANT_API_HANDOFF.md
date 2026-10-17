# Bàn giao dữ liệu Betea cho hệ thống AI phân tích

Tài liệu này mô tả API và dữ liệu theo mã nguồn hiện tại. Tài liệu không chứa khóa, mật khẩu, token hay URL có quyền truy cập riêng tư.

## 1. Kết luận về khả năng tích hợp hiện tại

REST API công khai dành cho AI tại `GET /api/ai/v1/electricity` đọc chỉ số công tơ, tình trạng ghi nhận, nhật ký thiết bị, checklist chốt ca, mức tiêu thụ đã tính và metadata ảnh công tơ. API không yêu cầu đăng nhập hoặc token. Bất kỳ ai biết URL đều có thể đọc dữ liệu điện trong khoảng ngày được hỗ trợ; không dùng endpoint này để trả thêm doanh thu, lợi nhuận hay dữ liệu nhạy cảm khác. API chỉ trả metadata ảnh, không trả ảnh, object path hoặc URL xem ảnh. Các trang dashboard và báo cáo vẫn đọc bằng Supabase server client gắn với phiên đăng nhập. Các thao tác ghi được triển khai bằng Next.js Server Actions; đây là giao tiếp nội bộ của giao diện, không phải API ổn định để cấp cho nhà cung cấp AI.

Không gửi tài khoản đăng nhập, cookie phiên, khóa `SUPABASE_SERVICE_ROLE_KEY`, khóa Supabase hay quyền truy cập trực tiếp database cho bên thứ ba.

## 2. REST routes hiện đang có

Các URL dưới đây nằm dưới domain triển khai của ứng dụng. Route group trong ngoặc của Next.js không xuất hiện trong URL thực tế.

- Domain production đang dùng: `https://betea-revenue-management.vercel.app`
- Các route owner/staff hiện xác thực bằng phiên đăng nhập website (cookie Supabase), không có client credential/API token dành cho nhà cung cấp bên ngoài.

| Method và path | Xác thực hiện tại | Chức năng | Dùng trực tiếp cho AI? |
|---|---|---|---|
| `GET /auth/callback` | Luồng đăng nhập Supabase PKCE | Đổi mã đăng nhập thành phiên website rồi chuyển hướng người dùng | Không |
| `GET /api/evidence/{photoId}/url` | Phiên owner hoặc nhân viên; quyền được kiểm tra theo cửa hàng | Trả URL xem ảnh Bluebook có thời hạn | Không. URL ảnh riêng tư, chỉ dùng trong giao diện đã đăng nhập |
| `POST /api/evidence/upload` | Phiên owner hoặc nhân viên; nhân viên chỉ tải ảnh ngày hiện tại | Tạo URL tải ảnh Bluebook lên R2; ảnh tối đa 2 MB | Không. Đây là luồng ghi ảnh |
| `POST /api/admin/evidence/migrate-next` | Phiên owner | Chuyển từng ảnh Bluebook cũ từ Supabase Storage sang R2 và cập nhật metadata | Không. Đây là route bảo trì có thay đổi dữ liệu |
| `POST /api/admin/advances/evidence/upload` | Phiên owner | Tạo phiên và URL tải ảnh hóa đơn riêng tư lên R2 | Không. Đây là luồng ghi chứng từ |
| `POST /api/admin/advances/evidence/finalize` | Phiên owner | Xác minh và gắn ảnh hóa đơn vào phiếu mua | Không. Đây là luồng ghi dữ liệu |
| `POST /api/admin/advances/evidence/cleanup` | Phiên owner | Dọn các ảnh tải dở đã hết hạn | Không. Route có thể xóa đối tượng R2 tạm |
| `GET /api/admin/advances/evidence/{evidenceId}/url` | Phiên owner | Trả URL xem ảnh hóa đơn riêng tư, có thời hạn 5 phút | Không. Chứng từ mua hàng nhạy cảm |
| `GET /api/ai/v1/electricity?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` | Công khai, không cần đăng nhập hoặc token | Đọc công tơ, trạng thái/lý do/ghi chú, thiết bị, checklist, mức dùng điện và metadata ảnh công tơ; tối đa 31 ngày mỗi request | Có, chỉ gồm dữ liệu điện và vận hành thiết bị |
| `POST /api/recipe-cost/import` | Phiên owner | Xem trước hoặc nhập workbook `.xlsx` giá vốn; chế độ xác nhận sẽ ghi dữ liệu | Không. Có chế độ ghi dữ liệu và chứa giá vốn nhạy cảm |
| `GET /inventory/export?from=YYYY-MM-DD&to=YYYY-MM-DD` | Phiên owner | Tải workbook lịch sử kho; tối đa 366 ngày mỗi lần | Không phải API JSON; chỉ dùng trong website để xuất file |

Ngoài API điện, hiện chưa có route `GET /api/...` để đọc doanh thu theo ngày/tuần/tháng hoặc lợi nhuận. Một số GET ở trên chỉ dùng trong xác thực, xuất Excel hoặc tạo URL ảnh có quyền.

## 3. Server Actions nội bộ (không phải API công khai)

Server Actions nhận phiên website và kiểm tra role owner/staff. Không cấp các action này cho AI như một API. Các nhóm action hiện có:

| File/module | Nhóm chức năng và action |
|---|---|
| `src/app/(private)/ledger/actions.ts` | `saveDailyRecord`, `addDailyExpense`, `restoreDeletedShift` — nhập/sửa sổ ngày, chi phí phát sinh và khôi phục ca |
| `src/app/(staff)/staff/actions.ts` | `saveStaffEntryAction` — nhập doanh thu ca, Grab/Shopee, số bill, chỉ số điện và chi phí do nhân viên trả từ doanh thu quán |
| `src/app/(private)/costs/actions.ts` | `saveMonthlyCosts`, `addMonthlyCostAdjustment`, `deleteMonthlyCostAdjustment`, `saveMonthTargets`, `saveWeekTarget` |
| `src/app/(private)/inventory/actions.ts`, `src/app/inventory/actions.ts` | Danh mục hàng, phiếu nhập kho, bản kiểm kho, hiệu chỉnh và lịch sử kiểm kho |
| `src/app/(private)/product-costs/actions.ts` | Lưu workspace giá vốn món và xử lý dòng cần đối chiếu khi nhập workbook |
| `src/app/(private)/sop/actions.ts` | Lưu bản SOP nháp và công bố SOP an toàn cho nhân viên |
| `src/app/(private)/advances/actions.ts` | Tạo/sửa/hủy/chốt phiếu mua, ghi nhận hoàn ứng, ghi/đảo khoản mua vào lợi nhuận, xử lý trùng và hiệu chỉnh phiếu |
| `src/app/(private)/staff-accounts/actions.ts` | Tạo/sửa/khóa tài khoản nhân viên và đặt lại mật khẩu |
| `src/app/(private)/account/actions.ts` | Đổi email owner |
| `src/app/login/actions.ts`, `src/app/auth/password/actions.ts`, `src/app/signout/actions.ts` | Đăng nhập, khôi phục/đặt mật khẩu và đăng xuất |

## 4. Các miền dữ liệu trong Supabase

Các bảng sau được ứng dụng dùng trong những miền tương ứng. Đây là danh mục bảng trong mã nguồn/migration, không đồng nghĩa bên ngoài hiện có quyền truy vấn.

| Miền | Bảng tiêu biểu | Dữ liệu |
|---|---|---|
| Sổ doanh thu | `daily_records`, `daily_admin_details` | Doanh thu bốn ca, Grab/Shopee, số đơn/bill, hai mốc công tơ, tổng Bluebook, chênh lệch đối chiếu, trạng thái ngày, xác nhận vệ sinh/sắp xếp và ghi chú admin |
| Chi phí vận hành | `daily_expenses`, `monthly_costs`, `monthly_cost_adjustments` | Chi phí phát sinh theo ngày; COGS POS, thuê mặt bằng, lương, tiền nước, bill điện và các điều chỉnh chi phí tháng |
| Mục tiêu | `weekly_targets`, `monthly_targets` | Mục tiêu doanh thu tuần/tháng và mục tiêu lợi nhuận tháng |
| Ảnh Bluebook | `day_photos` | Metadata ảnh theo ngày và nguồn lưu trữ. Ảnh hiện lưu trên R2 hoặc một số bản cũ trên Supabase Storage; object path không nên đưa cho AI |
| Kho | `inventory_items`, `inventory_receipts`, `inventory_receipt_lines`, `inventory_counts`, `inventory_count_items`, các bảng `*_corrections` và `*_versions` | Danh mục, đơn vị quy đổi, phiếu nhập, số lượng kiểm kê, hiệu chỉnh và lịch sử bất biến |
| Giá vốn món | `recipe_cost_workspace`, `recipe_cost_snapshots` | Nguyên liệu, quy cách/định lượng, công thức theo size, giá vốn và lịch sử phiên bản |
| SOP | `owner_sop_workspace`, `owner_sop_snapshots`, `staff_sop_publications` | Bản nháp riêng của owner, lịch sử và bản SOP đã lọc để nhân viên xem |
| Khoản chi admin ứng trước | `owner_purchase_vouchers`, `owner_purchase_lines`, `owner_purchase_reimbursements`, `owner_purchase_profit_postings`, `owner_purchase_events`, `owner_purchase_source_links`, `owner_purchase_stock_links`, các bảng upload/evidence | Phiếu mua bằng tiền cá nhân admin, mặt hàng, hoàn ứng, khoản đã đưa vào lợi nhuận, audit và metadata chứng từ. Ảnh hóa đơn riêng tư |
| Quyền và audit | `owner_profiles`, `store_memberships`, `audit_events`, `daily_shift_deletions` | Owner/cửa hàng, quyền nhân viên, thay đổi dữ liệu và lịch sử thao tác |

Schema `private` còn chứa một số bảng/trình trợ giúp nội bộ cho lịch sử kho; không phải API tích hợp.

## 5. Quy tắc đọc và diễn giải dữ liệu

- Ngày kinh doanh là ngày tại múi giờ `Asia/Ho_Chi_Minh`. Dữ liệu ghi nhận bắt đầu từ `2026-09-01`.
- Tuần bắt đầu Thứ Hai và kết thúc Chủ nhật.
- Doanh thu ngày = tổng bốn ca tại quán + Grab + Shopee. Grab/Shopee là kênh cộng ngoài bốn ca; nếu ô trống thì được xem là 0. Bốn ca phải có đủ giá trị mới được đánh dấu ngày đã nhập đủ. Ngày không kinh doanh có tổng bằng 0.
- Tổng bill là số lượng đơn/bill, không phải doanh thu. Doanh thu tiền tệ lưu bằng số nguyên VND.
- Bluebook là số tổng để đối chiếu. `reconciliation_difference_vnd` theo phép tính Bluebook trừ doanh thu website; chênh lệch và ghi chú là dữ liệu đối chiếu, không tự sửa doanh thu.
- Điện tháng ước tính = (chỉ số ca tối ngày cuối tháng − chỉ số ca sáng ngày đầu tháng) × 3.471 VND/kWh. Khi có bill điện, bill là chi phí điện dùng để tính; công tơ reset/giảm làm mất hiệu lực ước tính từ phép trừ đầu-cuối.
- API điện trả trạng thái ghi nhận theo ca (`recorded`, `unable`, `unrecorded`; dữ liệu cũ có thể là `legacy_recorded_without_metadata`), giờ đọc, kWh, lý do chưa đọc được và ghi chú bất thường. `usageKwh.operatingHours` là mức tăng từ sáng đến tối; `overnight` là từ tối đến sáng hôm sau; `total` là mức dùng cả ngày khi đủ chỉ số và không có số công tơ giảm.
- Nhật ký thiết bị được chia theo `morning` và `evening`: trạng thái chạy, giờ bật/tắt, ngày bật/tắt, thời gian hoạt động tính bằng phút, có kéo sang ngày sau, còn chạy qua đêm, còn chạy sau đóng cửa và ghi chú. `deviceCatalog` là danh mục cấu hình hiện tại; `isActive` cho biết thiết bị còn được theo dõi, không phải thiết bị đang bật. Tên và loại thiết bị trong nhật ký là thông tin được lưu tại thời điểm ghi để giữ đúng lịch sử.
- `startedAt`/`endedAt` có dạng `HH:mm` theo giờ Việt Nam; `startedOn`/`endedOn` là ngày tương ứng dạng `YYYY-MM-DD`. `durationMinutes` chỉ tính cho thiết bị `timed` đang `running` và có khoảng giờ hợp lệ. Thiết bị chạy liên tục, thiếu giờ hoặc giờ chưa hợp lệ trả `null`, không tự giả định chạy 24 giờ. Thời gian này là một khoảng được nhân viên ghi nhận, không phải số đo công suất hay kWh riêng của từng thiết bị; không cộng trùng khoảng sáng/tối nếu chúng chồng nhau.
- `deviceOperations` là danh sách thiết bị phẳng theo ngày để AI dễ đọc giờ hoạt động. Mỗi dòng có `recordedInPeriod`, `deviceName`, `status`, `startDateTime` và `endDateTime`; giờ đầy đủ mang múi giờ `+07:00`. Trường này bổ sung cho `devices.morning`/`devices.evening`, không thay thế chúng.
- `devices.morning`/`devices.evening` chỉ chứa nhật ký đã được lưu. Thiết bị không có trong danh sách ca nghĩa là chưa có nhật ký, không được suy ra là không sử dụng. `status: "not_running"` mới là nhân viên đã xác nhận không dùng. API đọc đầy đủ các trang dữ liệu để không cắt mất nhật ký khi truy vấn nhiều ngày.
- `closingChecklist` gồm xác nhận tắt thiết bị không cần thiết, kiểm tra cửa tủ mát/tủ đông và nhân viên tự xác nhận đã chụp công tơ; giá trị `null` nghĩa là chưa xác nhận. `meterPhotos` chỉ có chú thích và thời điểm tải ảnh theo ca; không có nội dung ảnh hoặc URL riêng tư.
- Thuê, lương, nước, bill điện và điều chỉnh chi phí tháng được phân bổ theo số ngày lịch trong tháng, giữ nguyên tổng sau khi chia. Chi phí phát sinh nhập theo ngày.
- Lợi nhuận tháng/năm = doanh thu − chi phí hoạt động − khoản admin đã ghi nhận vào lợi nhuận − COGS tháng từ POS. Tuần/khoảng ngày hiển thị lợi nhuận trước COGS vì COGS chỉ có số theo tháng. Phiếu mua admin chỉ được tính khi owner ghi nhận/post vào lợi nhuận; không tự cộng mọi phiếu mua.
- Khoản mua vật tư/nguyên liệu trong sổ ứng tiền theo dõi số admin tự ứng và hoàn ứng; nguyên liệu nhập kho không tự cộng vào lợi nhuận. Chi phí nhân viên trả từ doanh thu quán được ghi riêng trong sổ ngày.
- SOP nhân viên là phiên bản đã được owner công bố. Nó không nên được dùng để suy ra hoặc trả về COGS/giá bán riêng tư.

## 6. Tích hợp AI ngoài phạm vi số điện

Endpoint điện hỗ trợ AI đọc nhật ký công tơ và thiết bị. Nếu sau này cần AI đọc doanh thu, lợi nhuận, khoản mua, kho hoặc giá vốn, các API bên dưới vẫn chỉ là **đề xuất, chưa được triển khai**; endpoint điện không trả các miền dữ liệu đó.

Bot gọi endpoint điện bằng HTTP GET, không cần header xác thực. Để lấy một ngày, truyền cùng ngày ở `fromDate` và `toDate`:

```http
GET https://betea-revenue-management.vercel.app/api/ai/v1/electricity?fromDate=2026-10-11&toDate=2026-10-11
```

Có thể truy vấn nhiều ngày bằng cách đặt ngày bắt đầu ở `fromDate` và ngày kết thúc ở `toDate` (tối đa 31 ngày, định dạng `YYYY-MM-DD`). Không cần cấu hình token hoặc gửi Authorization header.

Phản hồi có `apiVersion`, `timezone`, đơn vị `kWh`, `generatedAt`, `interpretationGuidance`, `deviceCatalog` và `items`. Mỗi item giữ các trường cũ `status`, `readingsKwh` và `usageKwh` để bot đang dùng không bị hỏng. Các trường mới là `readings` (trạng thái/giờ/kWh/lý do/ghi chú sáng và tối), `devices` theo ca, `deviceOperations` dạng phẳng, `closingChecklist` và `meterPhotos` theo ca. Ngày không có bản ghi mang `status: "no_record"`. Tổng kWh ngày chưa hoàn tất nếu thiếu chỉ số sáng hôm sau hoặc phát hiện công tơ giảm.

Khi kết nối endpoint với trợ lý AI, yêu cầu trợ lý đọc `interpretationGuidance` trước khi phân tích. Cụ thể, `readings.*.recordedAt` chỉ là giờ nhân viên đọc công tơ. Giờ bật/tắt thiết bị nằm ở `items[].deviceOperations[].startDateTime` và `endDateTime`. Đây là nhật ký thời gian do nhân viên ghi, không phải phép đo kWh riêng của thiết bị. Nếu hai ca ghi khoảng giờ chồng nhau, không cộng thời lượng hai dòng.

Ví dụ cấu trúc dữ liệu mới:

```json
{
  "apiVersion": "2",
  "timezone": "Asia/Ho_Chi_Minh",
  "unit": "kWh",
  "fromDate": "2026-10-15",
  "toDate": "2026-10-15",
  "generatedAt": "2026-10-16T03:00:00.000Z",
  "interpretationGuidance": [
    "Giờ recordedAt chỉ là giờ đọc công tơ; dùng deviceOperations để đọc giờ bật và tắt thiết bị.",
    "Khoảng giờ thiết bị là nhật ký nhân viên ghi, không phải kWh riêng của thiết bị. Không cộng các khoảng thời gian chồng nhau."
  ],
  "deviceCatalog": [
    { "id": "...", "name": "Điều hòa", "mode": "timed", "sortOrder": 10, "isActive": true }
  ],
  "items": [
    {
      "date": "2026-10-15",
      "recordStatus": "has_record",
      "status": "complete",
      "readings": {
        "morning": { "status": "recorded", "recordedAt": "07:00", "kwh": 15230.5, "unavailableReason": null, "note": null },
        "evening": { "status": "recorded", "recordedAt": "22:00", "kwh": 15242.1, "unavailableReason": null, "note": null }
      },
      "readingsKwh": { "morning": 15230.5, "evening": 15242.1, "nextMorning": 15244.0 },
      "usageKwh": { "operatingHours": 11.6, "overnight": 1.9, "total": 13.5 },
      "deviceOperations": [
        {
          "recordedInPeriod": "morning",
          "deviceId": "...",
          "deviceName": "Điều hòa quán 1",
          "mode": "timed",
          "status": "running",
          "startDateTime": "2026-10-15T04:30:00+07:00",
          "endDateTime": "2026-10-15T12:00:00+07:00",
          "durationMinutes": 450,
          "endsNextDay": false,
          "ranFromPreviousNight": false,
          "remainsOnAfterClose": null,
          "note": null
        }
      ],
      "devices": {
        "morning": [
          {
            "deviceId": "...",
            "name": "Điều hòa quán 1",
            "mode": "timed",
            "status": "running",
            "startedAt": "04:30",
            "endedAt": "12:00",
            "startedOn": "2026-10-15",
            "endedOn": "2026-10-15",
            "durationMinutes": 450,
            "endsNextDay": false,
            "ranFromPreviousNight": false,
            "remainsOnAfterClose": null,
            "note": null
          }
        ],
        "evening": [
          {
            "deviceId": "...",
            "name": "Điều hòa",
            "mode": "timed",
            "status": "running",
            "startedAt": "20:00",
            "endedAt": "00:30",
            "startedOn": "2026-10-15",
            "endedOn": "2026-10-16",
            "durationMinutes": 270,
            "endsNextDay": true,
            "ranFromPreviousNight": null,
            "remainsOnAfterClose": true,
            "note": "Tắt sau khi kết thúc sự kiện"
          }
        ]
      },
      "closingChecklist": { "turnedOffUnneeded": true, "checkedCoolerDoors": true, "meterPhotoConfirmed": true },
      "meterPhotos": { "morning": [], "evening": [] }
    }
  ]
}
```

Các trường thiết bị dành cho bot:

| Trường | Ý nghĩa |
|---|---|
| `deviceId`, `name` | Mã thiết bị và tên tại thời điểm ghi |
| `mode` | `timed`: theo dõi giờ bật/tắt; `continuous`: thiết bị chạy liên tục |
| `status` | `running`: có sử dụng; `not_running`: đã xác nhận không dùng |
| `startedAt`, `endedAt` | Giờ bật/tắt, dạng `HH:mm`; `null` nếu chưa biết hoặc không áp dụng |
| `startedOn`, `endedOn` | Ngày của hai mốc giờ, giúp xác định khoảng chạy qua nửa đêm |
| `durationMinutes` | Số phút theo khoảng giờ đã nhập; `null` khi không đủ dữ liệu để tính |
| `endsNextDay` | Giờ tắt ca tối nằm ở ngày kế tiếp |
| `ranFromPreviousNight` | Xác nhận ca sáng: thiết bị còn chạy từ đêm trước |
| `remainsOnAfterClose` | Xác nhận ca tối: thiết bị vẫn chạy sau khi đóng cửa |
| `note` | Ghi chú sử dụng hoặc bất thường; `null` nếu không có |

| Endpoint đề xuất | Trả về | Quyền mặc định |
|---|---|---|
| `GET /api/ai/v1/summary?from=&to=` | Tổng doanh thu, số ngày đủ/thiếu, chi phí/lợi nhuận nếu được cấp quyền, tỷ lệ đạt mục tiêu | `analytics:read`; lợi nhuận yêu cầu scope riêng |
| `GET /api/ai/v1/daily?from=&to=&cursor=` | Mỗi ngày: doanh thu từng ca và kênh, bill, chi phí phát sinh, đối chiếu Bluebook, điện, trạng thái đầy đủ | `ledger:read`; giới hạn khoảng ngày và phân trang |
| `GET /api/ai/v1/monthly-costs?month=` | COGS, thuê, lương, nước, bill điện, điều chỉnh và target | `profit:read` riêng; chỉ owner cho phép |
| `GET /api/ai/v1/purchases?from=&to=&cursor=` | Tổng tiền phiếu admin, mặt hàng/số lượng, trạng thái hoàn ứng, chi phí đã post | `purchases:read` riêng; không trả ảnh/chứng từ mặc định |
| `GET /api/ai/v1/inventory?asOf=` | Tồn kho theo đơn vị chuẩn và thời điểm kiểm kê gần nhất | `inventory:read`; không tải toàn bộ lịch sử phiên bản mặc định |
| `GET /api/ai/v1/recipe-costs` | Công thức, định lượng và giá vốn theo size | `recipe-costs:read` riêng vì đây là bí mật kinh doanh; tắt mặc định |

Contract nên dùng JSON versioned, VND là integer, ngày là `YYYY-MM-DD`, phản hồi có `generatedAt`, `timezone`, `from`, `to`, `dataCompleteness` và cảnh báo ngày thiếu. Không trả tên/email nhân viên, dữ liệu đăng nhập, raw object path, signed URL ảnh hay ảnh hóa đơn trong endpoint phân tích mặc định.

## 7. Yêu cầu bảo mật cho implementation tích hợp

1. API này được chủ ý để công khai và không xác thực. Bất kỳ ai có URL đều có thể đọc dữ liệu điện, thiết bị và ghi chú vận hành của Betea trong phạm vi ngày hỗ trợ; không đưa doanh thu, lợi nhuận, email/tên nhân viên, khoản mua hoặc dữ liệu riêng tư khác vào response này.
2. Endpoint tự khóa `owner_id`, chỉ chọn các cột điện/thiết bị liên quan, chỉ hỗ trợ GET và giới hạn tối đa 31 ngày mỗi lần. Chưa có rate limit hay audit log riêng cho các lần đọc API.
3. Supabase service-role key chỉ được dùng trong route phía server và không được trả về cho bên AI. Không cấp quyền database, quyền RPC hay public bucket cho bot.
4. Dữ liệu API không gồm doanh thu, lợi nhuận, thông tin nhận diện nhân viên, COGS, khoản mua, ảnh gốc, object path hoặc signed URL. Metadata ảnh công tơ chỉ gồm ca, chú thích và thời điểm tải lên.
5. Phản hồi không được cache (`Cache-Control: private, no-store, max-age=0`).

## 8. Thông tin cần bên làm AI nhận

Có thể gửi tài liệu này để mô tả cấu trúc và semantics. Sau khi phiên bản API được deploy, chuyển URL endpoint cho bot. Endpoint công khai nên không cần token, mật khẩu, cookie hay khóa Supabase.

Có thể thêm chỉ dẫn sau vào cấu hình trợ lý:

```text
Khi đọc API điện, hãy đọc interpretationGuidance trước. Giờ đọc công tơ nằm trong readings.*.recordedAt; giờ bật/tắt của thiết bị nằm trong deviceOperations[].startDateTime và endDateTime. Luôn nêu tên thiết bị, ca ghi nhận và ngày giờ địa phương. Không suy ra kWh riêng cho từng thiết bị từ tổng công tơ, và không cộng thời lượng các khoảng bị chồng nhau. Nếu hai ca ghi khác nhau hoặc chồng nhau, hãy nêu rõ là nhật ký cần đối chiếu thay vì tự chọn một khoảng.
```
