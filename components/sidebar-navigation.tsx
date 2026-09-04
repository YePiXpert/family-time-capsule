"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAVIGATION, SECONDARY_NAVIGATION, filterNavigationByCapabilities, isNavigationItemActive } from "./navigation-items";
import { Icon } from "./ui/icons";
import { LogoutButton } from "./logout-button";
import type { FamilyCapability, FamilyRole } from "@/lib/authz/policy";

const ROLE_LABELS: Record<FamilyRole, string> = {
  admin: "管理员",
  editor: "整理者",
  contributor: "贡献者",
  viewer: "只读成员",
};

export function SidebarNavigation({ familyName, inboxCount, userName, role, capabilities }: { familyName: string; inboxCount: number; userName: string; role: FamilyRole; capabilities: readonly FamilyCapability[] }) {
  const pathname = usePathname();
  const primaryNavigation = filterNavigationByCapabilities(PRIMARY_NAVIGATION, capabilities);
  const secondaryNavigation = filterNavigationByCapabilities(SECONDARY_NAVIGATION, capabilities);
  return (
    <aside className="sidebar-navigation" aria-label="应用导航">
      <div className="px-5 pb-5 pt-7">
        <Link href="/" className="block rounded-lg focus-visible:outline-offset-4">
          <span className="page-eyebrow">家庭时间胶囊</span>
          <span className="mt-1 block truncate text-lg font-semibold">{familyName}</span>
        </Link>
      </div>
      <Link href="/search" className="sidebar-search mx-4">
        <Icon name="search" size={19} />
        <span>搜索家庭记忆</span>
      </Link>
      <nav aria-label="一级导航" className="mt-5 px-3">
        <ul className="space-y-1">
          {primaryNavigation.filter((item) => item.href !== "/more").map((item) => {
            const active = isNavigationItemActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={`sidebar-nav-item ${item.emphasis ? "sidebar-nav-item-emphasis" : ""} ${active ? "is-active" : ""}`}>
                  <Icon name={item.icon} size={21} />
                  <span>{item.label}</span>
                  {item.href === "/inbox" && inboxCount > 0 ? <span className="nav-count ml-auto" aria-label={`${inboxCount} 条待整理`}>{inboxCount > 99 ? "99+" : inboxCount}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mx-5 my-5 border-t border-line" />
      <nav aria-label="更多功能" className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
        <p className="px-3 pb-2 text-xs font-medium tracking-widest text-faint">更多</p>
        <ul className="space-y-0.5">
          {secondaryNavigation.filter((item) => item.href !== "/search").map((item) => {
            const active = isNavigationItemActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={`sidebar-nav-item sidebar-nav-item-secondary ${active ? "is-active" : ""}`}>
                  <Icon name={item.icon} size={19} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
        <span className="min-w-0 truncate text-sm text-muted">{userName} · {ROLE_LABELS[role]}</span>
        <LogoutButton />
      </div>
    </aside>
  );
}
