import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/auth/password-forms";
import { getAppAccess } from "@/lib/auth/app-access";

export default async function SetPasswordPage() {
  const access = await getAppAccess();
  if (access.status === "owner" || access.status === "staff") {
    return (
      <main className="login-page">
        <section className="login-story" aria-label="Đặt mật khẩu Betea">
          <a className="brand" href="/login" aria-label="Betea, trang đăng nhập">
            <span className="brand-mark" aria-hidden="true">B</span>
            <span className="brand-name">betea<span className="brand-subtitle">Sổ quản lý cửa hàng</span></span>
          </a>
          <div className="login-copy">
            <p className="eyebrow">BẢO VỆ TÀI KHOẢN</p>
            <h1>Mật khẩu chỉ bạn biết.</h1>
            <p>Đặt mật khẩu riêng cho tài khoản quản lý cửa hàng.</p>
          </div>
          <p className="login-footnote">Betea không yêu cầu bạn gửi mật khẩu cho nhân viên.</p>
        </section>
        <section className="login-panel" aria-labelledby="password-title">
          <div className="login-card">
            <h2 id="password-title">Tạo mật khẩu mới</h2>
            <p>Chọn mật khẩu dài ít nhất 12 ký tự.</p>
            <SetPasswordForm />
          </div>
        </section>
      </main>
    );
  }
  if (access.status === "signed-out") redirect("/login?auth=failed");
  redirect("/setup");
}
