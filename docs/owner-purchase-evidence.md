# Chứng từ phiếu mua hàng

Ảnh hóa đơn nằm trong R2 theo đường dẫn riêng của chủ cửa hàng. Liên kết tải lên 120 giây chỉ ghi vào vùng tạm `owner-advances-staging`; khi xác nhận, server kiểm tra metadata rồi khóa bytes vào vùng `owner-advances` bằng conditional PUT `If-None-Match: *`. Database chỉ gắn chứng từ với đường dẫn đã khóa. Dùng lại link cũ chỉ có thể ghi lại vùng tạm, không ghi đè ảnh đã đính kèm. Liên kết xem hết hạn sau 5 phút; API không trả đường dẫn lưu trữ và không dùng bucket công khai.

Mỗi phiếu nhận tối đa 10 ảnh JPEG, PNG hoặc WebP, mỗi ảnh tối đa 2 MB. Ảnh phải được xác minh bằng metadata HEAD trên R2 trước khi bản ghi chứng từ được tạo. Phiếu hoàn tiền có thể gắn ảnh riêng với sự kiện hoàn.

## Dọn phiên tải bị bỏ dở

Phiên tải chưa hoàn tất được giữ qua thời hạn URL để tránh xóa ảnh đang tải. Chỉ những phiên đã hết hạn ít nhất một giờ mới đủ điều kiện dọn. Phiếu đã chốt cũng được dọn lại vùng tạm sau khoảng chờ này để xử lý trường hợp link PUT cũ bị dùng lại; ảnh chứng từ đã khóa không bị xóa. API xử lý tối đa 100 phiên mỗi lượt; nếu thao tác xóa lỗi, phiên được thử lại sau khi lease 10 phút hết hạn.

Sau khi đăng nhập bằng tài khoản chủ cửa hàng, có thể gọi endpoint dọn thủ công từ cùng website:

```js
await fetch("/api/admin/advances/evidence/cleanup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
```

Endpoint chỉ xử lý namespace của owner đang đăng nhập và trả số lượng đã dọn/lỗi, không trả đường dẫn ảnh. Phiếu chưa chốt sẽ dọn cả ảnh tạm lẫn ảnh khóa mồ côi; phiếu đã chốt chỉ dọn ảnh tạm. Phase 04 có thể gọi thao tác này từ màn hình quản lý; hiện chưa cấu hình bộ lập lịch tự động.
