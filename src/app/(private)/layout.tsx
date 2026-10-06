import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAppAccess } from "@/lib/auth/app-access";
import { signOutAction } from "@/app/signout/actions";
import { PrivateNavigation } from "@/components/layout/private-navigation";

export default async function PrivateLayout({ children }: Readonly<{ children: ReactNode }>) {
  const access = await getAppAccess();
  if (access.status === "unconfigured") redirect("/login?setup=missing");
  if (access.status === "signed-out") redirect("/login");
  if (access.status === "staff") redirect("/staff/dashboard");
  if (access.status === "not-authorized") redirect("/setup");
  if (access.status === "unavailable") redirect("/login?service=unavailable");

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <Link className="brand" href="/" aria-label="Betea, tổng quan">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span className="brand-name">betea<span className="brand-subtitle">Sổ quản lý cửa hàng</span></span>
        </Link>
        <PrivateNavigation />
        <div className="rail-bottom">
          <p className="account-email">{access.email ?? "Tài khoản chủ cửa hàng"}</p>
          <Link className="text-link account-settings-link" href="/account">Tài khoản</Link>
          <form action={signOutAction}><button className="button button-plain" type="submit">Đăng xuất</button></form>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar"><span className="topbar-label">Betea · Quản lý thu chi</span><span className="status status-neutral">Chỉ chủ cửa hàng</span><form className="mobile-signout" action={signOutAction}><button className="button button-plain" type="submit">Đăng xuất</button></form></header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
