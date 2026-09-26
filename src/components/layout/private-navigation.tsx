"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/", label: "Tổng quan" },
  { href: "/ledger", label: "Sổ ngày" },
  { href: "/costs", label: "Chi phí tháng" },
  { href: "/reports", label: "Báo cáo" },
  { href: "/audit", label: "Lịch sử" },
  { href: "/staff-accounts", label: "Nhân viên" },
] as const;

export function PrivateNavigation() {
  const pathname = usePathname();

  return (
    <nav className="side-nav" aria-label="Điều hướng chính">
      {navigationItems.map(({ href, label }) => {
        const isCurrent = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link className="nav-link" href={href} key={href} aria-current={isCurrent ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
