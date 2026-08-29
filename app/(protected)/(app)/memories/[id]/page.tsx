import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { getMemoryEventDetail } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "记忆 · Family Time Capsule" };

const TIME_SOURCE_LABEL: Record<string, string> = {
  user_confirmed: "用户确认",
  embedded_metadata: "内嵌 metadata",
  file_metadata: "文件时间",
  import_time: "导入时间",
};

export default async function MemoryEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { familyId } = await requireFamily();
  const { id } = await params;
  const [detail, family] = await Promise.all([
    getMemoryEventDetail(familyId, id),
    getFamily(familyId),
  ]);
  if (!detail) notFound();

  const timezone = family?.timezone ?? "Asia/Shanghai";

  const { event, assets, participants } = detail;
  const child = participants.find((p) => p.id === event.childPersonId);
  const ageLabel = formatAgeLabel(child?.birthDate, event.occurredAt);
  const cover = assets.find((a) => a.id === event.coverAssetId) ?? assets[0];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href="/timeline" className="text-sm text-foreground/60 hover:text-foreground">
        ← 时间轴
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{event.title}</h1>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm text-foreground/70">
        <span>
          {new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "long",
            timeStyle:
              event.occurredAtPrecision === "date_only" ? undefined : "short",
            timeZone: timezone,
          }).format(event.occurredAt)}
        </span>
        {ageLabel && <span className="text-accent">{ageLabel}</span>}
      </p>

      <section aria-label="参与人物" className="mt-4 text-sm text-foreground/70">
        参与：
        {participants.map((p, i) => (
          <span key={p.id}>
            {i > 0 && " / "}
            {p.displayName}
            {p.id === event.childPersonId ? "（孩子）" : ""}
          </span>
        ))}
      </section>

      <section aria-label="原始资料" className="mt-8">
        <h2 className="text-lg font-medium">原始资料（{assets.length}）</h2>
        {assets.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/50">无关联素材。</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {assets.map((a) => (
              <div key={a.id} className="w-full">
                {a.type === "image" && (
                  <a
                    href={`/api/media/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-lg border border-foreground/10"
                    title={a.originalFilename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${a.id}`}
                      alt={a.originalFilename}
                      className="max-h-[28rem] w-full object-contain transition-opacity group-hover:opacity-95"
                    />
                  </a>
                )}
                {a.type === "video" && (
                  <video
                    controls
                    preload="metadata"
                    src={`/api/media/${a.id}`}
                    className="max-h-[28rem] w-full rounded-lg border border-foreground/10"
                  />
                )}
                {a.type === "audio" && (
                  <audio
                    controls
                    preload="metadata"
                    src={`/api/media/${a.id}`}
                    className="w-full"
                  />
                )}
                {a.type === "document" && (
                  <a
                    href={`/api/media/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-foreground/10 px-4 py-3 text-sm underline underline-offset-2"
                  >
                    {a.originalFilename}
                  </a>
                )}
                <p className="mt-1 truncate text-xs text-foreground/40" title={a.originalFilename}>
                  {a.originalFilename}
                  {a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} 秒` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
        {cover && (
          <p className="mt-3 text-xs text-foreground/45">
            封面：{cover.originalFilename}
          </p>
        )}
      </section>

      <section aria-label="家人视角" className="mt-10">
        <h2 className="text-lg font-medium">家人视角</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/50">
          每位家人可以留下自己独立的讲述（#012 起支持）。
        </p>
      </section>

      <section aria-label="素材 metadata" className="mt-10">
        <h2 className="text-lg font-medium">档案信息</h2>
        <dl className="mt-2 grid gap-x-8 gap-y-1 text-xs text-foreground/50 sm:grid-cols-2">
          {assets.map((a) => (
            <div key={a.id} className="flex flex-col border-t border-foreground/5 py-1">
              <dt className="truncate" title={a.originalFilename}>
                {a.originalFilename}
              </dt>
              <dd>
                {TIME_SOURCE_LABEL[a.timeSource] ?? a.timeSource} ·{" "}
                {a.capturedAt
                  ? new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: timezone,
                    }).format(a.capturedAt)
                  : "无拍摄时间"}{" "}
                · SHA-256 {a.sha256.slice(0, 12)}… · {(a.bytes / 1024).toFixed(0)} KB
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
