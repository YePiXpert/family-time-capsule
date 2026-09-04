"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAVIGATION, filterNavigationByCapabilities, isNavigationItemActive } from "./navigation-items";
import { Icon } from "./ui/icons";
import type { FamilyCapability } from "@/lib/authz/policy";

export function BottomNavigation({ inboxCount, capabilities }: { inboxCount: number; capabilities: readonly FamilyCapability[] }) {
  const pathname = usePathname();
  const navigation = filterNavigationByCapabilities(PRIMARY_NAVIGATION, capabilities);
  return (
    <nav aria-label="一级导航" className="bottom-navigation lg:hidden">
      <div
        className="bottom-navigation-inner"
        style={{ gridTemplateColumns: `repeat(${navigation.length}, minmax(0, 1fr))` }}
      >
        {navigation.map((item) => {
          const active = isNavigationItemActive(pathname, item.href, true);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`bottom-nav-item ${item.emphasis ? "bottom-nav-item-emphasis" : ""} ${active ? "is-active" : ""}`}
            >
              <span className="relative">
                <Icon name={item.icon} size={item.emphasis ? 27 : 23} />
                {item.href === "/inbox" && inboxCount > 0 ? <span className="nav-count nav-count-mobile" aria-label={`${inboxCount} 条待整理`}>{inboxCount > 99 ? "99+" : inboxCount}</span> : null}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
