import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAppAccess } from "@/lib/auth/app-access";
import { signOutAction } from "@/app/signout/actions";

export default async function StaffLayout({ children }: Readonly<{ children: ReactNode }>) {
  const access = await getAppAccess();
  if (access.status === "owner") redirect("/");
  if (access.status === "signed-out") redirect("/login");
  if (access.status !== "staff") redirect("/setup");

  return (
    <div className="staff-shell">
      <header className="staff-topbar">
        <Link className="brand" href="/staff/dashboard" aria-label="Betea, khu vực nhân viên">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span className="brand-name">betea<span className="brand-subtitle">Khu vực nhân viên</span></span>
        </Link>
        <div className="staff-account-identity"><span>{access.displayName}</span><form action={signOutAction}><button className="button button-plain" type="submit">Đăng xuất</button></form></div>
      </header>
      <main className="staff-content">{children}</main>
    </div>
  );
}
