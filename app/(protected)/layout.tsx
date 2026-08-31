import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { getAuth } from "@/lib/auth/auth";
import {
  hasFamilyCapability,
  type FamilyCapability,
} from "@/lib/authz/policy";
import { requireUserBinding } from "@/lib/family/context";

const NAV: ReadonlyArray<{
  href: string;
  label: string;
  capability?: FamilyCapability;
}> = [
  { href: "/capture", label: "记录", capability: "capture:create" },
  { href: "/inbox", label: "收件箱" },
  { href: "/timeline", label: "时光轴" },
  { href: "/search", label: "搜索" },
  { href: "/family", label: "家人" },
  { href: "/capsules", label: "胶囊" },
  { href: "/settings", label: "设置" },
] as const;

/**
 * 受保护区域：所有需要登录的路由都放在 (protected) 路由组下。
 * 不用 middleware 是因为 SQLite（better-sqlite3）无法在 Edge 运行时访问数据库，
 * 布局层守卫同样能覆盖组内全部页面（docs/ARCHITECTURE.md）。
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 先取 headers()（触发动态渲染 bailout），再实例化 auth——
  // 避免构建期静态分析时打开数据库
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");
  const binding = await requireUserBinding(session.user.id);
  const visibleNav = NAV.filter(
    (item) =>
      !item.capability || hasFamilyCapability(binding.role, item.capability),
  );

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            家庭时间胶囊
          </Link>
          <nav
            aria-label="一级导航"
            className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-foreground/70"
          >
            {visibleNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-foreground/60 sm:inline">
              {session.user.name}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
