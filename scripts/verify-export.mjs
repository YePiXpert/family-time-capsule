#!/usr/bin/env node
// 校验 family-time-capsule 导出 ZIP（docs/RESTORE.md §1）：
//   npm run verify:export <zip路径>
// 检查 manifest 版本、每个原件的存在/字节数/SHA-256、必需 JSON 可解析、引用完整性。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = "family-time-capsule-export";
const SUPPORTED_EXPORT_VERSIONS = new Set([1]);

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

const [familyJson, people, memories, contributions, facts, factSources, transcripts, capsules] = await Promise.all([
  readJsonAsync("family.json"),
  readJsonAsync("people.json"),
  readJsonAsync("memories.json"),
  readJsonAsync("contributions.json"),
  readJsonAsync("facts.json"),
  readJsonAsync("fact-sources.json"),
  readJsonAsync("transcripts.json"),
  readJsonAsync("capsules.json"),
]);
if (familyJson) ok(`family: ${familyJson.name} (${familyJson.timezone})`);

const timelineMd = zip.file(`${ROOT}/timeline.md`);
if (timelineMd) ok("timeline.md 存在");
else fail("缺少 timeline.md");

// v0.1.5 起固定 12 个非媒体文件（含 inbox*2）；M4 起 stories 三件套（+3）
const hasInboxItems = Boolean(zip.file(`${ROOT}/inbox-items.json`));
const hasInboxItemAssets = Boolean(zip.file(`${ROOT}/inbox-item-assets.json`));
const hasStories = await zipEntryExists("stories.json");
const expectedNonAssetCount =
  (hasInboxItems && hasInboxItemAssets ? 12 : 10) + (hasStories ? 3 : 0);
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
const factIds = new Set((facts ?? []).map((f) => f.id));
if (people) ok(`people: ${people.length} 人`);
if (memories) {
  for (const m of memories) {
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
    if (!["asset", "contribution", "transcript", "user_text"].includes(s.sourceType))
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
