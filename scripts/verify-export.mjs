#!/usr/bin/env node
import { validateStoryInputSources } from "../lib/stories/dependencies.mjs";
import { validateArchivePrivacy } from "../lib/export/privacy.mjs";
import { parseAssetDeletions } from "../lib/assets/deletion-portable.mjs";
import { BOOK_FILES, validateBookArchive } from "../lib/books/projects/portable.mjs";
import { COLLECTION_FILES, validateCollectionArchive } from "../lib/collections/portable.mjs";
// 校验 family-time-capsule 导出 ZIP（docs/RESTORE.md §1）：
//   npm run verify:export <zip路径>
// 检查 manifest 版本、每个原件的存在/字节数/SHA-256、必需 JSON 可解析、引用完整性。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = "family-time-capsule-export";
const SUPPORTED_EXPORT_VERSIONS = new Set([1, 2, 3]);

const zipArg = process.argv[2];
if (!zipArg) {
  console.error("用法: npm run verify:export <导出.zip>");
  process.exit(2);
}

let zip;
try {
  const { default: JSZip } = await import("jszip");
  zip = await JSZip.loadAsync(readFileSync(path.resolve(zipArg)));
} catch (err) {
  console.error(`✗ 无法读取 ZIP: ${err.message}`);
  process.exit(1);
}

const errors = [];
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => {
  errors.push(msg);
  console.error(`✗ ${msg}`);
};

async function readJsonAsync(name) {
  const file = zip.file(`${ROOT}/${name}`);
  if (!file) {
    fail(`缺少 ${name}`);
    return null;
  }
  try {
    return JSON.parse(await file.async("string"));
  } catch {
    fail(`${name} 无法解析为 JSON`);
    return null;
  }
}

const manifest = await readJsonAsync("manifest.json");
if (!manifest) {
  console.error("\n结论: 校验失败（manifest 不可用，无法继续）");
  process.exit(1);
}

if (!SUPPORTED_EXPORT_VERSIONS.has(manifest.exportVersion)) {
  fail(`不支持的 exportVersion: ${manifest.exportVersion}（支持: ${[...SUPPORTED_EXPORT_VERSIONS].join(", ")}）`);
} else {
  ok(`exportVersion=${manifest.exportVersion}, appVersion=${manifest.appVersion ?? "?"}, 导出时间=${manifest.exportedAt}`);
}

async function zipEntryExists(name) {
  return zip.file(`${ROOT}/${name}`) !== null;
}

const [
  familyJson,
  people,
  memories,
  contributions,
  facts,
  factSources,
  transcripts,
  capsules,
  importSessions,
  importDefaultParticipants,
  importSessionItems,
  contributionRequests,
  requestSubmissions,
  portalSubmissions,
  reviewPeriods,
  reviewPeriodEvents,
] = await Promise.all([
  readJsonAsync("family.json"),
  readJsonAsync("people.json"),
  readJsonAsync("memories.json"),
  readJsonAsync("contributions.json"),
  readJsonAsync("facts.json"),
  readJsonAsync("fact-sources.json"),
  readJsonAsync("transcripts.json"),
  readJsonAsync("capsules.json"),
  readJsonAsync("import-sessions.json"),
  readJsonAsync("import-session-default-participants.json"),
  readJsonAsync("import-session-items.json"),
  readJsonAsync("contribution-requests.json"),
  readJsonAsync("contribution-request-submissions.json"),
  readJsonAsync("contribution-portal-submissions.json"),
  readJsonAsync("review-periods.json"),
  readJsonAsync("review-period-events.json"),
]);
if (familyJson) ok(`family: ${familyJson.name} (${familyJson.timezone})`);

const timelineMd = zip.file(`${ROOT}/timeline.md`);
if (timelineMd) ok("timeline.md 存在");
else fail("缺少 timeline.md");

// v0.1.5 起固定 12 个非媒体文件（含 inbox*2）；M4 起 stories 三件套（+3）
const hasInboxItems = Boolean(zip.file(`${ROOT}/inbox-items.json`));
const hasInboxItemAssets = Boolean(zip.file(`${ROOT}/inbox-item-assets.json`));
const hasStories = await zipEntryExists("stories.json");
const hasDialogue = await zipEntryExists("capsule-questions.json");
const collectionPresence = await Promise.all(COLLECTION_FILES.map(name => zipEntryExists(name)));
const hasCollections = collectionPresence.every(Boolean);
if (!hasCollections && collectionPresence.some(Boolean)) fail("相册关系三件套不完整");
if (manifest.modules?.collections !== undefined && (manifest.modules.collections !== 1 || !hasCollections)) fail("声明的相册模块缺失或不支持");
const collectionGraph = hasCollections ? await Promise.all(COLLECTION_FILES.map(name => readJsonAsync(name))) : [[],[],[]];
const bookPresence = await Promise.all(BOOK_FILES.map(name=>zipEntryExists(name)));
const hasBooks = bookPresence.every(Boolean);
if(!hasBooks && bookPresence.some(Boolean)) fail("年册关系文件不完整");
if(manifest.modules?.bookProjects !== undefined && (manifest.modules.bookProjects !== 1 || !hasBooks)) fail("声明的年册模块缺失或不支持");
const bookGraph = hasBooks ? await Promise.all(BOOK_FILES.map(name=>readJsonAsync(name))) : [[],[],[],[],[],[]];
const hasNameReviews = await zipEntryExists("name-reviews.json");
if (manifest.modules?.nameReviews !== undefined && (manifest.modules.nameReviews !== 1 || !hasNameReviews)) fail("声明的名称审核模块缺失或不支持");
const hasDrafts = await zipEntryExists("drafts.json");
if (manifest.modules?.drafts !== undefined && (manifest.modules.drafts !== 1 || !hasDrafts)) fail("声明的草稿模块缺失或不支持");
const hasAssetDeletions = await zipEntryExists("asset-deletions.json");
if (manifest.modules?.assetDeletions !== undefined && (manifest.modules.assetDeletions !== 1 || !hasAssetDeletions)) fail("声明的原件删除记录缺失或不支持");
const expectedNonAssetCount =
  (manifest.exportVersion >= 2 ? 1 : 0) +
  (hasInboxItems && hasInboxItemAssets ? 12 : 10) +
  (hasStories ? 3 : 0) + (hasNameReviews ? 1 : 0) + (hasDrafts ? 1 : 0) + (hasAssetDeletions ? 1 : 0) +
  (hasDialogue ? 2 : 0) +
  (importSessions ? 8 : 0) + (hasCollections ? COLLECTION_FILES.length : 0) + (hasBooks ? BOOK_FILES.length : 0);
if (hasInboxItems !== hasInboxItemAssets) {
  fail("inbox-items.json 与 inbox-item-assets.json 必须同时存在或同时缺失");
}
const expectedFileCount = (manifest.assets?.length ?? 0) + expectedNonAssetCount;
if (manifest.fileCount !== expectedFileCount) {
  fail(`manifest.fileCount 不匹配: ${manifest.fileCount} != ${expectedFileCount}`);
} else {
  ok(`fileCount=${manifest.fileCount} 与文件集一致`);
}

// 引用完整性
const personIds = new Set((people ?? []).map((p) => p.id));
const assetIds = new Set((manifest.assets ?? []).map((a) => a.assetId));

for (const a of manifest.assets ?? []) {
  if (a.participantPersonIds !== undefined && (!Array.isArray(a.participantPersonIds) || a.participantPersonIds.some(id => !personIds.has(id)))) fail("素材人物引用无效");
}
const factIds = new Set((facts ?? []).map((f) => f.id));
const eventIds = new Set((memories ?? []).map((m) => m.id));
if (manifest.exportVersion >= 2) {
  try {
    if (!memories.every(m => typeof m.bodyText === "string")) throw new Error();
    const privacy = validateArchivePrivacy(await readJsonAsync("privacy.json"), { events: eventIds, assets: assetIds, drafts: new Set(((await readJsonAsync("drafts.json")) ?? []).map(d => d.id)), books: new Set(bookGraph[0].map(p => p.id)), imports: new Set((importSessions ?? []).map(i => i.id)), reviewAssets: new Set(((await readJsonAsync("inbox-item-assets.json")) ?? []).map(l => `${l.inboxItemId}:${l.assetId}`)) });
    const drafts = await readJsonAsync("drafts.json");
    if (drafts.some(d => privacy.drafts.find(p => p.id === d.id)?.visibility !== d.visibility) || bookGraph[0].some(p => p.audience === "personal" && privacy.books.find(r => r.id === p.id)?.owner === null)) throw new Error();
    ok("v2 作者和读者关系完整");
  } catch { fail("v2 作者、读者或正文无效"); }
} else if (await zipEntryExists("privacy.json") || memories?.some(m => m.bodyText !== undefined)) fail("v2 内容不可降级为 v1");

try { parseAssetDeletions(hasAssetDeletions ? await readJsonAsync("asset-deletions.json") : [], assetIds); ok("原件删除记录有效"); } catch { fail("原件删除记录无效"); }
try { validateCollectionArchive(...collectionGraph, manifest.familyId, eventIds, assetIds); ok("相册关系图校验通过"); }
catch { fail("相册编辑关系图无效"); }

try { validateBookArchive(bookGraph, manifest.familyId, { memory:eventIds, asset:assetIds, person:personIds, contribution:new Set((contributions??[]).map(c=>c.id)), story:new Set(((await readJsonAsync("stories.json"))??[]).map(s=>s.id)), collection:new Set(collectionGraph[0].map(c=>c.id)) }); ok("年册编辑与历史版本关系图校验通过"); }
catch { fail("年册编辑与历史版本关系图无效"); }
const inboxEntry = zip.file(`${ROOT}/inbox-items.json`);
const inboxItemIds = new Set(
  inboxEntry
    ? JSON.parse(await inboxEntry.async("string")).map((item) => item.id)
    : [],
);
const intakeDraftIds = new Set();
if (hasDrafts) {
  const drafts = await readJsonAsync("drafts.json");
  const ids = new Set(), itemIds = new Set();
  try {
    if (!Array.isArray(drafts)) throw new Error();
    for (const row of drafts) {
      if (!row || typeof row.id !== "string" || ids.has(row.id) || Object.hasOwn(row, "authorUserId") || Object.hasOwn(row, "familyId") || !["editing", "published", "discarded"].includes(row.status) || !["family", "members", "private"].includes(row.visibility)) throw new Error();
      ids.add(row.id); intakeDraftIds.add(row.id);
      if ((row.authorPersonId !== null && !personIds.has(row.authorPersonId)) || (row.inboxItemId !== null && !inboxItemIds.has(row.inboxItemId)) || (row.memoryEventId !== null && (!eventIds.has(row.memoryEventId) || row.status !== "published"))) throw new Error();
      if (!Array.isArray(row.participantIds) || row.participantIds.some(id => !personIds.has(id)) || !Array.isArray(row.items)) throw new Error();
      validateLivePhotoReferences(row.items);
      for (const item of row.items) {
        if (!item || typeof item.id !== "string" || itemIds.has(item.id) || (item.assetId !== null && !assetIds.has(item.assetId))) throw new Error();
        itemIds.add(item.id);
      }
      if (row.coverItemId !== null && !row.items.some(item => item.id === row.coverItemId)) throw new Error();
    }
    ok(`草稿：${drafts.length} 件，作者、封面与素材引用完整（详细字段校验由恢复预检执行）`);
  } catch { fail("草稿或素材引用无效"); }
}
if (hasNameReviews) {
  const reviews = await readJsonAsync("name-reviews.json");
  if (!Array.isArray(reviews) || reviews.some(row => !row || !["accepted", "rejected"].includes(row.status) || !Number.isSafeInteger(row.revision) || row.revision < 1 || !(row.entityType === "memory_event" ? eventIds : row.entityType === "inbox_item" ? inboxItemIds : row.entityType === "asset" ? assetIds : new Set()).has(row.entityId))) fail("名称审核墓碑或目标关系无效");
  else ok(`名称审核：${reviews.length} 条，目标关系完整（详细版本校验由恢复预检执行）`);
}
const storyEntry = zip.file(`${ROOT}/stories.json`);
const storyIds = new Set(
  storyEntry
    ? JSON.parse(await storyEntry.async("string")).map((story) => story.id)
    : [],
);
if (storyEntry) {
  const dependencyIds = {
    fact: factIds, memory_event: eventIds,
    contribution: new Set((contributions ?? []).map(row => row.id)),
    transcript: new Set(((await readJsonAsync("transcripts.json")) ?? []).map(row => row.id)),
  };
  for (const row of JSON.parse(await storyEntry.async("string"))) {
    try {
      if (manifest.exportVersion >= 3 && !Object.hasOwn(row, "inputSources")) throw new Error();
      const sources = validateStoryInputSources(row.inputSources ?? null);
      if ((sources ?? []).some(source => !dependencyIds[source.sourceType].has(source.sourceId))) throw new Error();
    } catch { fail(`story ${row.id} 的生成来源清单或引用无效`); }
  }
}
function validateLivePhotoReferences(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.livePhotoGroupId) { if (item.livePhotoRole) throw new Error(); continue; }
    if (!/^[\w-]{1,128}$/u.test(item.livePhotoGroupId) || !["image", "video"].includes(item.livePhotoRole)) throw new Error();
    groups.set(item.livePhotoGroupId, [...(groups.get(item.livePhotoGroupId) ?? []), item]);
  }
  for (const pair of groups.values()) if (pair.length !== 2 || new Set(pair.map(i => i.livePhotoRole)).size !== 2 ||
    (pair[0].assetId && pair[0].assetId === pair[1].assetId)) throw new Error();
}
if (people) ok(`people: ${people.length} 人`);
if (memories) {
  for (const m of memories) {
    if (m.assetReferences !== undefined) {
      try {
        if (!Array.isArray(m.assetReferences) || JSON.stringify(m.assetReferences.map(r => r.assetId)) !== JSON.stringify(m.assetIds ?? [])) throw new Error();
        validateLivePhotoReferences(m.assetReferences);
        for (const r of m.assetReferences) if (r.livePhotoRole && manifest.assets.find(a => a.assetId === r.assetId)?.type !== r.livePhotoRole) throw new Error();
      } catch { fail(`memories: 事件 ${m.id} Live Photo 关系无效`); }
    }
    for (const id of m.participantPersonIds ?? []) {
      if (!personIds.has(id)) fail(`memories: 事件 ${m.id} 引用未知 person ${id}`);
    }
    for (const id of m.assetIds ?? []) {
      if (!assetIds.has(id)) fail(`memories: 事件 ${m.id} 引用未知 asset ${id}`);
    }
  }
  ok(`memories: ${memories.length} 个事件，引用完整`);
}
if (contributions) {
  for (const c of contributions) {
    if (!personIds.has(c.authorPersonId))
      fail(`contributions: ${c.id} 引用未知 person ${c.authorPersonId}`);
  }
  ok(`contributions: ${contributions.length} 条`);
}
if (capsules) {
  for (const c of capsules) {
    for (const id of c.memoryEventIds ?? []) {
      if (!(memories ?? []).some((m) => m.id === id))
        fail(`capsules: ${c.id} 引用未知 event ${id}`);
    }
  }
  ok(`capsules: ${capsules.length} 个`);
}
if (facts) ok(`facts: ${facts.length} 条`);
if (factSources) {
  for (const s of factSources) {
    if (!factIds.has(s.factId))
      fail(`fact-sources: ${s.id} 引用未知 fact ${s.factId}`);
    if (!["asset", "asset_analysis", "contribution", "transcript", "user_text"].includes(s.sourceType))
      fail(`fact-sources: ${s.id} 的 sourceType 非法 ${s.sourceType}`);
  }
  ok(`fact-sources: ${factSources.length} 条，引用完整`);
}
if (memories) {
  let tagCount = 0;
  for (const m of memories) {
    for (const tag of m.tags ?? []) {
      tagCount++;
      if (typeof tag !== "string" || tag.length === 0 || tag.length > 50)
        fail(`memories: 事件 ${m.id} 的 tag 非法 ${tag}`);
    }
  }
  if (tagCount > 0) ok(`tags: ${tagCount} 个`);
}
if (transcripts) ok(`transcripts: ${transcripts.length} 条`);

const importSessionIds = new Set((importSessions ?? []).map((session) => session.id));
for (const receipt of importSessions ?? []) {
  if ((receipt.intakeDestination !== undefined && !["pending", "draft", "library"].includes(receipt.intakeDestination)) ||
    (receipt.intakeDraftId != null && (receipt.intakeDestination !== "draft" || !intakeDraftIds.has(receipt.intakeDraftId)))) fail(`import session ${receipt.id} 的收件去向或草稿引用无效`);
}
for (const link of importDefaultParticipants ?? []) {
  if (!importSessionIds.has(link.importSessionId) || !personIds.has(link.personId))
    fail(`import default participant ${link.id} 引用未知 session/person`);
}
for (const item of importSessionItems ?? []) {
  if (!importSessionIds.has(item.importSessionId))
    fail(`import item ${item.id} 引用未知 session`);
  if (item.assetId && !assetIds.has(item.assetId))
    fail(`import item ${item.id} 引用未知 asset`);
  if (item.inboxItemId && !inboxItemIds.has(item.inboxItemId))
    fail(`import item ${item.id} 引用未知 inbox item`);
}
const requestIds = new Set((contributionRequests ?? []).map((request) => request.id));
for (const request of contributionRequests ?? []) {
  if (
    Object.hasOwn(request, "token") ||
    Object.hasOwn(request, "tokenHash") ||
    Object.hasOwn(request, "createdByUserId") ||
    Object.hasOwn(request, "closedByUserId")
  ) fail(`contribution request ${request.id} 泄露 token 或本地 User id`);
}
for (const submission of requestSubmissions ?? []) {
  if (!requestIds.has(submission.requestId) || !inboxItemIds.has(submission.inboxItemId))
    fail(`request submission ${submission.id} 引用不完整`);
}
for (const submission of portalSubmissions ?? []) {
  if (!requestIds.has(submission.requestId) || !importSessionIds.has(submission.importSessionId))
    fail(`portal submission ${submission.id} 引用不完整`);
}
const reviewPeriodIds = new Set((reviewPeriods ?? []).map((period) => period.id));
for (const period of reviewPeriods ?? []) {
  if (period.storyId && !storyIds.has(period.storyId))
    fail(`review period ${period.id} 引用未知 story`);
}
for (const link of reviewPeriodEvents ?? []) {
  if (!reviewPeriodIds.has(link.reviewPeriodId) || !eventIds.has(link.memoryEventId))
    fail(`review period event ${link.id} 引用不完整`);
}
if (importSessions)
  ok(`1.1 durable graph: ${importSessions.length} 个导入会话，关系完整且无 guest token`);

// 原件哈希校验
let verified = 0;
for (const entry of manifest.assets ?? []) {
  const file = zip.file(`${ROOT}/${entry.relativePath}`);
  if (!file) {
    fail(`manifest 引用的文件不存在: ${entry.relativePath}`);
    continue;
  }
  const buf = await file.async("nodebuffer");
  if (buf.byteLength !== entry.bytes) {
    fail(`${entry.relativePath}: 字节数不符（manifest=${entry.bytes}, 实际=${buf.byteLength}）`);
    continue;
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== entry.sha256) {
    fail(`${entry.relativePath}: SHA-256 不符（manifest=${entry.sha256.slice(0, 12)}…, 实际=${sha.slice(0, 12)}…）`);
    continue;
  }
  verified++;
}

console.log(
  `\n结论: ${errors.length === 0 ? "校验通过" : "校验失败"} —— 原件 ${verified}/${manifest.assets?.length ?? 0} 哈希一致` +
    (errors.length > 0 ? `，${errors.length} 个问题` : ""),
);
process.exit(errors.length === 0 ? 0 : 1);
