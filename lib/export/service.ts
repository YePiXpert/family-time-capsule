import { readStoryInputSources } from "@/lib/stories/dependencies.mjs";
import { bookProject } from "@/db/schema/book";
import { createBookSourceResolver } from "@/lib/books/projects/sources";
import { draft as draftTable } from "@/db/schema/draft";
import type { FamilyContext } from "@/lib/family/context";
import { getLiveFamilyPrincipal } from "@/lib/authz/principal";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { auditLog } from "@/db/schema/audit";
import { randomUUID } from "node:crypto";
import { createEventAccessSnapshot, eventVisibilityCondition } from "@/lib/authz/event-access";
import { createContributionAccessSnapshot, readableAssetPredicate, getVisibleContributionInTransaction } from "@/lib/authz/contribution-access";
import { parseBookArchive } from "@/lib/books/projects/archive";
import { parseCollectionArchive } from "@/lib/collections/archive";
import { collectArchivePrivacy } from "./collect-privacy";
import { assetDeletion } from "@/db/schema/asset-deletion";
import { collectDraftArchive } from "@/lib/drafts/archive";
import { collectNameReviews, parseNameReviews } from "@/lib/names/archive";
import "server-only";
import { collectBookArchive, collectBookSourceClosure } from "@/lib/books/projects/archive";
import { BOOK_FILES } from "@/lib/books/projects/portable.mjs";
import { collectCollectionArchive } from "@/lib/collections/archive";
import { COLLECTION_FILES } from "@/lib/collections/portable.mjs";

import { collectDurableStories } from "@/lib/stories/service";
import { collectCapsuleDialogue } from "@/lib/capsules/dialogue";
import { createReadStream, createWriteStream, statSync, unlinkSync } from "node:fs";
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
import { formatPersonAgeLabel } from "@/lib/memories/age";
import {
  formatOccurredLabel,
  precisionHasDay,
  type OccurredAtPrecision,
} from "@/lib/metadata/precision";
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

export const EXPORT_VERSION = 3;
export const EXPORT_ROOT_DIR = "family-time-capsule-export";
/** Current v2 non-media file count; legacy v1 is counted from its module set. */
export const EXPORT_NON_ASSET_FILE_COUNT = 29 + COLLECTION_FILES.length + BOOK_FILES.length;
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

/** Host maintenance only; application requests must use buildActorExport. */
export function buildDisasterExport(familyId: string, opts: { actorUserId?: string | null } = {}) {
  return buildExport(familyId, opts);
}
export async function buildActorExport(context: FamilyContext) {
  const principal = await getLiveFamilyPrincipal(context.userId, context.familyId);
  return buildExport(context.familyId, { actorUserId: context.userId, context: { ...context, ...principal } });
}
async function buildExport(familyId: string, opts: { actorUserId?: string | null; context?: FamilyContext }): Promise<ExportResult> {
  const db = getDb();
  const epoch = () => JSON.stringify([db.get(sql`pragma data_version`), db.get(sql`select total_changes() n`)]);
  const assertActor = () => {
    if (!opts.context) return;
    const c = opts.context;
    if (!hasFamilyCapability(c.role, "archive:export") || !db.get(sql`select id from user where id=${c.userId} and family_id=${familyId} and role=${c.role} and person_id is ${c.personId} and disabled_at is null`)) throw new Error("export_forbidden");
  };
  const startEpoch = db.transaction(() => { assertActor(); return epoch(); });
  let collectionGraph = collectCollectionArchive(familyId);
  let bookGraph = collectBookArchive(familyId);
  const bookClosure = collectBookSourceClosure(familyId);
  const family = await getFamily(familyId);
  if (!family) throw new Error("family not found");

  const [
    people,
    initialAssets,
    initialEvents,
    initialContributions,
    initialFacts,
    initialCapsules,
    initialInboxItems,
    initialInboxItemAssets,
    initialInboxItemParticipants,
    initialTranscripts,
    initialFactSources,
    initialTags,
    initialImportSessions,
    initialImportDefaultParticipants,
    initialImportItems,
    contributionRequests,
    initialRequestSubmissions,
    initialPortalSubmissions,
    initialReviewPeriods,
    initialReviewEvents,
  ] = await Promise.all([
    db.select().from(personTable).where(eq(personTable.familyId, familyId)),
    db.select().from(assetTable).where(eq(assetTable.familyId, familyId)),
    db
      .select()
      .from(memoryEventTable)
      .where(
        and(
          eq(memoryEventTable.familyId, familyId),
          // Disaster archives retain tombstoned roots so dependent facts and links remain valid.
          opts.context ? isNull(memoryEventTable.deletedAt) : undefined,
        ),
      ),
    listCompleteFamilyContributionsForDisasterExport(db, familyId),
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

  let assets = initialAssets;
  let events = initialEvents;
  let contributions = initialContributions;
  let facts = initialFacts;
  let capsules = initialCapsules;
  let inboxItems = initialInboxItems;
  let inboxItemAssets = initialInboxItemAssets;
  let inboxItemParticipants = initialInboxItemParticipants;
  let transcripts = initialTranscripts;
  let factSources = initialFactSources;
  let tags = initialTags;
  let importSessions = initialImportSessions;
  let importDefaultParticipants = initialImportDefaultParticipants;
  let importItems = initialImportItems;
  let requestSubmissions = initialRequestSubmissions;
  let portalSubmissions = initialPortalSubmissions;
  let reviewPeriods = initialReviewPeriods;
  let reviewEvents = initialReviewEvents;
  let draftArchive = collectDraftArchive(familyId, new Set(events.map(e => e.id)));
  let storyBundle = collectDurableStories(familyId, bookClosure.stories);
  let dialogue = collectCapsuleDialogue(familyId);
  if (opts.context) {
    const context = opts.context, access = createContributionAccessSnapshot(context);
    const readableEvents = new Set(db.select({ id: memoryEventTable.id }).from(memoryEventTable).where(and(eq(memoryEventTable.familyId, familyId), eventVisibilityCondition(createEventAccessSnapshot(context)), isNull(memoryEventTable.deletedAt))).all().map(r => r.id));
    events = events.filter(row => readableEvents.has(row.id));
    const readableAssets = new Set(db.select({ id: assetTable.id }).from(assetTable).where(and(eq(assetTable.familyId, familyId), readableAssetPredicate(access, sql`${assetTable.id}`))).all().map(r => r.id));
    assets = assets.filter(row => readableAssets.has(row.id));
    events = events.map(row => ({ ...row, coverAssetId: row.coverAssetId && readableAssets.has(row.coverAssetId) ? row.coverAssetId : null }));
    contributions = contributions.filter(row => readableEvents.has(row.memoryEventId) && db.transaction(tx => Boolean(getVisibleContributionInTransaction(tx, access, row.id))) && (!row.audioAssetId || readableAssets.has(row.audioAssetId)));
    const contributionIds = new Set(contributions.map(c => c.id));
    transcripts = transcripts.filter(row => readableAssets.has(row.assetId));
    const transcriptIds = new Set(transcripts.map(t => t.id));
    const sourceAllowed = (kind: string, id: string | null) => kind === "user_text" || (id !== null && (kind === "contribution" ? contributionIds : kind === "transcript" ? transcriptIds : kind === "memory_event" ? readableEvents : readableAssets).has(id));
    facts = facts.filter(row => readableEvents.has(row.memoryEventId) && factSources.filter(s => s.factId === row.id).every(s => sourceAllowed(s.sourceType, s.sourceId)));
    const factIds = new Set(facts.map(f => f.id));
    factSources = factSources.filter(row => factIds.has(row.factId));
    tags = tags.filter(row => readableEvents.has(row.memoryEventId));
    const ownDrafts = new Set(db.select({ id: draftTable.id }).from(draftTable).where(and(eq(draftTable.familyId, familyId), or(eq(draftTable.authorUserId, context.userId), context.personId ? and(isNull(draftTable.authorUserId), eq(draftTable.authorPersonId, context.personId)) : undefined))).all().map(r => r.id));
    draftArchive = draftArchive.filter(row => ownDrafts.has(row.id) && row.items.every(item => !item.assetId || readableAssets.has(item.assetId))).map(row => ({ ...row, memoryEventId: row.memoryEventId && readableEvents.has(row.memoryEventId) ? row.memoryEventId : null }));
    inboxItems = inboxItems.filter(row => (!row.memoryEventId || readableEvents.has(row.memoryEventId)) && inboxItemAssets.filter(l => l.inboxItemId === row.id).every(l => readableAssets.has(l.assetId)));
    const inboxIds = new Set(inboxItems.map(i => i.id));
    draftArchive = draftArchive.map(row => ({ ...row, inboxItemId: row.inboxItemId && inboxIds.has(row.inboxItemId) ? row.inboxItemId : null }));
    inboxItemAssets = inboxItemAssets.filter(row => inboxIds.has(row.inboxItemId) && readableAssets.has(row.assetId));
    inboxItemParticipants = inboxItemParticipants.filter(row => inboxIds.has(row.inboxItemId));
    const draftIds = new Set(draftArchive.map(d => d.id));
    importSessions = importSessions.filter(row => (row.createdByUserId === context.userId || row.source === "guest") && (!row.intakeDraftId || draftIds.has(row.intakeDraftId)) && importItems.filter(i => i.importSessionId === row.id).every(i => (!i.assetId || readableAssets.has(i.assetId)) && (!i.inboxItemId || inboxIds.has(i.inboxItemId))));
    const importIds = new Set(importSessions.map(i => i.id));
    importItems = importItems.filter(row => importIds.has(row.importSessionId));
    importDefaultParticipants = importDefaultParticipants.filter(row => importIds.has(row.importSessionId));
    requestSubmissions = requestSubmissions.filter(row => inboxIds.has(row.inboxItemId));
    portalSubmissions = portalSubmissions.filter(row => importIds.has(row.importSessionId));
    // Copied prose and historical book snapshots must never survive an inaccessible source.
    const permittedStories = new Set(storyBundle.stories.filter(row => !row.deletedAt && readStoryInputSources(row) !== null && [...(readStoryInputSources(row) ?? []), ...storyBundle.sources.filter(s => storyBundle.paragraphs.some(p => p.storyId === row.id && p.id === s.paragraphId))].every(s => s.sourceType === "fact" ? s.sourceId !== null && factIds.has(s.sourceId) : sourceAllowed(s.sourceType, s.sourceId))).map(s => s.id));
    storyBundle = { stories: storyBundle.stories.filter(s => permittedStories.has(s.id)), paragraphs: storyBundle.paragraphs.filter(p => permittedStories.has(p.storyId)), sources: storyBundle.sources.filter(s => storyBundle.paragraphs.some(p => p.id === s.paragraphId && permittedStories.has(p.storyId))) };
    reviewPeriods = reviewPeriods.filter(row => (!row.storyId || permittedStories.has(row.storyId)) && reviewEvents.filter(l => l.reviewPeriodId === row.id).every(l => readableEvents.has(l.memoryEventId)));
    const reviewIds = new Set(reviewPeriods.map(r => r.id));
    reviewEvents = reviewEvents.filter(row => reviewIds.has(row.reviewPeriodId));
    const collectionIds = new Set(collectionGraph.collections.filter(row => !row.deletedAt && (!row.coverAssetId || readableAssets.has(row.coverAssetId)) && collectionGraph.items.filter(i => i.collectionId === row.id).every(i => (!i.memoryEventId || readableEvents.has(i.memoryEventId)) && (!i.assetId || readableAssets.has(i.assetId)))).map(r => r.id));
    collectionGraph = parseCollectionArchive(collectionGraph.collections.filter(r => collectionIds.has(r.id)), collectionGraph.sections.filter(r => collectionIds.has(r.collectionId)), collectionGraph.items.filter(r => collectionIds.has(r.collectionId)), familyId, readableEvents, readableAssets);
    const refs = { memory: readableEvents, asset: readableAssets, contribution: contributionIds, story: permittedStories, collection: collectionIds, person: new Set(people.map(p => p.id)) };
    const sourceSet = (row: (typeof bookGraph.sources)[number]) => row.kind === "memory" ? row.memoryEventId : row.kind === "asset" ? row.assetId : row.kind === "contribution" ? row.contributionId : row.kind === "story" ? row.storyId : row.collectionId;
    const ownedBookIds = new Set(db.select({ id: bookProject.id }).from(bookProject).where(eq(bookProject.ownerUserId, context.userId)).all().map(r => r.id));
    const projectIds = new Set(bookGraph.projects.filter(row => !row.deletedAt && (row.audience === "family" || ownedBookIds.has(row.id)) && (!row.coverAssetId || readableAssets.has(row.coverAssetId)) && bookGraph.sources.filter(s => s.projectId === row.id).every(s => { const id = sourceSet(s); return id !== null && refs[s.kind].has(id) && createBookSourceResolver(context, row.audience)(s.kind, id).state.available; })).map(p => p.id));
    bookGraph = parseBookArchive([bookGraph.projects.filter(r => projectIds.has(r.id)), bookGraph.chapters.filter(r => projectIds.has(r.projectId)), bookGraph.blocks.filter(r => projectIds.has(r.projectId)), bookGraph.sources.filter(r => projectIds.has(r.projectId)), bookGraph.links.filter(r => projectIds.has(r.projectId)), bookGraph.revisions.filter(r => projectIds.has(r.projectId))], familyId, refs);
  }
  // Unedited generated drafts are rebuildable; keep the review without a dangling draft link.
  const retainedStories = new Set(storyBundle.stories.map(row => row.id));
  reviewPeriods = reviewPeriods.map(row => ({ ...row, storyId: row.storyId && retainedStories.has(row.storyId) ? row.storyId : null }));
  const eventIds = events.map((e) => e.id);
  const privacy = collectArchivePrivacy(familyId, { events, assets, draftIds: new Set(draftArchive.map(d => d.id)), bookIds: new Set(bookGraph.projects.map(p => p.id)), importIds: new Set(importSessions.map(i => i.id)), reviewAssetPairs: new Set(inboxItemAssets.map(l => `${l.inboxItemId}:${l.assetId}`)) });
  // Capture review records before opening the ZIP and reject an inconsistent
  // title snapshot rather than emitting an archive that cannot be restored.
  const nameReviews = parseNameReviews(collectNameReviews(familyId, new Set(eventIds), new Set(inboxItems.map(item => item.id)), new Set(assets.map(a => a.id))), new Map(events.map(event => [event.id, event.titleRevision])), new Map(inboxItems.map(item => [item.id, item.titleRevision])), new Map(assets.map(a => [a.id, a.nameRevision])));
  const [initialEventAssetLinks, eventParticipantLinks, initialCapsuleEventLinks, initialCapsuleAssetLinks, initialCapsuleContributionLinks] =
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

  let eventAssetLinks = initialEventAssetLinks;
  let capsuleEventLinks = initialCapsuleEventLinks;
  let capsuleAssetLinks = initialCapsuleAssetLinks;
  let capsuleContributionLinks = initialCapsuleContributionLinks;
  if (opts.context) {
    const assetIds = new Set(assets.map(a => a.id)), eventsSet = new Set(eventIds), contributionIds = new Set(contributions.map(c => c.id));
    const brokenPairs = new Set(eventAssetLinks.filter(row => row.livePhotoGroupId && !assetIds.has(row.assetId)).map(row => row.livePhotoGroupId!));
    eventAssetLinks = eventAssetLinks.filter(row => assetIds.has(row.assetId) && (!row.livePhotoGroupId || !brokenPairs.has(row.livePhotoGroupId)));
    events = events.map(row => ({ ...row, coverAssetId: row.coverAssetId && eventAssetLinks.some(l => l.memoryEventId === row.id && l.assetId === row.coverAssetId) ? row.coverAssetId : null }));
    const capsuleIds = new Set(capsules.filter(row => capsuleEventLinks.filter(l => l.capsuleId === row.id).every(l => eventsSet.has(l.memoryEventId)) && capsuleAssetLinks.filter(l => l.capsuleId === row.id).every(l => assetIds.has(l.assetId)) && capsuleContributionLinks.filter(l => l.capsuleId === row.id).every(l => contributionIds.has(l.contributionId)) && dialogue.replies.filter(r => r.capsuleId === row.id).every(r => !r.assetId || assetIds.has(r.assetId))).map(c => c.id));
    capsules = capsules.filter(row => capsuleIds.has(row.id));
    capsuleEventLinks = capsuleEventLinks.filter(row => capsuleIds.has(row.capsuleId));
    capsuleAssetLinks = capsuleAssetLinks.filter(row => capsuleIds.has(row.capsuleId));
    capsuleContributionLinks = capsuleContributionLinks.filter(row => capsuleIds.has(row.capsuleId));
    dialogue = { questions: dialogue.questions.filter(q => capsuleIds.has(q.capsuleId)), replies: dialogue.replies.filter(r => capsuleIds.has(r.capsuleId)) };
  }

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
      displayName: a.displayName,
      nameSource: a.nameSource,
      nameRevision: a.nameRevision,
      participantPersonIds: JSON.parse(a.participantIdsJson),
      metadataRevision: a.metadataRevision,
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
  const timelineEvents = eventsSorted.filter(e => !e.deletedAt);

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
    bodyText: e.bodyText,
    titleSource: e.titleSource,
    titleRevision: e.titleRevision,
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
    assetIds: eventAssetLinks.filter((l) => l.memoryEventId === e.id).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.assetId),
    assetReferences: eventAssetLinks.filter(l => l.memoryEventId === e.id).sort((a,b) => a.sortOrder - b.sortOrder).map(l => ({ assetId: l.assetId, caption: l.caption, ...(l.livePhotoGroupId ? { livePhotoGroupId: l.livePhotoGroupId, livePhotoRole: l.livePhotoRole } : {}) })),
    assetCaptions: Object.fromEntries(eventAssetLinks.filter((l) => l.memoryEventId === e.id).map(l => [l.assetId, l.caption])),
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
    titleSource: item.titleSource,
    titleRevision: item.titleRevision,
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
  md.push(`# ${family.name} · 家庭记忆时间轴`);
  md.push("");
  md.push(`> 由 Family Time Capsule 导出于 ${dt(new Date(), { dateStyle: "full", timeZone: tz })} · 共 ${timelineEvents.length} 个事件`);
  md.push("");
  const renderEventBody = (e: (typeof eventsSorted)[number]): void => {
    if (e.bodyText) md.push(e.bodyText, "");
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
  };

  let lastMonth = "";
  const undated: typeof eventsSorted = [];
  for (const e of timelineEvents) {
    // unknown 的锚点是创建时刻：按月分组会伪造发生月份，单独归入「时间不确定」。
    if (e.occurredAtPrecision === "unknown") {
      undated.push(e);
      continue;
    }
    const month = dt(e.occurredAt, { year: "numeric", month: "long", timeZone: tz });
    if (month !== lastMonth) {
      md.push(`## ${month}`);
      md.push("");
      lastMonth = month;
    }
    md.push(`### ${e.title}`);
    // 年龄只在到日或更精确时给出（月/年锚点的“年龄”会是编造值）。
    const age = precisionHasDay(e.occurredAtPrecision as OccurredAtPrecision)
      ? formatPersonAgeLabel(e.childPersonId ? personById.get(e.childPersonId) : null, e.occurredAt, tz)
      : null;
    const participantNames = eventParticipantLinks
      .filter((l) => l.memoryEventId === e.id)
      .map((l) => personById.get(l.personId)?.displayName)
      .filter(Boolean)
      .join("、");
    md.push(
      `${formatOccurredLabel(e.occurredAtPrecision as OccurredAtPrecision, e.occurredAt, tz)}` +
        (age ? ` · ${age}` : "") +
        (participantNames ? ` · ${participantNames}` : ""),
    );
    md.push("");
    renderEventBody(e);
  }
  // 时间不确定的事件：锚点是创建时刻，不进任何月份分组，也不显示编造日期。
  if (undated.length > 0) {
    md.push(`## 时间不确定`);
    md.push("");
    for (const e of undated) {
      md.push(`### ${e.title}`);
      const participantNames = eventParticipantLinks
        .filter((l) => l.memoryEventId === e.id)
        .map((l) => personById.get(l.personId)?.displayName)
        .filter(Boolean)
        .join("、");
      md.push(
        `时间不确定` + (participantNames ? ` · ${participantNames}` : ""),
      );
      md.push("");
      renderEventBody(e);
    }
  }

  const manifest = {
    exportVersion: EXPORT_VERSION,
    modules: { collections: 1, bookProjects: 1, nameReviews: 1, drafts: 1, assetDeletions: 1 },
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
    json("asset-deletions.json", opts.context ? [] : db.select({ assetId: assetDeletion.assetId, sha256: assetDeletion.sha256, deletedAt: assetDeletion.deletedAt }).from(assetDeletion).where(eq(assetDeletion.familyId, familyId)).all());
    json("drafts.json", draftArchive);
    json("privacy.json", privacy);
    json("inbox-items.json", inboxItemsJson);
    json("inbox-item-assets.json", inboxItemAssetsJson);
    json("import-sessions.json", importSessions.map((session) => ({
      id: session.id,
      source: session.source,
      intakeDestination: session.intakeDestination,
      intakeDraftId: session.intakeDraftId,
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
    json("name-reviews.json", nameReviews);
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
    json("stories.json", storyBundle.stories.map((st) => ({
      id: st.id,
      kind: st.kind,
      inputSources: readStoryInputSources(st),
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
      revision: t.revision,
      segmentsJson: t.segmentsJson,
      status: t.status,
      sourceSha256: t.sourceSha256,
      createdByJobId: t.createdByJobId,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    })));
    json("capsules.json", capsulesJson);
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
  try {
    db.transaction(tx => {
      assertActor();
      if (epoch() !== startEpoch) throw new Error("export_state_changed");
      // Final authorization and the audit commit synchronously under one writer lock.
      tx.insert(auditLog).values({ id: randomUUID(), familyId, kind: "export.created", actorUserId: opts.actorUserId ?? null, detailJson: JSON.stringify({ fileName, bytes, assetCount: manifestAssets.length, fileCount: manifestAssets.length + EXPORT_NON_ASSET_FILE_COUNT }), createdAt: new Date() }).run();
    }, { behavior: "immediate" });
  } catch (error) { unlinkSync(filePath); throw error; }

  return {
    filePath,
    fileName,
    bytes,
    fileCount: manifestAssets.length + EXPORT_NON_ASSET_FILE_COUNT,
    assetCount: manifestAssets.length,
  };
}

/**
 * Host disaster collection. Actor exports intersect these rows with their live
 * object grants before any original is hashed or any archive is emitted.
 */
async function listCompleteFamilyContributionsForDisasterExport(
  db: ReturnType<typeof getDb>,
  familyId: string,
) {
  return db
    .select({ contribution: contributionTable })
    .from(contributionTable)
    .innerJoin(memoryEventTable, eq(contributionTable.memoryEventId, memoryEventTable.id))
    .where(
      and(
        eq(memoryEventTable.familyId, familyId),
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
