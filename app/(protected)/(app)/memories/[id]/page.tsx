import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getMemoryEventDetail, listEventRevisions } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { listFacts } from "@/lib/contributions/service";
import {
  createContributionAccessSnapshot,
  listVisibleContributionsForEvent,
} from "@/lib/authz/contribution-access";
import { utcToZonedWallTimeInput } from "@/lib/metadata/time";
import { MediaBlock } from "@/components/media-view";
import {
  getAiRuntimeDisclosure,
  listAiProcessingConsents,
} from "@/lib/ai/jobs";
import type { AiConsentDto, AiJobSummary } from "@/lib/ai/jobs";
import {
  getTranscriptsForAssets,
  getLatestTranscriptionJobForAsset,
} from "@/lib/transcripts/service";
import {
  getAnalysesForAssets,
  getLatestImageAnalysisJobForAsset,
  getLatestVideoAnalysisJobForAsset,
} from "@/lib/analysis/service";
import { getAsset } from "@/lib/assets/service";
import { AddContributionForm, ContributionBlock } from "./contribution-ui";
import { EditEventForm } from "./edit-event-form";
import { FactSection } from "./fact-ui";
import { TranscriptSection } from "./transcript-ui";
import { ImageAnalysisSection } from "./analysis-ui";
import { SuggestionSection } from "./suggestion-ui";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  listPendingSuggestions,
  listEventTags,
} from "@/lib/suggestions/service";
import { listJobsForEntity } from "@/lib/ai/jobs";
import { factSource, type FactSourceRow } from "@/db/schema/suggestion";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";

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
  const canRequestTranscription = hasFamilyCapability(context.role, "ai:review");
  const contributionAccess = createContributionAccessSnapshot(context);
  const { id } = await params;
  const [detail, family, people, contributions, facts, revisions, suggestions, tags] = await Promise.all([
    getMemoryEventDetail(familyId, id),
    getFamily(familyId),
    listPeople(familyId),
    listVisibleContributionsForEvent(contributionAccess, id),
    listFacts(familyId, id),
    canViewAudit ? listEventRevisions(familyId, id) : Promise.resolve([]),
    listPendingSuggestions(familyId, "memory_event", id),
    listEventTags(familyId, id),
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

  // 音频/视频原件：事件直接关联的 + Contribution 引用的 audioAssetId
  const avAssetIds = new Set<string>();
  for (const a of assets) {
    if ((a.type === "audio" || a.type === "video") && a.originalAssetId === null) {
      avAssetIds.add(a.id);
    }
  }
  for (const c of contributions) {
    if (c.audioAssetId) avAssetIds.add(c.audioAssetId);
  }
  const avAssetIdsArray = [...avAssetIds];
  const contributionAudioAssetIds = avAssetIdsArray.filter(
    (id) => !assets.some((a) => a.id === id),
  );

  // 图片原件：事件直接关联的原始图片
  const imageAssetIds = assets
    .filter((a) => a.type === "image" && a.originalAssetId === null)
    .map((a) => a.id);

  // 视频原件：事件直接关联的原始视频（M3-G 视频理解）
  const videoAssetIds = assets
    .filter((a) => a.type === "video" && a.originalAssetId === null)
    .map((a) => a.id);

  const [
    contributionAudioAssets,
    transcripts,
    jobs,
    analyses,
    imageJobs,
    videoJobs,
    disclosure,
    consents,
    factSources,
    suggestionJobs,
  ] = await Promise.all([
    Promise.all(
      contributionAudioAssetIds.map((id) => getAsset(familyId, id)),
    ),
    getTranscriptsForAssets(familyId, avAssetIdsArray),
    Promise.all(
      avAssetIdsArray.map((assetId) =>
        getLatestTranscriptionJobForAsset(familyId, assetId),
      ),
    ),
    getAnalysesForAssets(familyId, [...imageAssetIds, ...videoAssetIds]),
    Promise.all(
      imageAssetIds.map((assetId) =>
        getLatestImageAnalysisJobForAsset(familyId, assetId),
      ),
    ),
    Promise.all(
      videoAssetIds.map((assetId) =>
        getLatestVideoAnalysisJobForAsset(familyId, assetId),
      ),
    ),
    Promise.resolve(getAiRuntimeDisclosure()),
    canRequestTranscription
      ? listAiProcessingConsents(context)
      : Promise.resolve([] as AiConsentDto[]),
    facts.length > 0
      ? getDb()
          .select()
          .from(factSource)
          .where(
            and(
              eq(factSource.familyId, familyId),
              inArray(
                factSource.factId,
                facts.map((f) => f.id),
              ),
            ),
          )
      : Promise.resolve([] as FactSourceRow[]),
    canRequestTranscription
      ? listJobsForEntity(context, "memory_event", id)
      : Promise.resolve([] as AiJobSummary[]),
  ]);
  const assetById = new Map(
    [...assets, ...contributionAudioAssets.filter((a): a is NonNullable<typeof contributionAudioAssets[number]> => Boolean(a))].map((a) => [
      a.id,
      a,
    ]),
  );

  // M3-D：factSource → 展示名（asset/asset_analysis→文件名；transcript→其素材；contribution→作者）
  const transcriptIdToAssetId = new Map(
    [...transcripts.entries()].map(([assetId, t]) => [t.id, assetId]),
  );
  const personById = new Map(people.map((p) => [p.id, p.displayName]));
  const factSourceLabels = new Map<string, string>();
  for (const source of factSources) {
    let label: string | undefined;
    if (source.sourceType === "asset" || source.sourceType === "asset_analysis") {
      if (source.sourceId) label = assetById.get(source.sourceId)?.originalFilename;
    } else if (source.sourceType === "transcript") {
      const assetId = source.sourceId
        ? transcriptIdToAssetId.get(source.sourceId)
        : undefined;
      if (assetId) label = assetById.get(assetId)?.originalFilename;
    } else if (source.sourceType === "contribution") {
      const contribution = contributions.find((c) => c.id === source.sourceId);
      if (contribution) {
        label = personById.get(contribution.authorPersonId) ?? "家人讲述";
      }
    }
    if (label) factSourceLabels.set(source.id, label);
  }
  const transcriptionConsent = consents.find((c) => c.capability === "transcription");
  const transcriptionAvailable =
    disclosure.valid &&
    disclosure.capabilities?.transcription?.available === true &&
    (disclosure.external === false || transcriptionConsent?.enabled === true);

  const visionConsent = consents.find((c) => c.capability === "vision");
  const visionAvailable =
    disclosure.valid &&
    disclosure.capabilities?.vision?.available === true &&
    (disclosure.external === false || visionConsent?.enabled === true);

  const textConsent = consents.find((c) => c.capability === "text");
  const textAvailable =
    disclosure.valid &&
    disclosure.capabilities?.text?.available === true &&
    (disclosure.external === false || textConsent?.enabled === true);

  const latestSuggestionJob = suggestionJobs[0];

  const child = participants.find((p) => p.id === event.childPersonId);
  const ageLabel = formatAgeLabel(child?.birthDate, event.occurredAt);
  const cover = assets.find((a) => a.id === event.coverAssetId) ?? assets[0];
  const contributionAuthors =
    context.role === "admin" || context.role === "editor"
      ? people
      : people.filter((p) => p.id === context.personId);
  const jobByAssetId = new Map(
    avAssetIdsArray.map((assetId, index) => [assetId, jobs[index]]),
  );
  const imageJobByAssetId = new Map(
    imageAssetIds.map((assetId, index) => [assetId, imageJobs[index]]),
  );
  const videoJobByAssetId = new Map(
    videoAssetIds.map((assetId, index) => [assetId, videoJobs[index]]),
  );

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

      {avAssetIdsArray.length > 0 && (
        <section aria-label="转录" className="mt-10">
          <h2 className="text-lg font-medium">转录</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/50">
            AI 转录仅作为可重建的参考，人工修订后的文本永不覆盖。
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {avAssetIdsArray.map((assetId) => {
              const asset = assetById.get(assetId);
              if (!asset) return null;
              return (
                <TranscriptSection
                  key={assetId}
                  memoryEventId={event.id}
                  asset={asset}
                  transcript={transcripts.get(assetId)}
                  job={jobByAssetId.get(assetId)}
                  canRequest={canRequestTranscription && transcriptionAvailable}
                  canEdit={canWriteEvent}
                />
              );
            })}
          </div>
        </section>
      )}

      {imageAssetIds.length > 0 && (
        <section aria-label="AI 图像理解" className="mt-10">
          <h2 className="text-lg font-medium">AI 图像理解</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/50">
            AI 描述与图中文字仅为未确认的参考，可随时重新生成，不进入导出归档。
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {imageAssetIds.map((assetId) => {
              const asset = assetById.get(assetId);
              if (!asset) return null;
              return (
                <ImageAnalysisSection
                  key={assetId}
                  memoryEventId={event.id}
                  asset={asset}
                  analysis={analyses.get(assetId)}
                  job={imageJobByAssetId.get(assetId)}
                  canRequest={canRequestTranscription && visionAvailable}
                />
              );
            })}
          </div>
        </section>
      )}

      {videoAssetIds.length > 0 && (
        <section aria-label="AI 视频理解" className="mt-10">
          <h2 className="text-lg font-medium">AI 视频理解</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/50">
            服务器从视频抽取少量代表帧送 AI 分析；结果为未确认参考，可随时重新生成，不进入导出归档。
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {videoAssetIds.map((assetId) => {
              const asset = assetById.get(assetId);
              if (!asset) return null;
              return (
                <ImageAnalysisSection
                  key={assetId}
                  memoryEventId={event.id}
                  asset={asset}
                  analysis={analyses.get(assetId)}
                  job={videoJobByAssetId.get(assetId)}
                  canRequest={canRequestTranscription && visionAvailable}
                  kind="video"
                />
              );
            })}
          </div>
        </section>
      )}

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
              canEdit={c.canEdit}
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

      <SuggestionSection
        memoryEventId={event.id}
        suggestions={suggestions}
        tags={tags}
        latestJob={latestSuggestionJob}
        canRequest={canRequestTranscription && textAvailable}
        canWrite={canWriteEvent}
      />

      <FactSection
        memoryEventId={event.id}
        facts={facts}
        factSources={factSources}
        sourceLabels={factSourceLabels}
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
