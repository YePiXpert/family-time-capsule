import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { getAppVersion } from "@/lib/export/service";
import { listRecentAudit } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "设置 · Family Time Capsule" };

const AUDIT_LABEL: Record<string, string> = {
  "export.created": "导出完整备份",
  "restore.completed": "从备份恢复",
};

export default async function SettingsPage() {
  const { familyId, userName } = await requireFamily();
  const [family, auditEntries] = await Promise.all([
    getFamily(familyId),
    listRecentAudit(familyId, 10),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">设置</h1>

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
      </section>

      <section aria-label="备份与导出" className="mt-10">
        <h2 className="text-lg font-medium">备份与导出</h2>
        <p className="mt-1 text-sm leading-6 text-foreground/60">
          完整导出包含全部原件（SHA-256 校验）、记忆事件、家人视角、事实与胶囊——
          即使胶囊尚未到开启时间。ZIP 解压后无需本系统即可阅读 Markdown、播放媒体。
        </p>
        <a
          href="/api/export"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background transition-opacity hover:opacity-90"
        >
          导出完整备份（ZIP）
        </a>
        <p className="mt-2 text-xs text-foreground/45">
          导出较大时需要等待一会儿；导出过程会重新校验每个原件的哈希。
        </p>
      </section>

      <section aria-label="最近操作" className="mt-10">
        <h2 className="text-lg font-medium">最近操作</h2>
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
      </section>
    </main>
  );
}
