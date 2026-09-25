import Link from "next/link";
import { getOwnerAccess } from "@/lib/auth/owner-access";
import { redirect } from "next/navigation";

export default async function SetupPage() {
  const access = await getOwnerAccess();
  if (access.status === "owner") redirect("/");

  return (
    <main className="login-page">
      <section className="login-story">
        <a className="brand" href="/login"><span className="brand-mark">B</span><span className="brand-name">betea<span className="brand-subtitle">Sổ quản lý cửa hàng</span></span></a>
        <div className="login-copy"><p className="eyebrow">CẤP QUYỀN TRUY CẬP</p><h1>Tài khoản này chưa được cấp quyền chủ cửa hàng.</h1><p>Dữ liệu chỉ mở cho tài khoản Betea đã được xác nhận.</p></div>
      </section>
      <section className="login-panel"><div className="login-card"><h2>Chưa có quyền truy cập</h2><p>Nếu đây là tài khoản quản lý, hãy kiểm tra lại tài khoản chủ cửa hàng đã được cấp trong Supabase.</p><Link className="button button-secondary" href="/login">Quay lại đăng nhập</Link></div></section>
    </main>
  );
}
