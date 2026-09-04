import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNavigation } from "./bottom-navigation";
import { SidebarNavigation } from "./sidebar-navigation";
import { Icon } from "./ui/icons";

export function AppShell({ children, familyName, inboxCount }: { children: ReactNode; familyName: string; inboxCount: number }) {
  return (
    <div className="app-shell">
      <SidebarNavigation familyName={familyName} inboxCount={inboxCount} />
      <header className="mobile-app-header lg:hidden">
        <Link href="/" className="min-w-0 rounded-md py-1">
          <span className="block text-[10px] font-semibold tracking-[0.16em] text-accent">家庭时间胶囊</span>
          <span className="block truncate text-base font-semibold">{familyName}</span>
        </Link>
        <Link href="/search" className="icon-button" aria-label="搜索家庭记忆">
          <Icon name="search" size={22} />
        </Link>
      </header>
      <div className="app-shell-content">{children}</div>
      <BottomNavigation inboxCount={inboxCount} />
    </div>
  );
}
