# Phase 05 — Đồng bộ bản nháp Canva

**ID:** `phase-05-canva-draft-sync`<br>
**Stories:** US-05 (P1)

## Mục tiêu

Sau khi SOP được lưu ở Betea, tạo/cập nhật bản nháp trên bản sao Canva; owner mở draft để kiểm tra rồi tự bấm Publish.

## Công việc

1. Đăng ký/cấu hình Canva integration và OAuth scopes cần thiết; giữ client secret/refresh token server-side, không lưu token trong browser, SOP payload hoặc logs.
2. Dùng đúng bản sao của link người dùng đưa; cấu hình data fields/dataset cho tên món, size, nguyên liệu/định lượng và bước SOP. Không gửi trường cost.
3. Sau khi SOP được lưu, enqueue job cập nhật draft; coalesce thay đổi mới khi job trước còn pending để tránh draft lỗi thời/nhân bản thiết kế.
4. Tích hợp Autofill async create/get job; nếu dùng `update_design`, bật chỉ trong integration gate vì API hiện được đánh dấu preview.
5. Lưu trạng thái sync (queued/running/succeeded/failed), error ngắn đã lọc secrets, design ID và URL draft; có retry owner-only và hiển thị thời điểm dữ liệu draft.
6. Betea cung cấp link để owner mở draft trong Canva; owner kiểm tra bố cục/đủ nội dung rồi tự bấm Publish. Không gọi publish tự động.
7. Xác minh bản copy đã publish giữ URL mà staff cần dùng; trước xác nhận này không thay link đang phát hành cho nhân viên.

## Files/modules

- `src/lib/canva/client.ts`, `oauth.ts`, `autofill.ts` (mới, server-only).
- `src/app/api/integrations/canva/callback/route.ts` (mới; theo Next 16.3.6 docs).
- `src/app/(private)/canva/` và actions/status component (mới).
- `supabase/migrations/<timestamp>_canva_sync.sql` lưu job metadata/config reference, không lưu secret thuần.
- Server-only environment configuration và deployment docs.

## Dependencies

- Phase 01 Canva feasibility gate đã xác nhận account có quyền Autofill/API và cách tạo/cập nhật copy.
- Phase 04 có staff-safe SOP revision; Canva nhận duy nhất projection an toàn này.

## Acceptance / verification

- SOP edit tạo/cập nhật đúng bản sao và job status có thể theo dõi; job failure không mất nội dung ở Betea.
- Design gốc không đổi; Canva payload không chứa cost/giá bán/lãi.
- Owner có thể mở đúng draft và tự publish; hệ thống không thực hiện publish.
- Đường dẫn nhân viên giữ ổn định sau lần test republish; nếu URL đổi ngoài dự kiến, phase chưa đạt và rollout dừng.
- OAuth refresh, revoke/disconnect và API error handling không lộ token trong client/logs.

## Risks / notes

- Autofill chỉ dùng được với Canva plan/user có access; quyền “dùng bình thường” chưa chứng minh API access.
- Canva API `update_design` hiện là preview; nếu không khả dụng, không tự chuyển sang phát sinh URL mới mà cần owner quyết định.
- Tài liệu công khai chưa đưa ra publish Website endpoint chung; vì thế publish vẫn là thao tác thủ công của owner.
