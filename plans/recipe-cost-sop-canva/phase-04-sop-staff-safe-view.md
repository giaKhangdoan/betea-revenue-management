# Phase 04 — Biên tập SOP và màn hình staff an toàn

**ID:** `phase-04-sop-staff-safe-view`<br>
**Stories:** US-05–US-06 (P1)

## Mục tiêu

Cho owner biên tập hướng dẫn pha chế liên kết với recipe; staff chỉ xem hướng dẫn và định lượng cần thiết, không thể truy cập cost.

## Công việc

1. Thêm editor SOP cho món/size: tiêu đề, thứ tự bước, hướng dẫn, định lượng tham chiếu, ghi chú và trạng thái draft/published.
2. Tái sử dụng định lượng từ recipe canonical khi phù hợp; cảnh báo nếu SOP đang tham chiếu revision cũ sau khi recipe đổi.
3. Tạo safe SOP revision/projection riêng chỉ chứa tên món, size, nguyên liệu/định lượng pha và hướng dẫn. Loại bỏ giá mua, unit cost, tổng cost, giá bán, lãi và margin.
4. Thêm staff route `/staff/sop` và chi tiết theo món/size qua `requireStaff`; staff chỉ đọc revision đã được owner cho xem.
5. Dùng allowlist server-side cho payload. Không trả canonical recipe records rồi ẩn trường cost trên client.
6. Giữ quyền sửa/publish nội dung SOP ở owner; staff là read-only theo yêu cầu hiện có.

## Files/modules

- `src/app/(private)/sop/` và server actions cho owner (mới).
- `src/app/(staff)/staff/sop/` cho employee view (mới).
- `src/components/sop/` cho editor, preview và staff instructions (mới).
- `supabase/migrations/<timestamp>_sop_safe_revisions.sql`.
- `supabase/tests/sop_staff_boundary.sql`.
- `src/components/layout/private-navigation.tsx` và staff navigation component nếu có.

## Dependencies

- Phase 02 canonical recipes and version model.
- Phase 03 owner workspace establishes manageable product/size records.

## Acceptance / verification

- Owner edits and previews SOP for each S/M/L; a recipe change shows stale SOP status when quantities no longer align.
- Staff sees only active instructions and preparation quantities; staff cannot read cost/price/history via UI, actions, route handlers or Supabase API.
- Draft SOP stays owner-only until explicitly made available to employees/Canva.
- Existing staff login/dashboard and admin revenue/cost monthly flows continue working.

## Risks / notes

- Supabase views can have different RLS semantics; prefer explicit safe revision table or carefully tested secure RPC instead of exposing canonical rows through a default view.
- SOP must not accidentally include hidden HTML/metadata fields containing cost when serialized to Canva.
