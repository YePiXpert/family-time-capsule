import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { getAppVersion } from "@/lib/export/service";
import { listRecentAudit } from "@/lib/audit/service";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "设置 · Family Time Capsule" };

const AUDIT_LABEL: Record<string, string> = {
  "export.created": "导出完整备份",
  "restore.completed": "从备份恢复",
  "invitation.created": "创建账号邀请",
  "invitation.revoked": "撤销账号邀请",
  "invitation.accepted": "接受账号邀请",
  "account.disabled": "停用账号",
  "account.enabled": "恢复账号",
  "account.role_changed": "调整账号角色",
  "person.guardian_changed": "调整监护人身份",
  "child_later.policy_changed": "调整孩子解锁年龄",
  "child_later.manually_unlocked": "手工解锁孩子内容",
  "ai.consent_enabled": "启用外部 AI 处理",
  "ai.consent_revoked": "关闭外部 AI 处理",
  "ai.job_cancelled": "停止 AI 后台任务",
  "ai.job_retried": "重试 AI 后台任务",
};

export default async function SettingsPage(props: PageProps<"/settings">) {
  const { familyId, userName, role } = await requireFamily();
  const searchParams = await props.searchParams;
  const canExport = hasFamilyCapability(role, "archive:export");
  const canViewAudit = hasFamilyCapability(role, "audit:view");
  const canInvite = hasFamilyCapability(role, "account:invite");
  const canManageAccounts = hasFamilyCapability(role, "account:manage");
  const canReviewAi = hasFamilyCapability(role, "ai:review");
  const [family, auditEntries] = await Promise.all([
    getFamily(familyId),
    canViewAudit ? listRecentAudit(familyId, 10) : Promise.resolve([]),
  ]);

  return (
    <main className="page-container max-w-4xl">
      <PageHeader
        eyebrow="Family settings"
        title="设置"
        description="管理家庭成员与账号；外部 AI、完整导出、WebDAV 和审计记录集中在高级档案设置中。"
      />

      {searchParams?.accountRoleUpdated === "1" && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm leading-6"
        >
          你的账号角色已更新；可用功能已按新角色刷新。
        </p>
      )}
      {searchParams?.authorizationChanged === "1" && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-amber-700/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-900 dark:text-amber-200"
        >
          你的管理员权限已经变化，账号管理页已关闭，本次没有执行任何修改。
        </p>
      )}

      <section aria-label="家庭" className="mt-8">
        <h2 className="text-lg font-medium">家庭</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-foreground/50">家庭名称</dt>
            <dd>{family?.name}</dd>
          </div>
          <div>
            <dt className="text-foreground/50">时区</dt>
            <dd>{family?.timezone}</dd>
          </div>
          <div>
            <dt className="text-foreground/50">当前登录</dt>
            <dd>{userName}</dd>
          </div>
          <div>
            <dt className="text-foreground/50">版本</dt>
            <dd>v{getAppVersion()}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-foreground/45">
          成员管理在
          <Link href="/family" className="mx-1 underline underline-offset-2">
            家人
          </Link>
          页。
        </p>
        {(canManageAccounts || canInvite) && (
          <div className="mt-4 flex flex-wrap gap-3">
            {canManageAccounts && (
              <Link
                href="/settings/accounts"
                className="inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                管理现有账号
              </Link>
            )}
            {canInvite && (
              <Link
                href="/settings/invitations"
                className="inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                管理账号邀请
              </Link>
            )}
          </div>
        )}
      </section>

      {(canExport || canReviewAi) && <section aria-label="高级档案设置" className="mt-10 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-medium">高级档案设置</h2>
        <p className="mt-1 text-sm leading-6 text-foreground/60">
          完整导出、远程备份和 AI Provider 都是可选的管理能力；日常记录、整理、阅读和搜索不依赖它们。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canExport ? <a
            href="/api/export"
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background transition-opacity hover:opacity-90"
          >
            导出完整备份 ZIP
          </a> : null}
          {canExport ? <Link
            href="/settings/backup"
            className="inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent"
          >
            管理 WebDAV 远程备份
          </Link> : null}
          {canReviewAi ? <Link
            href="/settings/ai"
            className="inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:border-accent"
          >
            AI 整理与隐私
          </Link> : null}
        </div>
        <p className="mt-2 text-xs text-foreground/45">
          完整导出会重新校验每份原件；API Key 与 WebDAV 凭据只存在部署环境，不写入家庭备份。
        </p>
      </section>}

      {canViewAudit && <section aria-label="安全与审计记录" className="mt-10">
        <h2 className="text-lg font-medium">安全与审计记录</h2>
        {auditEntries.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/50">暂无导出/恢复记录。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {auditEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg border border-foreground/10 px-4 py-2.5 text-sm"
              >
                <span>
                  {AUDIT_LABEL[entry.kind] ?? entry.kind}
                  <span className="ml-2 text-foreground/50">
                    {entry.actorName ?? "系统"}
                  </span>
                </span>
                <span className="text-xs text-foreground/45">
                  {new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: family?.timezone ?? "Asia/Shanghai",
                  }).format(entry.createdAt)}
                  {typeof entry.detail.bytes === "number"
                    ? ` · ${(entry.detail.bytes / 1024 / 1024).toFixed(1)} MB`
                    : ""}
                  {typeof entry.detail.assetCount === "number"
                    ? ` · ${entry.detail.assetCount} 份原件`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>}
    </main>
  );
}
