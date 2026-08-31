import { requireFamily } from "@/lib/family/context";

/**
 * (app) 组：所有依赖家庭数据的页面。
 * 认证守卫在上级 (protected)/layout；这里再确保已绑定家庭，
 * 未完成 onboarding 的用户统一送去 /onboarding（layout 拿不到 pathname，
 * 因此用嵌套路由组而不是在上级判断，见 docs/DECISIONS.md D-007）。
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireFamily();
  return <>{children}</>;
}
