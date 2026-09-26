import Link from "next/link";
import { getAppAccess } from "@/lib/auth/app-access";
import { redirect } from "next/navigation";

export default async function SetupPage() {
  const access = await getAppAccess();
  if (access.status === "owner") redirect("/");
  if (access.status === "staff") redirect("/staff/dashboard");

  return (
    <main className="login-page">
      <section className="login-story">
        <a className="brand" href="/login"><span className="brand-mark">B</span><span className="brand-name">betea<span className="brand-subtitle">Sổ quản lý cửa hàng</span></span></a>
        <div className="login-copy"><p className="eyebrow">CẤP QUYỀN TRUY CẬP</p><h1>Tài khoản này chưa được cấp quyền Betea.</h1><p>Chủ cửa hàng cần tạo hoặc kích hoạt tài khoản này trước khi sử dụng.</p></div>
      </section>
        <section className="login-panel"><div className="login-card"><h2>Chưa có quyền truy cập</h2><p>Liên hệ chủ cửa hàng để được cấp tài khoản hoặc mở lại quyền truy cập.</p><Link className="button button-secondary" href="/login">Quay lại đăng nhập</Link></div></section>
    </main>
  );
}
