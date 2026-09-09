"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAVIGATION, filterNavigationByCapabilities, isNavigationItemActive } from "./navigation-items";
import { Icon } from "./ui/icons";
import type { FamilyCapability } from "@/lib/authz/policy";

export function BottomNavigation({ capabilities, simpleMode = false }: { capabilities: readonly FamilyCapability[]; simpleMode?: boolean }) {
  const pathname = usePathname();
  const navigation = filterNavigationByCapabilities(PRIMARY_NAVIGATION, capabilities);
  return (
    <nav aria-label="一级导航" className="bottom-navigation lg:hidden">
      {capabilities.includes("capture:create") && pathname !== "/capture" ? <Link href="/capture" className="floating-capture" aria-label="记录一刻"><Icon name="capture" size={22} /><span>记录一刻</span></Link> : null}
      <div
        className="bottom-navigation-inner"
        style={{ gridTemplateColumns: `repeat(${navigation.length}, minmax(0, 1fr))` }}
      >
        {navigation.map((item) => {
          const active = isNavigationItemActive(pathname, item.href);
          // 简洁模式用更直白的动词，避免「记录」这类抽象名词。
          const label = item.label;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`bottom-nav-item ${item.emphasis ? "bottom-nav-item-emphasis" : ""} ${active ? "is-active" : ""}`}
            >
              <span className="relative">
                <Icon name={item.icon} size={item.emphasis ? (simpleMode ? 30 : 27) : simpleMode ? 26 : 23} />
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
