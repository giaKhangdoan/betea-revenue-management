"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const overviewLink = { href: "/", label: "Tổng quan" } as const;

const navigationGroups = [
  {
    id: "operations",
    label: "Vận hành",
    items: [
      { href: "/ledger", label: "Sổ ngày" },
      { href: "/inventory", label: "Kho" },
      { href: "/advances", label: "Khoản chi" },
    ],
  },
  {
    id: "products",
    label: "Sản phẩm",
    items: [
      { href: "/product-costs", label: "Giá vốn món" },
      { href: "/sop", label: "SOP pha chế" },
    ],
  },
  {
    id: "management",
    label: "Quản lý",
    items: [
      { href: "/staff-accounts", label: "Nhân viên" },
      { href: "/costs", label: "Chi phí tháng" },
      { href: "/reports", label: "Báo cáo" },
      { href: "/audit", label: "Lịch sử" },
    ],
  },
] as const;

function isCurrentRoute(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function PrivateNavigation() {
  const pathname = usePathname();

  return (
    <nav className="side-nav" aria-label="Điều hướng chính">
      <Link className="nav-link nav-overview" href={overviewLink.href} aria-current={isCurrentRoute(pathname, overviewLink.href) ? "page" : undefined}>
        {overviewLink.label}
      </Link>
      {navigationGroups.map(({ id, label, items }) => <details
        className="nav-group"
        data-group={id}
        key={id}
        open={items.some(({ href }) => isCurrentRoute(pathname, href))}
      >
        <summary className="nav-group-label">{label}</summary>
        <div className="nav-group-links">
          {items.map(({ href, label: itemLabel }) => <Link className="nav-link" href={href} key={href} aria-current={isCurrentRoute(pathname, href) ? "page" : undefined}>
            {itemLabel}
          </Link>)}
        </div>
      </details>)}
    </nav>
  );
}
