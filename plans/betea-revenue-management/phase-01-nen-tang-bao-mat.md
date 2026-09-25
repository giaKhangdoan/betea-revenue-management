# Phase 01 — Nền tảng và bảo mật

## Mục tiêu

Khởi tạo ứng dụng riêng tư cho một cửa hàng và một chủ tài khoản, đặt nền tảng giao diện thống nhất cùng mô hình đăng nhập/quyền truy cập an toàn.

## Phạm vi và công việc cụ thể

1. Khởi tạo Next.js App Router, React, TypeScript, lint/type-check scripts và cấu trúc modules theo feature.
2. Tạo shell đăng nhập/khu vực riêng tư, điều hướng chữ rõ, thiết lập giao diện sáng, font tiếng Việt duy nhất, palette tiết chế, icon tối giản, bo góc vừa phải và motion nhẹ.
3. Tạo browser và server Supabase clients bằng @supabase/ssr; xác minh claims trong server DAL và mutations. Proxy chỉ refresh phiên/redirect; dữ liệu riêng không được cache.
4. Tắt public sign-up; ghi quy trình tạo tài khoản owner thủ công và đặt secrets đúng môi trường.
5. Tạo migrations ban đầu cho cấu hình cửa hàng, owner binding và audit foundation. Thiết kế grants/RLS theo owner cho từng bảng; các migration sau phải thêm RLS/policies cùng bảng mới.
6. Ghi quyết định version/runtime và cấu hình env mẫu không chứa secrets.

## Tệp và module dự kiến

package.json, next.config.*, src/app/(auth)/login, src/app/(private)/layout, src/app/proxy.ts hoặc proxy.ts theo phiên bản đã chọn, src/lib/supabase/{browser,server}.ts, src/lib/dal/require-owner.ts, src/components/layout, src/styles/tokens.css, supabase/config.toml, supabase/migrations/*, .env.example.

## Phụ thuộc

Không phụ thuộc phase trước. Cần xác nhận môi trường preview/production trước khi tạo projects production thật; có thể dựng local/dev trước đó.

## Nghiệm thu / xác minh

- Ẩn danh không mở dashboard hay gọi mutations; phiên hợp lệ vào được; logout làm mất quyền ngay sau refresh.
- Một tài khoản authenticated khác không đọc/sửa dữ liệu của owner qua API trực tiếp.
- Mọi bảng exposed bật RLS và grants tối thiểu; service-role key không xuất hiện trong bundle/source phía client.
- Không cache dashboard riêng tư; theme checklist được đáp ứng trên desktop và màn hình nhỏ.

## Rủi ro / quyết định

Auth middleware/proxy không thay thế kiểm tra DAL/RLS. Owner-only cần predicate owner cụ thể, không chỉ policy authenticated. Cần chọn phiên bản Next.js tương thích convention proxy hiện hành.

## Truy vết user story

Nền tảng bảo mật và trải nghiệm dùng chung cho US-01–US-12.
