import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getMemoryEventDetail, listEventRevisions } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { listContributions, listFacts } from "@/lib/contributions/service";
import { utcToZonedWallTimeInput } from "@/lib/metadata/time";
import { MediaBlock } from "@/components/media-view";
import { AddContributionForm, ContributionBlock } from "./contribution-ui";
import { EditEventForm } from "./edit-event-form";
import { FactSection } from "./fact-ui";
import {
  canEditContribution,
  hasFamilyCapability,
} from "@/lib/authz/policy";

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
  const context = await requireFamily();
  const { familyId } = context;
  const canWriteEvent = hasFamilyCapability(context.role, "event:write");
  const canCreateContribution = hasFamilyCapability(
    context.role,
    "contribution:create",
  );
  const canViewAudit = hasFamilyCapability(context.role, "audit:view");
  const { id } = await params;
  const [detail, family, people, contributions, facts, revisions] = await Promise.all([
    getMemoryEventDetail(familyId, id),
    getFamily(familyId),
    listPeople(familyId),
    listContributions(familyId, id),
    listFacts(familyId, id),
    canViewAudit ? listEventRevisions(familyId, id) : Promise.resolve([]),
  ]);
  if (!detail) notFound();

  // 详情页图片优先缩略图（原件仍可点开下载）
  const { getThumbnailMap } = await import("@/lib/assets/service");
  const thumbMap = await getThumbnailMap(
    familyId,
    detail.assets.map((a) => a.id),
  );

  const timezone = family?.timezone ?? "Asia/Shanghai";

  const { event, assets, participants, sourceNotes } = detail;
  const child = participants.find((p) => p.id === event.childPersonId);
  const ageLabel = formatAgeLabel(child?.birthDate, event.occurredAt);
  const cover = assets.find((a) => a.id === event.coverAssetId) ?? assets[0];
  const contributionAuthors =
    context.role === "admin" || context.role === "editor"
      ? people
      : people.filter((p) => p.id === context.personId);

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

      {event.locationText && (
        <p className="mt-2 text-sm text-foreground/70">{event.locationText}</p>
      )}

      {canWriteEvent && <div className="mt-4">
        <EditEventForm
          event={event}
          people={people}
          assets={assets}
          participantIds={participants.map((p) => p.id)}
          defaultWallTime={utcToZonedWallTimeInput(event.occurredAt, timezone)}
          timezone={timezone}
        />
      </div>}

      {sourceNotes.length > 0 && (
        <section aria-label="原始文字记录" className="mt-8">
          <h2 className="text-lg font-medium">文字记录（{sourceNotes.length}）</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/60">
            确认收件箱内容时保留的原始文字；未标注讲述者。
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {sourceNotes.map((note) => (
              <article
                key={note.id}
                className="rounded-lg border border-foreground/10 bg-foreground/[0.025] px-4 py-3"
              >
                <p className="max-w-prose whitespace-pre-wrap break-words text-base leading-7 text-foreground/90">
                  {note.rawText}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

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
                thumbAssetId={thumbMap.get(a.id)?.id ?? null}
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
            <ContributionBlock
              key={c.id}
              contribution={c}
              canEdit={canEditContribution({
                role: context.role,
                userPersonId: context.personId,
                authorPersonId: c.authorPersonId,
                isGuardian: false,
                childLaterUnlocked: false,
                accountEnabled: true,
              })}
            />
          ))}
        </div>
        {canCreateContribution && contributionAuthors.length > 0 && (
          <AddContributionForm
            memoryEventId={event.id}
            people={contributionAuthors}
          />
        )}
      </section>

      <FactSection
        memoryEventId={event.id}
        facts={facts}
        canWrite={canWriteEvent}
      />

      {revisions.length > 0 && (
        <section aria-label="编辑历史" className="mt-10">
          <details>
            <summary className="cursor-pointer text-lg font-medium">
              编辑历史（{revisions.length}）
            </summary>
            <ol className="mt-3 flex flex-col gap-2">
              {revisions.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-foreground/10 px-4 py-3 text-sm"
                >
                  <p className="text-foreground/60">
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: timezone,
                    }).format(r.createdAt)}
                    {" · "}
                    {r.editorName ?? "家人"} 修改
                  </p>
                  <p className="mt-1 leading-6">
                    之前：{r.snapshot.title}
                    <span className="ml-2 text-foreground/50">
                      {new Intl.DateTimeFormat("zh-CN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: timezone,
                      }).format(new Date(r.snapshot.occurredAt))}
                    </span>
                    {r.snapshot.locationText && (
                      <span className="ml-2 text-foreground/50">
                        · {r.snapshot.locationText}
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}

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
