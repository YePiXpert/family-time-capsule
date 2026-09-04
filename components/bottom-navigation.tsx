"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAVIGATION, isNavigationItemActive } from "./navigation-items";
import { Icon } from "./ui/icons";

export function BottomNavigation({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="一级导航" className="bottom-navigation lg:hidden">
      <div className="bottom-navigation-inner">
        {PRIMARY_NAVIGATION.map((item) => {
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
