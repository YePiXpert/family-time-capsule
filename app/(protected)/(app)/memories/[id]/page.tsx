import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getMemoryEventDetail } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { listContributions, listFacts } from "@/lib/contributions/service";
import { MediaBlock } from "@/components/media-view";
import { AddContributionForm, ContributionBlock } from "./contribution-ui";
import { FactSection } from "./fact-ui";

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
  const [detail, family, people, contributions, facts] = await Promise.all([
    getMemoryEventDetail(familyId, id),
    getFamily(familyId),
    listPeople(familyId),
    listContributions(familyId, id),
    listFacts(familyId, id),
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
              <MediaBlock
                key={a.id}
                assetId={a.id}
                filename={a.originalFilename}
                mimeType={a.mimeType}
                type={a.type}
                durationMs={a.durationMs}
              />
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
        <p className="mt-1 text-sm leading-6 text-foreground/50">
          每个人留下自己独立的讲述，互不覆盖；没有账号的家人（祖辈）也可以被记录。
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {contributions.map((c) => (
            <ContributionBlock key={c.id} contribution={c} />
          ))}
        </div>
        <AddContributionForm memoryEventId={event.id} people={people} />
      </section>

      <FactSection memoryEventId={event.id} facts={facts} />

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
