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
      <div className="sidebar-brand">
        <Link href="/" className="sidebar-brand-link">
          <span className="sidebar-brand-mark"><Icon name="book" size={24} /></span>
          <span className="min-w-0"><span className="sidebar-brand-title">小美成长记</span>
          <span className="sidebar-family">{familyName}</span></span>
        </Link>
      </div>
      <nav aria-label="一级导航" className="px-4">
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
      <nav aria-label="记录" className="sidebar-capture">
        {secondaryNavigation.map(item => <Link key={item.href} href={item.href} className={`sidebar-nav-item sidebar-nav-item-emphasis ${isNavigationItemActive(pathname, item.href) ? "is-active" : ""}`} aria-current={isNavigationItemActive(pathname, item.href) ? "page" : undefined}><Icon name={item.icon} size={21} /><span>{item.label}</span></Link>)}
      </nav>
      <div className="sidebar-account">
        <span className="sidebar-avatar" aria-hidden="true">{Array.from(userName)[0]}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{userName}</span><span className="block text-xs text-muted">{ROLE_LABELS[role]}</span></span>
        <LogoutButton />
      </div>
    </aside>
  );
}
