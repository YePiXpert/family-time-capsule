import { requireFamily } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { countInbox } from "@/lib/inbox/service";
import { AppShell } from "@/components/app-shell";

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
  const { familyId } = await requireFamily();
  const [family, inboxCount] = await Promise.all([
    getFamily(familyId),
    countInbox(familyId),
  ]);
  return (
    <AppShell familyName={family?.name ?? "家庭档案"} inboxCount={inboxCount}>
      {children}
    </AppShell>
  );
}
