import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/auth";
import { requireUserBinding } from "@/lib/family/context";

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
  await requireUserBinding(session.user.id);
  return <div className="flex min-h-screen flex-1 flex-col">{children}</div>;
}
