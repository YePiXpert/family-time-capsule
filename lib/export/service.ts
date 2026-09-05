import "server-only";
import { collectBookArchive, collectBookSourceClosure } from "@/lib/books/projects/archive";
import { BOOK_FILES } from "@/lib/books/projects/portable.mjs";
import { collectCollectionArchive } from "@/lib/collections/archive";
import { COLLECTION_FILES } from "@/lib/collections/portable.mjs";

import { collectDurableStories } from "@/lib/stories/service";
import { collectCapsuleDialogue } from "@/lib/capsules/dialogue";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ZipArchive } from "archiver";
import { isNull, and, eq, inArray, or, sql } from "drizzle-orm";
import pkg from "../../package.json";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { person as personTable } from "@/db/schema/family";
import { inboxItem, inboxItemAsset, inboxItemParticipant } from "@/db/schema/inbox";
import { contribution as contributionTable, fact as factTable } from "@/db/schema/contribution";
import { assetTranscript as assetTranscriptTable } from "@/db/schema/transcript";
import {
  memoryEvent as memoryEventTable,
  memoryEventAsset,
  memoryEventParticipant,
} from "@/db/schema/memory";
import { memoryEventTag } from "@/db/schema/suggestion";
import {
  capsule as capsuleTable,
  capsuleAsset,
  capsuleContribution,
  capsuleEvent,
} from "@/db/schema/capsule";
import { factSource } from "@/db/schema/suggestion";
import {
  importSession,
  importSessionDefaultParticipant,
  importSessionItem,
} from "@/db/schema/import";
import {
  contributionPortalSubmission,
  contributionRequest,
  contributionRequestSubmission,
} from "@/db/schema/oral-history";
import { reviewPeriod, reviewPeriodEvent } from "@/db/schema/review";
import { getAssetStorage } from "@/lib/assets/storage";
import { formatAgeLabel } from "@/lib/memories/age";
import { getFamily } from "@/lib/family/service";

/**
 * 完整可迁移导出（Issue #014，PRD §18）。
 *
 * 结构（docs/EXPORT_FORMAT.md）：
 * family-time-capsule-export/
 * ├── manifest.json / family.json / people.json / memories.json
 * ├── inbox-items.json / inbox-item-assets.json
 * ├── contributions.json / facts.json / capsules.json / timeline.md
 * ├── originals/{images,audio,video,documents}/
 * └── stories/
 *
 * 关键保证：
 * - 导出时重新计算每个原件的 SHA-256，与库中不符 → 整个导出失败（绝不产出看似成功的备份）；
 * - 胶囊内容始终完整包含（includeLocked——封存不是加密）；
 * - timeline.md 用相对路径引用原媒体，解压即可读/可播放。
 */

export const EXPORT_VERSION = 1;
export const EXPORT_ROOT_DIR = "family-time-capsule-export";
/** v1 当前固定的非媒体文件数；恢复端也用它区分完整新档与旧式 v1 档。 */
export const EXPORT_NON_ASSET_FILE_COUNT = 25 + COLLECTION_FILES.length + BOOK_FILES.length;
/** v0.1.3 及更早的 v1 档尚无两份 Inbox JSON。 */
export const LEGACY_EXPORT_NON_ASSET_FILE_COUNT = 8;
export type ExportChecksumMismatchError = {
  code: "checksum_mismatch";
  assetId: string;
  storageKey: string;
  expected: string;
  actual: string;
};

export class ExportVerificationError extends Error {
  readonly detail: ExportChecksumMismatchError;
  constructor(detail: ExportChecksumMismatchError) {
    super(`original file checksum mismatch: ${detail.assetId}`);
    this.name = "ExportVerificationError";
    this.detail = detail;
  }
}

function typeDir(type: string): string {
  switch (type) {
    case "image":
      return "originals/images";
    case "audio":
      return "originals/audio";
    case "video":
      return "originals/video";
    default:
      return "originals/documents";
  }
}

function extensionOf(storageKey: string): string {
  const ext = path.extname(storageKey).replace(".", "");
  return ext ? `.${ext}` : ".bin";
}

/** 相对路径（导出内）：originals/images/<assetId>.<ext> */
export function exportRelativePath(assetId: string, type: string, storageKey: string): string {
  return `${typeDir(type)}/${assetId}${extensionOf(storageKey)}`;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function hashOriginalFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const value of createReadStream(filePath)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    hash.update(chunk);
    bytes += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), bytes };
}

export type ExportResult = {
  filePath: string;
  fileName: string;
  bytes: number;
  fileCount: number;
  assetCount: number;
};

export async function buildFamilyExport(
  familyId: string,
  opts: { actorUserId?: string | null } = {},
): Promise<ExportResult> {
  const db = getDb();
  const collectionGraph = collectCollectionArchive(familyId);
  const bookGraph = collectBookArchive(familyId);
  const bookClosure = collectBookSourceClosure(familyId);
  const family = await getFamily(familyId);
  if (!family) throw new Error("family not found");

  const [
    people,
    assets,
    events,
    contributions,
    facts,
    capsules,
    inboxItems,
    inboxItemAssets,
    inboxItemParticipants,
    transcripts,
    factSources,
    tags,
    importSessions,
    importDefaultParticipants,
    importItems,
    contributionRequests,
    requestSubmissions,
    portalSubmissions,
    reviewPeriods,
    reviewEvents,
  ] = await Promise.all([
    db.select().from(personTable).where(eq(personTable.familyId, familyId)),
    db.select().from(assetTable).where(eq(assetTable.familyId, familyId)),
    db
      .select()
      .from(memoryEventTable)
      .where(
        and(
          eq(memoryEventTable.familyId, familyId),
          or(isNull(memoryEventTable.deletedAt), inArray(memoryEventTable.id,bookClosure.events), sql`exists (select 1 from collection_item ci where ci.memory_event_id=${memoryEventTable.id} and ci.family_id=${familyId})`),
        ),
      ),
    listCompleteFamilyContributionsForDisasterExport(db, familyId, bookClosure.contributions),
    listFamilyFacts(db, familyId),
    db.select().from(capsuleTable).where(eq(capsuleTable.familyId, familyId)),
    db.select().from(inboxItem).where(eq(inboxItem.familyId, familyId)),
    db.select().from(inboxItemAsset).where(eq(inboxItemAsset.familyId, familyId)),
    db.select().from(inboxItemParticipant).where(eq(inboxItemParticipant.familyId, familyId)),
    db.select().from(assetTranscriptTable).where(eq(assetTranscriptTable.familyId, familyId)),
    db.select().from(factSource).where(eq(factSource.familyId, familyId)),
    db.select().from(memoryEventTag).where(eq(memoryEventTag.familyId, familyId)),
    db.select().from(importSession).where(eq(importSession.familyId, familyId)),
    db
      .select()
      .from(importSessionDefaultParticipant)
      .where(eq(importSessionDefaultParticipant.familyId, familyId)),
    db.select().from(importSessionItem).where(eq(importSessionItem.familyId, familyId)),
    db.select().from(contributionRequest).where(eq(contributionRequest.familyId, familyId)),
    db
      .select()
      .from(contributionRequestSubmission)
      .where(eq(contributionRequestSubmission.familyId, familyId)),
    db
      .select()
      .from(contributionPortalSubmission)
      .where(eq(contributionPortalSubmission.familyId, familyId)),
    db.select().from(reviewPeriod).where(eq(reviewPeriod.familyId, familyId)),
    db.select().from(reviewPeriodEvent).where(eq(reviewPeriodEvent.familyId, familyId)),
  ]);

  const eventIds = events.map((e) => e.id);
  const [eventAssetLinks, eventParticipantLinks, capsuleEventLinks, capsuleAssetLinks, capsuleContributionLinks] =
    await Promise.all([
      eventIds.length
        ? db.select().from(memoryEventAsset).where(inArray(memoryEventAsset.memoryEventId, eventIds))
        : Promise.resolve([] as (typeof memoryEventAsset.$inferSelect)[]),
      eventIds.length
        ? db.select().from(memoryEventParticipant).where(inArray(memoryEventParticipant.memoryEventId, eventIds))
        : Promise.resolve([] as (typeof memoryEventParticipant.$inferSelect)[]),
      db.select().from(capsuleEvent).where(eq(capsuleEvent.familyId, familyId)),
      db.select().from(capsuleAsset).where(eq(capsuleAsset.familyId, familyId)),
      db.select().from(capsuleContribution).where(eq(capsuleContribution.familyId, familyId)),
    ]);

  const storage = getAssetStorage();

  // 1) 校验所有原件：从磁盘重读并重算 SHA-256
  const manifestAssets: Array<Record<string, unknown>> = [];
  const assetRelPaths = new Map<string, string>();
  for (const a of assets) {
    if (a.derivativeType) continue; // 只导原件；衍生物可再生
    const actual = await hashOriginalFile(storage.resolvePath(a.storageKey));
    if (actual.sha256 !== a.sha256 || actual.bytes !== a.bytes) {
      throw new ExportVerificationError({
        code: "checksum_mismatch",
        assetId: a.id,
        storageKey: a.storageKey,
        expected: a.sha256,
        actual: actual.sha256,
      });
    }
    const rel = exportRelativePath(a.id, a.type, a.storageKey);
    assetRelPaths.set(a.id, rel);
    manifestAssets.push({
      assetId: a.id,
      relativePath: rel,
      sha256: a.sha256,
      bytes: a.bytes,
      mimeType: a.mimeType,
      capturedAt: iso(a.capturedAt),
      importedAt: iso(a.importedAt),
      // v0.1.1 起的增量字段（exportVersion 仍为 1，旧导出缺失时恢复端取默认值）
      type: a.type,
      originalFilename: a.originalFilename,
      timeSource: a.timeSource,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      metadataJson: a.metadataJson,
    });
  }

  // 2) 组织导出数据
  const personById = new Map(people.map((p) => [p.id, p]));
  const eventsSorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const child = people.find((p) => p.isChild);

  const tagsByEvent = new Map<string, string[]>();
  for (const t of tags) {
    const list = tagsByEvent.get(t.memoryEventId) ?? [];
    list.push(t.tag);
    tagsByEvent.set(t.memoryEventId, list);
  }

  const memoriesJson = eventsSorted.map((e) => ({
    id: e.id,
    childPersonId: e.childPersonId,
    title: e.title,
    occurredAt: iso(e.occurredAt),
    occurredAtPrecision: e.occurredAtPrecision,
    locationText: e.locationText,
    coverAssetId: e.coverAssetId,
    status: e.status,
        deletedAt: iso(e.deletedAt),
    milestoneType: e.milestoneType,
    isPinned: e.isPinned,
    ageDays: e.ageDays,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
    assetIds: eventAssetLinks.filter((l) => l.memoryEventId === e.id).map((l) => l.assetId),
    participantPersonIds: eventParticipantLinks
      .filter((l) => l.memoryEventId === e.id)
      .map((l) => l.personId),
    tags: tagsByEvent.get(e.id) ?? [],
  }));

  const capsulesJson = capsules.map((c) => ({
    id: c.id,
    title: c.title,
    unlockType: c.unlockType,
    unlockValue: c.unlockValue,
    status: c.status,
    sealedAt: iso(c.sealedAt),
    openedAt: iso(c.openedAt),
    createdAt: iso(c.createdAt),
    // 导出永远包含内容（封存不是物理加密，PRD §15）
    memoryEventIds: capsuleEventLinks.filter((l) => l.capsuleId === c.id).map((l) => l.memoryEventId),
    assetIds: capsuleAssetLinks.filter((l) => l.capsuleId === c.id).map((l) => l.assetId),
    contributionIds: capsuleContributionLinks
      .filter((l) => l.capsuleId === c.id)
      .map((l) => l.contributionId),
  }));

  const inboxItemsJson = inboxItems.map((item) => ({
    id: item.id,
    familyId: item.familyId,
    kind: item.kind,
    status: item.status,
    rawText: item.rawText,
    draftTitle: item.draftTitle,
    draftOccurredAt: iso(item.draftOccurredAt),
    draftLocationText: item.draftLocationText,
    participantPersonIds: inboxItemParticipants
      .filter((link) => link.inboxItemId === item.id)
      .map((link) => link.personId),
    memoryEventId: item.memoryEventId,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  }));
  const inboxItemAssetsJson = inboxItemAssets.map((link) => ({
    id: link.id,
    inboxItemId: link.inboxItemId,
    assetId: link.assetId,
    familyId: link.familyId,
    createdAt: iso(link.createdAt),
  }));

  // 3) timeline.md（相对路径引用原媒体）
  const tz = family.timezone;
  const dt = (d: Date, style: Intl.DateTimeFormatOptions = { dateStyle: "long", timeZone: tz }) =>
    new Intl.DateTimeFormat("zh-CN", style).format(d);
  const md: string[] = [];
  md.push(`# ${family.name} · 成长时间轴`);
  md.push("");
  md.push(`> 由 Family Time Capsule 导出于 ${dt(new Date(), { dateStyle: "full", timeZone: tz })} · 共 ${eventsSorted.length} 个事件`);
  md.push("");
  let lastMonth = "";
  for (const e of eventsSorted) {
    const month = dt(e.occurredAt, { year: "numeric", month: "long", timeZone: tz });
    if (month !== lastMonth) {
      md.push(`## ${month}`);
      md.push("");
      lastMonth = month;
    }
    md.push(`### ${e.title}`);
    const age = formatAgeLabel(child?.birthDate, e.occurredAt, tz);
    const participantNames = eventParticipantLinks
      .filter((l) => l.memoryEventId === e.id)
      .map((l) => personById.get(l.personId)?.displayName)
      .filter(Boolean)
      .join("、");
    md.push(
      `${dt(e.occurredAt, { dateStyle: "long", timeStyle: "short", timeZone: tz })}` +
        (age ? ` · ${age}` : "") +
        (participantNames ? ` · ${participantNames}` : ""),
    );
    md.push("");
    for (const link of eventAssetLinks.filter((l) => l.memoryEventId === e.id)) {
      const asset = assets.find((a) => a.id === link.assetId);
      if (!asset || asset.derivativeType) continue;
      const rel = assetRelPaths.get(asset.id)!;
      // 转义 ] 与换行，防止展示名破坏 Markdown 结构
      const safeAlt = asset.originalFilename.replace(/[\r\n\]]/g, " ");
      if (asset.type === "image") {
        md.push(`![${safeAlt}](${rel})`);
        md.push("");
      } else if (asset.type === "audio") {
        md.push(`- 🎧 [录音：${safeAlt}](${rel})`);
      } else if (asset.type === "video") {
        md.push(`- 🎬 [视频：${safeAlt}](${rel})`);
      } else if (asset.type === "document") {
        md.push(`- 📄 [文档：${safeAlt}](${rel})`);
      }
    }
    for (const c of contributions.filter((c) => c.memoryEventId === e.id)) {
      const author = personById.get(c.authorPersonId)?.displayName ?? "家人";
      md.push("");
      md.push(`**${author}说：**`);
      md.push("");
      md.push((c.editedText ?? c.rawText ?? "").split("\n").map((l) => `> ${l}`).join("\n"));
    }
    const eventFacts = facts.filter((f) => f.memoryEventId === e.id && f.status === "user_confirmed");
    if (eventFacts.length > 0) {
      md.push("");
      md.push("**已确认事实**");
      for (const f of eventFacts) md.push(`- ${f.statement}`);
    }
    md.push("");
  }

  const manifest = {
    exportVersion: EXPORT_VERSION,
    modules: { collections: 1, bookProjects: 1 },
    appVersion: getAppVersion(),
    exportedAt: new Date().toISOString(),
    familyId,
    familyName: family.name,
    fileCount: manifestAssets.length + EXPORT_NON_ASSET_FILE_COUNT,
    assetCount: manifestAssets.length,
    assets: manifestAssets,
  };

  // 4) 打包（流式写入 exports/）
  const { ensureDataDirs } = await import("@/lib/paths");
  const dirs = ensureDataDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `family-time-capsule-export-${stamp}.zip`;
  const filePath = path.join(dirs.exports, fileName);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = new ZipArchive({ zlib: { level: 0 } }); // 媒体已压缩，store 模式更快
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    const json = (name: string, data: unknown) =>
      archive.append(Buffer.from(JSON.stringify(data, null, 2)), {
        name: `${EXPORT_ROOT_DIR}/${name}`,
      });

    json("manifest.json", manifest);
    json("family.json", {
      id: family.id,
      name: family.name,
      timezone: family.timezone,
      childLaterUnlockAge: family.childLaterUnlockAge,
      weekStartsOn: family.weekStartsOn,
      reviewReminderWeekday: family.reviewReminderWeekday,
      reviewReminderLocalTime: family.reviewReminderLocalTime,
      remindPendingInbox: family.remindPendingInbox,
      remindPendingRequests: family.remindPendingRequests,
      remindUpcomingCapsules: family.remindUpcomingCapsules,
      createdAt: iso(family.createdAt),
      updatedAt: iso(family.updatedAt),
    });
    json("people.json", people.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      relationToChild: p.relationToChild,
      isChild: p.isChild,
      isGuardian: p.isGuardian,
      birthDate: p.birthDate,
      childLaterUnlockedAt: iso(p.childLaterUnlockedAt),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    })));
    json("memories.json", memoriesJson);
    json("inbox-items.json", inboxItemsJson);
    json("inbox-item-assets.json", inboxItemAssetsJson);
    json("import-sessions.json", importSessions.map((session) => ({
      id: session.id,
      source: session.source,
      status: session.status,
      totalCount: session.totalCount,
      completedCount: session.completedCount,
      failedCount: session.failedCount,
      defaultTitle: session.defaultTitle,
      defaultOccurredAt: iso(session.defaultOccurredAt),
      defaultLocationText: session.defaultLocationText,
      createdAt: iso(session.createdAt),
      updatedAt: iso(session.updatedAt),
    })));
    json("import-session-default-participants.json", importDefaultParticipants.map((link) => ({
      id: link.id,
      importSessionId: link.importSessionId,
      personId: link.personId,
      createdAt: iso(link.createdAt),
    })));
    json("import-session-items.json", importItems.map((item) => ({
      id: item.id,
      importSessionId: item.importSessionId,
      captureId: item.captureId,
      filename: item.filename,
      declaredMime: item.declaredMime,
      totalBytes: item.totalBytes,
      lastModified: iso(item.lastModified),
      clientFingerprint: item.clientFingerprint,
      assetId: item.assetId,
      inboxItemId: item.inboxItemId,
      status: item.status,
      errorCode: item.errorCode,
      sortOrder: item.sortOrder,
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
    })));
    json("contribution-requests.json", contributionRequests.map((request) => ({
      id: request.id,
      kind: request.kind,
      title: request.title,
      recipientLabel: request.recipientLabel,
      recipientPersonId: request.recipientPersonId,
      promptText: request.promptText,
      topicKey: request.topicKey,
      maxSubmissions: request.maxSubmissions,
      maxFilesPerSubmission: request.maxFilesPerSubmission,
      allowImages: request.allowImages,
      allowAudio: request.allowAudio,
      allowVideo: request.allowVideo,
      allowDocuments: request.allowDocuments,
      allowText: request.allowText,
      allowBrowserRecording: request.allowBrowserRecording,
      allowGuestName: request.allowGuestName,
      allowReuse: request.allowReuse,
      expiresAt: iso(request.expiresAt),
      createdAt: iso(request.createdAt),
      updatedAt: iso(request.updatedAt),
      // tokenHash, creator/closer User ids and live status are instance-local.
      // Every restored entry is deliberately closed until a user regenerates it.
    })));
    json("contribution-request-submissions.json", requestSubmissions.map((submission) => ({
      id: submission.id,
      requestId: submission.requestId,
      inboxItemId: submission.inboxItemId,
      createdAt: iso(submission.createdAt),
    })));
    json("contribution-portal-submissions.json", portalSubmissions.map((submission) => ({
      id: submission.id,
      requestId: submission.requestId,
      importSessionId: submission.importSessionId,
      guestDisplayName: submission.guestDisplayName,
      status: submission.status,
      completedAt: iso(submission.completedAt),
      createdAt: iso(submission.createdAt),
    })));
    for (const [index, rows] of Object.values(bookGraph).entries()) json(BOOK_FILES[index], rows);
    json("collections.json", collectionGraph.collections);
    json("collection-sections.json", collectionGraph.sections);
    json("collection-items.json", collectionGraph.items);
    json("review-periods.json", reviewPeriods.map((period) => ({
      id: period.id,
      periodStart: iso(period.periodStart),
      periodEnd: iso(period.periodEnd),
      status: period.status,
      storyId: period.storyId,
      startedAt: iso(period.startedAt),
      completedAt: iso(period.completedAt),
      createdAt: iso(period.createdAt),
      updatedAt: iso(period.updatedAt),
    })));
    json("review-period-events.json", reviewEvents.map((link) => ({
      id: link.id,
      reviewPeriodId: link.reviewPeriodId,
      memoryEventId: link.memoryEventId,
      createdAt: iso(link.createdAt),
    })));
    json("contributions.json", contributions.map((c) => ({
      id: c.id,
      memoryEventId: c.memoryEventId,
      authorPersonId: c.authorPersonId,
      // Login credentials and local User ids are intentionally not portable.
      // Person/name/mode preserve who entered the words after disaster restore.
      recordedByPersonId: c.recordedByPersonId,
      recordedByNameSnapshot: c.recordedByNameSnapshot,
      recordingMode: c.recordingMode,
      rawText: c.rawText,
      transcript: c.transcript,
      editedText: c.editedText,
      audioAssetId: c.audioAssetId,
      visibility: c.visibility,
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
      deletedAt: iso(c.deletedAt),
    })));
    json("facts.json", facts.map((f) => ({
      id: f.id,
      memoryEventId: f.memoryEventId,
      statement: f.statement,
      status: f.status,
      createdAt: iso(f.createdAt),
    })));
    json("fact-sources.json", factSources.map((s) => ({
      id: s.id,
      factId: s.factId,
      sourceType: s.sourceType,
      sourceId: s.sourceId,
      // M3-D 精确 locator：引文 + 转录时间段（服务端推导、创建时固化）
      quote: s.quote,
      startMs: s.startMs,
      endMs: s.endMs,
      createdAt: iso(s.createdAt),
    })));
    const storyBundle = collectDurableStories(familyId, bookClosure.stories);
    json("stories.json", storyBundle.stories.map((st) => ({
      id: st.id,
      kind: st.kind,
      periodStart: iso(st.periodStart),
      periodEnd: iso(st.periodEnd),
      title: st.title,
      status: st.status,
      editedAt: st.editedAt ? iso(st.editedAt) : null,
      publishedAt: st.publishedAt ? iso(st.publishedAt) : null,
      createdAt: iso(st.createdAt),
      updatedAt: iso(st.updatedAt),
      deletedAt: iso(st.deletedAt),
    })));
    json("story-paragraphs.json", storyBundle.paragraphs.map((pp) => ({
      id: pp.id,
      storyId: pp.storyId,
      position: pp.position,
      kind: pp.kind,
      text: pp.text,
      createdAt: iso(pp.createdAt),
      updatedAt: iso(pp.updatedAt),
    })));
    json("story-sources.json", storyBundle.sources.map((ss) => ({
      id: ss.id,
      paragraphId: ss.paragraphId,
      sourceType: ss.sourceType,
      sourceId: ss.sourceId,
      quote: ss.quote,
      createdAt: iso(ss.createdAt),
    })));
    json("transcripts.json", transcripts.map((t) => ({
      id: t.id,
      familyId: t.familyId,
      assetId: t.assetId,
      language: t.language,
      provider: t.provider,
      model: t.model,
      rawTranscript: t.rawTranscript,
      editedTranscript: t.editedTranscript,
      segmentsJson: t.segmentsJson,
      status: t.status,
      sourceSha256: t.sourceSha256,
      createdByJobId: t.createdByJobId,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    })));
    json("capsules.json", capsulesJson);
    const dialogue = collectCapsuleDialogue(familyId);
    json("capsule-questions.json", dialogue.questions.map((q) => ({
      id: q.id,
      capsuleId: q.capsuleId,
      questionText: q.questionText,
      createdAt: iso(q.createdAt),
    })));
    json("capsule-replies.json", dialogue.replies.map((r) => ({
      id: r.id,
      questionId: r.questionId,
      capsuleId: r.capsuleId,
      authorPersonId: r.authorPersonId,
      text: r.text,
      assetId: r.assetId,
      createdAt: iso(r.createdAt),
    })));
    archive.append(Buffer.from(md.join("\n"), "utf8"), {
      name: `${EXPORT_ROOT_DIR}/timeline.md`,
    });

    // 原件：从磁盘流式加入
    for (const a of assets) {
      if (a.derivativeType) continue;
      archive.file(storage.resolvePath(a.storageKey), {
        name: `${EXPORT_ROOT_DIR}/${assetRelPaths.get(a.id)!}`,
      });
    }
    // 空目录也保留（stories/ 及空的媒体目录）
    archive.append(Buffer.alloc(0), { name: `${EXPORT_ROOT_DIR}/stories/.keep` });
    archive.append(Buffer.alloc(0), { name: `${EXPORT_ROOT_DIR}/originals/images/.keep` });
    archive.append(Buffer.alloc(0), { name: `${EXPORT_ROOT_DIR}/originals/audio/.keep` });
    archive.append(Buffer.alloc(0), { name: `${EXPORT_ROOT_DIR}/originals/video/.keep` });
    archive.append(Buffer.alloc(0), { name: `${EXPORT_ROOT_DIR}/originals/documents/.keep` });

    void archive.finalize();
  });

  const bytes = statSync(filePath).size;
  // 审计留痕（v0.1.3）：best-effort，失败不影响导出结果
  {
    const { recordAudit, AUDIT_KINDS } = await import("@/lib/audit/service");
    await recordAudit(familyId, AUDIT_KINDS.exportCreated, opts.actorUserId ?? null, {
      fileName,
      bytes,
      assetCount: manifestAssets.length,
      fileCount: manifestAssets.length + EXPORT_NON_ASSET_FILE_COUNT,
    });
  }
  return {
    filePath,
    fileName,
    bytes,
    fileCount: manifestAssets.length + EXPORT_NON_ASSET_FILE_COUNT,
    assetCount: manifestAssets.length,
  };
}

/**
 * Deliberate full-backup bypass: the API route has already required
 * `archive:export`. Never reuse this query for ordinary archive reads.
 */
async function listCompleteFamilyContributionsForDisasterExport(
  db: ReturnType<typeof getDb>,
  familyId: string,
  retainedIds: string[] = [],
) {
  return db
    .select({ contribution: contributionTable })
    .from(contributionTable)
    .innerJoin(memoryEventTable, eq(contributionTable.memoryEventId, memoryEventTable.id))
    .where(
      and(
        eq(memoryEventTable.familyId, familyId),
        or(isNull(contributionTable.deletedAt),inArray(contributionTable.id,retainedIds)),
      ),
    )
    .then((rows) => rows.map((r) => r.contribution));
}

async function listFamilyFacts(db: ReturnType<typeof getDb>, familyId: string) {
  return db
    .select({ fact: factTable })
    .from(factTable)
    .innerJoin(memoryEventTable, eq(factTable.memoryEventId, memoryEventTable.id))
    .where(and(eq(memoryEventTable.familyId, familyId)))
    .then((rows) => rows.map((r) => r.fact));
}

let cachedAppVersion: string | undefined;

export function getAppVersion(): string {
  cachedAppVersion ??= pkg.version;
  return cachedAppVersion;
}
