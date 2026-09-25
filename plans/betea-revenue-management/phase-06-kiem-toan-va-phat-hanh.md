# Phase 06 — Audit, hardening và phát hành

## Mục tiêu

Hoàn tất dấu vết chỉnh sửa và runbook vận hành; kiểm chứng quyền truy cập, backup/restore và phát hành an toàn.

## Phạm vi và công việc cụ thể

1. Hiển thị lịch sử chỉnh sửa doanh thu/chi phí đã chốt: ai, khi nào, trước/sau. Audit event bất biến với thao tác thông thường; ghi log transactionally qua trigger hoặc server mutation đã rà quyền.
2. Rà bảo mật toàn bộ bảng, views, functions, server actions, endpoints và Storage objects. Views dùng security_invoker phù hợp hoặc grants bị thu hồi; loại mọi secret khỏi client.
3. Cấu hình preview và production tách biệt; Vercel env riêng, Supabase projects riêng, migrations versioned và quy trình deploy có kiểm soát. Viết runbook cutover gồm ngày go-live, thứ tự migrate/seed theo Q2, kiểm tra owner login và mốc bắt đầu đã chốt, tiêu chí chuyển sổ sang nguồn chính thức và đường lui. Tạo owner thủ công, bật TLS và hướng dẫn recovery; cân nhắc MFA cho owner.
4. Chọn gói/giới hạn Storage, nơi lưu backup ảnh độc lập, retention và người có quyền đọc backup. Viết quy trình backup database + ảnh và thử phục hồi vào môi trường không-production.
5. Nếu Q2 chọn nhập dữ liệu Excel tháng 9: chỉ nạp sheet Betea từ 01/09, đối chiếu từng ngày/ca với workbook; kiểm tra tổng nguồn 36.927.684đ và tránh dùng tổng P&L lỗi 8.932.314đ. Nếu chọn sổ trống, xác nhận không có seed.
6. Thực hiện kiểm tra release: ma trận anon/owner/account khác, signed URL hết hạn, phân bổ/money invariants, khôi phục ảnh và luồng UI chính. Chỉ phát hành production sau khi Q3 chốt hosting, gói và backup.

## Tệp và module dự kiến

src/features/audit, src/app/(private)/audit/page.tsx, supabase/migrations/*_audit.sql, supabase/seed hoặc script import dùng một lần nếu được chọn, docs/runbooks/deploy.md, docs/runbooks/backup-restore.md, cấu hình Vercel/Supabase theo môi trường.

## Phụ thuộc

Phases 01–05. Q2 quyết định có import dữ liệu hay không; Q3 bắt buộc trước production; Q1–Q5 phải được ghi nhận trong implementation decisions.

## Nghiệm thu / xác minh

- Sửa bản ghi đã chốt tạo lịch sử actor/time/before/after và không thể sửa audit qua tài khoản ứng dụng.
- Ma trận quyền chứng minh anon và account ngoài owner không đọc/sửa database hay ảnh.
- Preview không trỏ vào production; secret đúng môi trường; migration có phiên bản và deploy lặp lại an toàn.
- Có backup độc lập ảnh và database; phục hồi thử thành công trong môi trường cô lập.
- Nếu import, tổng sau import đối chiếu các dòng nguồn; nếu không, database production bắt đầu rỗng đúng lựa chọn.

## Rủi ro / quyết định

Backup Supabase database không bao gồm Storage files. Mất private bucket sẽ làm mất bằng chứng dù metadata còn; không release nếu chưa có chính sách backup ảnh và thử restore. Không import công thức P&L tháng 3 từ file cũ.

## Truy vết user story

US-12; kiểm soát security/release cho US-01–US-11.
