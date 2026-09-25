import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { getOwnerAccess } from "@/lib/auth/owner-access";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string }>;
}) {
  const params = await searchParams;
  const access = await getOwnerAccess();
  if (access.status === "owner") redirect("/");
  if (access.status === "not-owner") redirect("/setup");

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Giới thiệu sổ quản lý Betea">
        <a className="brand" href="/login" aria-label="Betea, trang đăng nhập">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span className="brand-name">betea<span className="brand-subtitle">Sổ quản lý cửa hàng</span></span>
        </a>
        <div className="login-copy">
          <p className="eyebrow">SỔ DOANH THU RIÊNG</p>
          <h1>Rõ doanh thu. Dễ đối chiếu.</h1>
          <p>Theo dõi doanh thu theo ca, chi phí và hình ảnh chứng từ trong một nơi.</p>
        </div>
        <p className="login-footnote">Chỉ dành cho tài khoản chủ cửa hàng được cấp quyền.</p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <h2 id="login-title">Đăng nhập Betea</h2>
          <p>Nhập email và mật khẩu của tài khoản quản lý.</p>
          {params.auth === "failed" ? (
            <div className="form-error" role="alert">Liên kết đăng nhập đã hết hạn hoặc không hợp lệ. Hãy dùng lời mời mới hoặc đăng nhập bằng mật khẩu.</div>
          ) : null}
          {access.status === "unconfigured" ? (
            <div className="login-config" role="status">Ứng dụng đang chờ kết nối Supabase. Form đăng nhập sẽ hoạt động sau khi cấu hình dịch vụ.</div>
          ) : null}
          {access.status === "unavailable" ? (
            <div className="form-error" role="alert">Chưa thể kiểm tra quyền truy cập. Vui lòng thử lại sau.</div>
          ) : null}
          <LoginForm configured={access.status !== "unconfigured" && access.status !== "unavailable"} />
          <Link className="auth-text-link" href="/auth/forgot-password">Quên hoặc chưa đặt mật khẩu?</Link>
        </div>
      </section>
    </main>
  );
}
