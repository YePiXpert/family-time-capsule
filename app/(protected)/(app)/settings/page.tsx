import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily, requireCurrentSessionId } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { getAppVersion } from "@/lib/export/service";
import { listRecentAudit } from "@/lib/audit/service";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { hasRecentAuth } from "@/lib/auth/step-up";
import { DisplayModeToggle } from "@/components/display-mode-toggle";
import { getDisplayMode } from "@/lib/display-mode.server";
import { DangerZone, ExportStepUpPanel } from "./account/danger-zone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "我的 · 小美成长记" };

const AUDIT_LABEL: Record<string, string> = {
  "export.created": "导出可读档案",
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

const roleLabels: Record<string, string> = {
  owner: "家庭管理员",
  admin: "管理员",
  editor: "记录者",
  contributor: "记录者",
  viewer: "读者",
};

export default async function SettingsPage(props: PageProps<"/settings">) {
  const { familyId, userName, role } = await requireFamily();
  const searchParams = await props.searchParams;
  const canExport = hasFamilyCapability(role, "archive:export");
  const canViewAudit = hasFamilyCapability(role, "audit:view");
  const canInvite = hasFamilyCapability(role, "account:invite");
  const canManageAccounts = hasFamilyCapability(role, "account:manage");
  const canReviewAi = hasFamilyCapability(role, "ai:review");
  const currentSessionId = await requireCurrentSessionId();
  const exportNeedsStepUp = canExport && !hasRecentAuth(currentSessionId);
  const [family, auditEntries, displayMode] = await Promise.all([
    getFamily(familyId),
    canViewAudit ? listRecentAudit(familyId, 10) : Promise.resolve([]),
    getDisplayMode(),
  ]);

  return (
    <main className="page-container settings-page max-w-4xl">
      {/* 身份卡：家人先看到自己，再看到设置 */}
      <div className="settings-identity">
        <span aria-hidden="true" className="settings-identity-avatar">{(userName ?? "我").trim().slice(0, 1) || "我"}</span>
        <div className="min-w-0">
          <h1 className="settings-identity-name">{userName ?? "我的"}</h1>
          <p className="settings-identity-family">{[family?.name, roleLabels[role] ?? null].filter(Boolean).join(" · ") || "管理家人、设备和资料。"}</p>
        </div>
      </div>

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
          className="inline-notice inline-notice-warning mt-6 text-sm leading-6"
        >
          你的管理员权限已经变化，账号管理页已关闭，本次没有执行任何修改。
        </p>
      )}

      <details name="settings-section" className="mt-4"><summary>家人和账号</summary>
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
                className="ui-button-secondary"
              >
                管理现有账号
              </Link>
            )}
            {canInvite && (
              <Link
                href="/settings/invitations"
                className="ui-button-secondary"
              >
                管理账号邀请
              </Link>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/settings/security"
            className="ui-button-secondary"
          >
            账号安全（两步验证 / 通行密钥）
          </Link>
          <Link
            href="/settings/sessions"
            className="ui-button-secondary"
          >
            活动设备与会话
          </Link>
        </div>
      <details className="mt-5"><summary className="ui-text-link cursor-pointer">账户维护与审计</summary>
      <DangerZone isOwner={role === "owner"} />

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
      </details>
      </details>

      <details name="settings-section" className="mt-3"><summary>存储与同步</summary><div className="flex flex-wrap gap-3"><Link href="/library" className="ui-button-secondary">资料库</Link><Link href="/imports" className="ui-button-secondary">导入进度</Link><Link href="/trash" className="ui-button-secondary">回收站</Link></div></details>
      {canExport ? <details name="settings-section" className="mt-3"><summary>备份与恢复</summary><div className="flex flex-wrap gap-3"><ExportStepUpPanel needsStepUp={exportNeedsStepUp} /><Link href="/settings/backup" className="ui-button-secondary">家庭备份与恢复</Link></div></details> : null}
      <details name="settings-section" className="mt-3"><summary>显示与辅助</summary><DisplayModeToggle mode={displayMode} />{canReviewAi ? <Link href="/settings/ai" className="ui-button-secondary mt-4">AI 整理与隐私</Link> : null}</details>

    </main>
  );
}
