import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { backupTargetStatus, listBackupRuns } from "@/lib/webdav/service";
import { RunBackupButton } from "./backup-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "备份 · Family Time Capsule" };

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "进行中",
  succeeded: "成功",
  failed: "失败",
};

export default async function BackupSettingsPage() {
  const context = await requireFamily();
  const canManage = hasFamilyCapability(context.role, "backup:manage");
  if (!canManage) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <p className="text-sm text-foreground/60">当前角色不能管理备份。</p>
      </main>
    );
  }
  const status = backupTargetStatus(context);
  const runs = listBackupRuns(context);
  const timezone = context.familyTimezone;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href="/settings" className="text-sm text-foreground/60 hover:text-foreground">
        ← 设置
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">远程备份（WebDAV）</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        WebDAV 只是备份目标，不是主存储：每次备份先生成完整校验过的导出，
        上传到远端临时文件、回读核对 SHA-256 后再原子改名。凭据只保存在部署
        环境的环境变量里，不进数据库、不进导出、不下发浏览器。
      </p>

      <section aria-label="目标状态" className="mt-6 rounded-xl border border-foreground/10 p-4">
        {status.configured ? (
          <p className="text-sm">
            目标：<span className="font-medium">{status.hostLabel}</span>
            <span className="ml-2 rounded border border-emerald-700/40 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              已配置
            </span>
          </p>
        ) : (
          <p className="text-sm text-foreground/60">
            尚未配置。在部署环境设置{" "}
            <code className="rounded bg-foreground/5 px-1">WEBDAV_URL</code>、
            <code className="rounded bg-foreground/5 px-1">WEBDAV_USERNAME</code>、
            <code className="rounded bg-foreground/5 px-1">WEBDAV_PASSWORD</code>
            （可选 <code className="rounded bg-foreground/5 px-1">WEBDAV_DIRECTORY</code>）。
            仅允许 https 目标（本机 loopback http 例外）。
          </p>
        )}
        {status.configured && (
          <div className="mt-3">
            <RunBackupButton />
          </div>
        )}
      </section>

      <section aria-label="备份历史" className="mt-8">
        <h2 className="text-base font-medium">备份历史</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/50">还没有备份记录。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {runs.map((run) => (
              <li
                key={run.id}
                className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={
                      run.status === "succeeded"
                        ? "rounded border border-emerald-700/40 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
                        : run.status === "failed"
                          ? "rounded border border-red-700/40 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400"
                          : "rounded border border-foreground/15 px-1.5 py-0.5 text-xs"
                    }
                  >
                    {STATUS_LABEL[run.status] ?? run.status}
                  </span>
                  <span className="text-xs text-foreground/50">
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: timezone,
                    }).format(run.startedAt)}
                    {run.finishedAt &&
                      ` · 用时 ${Math.max(1, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000))} 秒`}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-foreground/50" title={run.remotePath}>
                  {run.remotePath}
                </p>
                {run.sha256 && (
                  <p className="text-xs text-foreground/40">
                    SHA-256 {run.sha256.slice(0, 16)}…
                    {run.bytes ? ` · ${(run.bytes / 1024 / 1024).toFixed(1)} MB` : ""}
                    {run.strategy === "direct-upload" ? " · 直接落位（目标不支持原子改名）" : ""}
                  </p>
                )}
                {run.error && (
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400">{run.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-foreground/40">
          失败的备份可直接再次「立即备份」——全量重传并重新校验，等价于重试。
        </p>
      </section>
    </main>
  );
}
