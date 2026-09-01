import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  PROMPT_LIBRARY,
  listContributionRequests,
} from "@/lib/oral-history/service";
import { CloseRequestButton, RequestCreateForm } from "./request-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "口述收集 · Family Time Capsule" };

const STATUS_LABEL: Record<string, string> = {
  open: "开放中",
  closed: "已关闭",
};

export default async function RequestsPage() {
  const context = await requireFamily();
  const canCreate = hasFamilyCapability(context.role, "contribution:create");
  const requests = listContributionRequests(context);
  const topics = PROMPT_LIBRARY.map((t) => ({
    key: t.key,
    label: t.label,
    questions: [...t.questions],
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">口述收集</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        为没有账号的家人（祖辈、亲戚）创建一次性提问链接：他们打开就能用文字、
        录音、照片或视频回答；提交先进收件箱，家人确认后才进入时间轴。
        链接过期或关闭后立即失效。
      </p>

      {canCreate && (
        <section
          aria-label="创建讲述链接"
          className="mt-8 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
        >
          <h2 className="text-base font-medium">新的提问</h2>
          <div className="mt-3">
            <RequestCreateForm topics={topics} />
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-foreground/60">
              内置问题库（点击展开参考）
            </summary>
            <dl className="mt-2 flex flex-col gap-2 text-sm">
              {topics.map((t) => (
                <div key={t.key}>
                  <dt className="font-medium text-foreground/70">{t.label}</dt>
                  <dd className="text-foreground/50">
                    {t.questions.map((q) => (
                      <span key={q} className="block">
                        · {q}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}

      {requests.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-foreground/20 p-8 text-center text-sm text-foreground/50">
          还没有创建过讲述链接。
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3" aria-label="讲述链接列表">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border border-foreground/10 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  给{r.recipientLabel}的提问
                </span>
                <span className="flex items-center gap-2 text-xs text-foreground/50">
                  <span
                    className={
                      r.status === "open"
                        ? "rounded border border-emerald-700/40 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400"
                        : "rounded border border-foreground/15 px-1.5 py-0.5"
                    }
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span>已收到 {r.submissionCount} 条</span>
                  {r.pendingCount > 0 && (
                    <span className="rounded border border-amber-600/40 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                      {r.pendingCount} 条待审核
                    </span>
                  )}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground/70">
                {r.promptText}
              </p>
              <p className="mt-1 text-xs text-foreground/45">
                有效期至{" "}
                {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(r.expiresAt)}
                {" · "}
                创建于{" "}
                {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(r.createdAt)}
              </p>
              {r.status === "open" && canCreate && (
                <div className="mt-2">
                  <CloseRequestButton requestId={r.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
