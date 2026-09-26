# Phase 04 — Dashboard staff và ảnh chứng từ

## Mục tiêu

Tạo màn hình staff dễ dùng và phạm vi dữ liệu đúng; chuyển ảnh từ staff tới admin qua bucket private.

## Phạm vi và công việc cụ thể

1. Tạo dashboard staff riêng hiển thị đúng các ngày Thứ 2–Chủ nhật của tuần hiện tại, doanh thu từng ngày; không có tổng tuần/tháng, lợi nhuận, tháng khác, cost hoặc điện tính toán.
2. Ngày đã qua trong tuần là chỉ đọc; ngày tương lai không cho nhập; route/query sửa tuần khác trả về current week hoặc access denied.
3. Tạo luồng nhiều ảnh, nhóm `Bluebook`, `Vệ sinh`, `Sắp xếp`; ảnh Bluebook có thể gắn ca, ảnh checklist gắn ngày. Giữ định dạng JPEG/PNG/WebP, 5 MB/ảnh, private bucket và signed URL 5 phút nếu được giữ đúng giới hạn hiện tại.
4. Sửa metadata/object path/Storage policy để staff được upload ngày hiện tại theo active membership và owner/store path; admin xem ảnh; không cho staff đọc/ghi file admin hoặc bucket tùy ý.
5. Chỉ admin có nút xác nhận vệ sinh/sắp xếp và đối chiếu Bluebook; ảnh staff upload không tự đổi trạng thái xác nhận.
6. Cập nhật view owner để ảnh và số liệu staff hiển thị ngay; dùng Supabase Realtime hoặc refresh/poll có giới hạn để đạt mục tiêu p95 5 giây.
7. Giao diện theo guardrails app: sáng, một font tiếng Việt, ít màu, nhãn chữ rõ, ít thao tác, không cần icon phức tạp; trạng thái đã lưu/lỗi/đang tải rõ trên điện thoại.

## Tệp và module dự kiến

`src/app/(staff)/dashboard/page.tsx`, `src/app/(staff)/entry/**`, `src/components/layout/private-navigation.tsx` hoặc navigation staff riêng, `src/components/ledger/photo-manager.tsx` hoặc component staff evidence, `src/app/(private)/ledger/[date]/page.tsx`, `src/app/(private)/ledger/photo-actions.ts`, migrations cho `day_photos` và `storage.objects` policies, `src/app/globals.css`.

## Phụ thuộc

Phase 01 cho RLS/Storage; Phase 02 role routing; Phase 03 cho staff entries và khóa ngày. Owner evidence confirmation vẫn phải hoạt động trong lúc chuyển policy.

## Nghiệm thu / xác minh

- Staff thấy từng ngày thuộc tuần hiện tại, không thấy widget tổng kỳ/target/lợi nhuận/chi phí; URL tuần khác không trả dữ liệu.
- Ảnh Bluebook/vệ sinh/sắp xếp tải nhiều file; owner xem ảnh thật; signed URL private hết hạn; anon và account không thuộc store bị chặn. Deactivate membership chặn tạo URL mới ngay; URL đã ký trước đó có thể dùng tới hạn hết hiệu lực, tối đa 5 phút. Kiểm tra cả hai hành vi này bằng một URL lấy trước khi deactivate.
- Staff không đánh dấu vệ sinh/đối soát; admin là người duy nhất cập nhật checklist và reconciliation.
- Đo lặp 20 lần thao tác save/upload tới lúc admin UI nhận được cập nhật trên cùng môi trường preview; p95 từ submit thành công tới khi admin thấy dữ liệu/ảnh không quá 5 giây. Chạy thêm production smoke với ảnh thử được cho phép.

## Rủi ro / quyết định

- Bucket private không đồng nghĩa file path an toàn; Storage policy phải xét membership, ngày nghiệp vụ và nhóm ảnh.
- Signed URL đã phát hành là bearer URL và không bị thu hồi tức thì khi khóa membership; giới hạn thời hạn tối đa 5 phút, kiểm tra URL mới bị từ chối sau deactivate và URL cũ hết hạn đúng giới hạn.
- Database backup không chứa Storage objects; giữ hướng dẫn backup object độc lập.
- Nếu Realtime không đạt latency ổn định, dùng polling chu kỳ 1 giây, dừng khi tab ẩn; giữ ít nhất 1 giây headroom cho request/render và chỉ phát hành khi phép đo end-to-end 20 lần vẫn đạt p95 không quá 5 giây.

## Truy vết user story

US-06, US-07, US-08 — P1; US-09 — P2.
