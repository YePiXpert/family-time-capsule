import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { AI_CAPABILITIES, type AiCapability } from "@/lib/ai/types";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  getAiRuntimeDisclosure,
  listAiProcessingConsents,
  listRecentAiJobs,
} from "@/lib/ai/jobs";
import {
  AiConsentControls,
  AiJobCancelControl,
  AiJobRetryControl,
} from "./ai-controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI 整理与隐私 · Family Time Capsule",
};

const CAPABILITY_LABEL: Record<AiCapability, string> = {
  text: "文字整理与故事草稿",
  vision: "图片与视频画面理解",
  transcription: "音频与视频音轨转录",
  embeddings: "可选语义搜索索引",
};

const CONTENT_DESCRIPTION: Record<AiCapability, string> = {
  text: "可能发送用户明确选择的文字、已确认来源和最少必要上下文。",
  vision: "发送去除 EXIF 的受限尺寸图片，或用户选择视频中的少量画面。",
  transcription: "发送用户选择的音频分段；原始声音仍只作为不可替代原件保存。",
  embeddings: "发送允许进入搜索索引的文字片段，向量仅作为可重建衍生数据。",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "等待处理",
  running: "正在处理",
  completed: "处理完成",
  failed: "处理失败",
  cancelled: "已停止",
};

export default async function AiSettingsPage() {
  const context = await requireFamily();
  if (!hasFamilyCapability(context.role, "ai:review")) notFound();
  const canConfigure = hasFamilyCapability(context.role, "ai:configure");
  const disclosure = getAiRuntimeDisclosure();
  const [consents, jobs] = await Promise.all([
    canConfigure ? listAiProcessingConsents(context) : Promise.resolve([]),
    Promise.resolve(listRecentAiJobs(context, 30)),
  ]);
  const consentByCapability = new Map(
    consents.map((consent) => [consent.capability, consent]),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link
        href="/settings"
        className="text-sm text-foreground/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ← 设置
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">AI 整理与隐私</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-foreground/65">
        AI 只是整理员。关闭 Provider 或停止 worker 不影响上传、收件箱、事件、时间轴、讲述、胶囊、导出与恢复。
      </p>

      {!disclosure.valid ? (
        <section
          role="alert"
          className="mt-8 rounded-xl border border-red-800/30 bg-red-500/10 p-4"
        >
          <h2 className="font-medium text-red-800 dark:text-red-300">
            AI 配置无效
          </h2>
          <p className="mt-1 text-sm leading-6 text-foreground/70">
            请检查服务器环境变量。核心家庭档案仍可正常使用，任何内容都不会发送给外部服务。
          </p>
        </section>
      ) : disclosure.providerId === "disabled" ? (
        <section className="mt-8 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-5">
          <h2 className="font-medium">当前未配置 AI Provider</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/60">
            这是安全的默认状态。需要时由部署管理员通过环境变量配置；API Key 不会写入数据库、页面或备份。
          </p>
        </section>
      ) : (
        <section aria-label="Provider 信息" className="mt-8">
          <h2 className="text-lg font-medium">当前 Provider</h2>
          <dl className="mt-3 grid gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-foreground/50">名称</dt>
              <dd>{disclosure.providerName}</dd>
            </div>
            <div>
              <dt className="text-foreground/50">数据位置</dt>
              <dd>{disclosure.external ? "会离开本机进程" : "本机进程内"}</dd>
            </div>
          </dl>
        </section>
      )}

      {disclosure.valid && disclosure.capabilities && (
        <section aria-label="AI 能力与同意" className="mt-10">
          <h2 className="text-lg font-medium">能力与外部处理同意</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/60">
            每项能力独立开启。Provider 或 Model 变化后，旧同意不会静默沿用。
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {AI_CAPABILITIES.map((capability) => {
              const status = disclosure.capabilities![capability];
              const consent = consentByCapability.get(capability);
              return (
                <article
                  key={capability}
                  className="rounded-xl border border-foreground/10 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{CAPABILITY_LABEL[capability]}</h3>
                      <p className="mt-1 max-w-xl text-sm leading-6 text-foreground/60">
                        {CONTENT_DESCRIPTION[capability]}
                      </p>
                    </div>
                    <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/65">
                      {status.available
                        ? consent?.enabled || !disclosure.external
                          ? "可使用"
                          : "等待同意"
                        : "未配置"}
                    </span>
                  </div>
                  {status.model && (
                    <p className="mt-3 text-xs text-foreground/50">
                      Model：{status.model}
                    </p>
                  )}
                  {canConfigure &&
                    disclosure.external &&
                    status.available && (
                      <AiConsentControls
                        capability={capability}
                        enabled={consent?.enabled === true}
                      />
                    )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section aria-label="后台任务" className="mt-10">
        <h2 className="text-lg font-medium">后台任务</h2>
        <p className="mt-1 text-sm leading-6 text-foreground/60">
          这里只显示状态和安全错误码，不记录讲述正文、转录、图片描述、路径、密钥或 Provider 原始响应。
        </p>
        {jobs.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50">
            还没有 AI 任务。没有 worker 时，核心档案也能完整使用。
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-xl border border-foreground/10 p-4 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                  <span className="text-xs text-foreground/50">
                    尝试 {job.attempts}/{job.maxAttempts}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-foreground/55">
                  {job.jobType}
                </p>
                {job.lastErrorCode && (
                  <p className="mt-2 text-xs text-red-800 dark:text-red-300">
                    错误码：{job.lastErrorCode}
                  </p>
                )}
                {(job.status === "pending" || job.status === "running") && (
                  <AiJobCancelControl jobId={job.id} />
                )}
                {(job.status === "failed" || job.status === "cancelled") && (
                  <AiJobRetryControl jobId={job.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
