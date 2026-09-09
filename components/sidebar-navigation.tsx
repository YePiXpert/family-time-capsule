"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAVIGATION, SECONDARY_NAVIGATION, filterNavigationByCapabilities, isNavigationItemActive } from "./navigation-items";
import { Icon } from "./ui/icons";
import { LogoutButton } from "./logout-button";
import type { DisplayMode } from "@/lib/display-mode";
import type { FamilyCapability, FamilyRole } from "@/lib/authz/policy";

const ROLE_LABELS: Record<FamilyRole, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "整理者",
  contributor: "贡献者",
  viewer: "只读成员",
};

export function SidebarNavigation({ familyName, userName, role, capabilities }: { familyName: string; inboxCount: number; userName: string; role: FamilyRole; capabilities: readonly FamilyCapability[]; simpleMode?: boolean; displayMode?: DisplayMode }) {
  const pathname = usePathname();
  const primaryNavigation = filterNavigationByCapabilities(PRIMARY_NAVIGATION, capabilities);
  const secondaryNavigation = filterNavigationByCapabilities(SECONDARY_NAVIGATION, capabilities);
  return (
    <aside className="sidebar-navigation" aria-label="应用导航">
      <div className="px-5 pb-5 pt-7">
        <Link href="/" className="block rounded-lg focus-visible:outline-offset-4">
          <span className="page-eyebrow">小美成长记</span>
          <span className="mt-1 block truncate text-lg font-semibold">{familyName}</span>
        </Link>
      </div>
      <nav aria-label="一级导航" className="mt-5 px-3">
        <ul className="space-y-1">
          {primaryNavigation.map((item) => {
            const active = isNavigationItemActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={`sidebar-nav-item ${item.emphasis ? "sidebar-nav-item-emphasis" : ""} ${active ? "is-active" : ""}`}>
                  <Icon name={item.icon} size={21} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav aria-label="记录" className="mt-auto px-3 py-5">
        {secondaryNavigation.map(item => <Link key={item.href} href={item.href} className="sidebar-nav-item" aria-current={isNavigationItemActive(pathname, item.href) ? "page" : undefined}><Icon name={item.icon} size={21} /><span>{item.label}</span></Link>)}
      </nav>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line px-5 py-4">
        <span className="min-w-0 truncate text-sm text-muted">{userName} · {ROLE_LABELS[role]}</span>
        <LogoutButton />
      </div>
    </aside>
  );
}
