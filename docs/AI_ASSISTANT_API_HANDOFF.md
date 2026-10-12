# Bàn giao dữ liệu Betea cho hệ thống AI phân tích

Tài liệu này mô tả API và dữ liệu theo mã nguồn hiện tại. Tài liệu không chứa khóa, mật khẩu, token hay URL có quyền truy cập riêng tư.

## 1. Kết luận về khả năng tích hợp hiện tại

Mã nguồn hiện có REST API đọc chỉ số điện dành cho AI bên ngoài tại `GET /api/ai/v1/electricity`. API này dùng bearer token riêng và chỉ trả chỉ số điện cùng kWh sử dụng; các trang dashboard và báo cáo khác vẫn đọc bằng Supabase server client gắn với phiên đăng nhập. Các thao tác ghi được triển khai bằng Next.js Server Actions; đây là giao tiếp nội bộ của giao diện, không phải API ổn định để cấp cho nhà cung cấp AI.

Không gửi tài khoản đăng nhập, cookie phiên, khóa `SUPABASE_SERVICE_ROLE_KEY`, khóa Supabase hay quyền truy cập trực tiếp database cho bên thứ ba. Token API điện đã được lưu dưới dạng biến nhạy cảm `BETEA_ELECTRICITY_API_TOKEN` trong môi trường production của Vercel; endpoint có hiệu lực khi phiên bản mã nguồn này được deploy.

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
| `GET /api/ai/v1/electricity?date=YYYY-MM-DD` hoặc `?from=YYYY-MM-DD&to=YYYY-MM-DD` | `Authorization: Bearer <BETEA_ELECTRICITY_API_TOKEN>` | Đọc chỉ số công tơ và kWh tiêu thụ; giới hạn 31 ngày mỗi request | Có, chỉ khi owner cấp token tích hợp |
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
- Thuê, lương, nước, bill điện và điều chỉnh chi phí tháng được phân bổ theo số ngày lịch trong tháng, giữ nguyên tổng sau khi chia. Chi phí phát sinh nhập theo ngày.
- Lợi nhuận tháng/năm = doanh thu − chi phí hoạt động − khoản admin đã ghi nhận vào lợi nhuận − COGS tháng từ POS. Tuần/khoảng ngày hiển thị lợi nhuận trước COGS vì COGS chỉ có số theo tháng. Phiếu mua admin chỉ được tính khi owner ghi nhận/post vào lợi nhuận; không tự cộng mọi phiếu mua.
- Khoản mua vật tư/nguyên liệu trong sổ ứng tiền theo dõi số admin tự ứng và hoàn ứng; nguyên liệu nhập kho không tự cộng vào lợi nhuận. Chi phí nhân viên trả từ doanh thu quán được ghi riêng trong sổ ngày.
- SOP nhân viên là phiên bản đã được owner công bố. Nó không nên được dùng để suy ra hoặc trả về COGS/giá bán riêng tư.

## 6. Tích hợp AI ngoài phạm vi số điện

Endpoint điện đã có trong mã nguồn. Nếu sau này cần AI đọc doanh thu, lợi nhuận, khoản mua, kho hoặc giá vốn, các API bên dưới vẫn chỉ là **đề xuất, chưa được triển khai**; không dùng token điện để đọc các miền dữ liệu này.

Bot gọi endpoint điện với header bearer riêng:

```http
GET https://betea-revenue-management.vercel.app/api/ai/v1/electricity?date=2026-10-11
Authorization: Bearer <BETEA_ELECTRICITY_API_TOKEN>
```

Có thể truy vấn nhiều ngày bằng `from` và `to` (tối đa 31 ngày). Token phải là chuỗi ngẫu nhiên tối thiểu 32 ký tự và đặt trong biến môi trường Vercel `BETEA_ELECTRICITY_API_TOKEN`; không đặt token trong URL hoặc mã nguồn. Mẫu tạo token bằng Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Phản hồi có `timezone`, đơn vị `kWh`, thời điểm tạo và `items`. Mỗi item có `status` là `complete`, `missing_reading`, `meter_decrease` hoặc `no_record`, ba số đọc công tơ và mức dùng trong giờ hoạt động, qua đêm, tổng ngày. Tổng ngày chưa hoàn tất nếu chưa có chỉ số sáng hôm sau.

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

1. API hiện dùng một bearer token ngẫu nhiên 256-bit, lưu dưới dạng biến nhạy cảm Vercel. Token chỉ đọc điện cho cửa hàng Betea; xoay vòng bằng cách cập nhật biến môi trường và deploy lại. Chưa có hạn sử dụng hoặc nhiều token theo từng nhà cung cấp.
2. Chỉ gửi token qua phần quản lý secrets của bot Discord. Không đưa vào trình duyệt, prompt/chat, repo, URL query hoặc log. Không dùng mật khẩu owner/nhân viên, cookie trình duyệt hay `SUPABASE_SERVICE_ROLE_KEY`.
3. Endpoint tự khóa `owner_id`, chỉ chọn hai cột chỉ số điện, chỉ hỗ trợ GET và giới hạn tối đa 31 ngày mỗi lần. Chưa có rate limit hay audit log riêng cho các lần đọc API.
4. Supabase service-role key chỉ được dùng trong route phía server và không được trả về cho bên AI. Không cấp quyền database, quyền RPC hay public bucket cho bot.
5. Dữ liệu API không gồm doanh thu, lợi nhuận, nhân viên, COGS, khoản mua, ảnh hoặc chứng từ.
6. Phản hồi không được cache (`Cache-Control: private, no-store, max-age=0`).

## 8. Thông tin cần bên làm AI nhận

Có thể gửi tài liệu này để mô tả cấu trúc và semantics. Sau khi phiên bản API được deploy, chuyển URL endpoint và bearer token cho bot qua khu vực secrets của dịch vụ tích hợp. Không ghi token vào repo, prompt công khai hay URL query.
