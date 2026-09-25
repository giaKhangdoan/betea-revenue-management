import { PasswordResetRequestForm } from "@/components/auth/password-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="login-page">
      <section className="login-story" aria-label="Khôi phục tài khoản Betea">
        <a className="brand" href="/login" aria-label="Betea, trang đăng nhập">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span className="brand-name">betea<span className="brand-subtitle">Sổ quản lý cửa hàng</span></span>
        </a>
        <div className="login-copy">
          <p className="eyebrow">BẢO VỆ TÀI KHOẢN</p>
          <h1>Đặt lại mật khẩu an toàn.</h1>
          <p>Liên kết đặt lại chỉ được gửi đến email bạn nhập và sẽ quay lại website Betea.</p>
        </div>
        <p className="login-footnote">Chỉ chủ cửa hàng được cấp quyền mới xem được sổ.</p>
      </section>
      <section className="login-panel" aria-labelledby="reset-title">
        <div className="login-card">
          <h2 id="reset-title">Khôi phục mật khẩu</h2>
          <p>Nhập email đã được mời làm tài khoản chủ cửa hàng.</p>
          <PasswordResetRequestForm />
        </div>
      </section>
    </main>
  );
}
