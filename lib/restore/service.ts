import "server-only";

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { Readable } from "node:stream";
import { count, eq } from "drizzle-orm";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { family as familyTable, person as personTable } from "@/db/schema/family";
import { inboxItem, inboxItemAsset } from "@/db/schema/inbox";
import {
  contribution as contributionTable,
  fact as factTable,
} from "@/db/schema/contribution";
import { assetTranscript as assetTranscriptTable } from "@/db/schema/transcript";
import {
  memoryEvent,
  memoryEventAsset,
  memoryEventParticipant,
} from "@/db/schema/memory";
import {
  capsule as capsuleTable,
  capsuleAsset,
  capsuleContribution,
  capsuleEvent,
} from "@/db/schema/capsule";
import { factSource, memoryEventTag } from "@/db/schema/suggestion";
import {
  story as storyTable,
  storyParagraph as storyParagraphTable,
  storySource as storySourceTable,
} from "@/db/schema/story";
import {
  futureQuestion as futureQuestionTable,
  capsuleReply as capsuleReplyTable,
} from "@/db/schema/capsule";
import { user as userTable } from "@/db/schema/auth";
import { getAssetStorage } from "@/lib/assets/storage";
import { AUDIT_KINDS, recordAudit } from "@/lib/audit/service";
import { isContributionVisibility } from "@/lib/authz/policy";
import {
  EXPORT_ROOT_DIR,
  EXPORT_VERSION,
  LEGACY_EXPORT_NON_ASSET_FILE_COUNT,
} from "@/lib/export/service";

/**
 * 归档恢复（RH-004，docs/RESTORE.md）。
 *
 * 恢复目标限制：**只能恢复到「无 Family」的实例**——
 * 家庭/人物/素材/事件等业务表必须为空；允许（且通常需要）已存在一个
 * 通过 /setup 创建的管理员（恢复的所有 created_by 指向该用户）。
 * 禁止高风险 merge restore：目标不为空 → 明确拒绝。
 *
 * 安全（RH-010）：
 * - ZIP 条目名 path traversal 校验（必须位于导出根目录内）；
 * - zip bomb 三重限制：条目数 / 单文件解压大小 / 总解压大小；
 * - exportVersion 白名单；manifest/JSON 结构校验；引用完整性校验；
 * - 全部原件 SHA-256 复核。
 *
 * 原子性：先写文件，后开 DB 事务；DB 失败 → 删除已写入文件。
 * 认证数据（user/session/account）永不从备份恢复。
 */

export type RestoreLimits = {
  maxEntries: number;
  maxSingleFileBytes: number;
  maxTotalUncompressedBytes: number;
};

export const RESTORE_LIMITS: RestoreLimits = {
  maxEntries: 200_000,
  maxSingleFileBytes: 2 * 1024 * 1024 * 1024, // 2GB（与上传上限同量级）
  maxTotalUncompressedBytes: 25 * 1024 * 1024 * 1024, // 25GB
};

const MAX_METADATA_FILE_BYTES = 64 * 1024 * 1024;

type RestoreArchiveEntry = {
  name: string;
  uncompressedSize: number;
};

type RestoreArchive = {
  entries: RestoreArchiveEntry[];
  has(name: string): boolean;
  openReadStream(name: string): Promise<Readable | null>;
  close(): void;
};

export class RestoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RestoreError";
    this.code = code;
  }
}

type ManifestAsset = {
  assetId: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  capturedAt: string | null;
  importedAt: string | null;
  // v0.1.1 增量字段（旧导出可能缺失）
  type?: string;
  originalFilename?: string;
  timeSource?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  metadataJson?: string | null;
};

type Manifest = {
  exportVersion: number;
  appVersion?: string;
  familyId: string;
  fileCount: number;
  assetCount: number;
  assets: ManifestAsset[];
};

type InboxItemArchiveRow = {
  id: string;
  familyId: string;
  kind: string;
  status: string;
  rawText: string | null;
  memoryEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

type InboxItemAssetArchiveRow = {
  id: string;
  inboxItemId: string;
  assetId: string;
  familyId: string;
  createdAt: string;
};

type FamilyArchiveRow = {
  id: string;
  name: string;
  timezone: string;
  childLaterUnlockAge?: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type PersonArchiveRow = {
  id: string;
  displayName: string;
  relationToChild?: string | null;
  isChild?: boolean;
  isGuardian?: boolean;
  birthDate?: string | null;
  childLaterUnlockedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ContributionArchiveRow = {
  id: string;
  memoryEventId: string;
  authorPersonId: string;
  /** Local User ids are never portable and must not be accepted from an archive. */
  recordedByUserId?: unknown;
  recordedByPersonId?: string | null;
  recordedByNameSnapshot?: string | null;
  recordingMode?: string;
  rawText?: string | null;
  transcript?: string | null;
  editedText?: string | null;
  audioAssetId?: string | null;
  visibility?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type TranscriptArchiveRow = {
  id: string;
  familyId: string;
  assetId: string;
  language?: string | null;
  provider: string;
  model: string;
  rawTranscript: string;
  editedTranscript?: string | null;
  segmentsJson?: string | null;
  status?: string;
  sourceSha256: string;
  createdByJobId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const UUID_LIKE = /^[0-9a-zA-Z_-]{6,64}$/;
const INBOX_KINDS = new Set(["text", "asset", "bundle"]);
const INBOX_STATUSES = new Set([
  "new",
  "processing",
  "needs_review",
  "confirmed",
  "discarded",
]);
const ASSET_TYPES = new Set(["image", "audio", "video", "document"]);
const TIME_SOURCES = new Set([
  "user_confirmed",
  "embedded_metadata",
  "file_metadata",
  "import_time",
]);
const RECORDING_MODES = new Set(["legacy", "self", "on_behalf"]);
const TRANSCRIPT_STATUSES = new Set<string>(["machine", "user_edited"]);

function requireCondition(cond: unknown, code: string, message: string): asserts cond {
  if (!cond) throw new RestoreError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


/** ZIP 条目名必须位于导出根目录之内（防 traversal / 绝对路径 / 盘符） */
function assertSafeEntryName(name: string, isDirectory = false) {
  const normalized = typeof name === "string" ? name.replaceAll("\\", "/") : "";
  const logicalName = isDirectory ? normalized.slice(0, -1) : normalized;
  const parts = logicalName.split("/");
  requireCondition(
    name === normalized &&
      !normalized.includes("\0") &&
      !normalized.startsWith("/") &&
      !/^[a-zA-Z]:/.test(normalized) &&
      normalized.endsWith("/") === isDirectory &&
      (logicalName === EXPORT_ROOT_DIR ||
        logicalName.startsWith(`${EXPORT_ROOT_DIR}/`)) &&
      parts.every((part) => part.length > 0 && part !== "." && part !== ".."),
    "unsafe_entry",
    `ZIP 条目名不安全: ${name}`,
  );
  requireCondition(
    parts[0] === EXPORT_ROOT_DIR && (isDirectory || parts.length >= 2),
    "unsafe_entry",
    `ZIP 条目名逃逸导出根目录: ${name}`,
  );
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isOptionalArchiveDate(value: unknown): boolean {
  return value === undefined || value === null || parseDate(value) !== null;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

/** 从导出相对路径推断 asset type（旧导出无 type 字段时的 fallback） */
function typeFromPath(rel: string): string {
  if (rel.includes("/images/")) return "image";
  if (rel.includes("/audio/")) return "audio";
  if (rel.includes("/video/")) return "video";
  return "document";
}

export type RestoreReport = {
  familyId: string;
  people: number;
  assets: number;
  events: number;
  contributions: number;
  facts: number;
  factSources: number;
  tags: number;
  transcripts: number;
  capsules: number;
  inboxItems: number;
  inboxItemAssets: number;
  filesWritten: number;
};

/** 目标环境是否允许恢复（业务数据必须为空） */
export async function assertRestoreTargetEmpty(): Promise<void> {
  const db = getDb();
  const familyCount = await db
    .select({ value: count() })
    .from(familyTable);
  requireCondition(
    Number(familyCount[0]?.value ?? 0) === 0,
    "target_not_empty",
    "目标实例已存在家庭数据；v0.1.1 只支持恢复到无 Family 的实例（禁止 merge restore）。",
  );
  // family 为空则 person/asset/... 因 FK 必然为空；仍做断言兜底
  const personCount = await db.select({ value: count() }).from(personTable);
  requireCondition(
    Number(personCount[0]?.value ?? 0) === 0,
    "target_not_empty",
    "目标实例存在 Person 数据，拒绝恢复。",
  );
}

function zipFailure(error: unknown): RestoreError {
  if (error instanceof RestoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid relative path|absolute path|invalid characters in fileName/iu.test(message)) {
    return new RestoreError("unsafe_entry", `ZIP 条目名不安全: ${message}`);
  }
  return new RestoreError("bad_zip", `ZIP 无法解析: ${message}`);
}

function openZipBuffer(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        autoClose: false,
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error) reject(error);
        else resolve(zipFile);
      },
    );
  });
}

function openZipPath(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        autoClose: false,
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error) reject(error);
        else resolve(zipFile);
      },
    );
  });
}

async function createRestoreArchive(
  zipFile: ZipFile,
  limits: RestoreLimits,
): Promise<RestoreArchive> {
  const entryMap = new Map<string, Entry>();
  const entryNames = new Set<string>();
  const entries: RestoreArchiveEntry[] = [];
  let entryCount = 0;
  let totalBytes = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      zipFile.on("error", fail);
      zipFile.on("entry", (entry: Entry) => {
        if (settled) return;
        try {
          const isDirectory = entry.fileName.endsWith("/");
          assertSafeEntryName(entry.fileName, isDirectory);
          requireCondition(
            !entryNames.has(entry.fileName),
            "bad_zip",
            `ZIP 存在重复条目: ${entry.fileName}`,
          );
          requireCondition(
            !entry.isEncrypted(),
            "bad_zip",
            `ZIP 条目不允许加密: ${entry.fileName}`,
          );
          requireCondition(
            entry.compressionMethod === 0 || entry.compressionMethod === 8,
            "bad_zip",
            `ZIP 条目压缩方法不支持: ${entry.fileName}`,
          );
          entryCount += 1;
          requireCondition(
            entryCount <= limits.maxEntries,
            "too_many_entries",
            `ZIP 条目数超限（> ${limits.maxEntries}）`,
          );
          requireCondition(
            entry.uncompressedSize <= limits.maxSingleFileBytes,
            "file_too_large",
            `条目解压后过大: ${entry.fileName}`,
          );
          totalBytes += entry.uncompressedSize;
          requireCondition(
            totalBytes <= limits.maxTotalUncompressedBytes,
            "zip_bomb",
            `ZIP 总解压大小超限（${(totalBytes / 1024 / 1024 / 1024).toFixed(2)}GB）`,
          );
          entryNames.add(entry.fileName);
          if (!isDirectory) {
            entryMap.set(entry.fileName, entry);
            entries.push({
              name: entry.fileName,
              uncompressedSize: entry.uncompressedSize,
            });
          }
          zipFile.readEntry();
        } catch (error) {
          fail(error);
        }
      });
      zipFile.on("end", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zipFile.readEntry();
    });
  } catch (error) {
    zipFile.close();
    throw zipFailure(error);
  }

  return {
    entries,
    has: (name) => entryMap.has(name),
    openReadStream: (name) => {
      const entry = entryMap.get(name);
      if (!entry) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (error, stream) => {
          if (error) reject(zipFailure(error));
          else resolve(stream);
        });
      });
    },
    close: () => {
      if (zipFile.isOpen) zipFile.close();
    },
  };
}

async function readArchiveText(
  archive: RestoreArchive,
  name: string,
  missingCode: "missing_manifest" | "missing_json",
): Promise<string> {
  const entry = archive.entries.find((candidate) => candidate.name === name);
  requireCondition(entry, missingCode, `缺少 ${name.split("/").at(-1) ?? name}`);
  requireCondition(
    entry.uncompressedSize <= MAX_METADATA_FILE_BYTES,
    "file_too_large",
    `metadata 条目过大: ${name}`,
  );
  const stream = await archive.openReadStream(name);
  requireCondition(stream, missingCode, `缺少 ${name}`);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    requireCondition(
      bytes <= MAX_METADATA_FILE_BYTES,
      "file_too_large",
      `metadata 条目过大: ${name}`,
    );
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

/** 读取并校验 ZIP（结构 + 限制 + 哈希 + 引用完整性），返回解析后的数据集 */
async function loadAndVerifyZip(
  archive: RestoreArchive,
  archiveBytes: number,
  limits: RestoreLimits,
) {
  requireCondition(
    archiveBytes > 0 && archiveBytes < limits.maxTotalUncompressedBytes,
    "zip_too_large",
    "ZIP 压缩包本身超出大小限制。",
  );

  // 条目枚举 + traversal + zip bomb 限制
  const entries = archive.entries;
  requireCondition(
    entries.length <= limits.maxEntries,
    "too_many_entries",
    `ZIP 条目数超限（${entries.length} > ${limits.maxEntries}）`,
  );
  let totalBytes = 0;
  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    requireCondition(
      entry.uncompressedSize <= limits.maxSingleFileBytes,
      "file_too_large",
      `条目解压后过大: ${entry.name}`,
    );
    totalBytes += entry.uncompressedSize;
  }
  requireCondition(
    totalBytes <= limits.maxTotalUncompressedBytes,
    "zip_bomb",
    `ZIP 总解压大小超限（${(totalBytes / 1024 / 1024 / 1024).toFixed(2)}GB）`,
  );

  // manifest
  const manifestPath = `${EXPORT_ROOT_DIR}/manifest.json`;
  requireCondition(archive.has(manifestPath), "missing_manifest", "缺少 manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      await readArchiveText(archive, manifestPath, "missing_manifest"),
    );
  } catch (error) {
    if (error instanceof RestoreError) throw error;
    throw new RestoreError("bad_manifest", "manifest.json 无法解析");
  }
  requireCondition(
    manifest.exportVersion === EXPORT_VERSION,
    "unsupported_version",
    `不支持的 exportVersion: ${String(manifest.exportVersion)}（当前支持 ${EXPORT_VERSION}）`,
  );
  requireCondition(
    typeof manifest.familyId === "string" && manifest.familyId.length > 0,
    "bad_manifest",
    "manifest.familyId 缺失",
  );
  requireCondition(Array.isArray(manifest.assets), "bad_manifest", "manifest.assets 必须是数组");
  requireCondition(
    Number.isSafeInteger(manifest.assetCount) && manifest.assetCount >= 0,
    "bad_manifest",
    "manifest.assetCount 非法",
  );
  requireCondition(
    manifest.assetCount === manifest.assets.length,
    "bad_manifest",
    "manifest.assetCount 与 assets 数量不一致",
  );
  requireCondition(
    Number.isSafeInteger(manifest.fileCount) && manifest.fileCount >= 0,
    "bad_manifest",
    "manifest.fileCount 非法",
  );

  // JSON 实体文件
  async function readJson<T>(name: string): Promise<T> {
    const entryPath = `${EXPORT_ROOT_DIR}/${name}`;
    requireCondition(archive.has(entryPath), "missing_json", `缺少 ${name}`);
    try {
      return JSON.parse(
        await readArchiveText(archive, entryPath, "missing_json"),
      ) as T;
    } catch (error) {
      if (error instanceof RestoreError) throw error;
      throw new RestoreError("bad_json", `${name} 无法解析`);
    }
  }

  const familyJson = await readJson<FamilyArchiveRow>("family.json");
  const peopleJson = await readJson<PersonArchiveRow[]>("people.json");
  const memoriesJson = await readJson<
    Array<{
      id: string;
      childPersonId: string;
      title: string;
      occurredAt: string | null;
      occurredAtPrecision?: string;
      locationText?: string | null;
      coverAssetId?: string | null;
      status?: string;
      ageDays?: number | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      assetIds?: string[];
      participantPersonIds?: string[];
      tags?: string[];
    }>
  >("memories.json");
  const contributionsJson = await readJson<ContributionArchiveRow[]>(
    "contributions.json",
  );
  const factsJson = await readJson<
    Array<{
      id: string;
      memoryEventId: string;
      statement: string;
      status?: string;
      createdAt?: string | null;
    }>
  >("facts.json");
  const capsulesJson = await readJson<
    Array<{
      id: string;
      title: string;
      unlockType: string;
      unlockValue: string;
      status?: string;
      sealedAt?: string | null;
      openedAt?: string | null;
      createdAt?: string | null;
      memoryEventIds?: string[];
      assetIds?: string[];
      contributionIds?: string[];
    }>
  >("capsules.json");

  // v0.1.3 后的 additive 文件：旧 exportVersion=1 归档两者都不存在时按空收件箱恢复。
  // 只缺一个代表图关系不完整，拒绝静默丢行。
  const inboxItemsFile = archive.has(`${EXPORT_ROOT_DIR}/inbox-items.json`);
  const inboxItemAssetsFile = archive.has(
    `${EXPORT_ROOT_DIR}/inbox-item-assets.json`,
  );
  requireCondition(
    Boolean(inboxItemsFile) === Boolean(inboxItemAssetsFile),
    "missing_json",
    "inbox-items.json 与 inbox-item-assets.json 必须同时存在或同时缺失",
  );
  const inboxItemsRaw = inboxItemsFile
    ? await readJson<unknown>("inbox-items.json")
    : [];
  const inboxItemAssetsRaw = inboxItemAssetsFile
    ? await readJson<unknown>("inbox-item-assets.json")
    : [];
  requireCondition(
    Array.isArray(inboxItemsRaw),
    "bad_json",
    "inbox-items.json 必须是数组",
  );
  requireCondition(
    Array.isArray(inboxItemAssetsRaw),
    "bad_json",
    "inbox-item-assets.json 必须是数组",
  );

  // v0.1.4 后的 additive 文件：旧 exportVersion=1 归档不存在 transcripts.json 时按空转录恢复。
  const transcriptsFile = archive.has(`${EXPORT_ROOT_DIR}/transcripts.json`);
  const transcriptsRaw = transcriptsFile
    ? await readJson<unknown>("transcripts.json")
    : [];
  requireCondition(
    Array.isArray(transcriptsRaw),
    "bad_json",
    "transcripts.json 必须是数组",
  );

  // v0.1.5 后的 additive 文件：旧 exportVersion=1 归档不存在 fact-sources.json 时按空来源恢复。
  const factSourcesFile = archive.has(`${EXPORT_ROOT_DIR}/fact-sources.json`);
  const factSourcesRaw = factSourcesFile
    ? await readJson<unknown>("fact-sources.json")
    : [];
  requireCondition(
    Array.isArray(factSourcesRaw),
    "bad_json",
    "fact-sources.json 必须是数组",
  );

  // M4 后的 additive 文件：stories 三件套。旧归档缺失时按空故事恢复。
  const storiesFile = archive.has(`${EXPORT_ROOT_DIR}/stories.json`);
  const storiesRaw = storiesFile ? await readJson<unknown>("stories.json") : [];
  requireCondition(Array.isArray(storiesRaw), "bad_json", "stories.json 必须是数组");
  const storyParagraphsFile = archive.has(
    `${EXPORT_ROOT_DIR}/story-paragraphs.json`,
  );
  const storyParagraphsRaw = storyParagraphsFile
    ? await readJson<unknown>("story-paragraphs.json")
    : [];
  requireCondition(
    Array.isArray(storyParagraphsRaw),
    "bad_json",
    "story-paragraphs.json 必须是数组",
  );
  const storySourcesFile = archive.has(`${EXPORT_ROOT_DIR}/story-sources.json`);
  const storySourcesRaw = storySourcesFile
    ? await readJson<unknown>("story-sources.json")
    : [];
  requireCondition(
    Array.isArray(storySourcesRaw),
    "bad_json",
    "story-sources.json 必须是数组",
  );
  requireCondition(
    Boolean(storiesFile) === Boolean(storyParagraphsFile) &&
      Boolean(storiesFile) === Boolean(storySourcesFile),
    "bad_json",
    "stories 三件套文件必须同时存在或同时缺失",
  );

  // M5 后的 additive 文件：胶囊对话两件套。旧归档缺失时按空恢复。
  const capsuleQuestionsFile = archive.has(
    `${EXPORT_ROOT_DIR}/capsule-questions.json`,
  );
  const capsuleQuestionsRaw = capsuleQuestionsFile
    ? await readJson<unknown>("capsule-questions.json")
    : [];
  requireCondition(
    Array.isArray(capsuleQuestionsRaw),
    "bad_json",
    "capsule-questions.json 必须是数组",
  );
  const capsuleRepliesFile = archive.has(
    `${EXPORT_ROOT_DIR}/capsule-replies.json`,
  );
  const capsuleRepliesRaw = capsuleRepliesFile
    ? await readJson<unknown>("capsule-replies.json")
    : [];
  requireCondition(
    Array.isArray(capsuleRepliesRaw),
    "bad_json",
    "capsule-replies.json 必须是数组",
  );
  requireCondition(
    Boolean(capsuleQuestionsFile) === Boolean(capsuleRepliesFile),
    "bad_json",
    "capsule 对话两件套必须同时存在或同时缺失",
  );

  const hasInboxFiles = Boolean(inboxItemsFile) && Boolean(inboxItemAssetsFile);
  const hasStoryFiles = Boolean(storiesFile);
  const hasDialogueFiles = Boolean(capsuleQuestionsFile);
  const expectedFileCount =
    manifest.assets.length +
    LEGACY_EXPORT_NON_ASSET_FILE_COUNT +
    (hasInboxFiles ? 2 : 0) +
    (transcriptsFile ? 1 : 0) +
    (factSourcesFile ? 1 : 0) +
    (hasStoryFiles ? 3 : 0) +
    (hasDialogueFiles ? 2 : 0);
  requireCondition(
    manifest.fileCount === expectedFileCount,
    hasInboxFiles || factSourcesFile || hasStoryFiles || hasDialogueFiles
      ? "bad_manifest"
      : "missing_json",
    hasInboxFiles
      ? "manifest.fileCount 与当前 v1 文件集不一致"
      : "归档声明包含 Inbox 文件，但两份 Inbox JSON 均缺失",
  );

  // 结构与引用完整性
  requireCondition(isRecord(familyJson), "bad_json", "family.json 必须是对象");
  requireCondition(
    familyJson.id === manifest.familyId,
    "bad_manifest",
    "family.json.id 与 manifest.familyId 不一致",
  );
  requireCondition(
    typeof familyJson.name === "string" &&
      familyJson.name.trim().length >= 1 &&
      familyJson.name.trim().length <= 50,
    "bad_json",
    "family.json.name 非法",
  );
  requireCondition(
    typeof familyJson.timezone === "string" &&
      isValidTimezone(familyJson.timezone),
    "bad_json",
    "family.json.timezone 非法",
  );
  requireCondition(
    familyJson.childLaterUnlockAge === undefined ||
      (Number.isInteger(familyJson.childLaterUnlockAge) &&
        familyJson.childLaterUnlockAge >= 1 &&
        familyJson.childLaterUnlockAge <= 100),
    "bad_policy",
    "family.childLaterUnlockAge 必须是 1 到 100 的整数",
  );
  requireCondition(
    isOptionalArchiveDate(familyJson.createdAt) &&
      isOptionalArchiveDate(familyJson.updatedAt),
    "bad_json",
    "family 时间字段非法",
  );

  const assetIds = new Set<string>();
  const assetTypeById = new Map<string, string>();
  const assetPaths = new Set<string>();
  for (const entry of manifest.assets) {
    requireCondition(isRecord(entry), "bad_manifest", "manifest asset 必须是对象");
    requireCondition(
      typeof entry.assetId === "string" &&
        UUID_LIKE.test(entry.assetId) &&
        !assetIds.has(entry.assetId),
      "bad_manifest",
      `assetId 非法或重复: ${String(entry.assetId)}`,
    );
    requireCondition(
      typeof entry.relativePath === "string" &&
        /^originals\/(images|audio|video|documents)\/[^/\\]+$/.test(
          entry.relativePath,
        ) &&
        !entry.relativePath.includes("..") &&
        !assetPaths.has(entry.relativePath),
      "bad_manifest",
      `素材 ${entry.assetId} 的 relativePath 非法或重复`,
    );
    const inferredType = typeFromPath(entry.relativePath);
    const resolvedType = entry.type ?? inferredType;
    requireCondition(
      typeof resolvedType === "string" &&
        ASSET_TYPES.has(resolvedType) &&
        resolvedType === inferredType,
      "bad_manifest",
      `素材 ${entry.assetId} 的 type 与路径不一致`,
    );
    requireCondition(
      typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.sha256),
      "bad_manifest",
      `素材 ${entry.assetId} 的 SHA-256 非法`,
    );
    requireCondition(
      Number.isSafeInteger(entry.bytes) &&
        entry.bytes >= 0 &&
        entry.bytes <= limits.maxSingleFileBytes,
      "bad_manifest",
      `素材 ${entry.assetId} 的 bytes 非法`,
    );
    requireCondition(
      typeof entry.mimeType === "string" && entry.mimeType.length > 0,
      "bad_manifest",
      `素材 ${entry.assetId} 的 mimeType 非法`,
    );
    requireCondition(
      (entry.capturedAt === null || parseDate(entry.capturedAt) !== null) &&
        parseDate(entry.importedAt) !== null,
      "bad_manifest",
      `素材 ${entry.assetId} 的时间字段非法`,
    );
    requireCondition(
      entry.originalFilename === undefined ||
        (typeof entry.originalFilename === "string" &&
          entry.originalFilename.length >= 1 &&
          entry.originalFilename.length <= 255),
      "bad_manifest",
      `素材 ${entry.assetId} 的 originalFilename 非法`,
    );
    requireCondition(
      entry.timeSource === undefined ||
        (typeof entry.timeSource === "string" &&
          TIME_SOURCES.has(entry.timeSource)),
      "bad_manifest",
      `素材 ${entry.assetId} 的 timeSource 非法`,
    );
    for (const [field, value] of [
      ["width", entry.width],
      ["height", entry.height],
      ["durationMs", entry.durationMs],
    ] as const) {
      requireCondition(
        value === undefined ||
          value === null ||
          (Number.isSafeInteger(value) && value >= 0),
        "bad_manifest",
        `素材 ${entry.assetId} 的 ${field} 非法`,
      );
    }
    requireCondition(
      entry.metadataJson === undefined ||
        entry.metadataJson === null ||
        typeof entry.metadataJson === "string",
      "bad_manifest",
      `素材 ${entry.assetId} 的 metadataJson 非法`,
    );
    assetIds.add(entry.assetId);
    assetPaths.add(entry.relativePath);
    assetTypeById.set(entry.assetId, resolvedType);
  }
  requireCondition(
    assetIds.size === manifest.assets.length,
    "bad_manifest",
    "manifest.assets 存在重复 assetId",
  );

  requireCondition(Array.isArray(peopleJson), "bad_json", "people.json 必须是数组");
  const personIds = new Set<string>();
  const childPersonIds = new Set<string>();
  for (const p of peopleJson) {
    requireCondition(isRecord(p), "bad_json", "person 必须是对象");
    requireCondition(
      typeof p.id === "string" && UUID_LIKE.test(p.id) && !personIds.has(p.id),
      "bad_json",
      `person id 非法或重复: ${String(p.id)}`,
    );
    requireCondition(
      typeof p.displayName === "string" &&
        p.displayName.trim().length >= 1 &&
        p.displayName.trim().length <= 50,
      "bad_json",
      `person ${p.id} 的 displayName 非法`,
    );
    requireCondition(
      p.relationToChild === undefined ||
        p.relationToChild === null ||
        (typeof p.relationToChild === "string" &&
          p.relationToChild.length <= 20),
      "bad_json",
      `person ${p.id} 的 relationToChild 非法`,
    );
    requireCondition(
      (p.isChild === undefined || typeof p.isChild === "boolean") &&
        (p.isGuardian === undefined || typeof p.isGuardian === "boolean"),
      "bad_policy",
      `person ${p.id} 的 guardian/child 标记非法`,
    );
    const isChild = p.isChild ?? false;
    const isGuardian = p.isGuardian ?? false;
    requireCondition(
      !(isChild && isGuardian),
      "bad_policy",
      `person ${p.id} 不能同时是 child 与 guardian`,
    );
    requireCondition(
      p.birthDate === undefined ||
        p.birthDate === null ||
        (typeof p.birthDate === "string" && isValidDateOnly(p.birthDate)),
      "bad_policy",
      `person ${p.id} 的 birthDate 非法`,
    );
    requireCondition(
      p.childLaterUnlockedAt === undefined ||
        p.childLaterUnlockedAt === null ||
        (isChild &&
          parseDate(p.childLaterUnlockedAt) !== null &&
          parseDate(p.childLaterUnlockedAt)!.getTime() >= 0),
      "bad_policy",
      `person ${p.id} 的 childLaterUnlockedAt 非法`,
    );
    requireCondition(
      isOptionalArchiveDate(p.createdAt) && isOptionalArchiveDate(p.updatedAt),
      "bad_json",
      `person ${p.id} 的时间字段非法`,
    );
    personIds.add(p.id);
    if (isChild) childPersonIds.add(p.id);
  }
  requireCondition(
    Array.isArray(memoriesJson),
    "bad_json",
    "memories.json 必须是数组",
  );
  const eventIds = new Set<string>();
  for (const m of memoriesJson) {
    requireCondition(isRecord(m), "bad_json", "memory event 必须是对象");
    requireCondition(
      typeof m.id === "string" && UUID_LIKE.test(m.id) && !eventIds.has(m.id),
      "bad_json",
      `memory event id 非法或重复: ${String(m.id)}`,
    );
    eventIds.add(m.id);
    requireCondition(
      typeof m.title === "string" && m.title.length > 0,
      "bad_json",
      `memories: 事件 ${m.id} 缺少标题`,
    );
    requireCondition(
      childPersonIds.has(m.childPersonId),
      "bad_refs",
      `memories: 事件 ${m.id} 引用未知或非 child Person ${m.childPersonId}`,
    );
    requireCondition(
      parseDate(m.occurredAt) !== null &&
        isOptionalArchiveDate(m.createdAt) &&
        isOptionalArchiveDate(m.updatedAt),
      "bad_json",
      `memories: 事件 ${m.id} 的时间字段非法`,
    );
    requireCondition(
      m.participantPersonIds === undefined ||
        (Array.isArray(m.participantPersonIds) &&
          m.participantPersonIds.every((id) => typeof id === "string")),
      "bad_json",
      `事件 ${m.id} 的 participantPersonIds 非法`,
    );
    requireCondition(
      m.assetIds === undefined ||
        (Array.isArray(m.assetIds) &&
          m.assetIds.every((id) => typeof id === "string")),
      "bad_json",
      `事件 ${m.id} 的 assetIds 非法`,
    );
    requireCondition(
      m.coverAssetId === undefined ||
        m.coverAssetId === null ||
        (typeof m.coverAssetId === "string" && assetIds.has(m.coverAssetId)),
      "bad_refs",
      `事件 ${m.id} 引用未知封面素材`,
    );
    requireCondition(
      m.tags === undefined ||
        (Array.isArray(m.tags) &&
          m.tags.every((t) => typeof t === "string" && t.length > 0 && t.length <= 50)),
      "bad_json",
      `事件 ${m.id} 的 tags 非法`,
    );
    for (const pid of m.participantPersonIds ?? []) {
      requireCondition(personIds.has(pid), "bad_refs", `事件 ${m.id} 引用未知参与人 ${pid}`);
    }
    for (const aid of m.assetIds ?? []) {
      requireCondition(assetIds.has(aid), "bad_refs", `事件 ${m.id} 引用未知素材 ${aid}`);
    }
  }
  const inboxItemIds = new Set<string>();
  const inboxItemsJson: InboxItemArchiveRow[] = [];
  for (const value of inboxItemsRaw) {
    requireCondition(isRecord(value), "bad_json", "inbox item 必须是对象");
    const item = value;
    requireCondition(
      typeof item.id === "string" &&
        UUID_LIKE.test(item.id) &&
        !inboxItemIds.has(item.id),
      "bad_json",
      `inbox item id 缺失或重复: ${String(item.id)}`,
    );
    inboxItemIds.add(item.id);
    requireCondition(
      item.familyId === manifest.familyId,
      "bad_refs",
      `inbox item ${item.id} 的 familyId 不一致`,
    );
    requireCondition(
      typeof item.kind === "string" && INBOX_KINDS.has(item.kind),
      "bad_json",
      `inbox item ${item.id} 的 kind 非法`,
    );
    requireCondition(
      typeof item.status === "string" && INBOX_STATUSES.has(item.status),
      "bad_json",
      `inbox item ${item.id} 的 status 非法`,
    );
    requireCondition(
      item.rawText === null || typeof item.rawText === "string",
      "bad_json",
      `inbox item ${item.id} 的 rawText 非法`,
    );
    requireCondition(
      item.memoryEventId === null || typeof item.memoryEventId === "string",
      "bad_json",
      `inbox item ${item.id} 的 memoryEventId 非法`,
    );
    if (item.memoryEventId !== null) {
      requireCondition(
        eventIds.has(item.memoryEventId),
        "bad_refs",
        `inbox item ${item.id} 引用未知事件 ${item.memoryEventId}`,
      );
    }
    requireCondition(
      typeof item.createdAt === "string" &&
        typeof item.updatedAt === "string" &&
        parseDate(item.createdAt) !== null &&
        parseDate(item.updatedAt) !== null,
      "bad_json",
      `inbox item ${item.id} 的时间非法`,
    );
    inboxItemsJson.push({
      id: item.id,
      familyId: item.familyId,
      kind: item.kind,
      status: item.status,
      rawText: item.rawText,
      memoryEventId: item.memoryEventId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
  const inboxItemAssetIds = new Set<string>();
  const inboxItemAssetsJson: InboxItemAssetArchiveRow[] = [];
  for (const value of inboxItemAssetsRaw) {
    requireCondition(isRecord(value), "bad_json", "inbox item asset 必须是对象");
    const link = value;
    requireCondition(
      typeof link.id === "string" &&
        UUID_LIKE.test(link.id) &&
        !inboxItemAssetIds.has(link.id),
      "bad_json",
      `inbox item asset id 缺失或重复: ${String(link.id)}`,
    );
    inboxItemAssetIds.add(link.id);
    requireCondition(
      link.familyId === manifest.familyId,
      "bad_refs",
      `inbox item asset ${link.id} 的 familyId 不一致`,
    );
    requireCondition(
      typeof link.inboxItemId === "string" &&
        inboxItemIds.has(link.inboxItemId),
      "bad_refs",
      `inbox item asset ${link.id} 引用未知 inbox item ${link.inboxItemId}`,
    );
    requireCondition(
      typeof link.assetId === "string" && assetIds.has(link.assetId),
      "bad_refs",
      `inbox item asset ${link.id} 引用未知素材 ${link.assetId}`,
    );
    requireCondition(
      typeof link.createdAt === "string" && parseDate(link.createdAt) !== null,
      "bad_json",
      `inbox item asset ${link.id} 的 createdAt 非法`,
    );
    inboxItemAssetsJson.push({
      id: link.id,
      inboxItemId: link.inboxItemId,
      assetId: link.assetId,
      familyId: link.familyId,
      createdAt: link.createdAt,
    });
  }
  requireCondition(
    Array.isArray(contributionsJson),
    "bad_json",
    "contributions.json 必须是数组",
  );
  const contributionIds = new Set<string>();
  for (const c of contributionsJson) {
    requireCondition(isRecord(c), "bad_json", "contribution 必须是对象");
    requireCondition(
      typeof c.id === "string" &&
        UUID_LIKE.test(c.id) &&
        !contributionIds.has(c.id),
      "bad_json",
      `contribution id 非法或重复: ${String(c.id)}`,
    );
    contributionIds.add(c.id);
    requireCondition(
      eventIds.has(c.memoryEventId),
      "bad_refs",
      `contribution ${c.id} 引用未知事件`,
    );
    requireCondition(
      personIds.has(c.authorPersonId),
      "bad_refs",
      `contribution ${c.id} 引用未知作者`,
    );
    requireCondition(
      isContributionVisibility(c.visibility ?? "family"),
      "bad_visibility",
      `contribution ${c.id} 的 visibility 非法`,
    );
    requireCondition(
      isNullableString(c.rawText) &&
        isNullableString(c.transcript) &&
        isNullableString(c.editedText),
      "bad_json",
      `contribution ${c.id} 的文字字段非法`,
    );
    requireCondition(
      isOptionalArchiveDate(c.createdAt) && isOptionalArchiveDate(c.updatedAt),
      "bad_json",
      `contribution ${c.id} 的时间字段非法`,
    );
    requireCondition(
      c.audioAssetId === undefined ||
        c.audioAssetId === null ||
        (typeof c.audioAssetId === "string" &&
          assetIds.has(c.audioAssetId) &&
          assetTypeById.get(c.audioAssetId) === "audio"),
      "bad_audio_ref",
      `contribution ${c.id} 的 audioAssetId 非法或不是原始音频`,
    );

    // Authentication data is instance-local. Portable provenance is expressed
    // only by Person + immutable name snapshot + recording mode.
    requireCondition(
      c.recordedByUserId === undefined || c.recordedByUserId === null,
      "bad_provenance",
      `contribution ${c.id} 不得携带本地 recordedByUserId`,
    );
    requireCondition(
      c.recordedByPersonId === undefined ||
        c.recordedByPersonId === null ||
        (typeof c.recordedByPersonId === "string" &&
          personIds.has(c.recordedByPersonId)),
      "bad_provenance",
      `contribution ${c.id} 引用未知 recorder Person`,
    );
    requireCondition(
      isNullableString(c.recordedByNameSnapshot),
      "bad_provenance",
      `contribution ${c.id} 的 recorder name snapshot 非法`,
    );
    const recordingMode = c.recordingMode ?? "legacy";
    const recorderPersonId = c.recordedByPersonId ?? null;
    const recorderName = c.recordedByNameSnapshot ?? null;
    const hasValidRecorderName =
      typeof recorderName === "string" &&
      recorderName.trim().length >= 1 &&
      recorderName.trim().length <= 50;
    requireCondition(
      RECORDING_MODES.has(recordingMode) &&
        ((recordingMode === "legacy" &&
          recorderPersonId === null &&
          recorderName === null) ||
          (recordingMode === "self" &&
            recorderPersonId === c.authorPersonId &&
            hasValidRecorderName) ||
          (recordingMode === "on_behalf" &&
            recorderPersonId !== c.authorPersonId &&
            hasValidRecorderName)),
      "bad_provenance",
      `contribution ${c.id} 的 recorder provenance 组合非法`,
    );
  }
  requireCondition(Array.isArray(factsJson), "bad_json", "facts.json 必须是数组");
  const factIds = new Set<string>(factsJson.map((f) => f.id));
  for (const f of factsJson) {
    requireCondition(eventIds.has(f.memoryEventId), "bad_refs", `fact ${f.id} 引用未知事件`);
    requireCondition(
      typeof f.statement === "string" && f.statement.length > 0,
      "bad_json",
      `fact ${f.id} 缺少陈述`,
    );
  }
  const SOURCE_TYPES = new Set([
    "asset",
    "asset_analysis",
    "contribution",
    "transcript",
    "user_text",
  ]);
  const factSourcesJson: Array<{
    id: string;
    factId: string;
    sourceType: string;
    sourceId: string | null;
    quote: string | null;
    startMs: number | null;
    endMs: number | null;
    createdAt?: string | null;
  }> = [];
  for (const value of factSourcesRaw) {
    requireCondition(isRecord(value), "bad_json", "fact source 必须是对象");
    const s = value as Record<string, unknown>;
    const id = s.id as string;
    const factId = s.factId as string;
    const sourceType = s.sourceType as string;
    requireCondition(
      typeof id === "string" && UUID_LIKE.test(id),
      "bad_json",
      `fact source id 非法: ${String(id)}`,
    );
    requireCondition(
      factIds.has(factId),
      "bad_refs",
      `fact source ${id} 引用未知 fact ${String(factId)}`,
    );
    requireCondition(
      typeof sourceType === "string" && SOURCE_TYPES.has(sourceType),
      "bad_json",
      `fact source ${id} 的 sourceType 非法`,
    );
    requireCondition(
      s.sourceId === undefined || s.sourceId === null || typeof s.sourceId === "string",
      "bad_json",
      `fact source ${id} 的 sourceId 非法`,
    );
    // M3-D locator：quote 可选字符串（≤300）；时间毫秒可选、0 ≤ start ≤ end
    requireCondition(
      s.quote === undefined ||
        s.quote === null ||
        (typeof s.quote === "string" && s.quote.length <= 300),
      "bad_json",
      `fact source ${id} 的 quote 非法`,
    );
    for (const field of ["startMs", "endMs"] as const) {
      const raw = s[field];
      requireCondition(
        raw === undefined ||
          raw === null ||
          (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 86_400_000),
        "bad_json",
        `fact source ${id} 的 ${field} 非法`,
      );
    }
    const startMs = (s.startMs ?? null) as number | null;
    const endMs = (s.endMs ?? null) as number | null;
    requireCondition(
      startMs === null || endMs === null || startMs <= endMs,
      "bad_json",
      `fact source ${id} 的时间区间非法`,
    );
    requireCondition(
      isOptionalArchiveDate(s.createdAt),
      "bad_json",
      `fact source ${id} 的时间非法`,
    );
    factSourcesJson.push({
      id,
      factId,
      sourceType,
      sourceId: (s.sourceId ?? null) as string | null,
      quote: ((s.quote as string | null | undefined) ?? null) || null,
      startMs,
      endMs,
      createdAt: s.createdAt as string | null | undefined,
    });
  }
  const transcriptIds = new Set<string>();
  const transcriptsJson: TranscriptArchiveRow[] = [];
  for (const value of transcriptsRaw) {
    requireCondition(isRecord(value), "bad_json", "transcript 必须是对象");
    const t = value;
    requireCondition(
      typeof t.id === "string" &&
        UUID_LIKE.test(t.id) &&
        !transcriptIds.has(t.id),
      "bad_json",
      `transcript id 缺失或重复: ${String(t.id)}`,
    );
    transcriptIds.add(t.id);
    requireCondition(
      typeof t.familyId === "string" && t.familyId === manifest.familyId,
      "bad_refs",
      `transcript ${t.id} 的 familyId 不一致`,
    );
    requireCondition(
      typeof t.assetId === "string" && assetIds.has(t.assetId),
      "bad_refs",
      `transcript ${t.id} 引用未知素材 ${String(t.assetId)}`,
    );
    requireCondition(
      typeof t.provider === "string" && t.provider.length > 0,
      "bad_json",
      `transcript ${t.id} 的 provider 非法`,
    );
    requireCondition(
      typeof t.model === "string" && t.model.length > 0,
      "bad_json",
      `transcript ${t.id} 的 model 非法`,
    );
    requireCondition(
      t.language === undefined || t.language === null || typeof t.language === "string",
      "bad_json",
      `transcript ${t.id} 的 language 非法`,
    );
    requireCondition(
      typeof t.rawTranscript === "string",
      "bad_json",
      `transcript ${t.id} 的 rawTranscript 非法`,
    );
    requireCondition(
      isNullableString(t.editedTranscript) &&
        isNullableString(t.segmentsJson) &&
        isNullableString(t.createdByJobId),
      "bad_json",
      `transcript ${t.id} 的可空字段非法`,
    );
    requireCondition(
      t.status === undefined ||
        (typeof t.status === "string" && TRANSCRIPT_STATUSES.has(t.status)),
      "bad_json",
      `transcript ${t.id} 的 status 非法`,
    );
    requireCondition(
      typeof t.sourceSha256 === "string" && /^[0-9a-f]{64}$/.test(t.sourceSha256),
      "bad_json",
      `transcript ${t.id} 的 sourceSha256 非法`,
    );
    requireCondition(
      isOptionalArchiveDate(t.createdAt) && isOptionalArchiveDate(t.updatedAt),
      "bad_json",
      `transcript ${t.id} 的时间字段非法`,
    );
    transcriptsJson.push({
      id: t.id as string,
      familyId: t.familyId as string,
      assetId: t.assetId as string,
      language:
        t.language === undefined || t.language === null
          ? null
          : (t.language as string),
      provider: t.provider as string,
      model: t.model as string,
      rawTranscript: t.rawTranscript as string,
      editedTranscript: (t.editedTranscript ?? null) as string | null,
      segmentsJson: (t.segmentsJson ?? null) as string | null,
      status: (t.status ?? "machine") as string,
      sourceSha256: t.sourceSha256 as string,
      createdByJobId: (t.createdByJobId ?? null) as string | null,
      createdAt: t.createdAt as string | null | undefined,
      updatedAt: t.updatedAt as string | null | undefined,
    });
  }

  // ---- M4 故事三件套校验 ----
  const STORY_KINDS_RESTORE = new Set(["weekly", "monthly", "yearly"]);
  const STORY_STATUSES = new Set(["draft", "edited", "published"]);
  const STORY_SOURCE_TYPES = new Set([
    "fact",
    "contribution",
    "transcript",
    "user_text",
  ]);
  const storyIds = new Set<string>();
  const storiesJson: Array<{
    id: string;
    kind: string;
    periodStart: string;
    periodEnd: string;
    title: string;
    status: string;
    editedAt: string | null;
    publishedAt: string | null;
    publishedByUserId: string | null;
    createdAt: string | null | undefined;
    updatedAt: string | null | undefined;
  }> = [];
  for (const value of storiesRaw) {
    requireCondition(isRecord(value), "bad_json", "story 必须是对象");
    const st = value as Record<string, unknown>;
    requireCondition(
      typeof st.id === "string" && UUID_LIKE.test(st.id) && !storyIds.has(st.id),
      "bad_json",
      `story id 缺失或重复: ${String(st.id)}`,
    );
    storyIds.add(st.id);
    requireCondition(
      typeof st.kind === "string" && STORY_KINDS_RESTORE.has(st.kind),
      "bad_json",
      `story ${st.id} 的 kind 非法`,
    );
    requireCondition(
      typeof st.title === "string" && st.title.trim().length >= 1 && st.title.length <= 100,
      "bad_json",
      `story ${st.id} 的 title 非法`,
    );
    requireCondition(
      typeof st.status === "string" && STORY_STATUSES.has(st.status),
      "bad_json",
      `story ${st.id} 的 status 非法`,
    );
    requireCondition(
      typeof st.periodStart === "string" && typeof st.periodEnd === "string",
      "bad_json",
      `story ${st.id} 的时间窗口非法`,
    );
    requireCondition(
      isNullableString(st.editedAt) &&
        isNullableString(st.publishedAt) &&
        isNullableString(st.publishedByUserId),
      "bad_json",
      `story ${st.id} 的可空字段非法`,
    );
    requireCondition(
      isOptionalArchiveDate(st.createdAt) && isOptionalArchiveDate(st.updatedAt),
      "bad_json",
      `story ${st.id} 的时间字段非法`,
    );
    storiesJson.push({
      id: st.id as string,
      kind: st.kind as string,
      periodStart: st.periodStart as string,
      periodEnd: st.periodEnd as string,
      title: st.title as string,
      status: st.status as string,
      editedAt: (st.editedAt ?? null) as string | null,
      publishedAt: (st.publishedAt ?? null) as string | null,
      publishedByUserId: (st.publishedByUserId ?? null) as string | null,
      createdAt: st.createdAt as string | null | undefined,
      updatedAt: st.updatedAt as string | null | undefined,
    });
  }

  const storyParagraphIds = new Set<string>();
  const storyParagraphsJson: Array<{
    id: string;
    storyId: string;
    position: number;
    kind: string;
    text: string;
    createdAt: string | null | undefined;
    updatedAt: string | null | undefined;
  }> = [];
  for (const value of storyParagraphsRaw) {
    requireCondition(isRecord(value), "bad_json", "story paragraph 必须是对象");
    const pp = value as Record<string, unknown>;
    requireCondition(
      typeof pp.id === "string" && UUID_LIKE.test(pp.id) && !storyParagraphIds.has(pp.id),
      "bad_json",
      `story paragraph id 缺失或重复: ${String(pp.id)}`,
    );
    storyParagraphIds.add(pp.id);
    requireCondition(
      typeof pp.storyId === "string" && storyIds.has(pp.storyId),
      "bad_refs",
      `story paragraph ${String(pp.id)} 引用未知故事`,
    );
    requireCondition(
      typeof pp.position === "number" &&
        Number.isInteger(pp.position) &&
        pp.position >= 0 &&
        pp.position <= 1000,
      "bad_json",
      `story paragraph ${String(pp.id)} 的 position 非法`,
    );
    requireCondition(
      (pp.kind === "narrative" || pp.kind === "quote") &&
        typeof pp.text === "string" &&
        pp.text.length > 0 &&
        pp.text.length <= 2000,
      "bad_json",
      `story paragraph ${String(pp.id)} 的 kind/text 非法`,
    );
    requireCondition(
      isOptionalArchiveDate(pp.createdAt) && isOptionalArchiveDate(pp.updatedAt),
      "bad_json",
      `story paragraph ${String(pp.id)} 的时间字段非法`,
    );
    storyParagraphsJson.push({
      id: pp.id as string,
      storyId: pp.storyId as string,
      position: pp.position as number,
      kind: pp.kind as string,
      text: pp.text as string,
      createdAt: pp.createdAt as string | null | undefined,
      updatedAt: pp.updatedAt as string | null | undefined,
    });
  }

  const storySourcesJson: Array<{
    id: string;
    paragraphId: string;
    sourceType: string;
    sourceId: string | null;
    quote: string | null;
    createdAt: string | null | undefined;
  }> = [];
  const seenStorySourceIds = new Set<string>();
  for (const value of storySourcesRaw) {
    requireCondition(isRecord(value), "bad_json", "story source 必须是对象");
    const ss = value as Record<string, unknown>;
    requireCondition(
      typeof ss.id === "string" && UUID_LIKE.test(ss.id) && !seenStorySourceIds.has(ss.id),
      "bad_json",
      `story source id 缺失或重复: ${String(ss.id)}`,
    );
    seenStorySourceIds.add(ss.id);
    requireCondition(
      typeof ss.paragraphId === "string" && storyParagraphIds.has(ss.paragraphId),
      "bad_refs",
      `story source ${String(ss.id)} 引用未知段落`,
    );
    requireCondition(
      typeof ss.sourceType === "string" && STORY_SOURCE_TYPES.has(ss.sourceType),
      "bad_json",
      `story source ${String(ss.id)} 的 sourceType 非法`,
    );
    if (ss.sourceType === "user_text") {
      requireCondition(
        ss.sourceId === undefined || ss.sourceId === null,
        "bad_refs",
        `story source ${String(ss.id)}：user_text 不允许 sourceId`,
      );
    } else {
      requireCondition(
        typeof ss.sourceId === "string" && ss.sourceId.length > 0,
        "bad_refs",
        `story source ${String(ss.id)} 缺少 sourceId`,
      );
      const known =
        (ss.sourceType === "fact" && factIds.has(ss.sourceId as string)) ||
        (ss.sourceType === "contribution" && contributionIds.has(ss.sourceId as string)) ||
        (ss.sourceType === "transcript" && transcriptIds.has(ss.sourceId as string));
      requireCondition(
        known,
        "bad_refs",
        `story source ${String(ss.id)} 引用未知 ${ss.sourceType} ${String(ss.sourceId)}`,
      );
    }
    requireCondition(
      isNullableString(ss.quote) &&
        (ss.quote === undefined || ss.quote === null || ss.quote.length <= 300),
      "bad_json",
      `story source ${String(ss.id)} 的 quote 非法`,
    );
    storySourcesJson.push({
      id: ss.id as string,
      paragraphId: ss.paragraphId as string,
      sourceType: ss.sourceType as string,
      sourceId: (ss.sourceId ?? null) as string | null,
      quote: ((ss.quote as string | null | undefined) ?? null) || null,
      createdAt: ss.createdAt as string | null | undefined,
    });
  }

  // ---- M5 胶囊对话校验 ----
  const capsuleIdSet = new Set(capsulesJson.map((c) => c.id));
  const questionIds = new Set<string>();
  const capsuleQuestionJson: Array<{
    id: string;
    capsuleId: string;
    questionText: string;
    createdAt: string | null | undefined;
  }> = [];
  for (const value of capsuleQuestionsRaw) {
    requireCondition(isRecord(value), "bad_json", "capsule question 必须是对象");
    const q = value as Record<string, unknown>;
    requireCondition(
      typeof q.id === "string" && UUID_LIKE.test(q.id) && !questionIds.has(q.id),
      "bad_json",
      `capsule question id 缺失或重复: ${String(q.id)}`,
    );
    questionIds.add(q.id);
    requireCondition(
      typeof q.capsuleId === "string" && capsuleIdSet.has(q.capsuleId),
      "bad_refs",
      `capsule question ${String(q.id)} 引用未知胶囊`,
    );
    requireCondition(
      typeof q.questionText === "string" &&
        q.questionText.trim().length >= 1 &&
        q.questionText.length <= 500,
      "bad_json",
      `capsule question ${String(q.id)} 的文本非法`,
    );
    requireCondition(
      isOptionalArchiveDate(q.createdAt),
      "bad_json",
      `capsule question ${String(q.id)} 的时间非法`,
    );
    capsuleQuestionJson.push({
      id: q.id as string,
      capsuleId: q.capsuleId as string,
      questionText: q.questionText as string,
      createdAt: q.createdAt as string | null | undefined,
    });
  }

  const capsuleReplyJson: Array<{
    id: string;
    questionId: string;
    authorPersonId: string | null;
    text: string | null;
    assetId: string | null;
    createdAt: string | null | undefined;
  }> = [];
  const seenReplyIds = new Set<string>();
  for (const value of capsuleRepliesRaw) {
    requireCondition(isRecord(value), "bad_json", "capsule reply 必须是对象");
    const r = value as Record<string, unknown>;
    requireCondition(
      typeof r.id === "string" && UUID_LIKE.test(r.id) && !seenReplyIds.has(r.id),
      "bad_json",
      `capsule reply id 缺失或重复: ${String(r.id)}`,
    );
    seenReplyIds.add(r.id);
    requireCondition(
      typeof r.questionId === "string" && questionIds.has(r.questionId),
      "bad_refs",
      `capsule reply ${String(r.id)} 引用未知问题`,
    );
    requireCondition(
      r.text === undefined ||
        r.text === null ||
        (typeof r.text === "string" && r.text.length >= 1 && r.text.length <= 10000),
      "bad_json",
      `capsule reply ${String(r.id)} 的文本非法`,
    );
    requireCondition(
      (r.text !== null && r.text !== undefined) || typeof r.assetId === "string",
      "bad_json",
      `capsule reply ${String(r.id)} 缺少内容（文字或媒体至少其一）`,
    );
    requireCondition(
      r.assetId === undefined || r.assetId === null || (typeof r.assetId === "string" && assetIds.has(r.assetId as string)),
      "bad_refs",
      `capsule reply ${String(r.id)} 引用未知素材`,
    );
    requireCondition(
      r.authorPersonId === undefined ||
        r.authorPersonId === null ||
        (typeof r.authorPersonId === "string" && personIds.has(r.authorPersonId as string)),
      "bad_refs",
      `capsule reply ${String(r.id)} 引用未知人物`,
    );
    requireCondition(
      isOptionalArchiveDate(r.createdAt),
      "bad_json",
      `capsule reply ${String(r.id)} 的时间非法`,
    );
    capsuleReplyJson.push({
      id: r.id as string,
      questionId: r.questionId as string,
      authorPersonId: (r.authorPersonId ?? null) as string | null,
      text: (r.text ?? null) as string | null,
      assetId: (r.assetId ?? null) as string | null,
      createdAt: r.createdAt as string | null | undefined,
    });
  }
  requireCondition(
    Array.isArray(capsulesJson),
    "bad_json",
    "capsules.json 必须是数组",
  );
  for (const cap of capsulesJson) {
    for (const eid of cap.memoryEventIds ?? []) {
      requireCondition(eventIds.has(eid), "bad_refs", `capsule ${cap.id} 引用未知事件`);
    }
    for (const aid of cap.assetIds ?? []) {
      requireCondition(assetIds.has(aid), "bad_refs", `capsule ${cap.id} 引用未知素材`);
    }
    for (const cid of cap.contributionIds ?? []) {
      requireCondition(
        contributionIds.has(cid),
        "bad_refs",
        `capsule ${cap.id} 引用未知讲述`,
      );
    }
  }

  return {
    archive,
    manifest,
    familyJson,
    peopleJson,
    memoriesJson,
    contributionsJson,
    factsJson,
    factSourcesJson,
    transcriptsJson,
    capsulesJson,
    inboxItemsJson,
    inboxItemAssetsJson,
    storiesJson,
    storyParagraphsJson,
    storySourcesJson,
    capsuleQuestionJson,
    capsuleReplyJson,
  };
}

/**
 * 执行恢复。前置：目标实例业务数据为空；operatorUserId 为已存在用户
 * （通常是通过 /setup 新建的管理员），恢复内容的 created_by 指向该用户。
 */
async function assertRestoreOperator(operatorUserId: string): Promise<void> {
  await assertRestoreTargetEmpty();
  const operator = await getDb()
    .select({
      id: userTable.id,
      role: userTable.role,
      familyId: userTable.familyId,
      personId: userTable.personId,
      disabledAt: userTable.disabledAt,
    })
    .from(userTable)
    .where(eq(userTable.id, operatorUserId))
    .limit(1);
  const operatorRow = operator[0];
  requireCondition(
    Boolean(operatorRow) &&
      operatorRow.role === "admin" &&
      operatorRow.disabledAt === null &&
      operatorRow.familyId === null &&
      operatorRow.personId === null,
    "bad_operator",
    `operator 必须是当前干净实例中未禁用、尚未绑定的 setup 管理员: ${operatorUserId}`,
  );
}

async function restoreFromArchive(
  archive: RestoreArchive,
  archiveBytes: number,
  operatorUserId: string,
  limits: RestoreLimits,
): Promise<RestoreReport> {
  const db = getDb();
  const data = await loadAndVerifyZip(archive, archiveBytes, limits);
  const {
    familyJson,
    peopleJson,
    memoriesJson,
    contributionsJson,
    factsJson,
    factSourcesJson,
    transcriptsJson,
    capsulesJson,
    inboxItemsJson,
    inboxItemAssetsJson,
    storiesJson,
    storyParagraphsJson,
    storySourcesJson,
    capsuleQuestionJson,
    capsuleReplyJson,
  } = data;

  const storage = getAssetStorage();
  const familyId = familyJson.id;
  const now = new Date();

  // 事件标签在事务内外都会用到（审计/报告），预先计算
  const eventTags = memoriesJson.flatMap((m) =>
    (m.tags ?? []).map((tag) => ({
      id: randomUUID(),
      memoryEventId: m.id,
      tag,
      familyId,
      createdAt: now,
    })),
  );

  // 1) 先写文件（DB 失败时回滚删除）；storageKey 以 putOriginal 实际返回为准
  const writtenKeys: string[] = [];
  const storageKeyByAsset = new Map<string, string>();
  try {
    for (const a of data.manifest.assets) {
      const file = await archive.openReadStream(
        `${EXPORT_ROOT_DIR}/${a.relativePath}`,
      );
      requireCondition(
        file,
        "missing_asset",
        `manifest 引用的文件不存在: ${a.relativePath}`,
      );
      const ext = a.relativePath.split(".").pop() ?? "bin";
      const captured = parseDate(a.capturedAt);
      const imported = parseDate(a.importedAt) ?? now;
      // The ZIP entry and destination are streamed while the storage layer
      // calculates actual byte count and SHA-256. No archive-sized or
      // original-sized Buffer is created by the file-based CLI path.
      const streamed = await storage.putOriginalStream(
        familyId,
        a.assetId,
        ext,
        file,
        captured ?? imported,
      );
      const { storageKey } = streamed;
      writtenKeys.push(storageKey);
      requireCondition(
        streamed.bytes === a.bytes,
        "hash_mismatch",
        `${a.relativePath}: 字节数不符`,
      );
      requireCondition(
        streamed.sha256 === a.sha256,
        "hash_mismatch",
        `${a.relativePath}: SHA-256 不符（备份可能损坏）`,
      );
      storageKeyByAsset.set(a.assetId, storageKey);
    }

    // 2) DB 事务恢复全部业务表
    db.transaction((tx) => {
      tx.insert(familyTable)
        .values({
          id: familyId,
          name: familyJson.name,
          timezone: familyJson.timezone || "Asia/Shanghai",
          childLaterUnlockAge: familyJson.childLaterUnlockAge ?? 18,
          createdAt: parseDate(familyJson.createdAt) ?? now,
          updatedAt: parseDate(familyJson.updatedAt) ?? now,
        })
        .run();

      if (peopleJson.length > 0) {
        tx.insert(personTable)
          .values(
            peopleJson.map((p) => ({
              id: p.id,
              familyId,
              displayName: p.displayName,
              relationToChild: p.relationToChild ?? null,
              isChild: p.isChild ?? false,
              isGuardian: p.isGuardian ?? false,
              birthDate: p.birthDate ?? null,
              childLaterUnlockedAt: parseDate(p.childLaterUnlockedAt),
              createdAt: parseDate(p.createdAt) ?? now,
              updatedAt: parseDate(p.updatedAt) ?? parseDate(p.createdAt) ?? now,
            })),
          )
          .run();
      }

      if (data.manifest.assets.length > 0) {
        tx.insert(assetTable)
          .values(
            data.manifest.assets.map((a) => {
              const captured = parseDate(a.capturedAt);
              const type = a.type ?? typeFromPath(a.relativePath);
              const ext = a.relativePath.split(".").pop() ?? "bin";
              const timeSource =
                a.timeSource ??
                (captured ? "embedded_metadata" : "import_time");
              return {
                id: a.assetId,
                familyId,
                type,
                originalFilename: a.originalFilename ?? `${a.assetId}.${ext}`,
                mimeType: a.mimeType,
                bytes: a.bytes,
                sha256: a.sha256,
                storageKey: storageKeyByAsset.get(a.assetId)!,
                capturedAt: captured,
                importedAt: parseDate(a.importedAt) ?? now,
                timeSource,
                width: a.width ?? null,
                height: a.height ?? null,
                durationMs: a.durationMs ?? null,
                metadataJson: a.metadataJson ?? null,
                createdByUserId: operatorUserId,
                originalAssetId: null,
                derivativeType: null,
                createdAt: parseDate(a.importedAt) ?? now,
              };
            }),
          )
          .run();
      }

      if (memoriesJson.length > 0) {
        tx.insert(memoryEvent)
          .values(
            memoriesJson.map((m) => ({
              id: m.id,
              familyId,
              childPersonId: m.childPersonId,
              title: m.title,
              occurredAt: parseDate(m.occurredAt) ?? now,
              occurredAtPrecision: m.occurredAtPrecision ?? "exact",
              locationText: m.locationText ?? null,
              coverAssetId: m.coverAssetId ?? null,
              status: m.status ?? "confirmed",
              ageDays: m.ageDays ?? null,
              lastEditedByUserId: null,
              createdAt: parseDate(m.createdAt) ?? now,
              updatedAt: parseDate(m.updatedAt) ?? now,
            })),
          )
          .run();
      }

      if (eventTags.length > 0) {
        tx.insert(memoryEventTag).values(eventTags).run();
      }

      if (inboxItemsJson.length > 0) {
        tx.insert(inboxItem)
          .values(
            inboxItemsJson.map((item) => ({
              id: item.id,
              familyId: item.familyId,
              kind: item.kind,
              status: item.status,
              rawText: item.rawText,
              memoryEventId: item.memoryEventId,
              createdAt: parseDate(item.createdAt)!,
              updatedAt: parseDate(item.updatedAt)!,
            })),
          )
          .run();
      }

      if (inboxItemAssetsJson.length > 0) {
        tx.insert(inboxItemAsset)
          .values(
            inboxItemAssetsJson.map((link) => ({
              id: link.id,
              inboxItemId: link.inboxItemId,
              assetId: link.assetId,
              familyId: link.familyId,
              createdAt: parseDate(link.createdAt)!,
            })),
          )
          .run();
      }

      const eventAssets = memoriesJson.flatMap((m) =>
        (m.assetIds ?? []).map((assetId) => ({
          id: randomUUID(),
          memoryEventId: m.id,
          assetId,
          familyId,
          createdAt: now,
        })),
      );
      if (eventAssets.length > 0) {
        tx.insert(memoryEventAsset).values(eventAssets).run();
      }

      const participants = memoriesJson.flatMap((m) => {
        const ids = new Set([m.childPersonId, ...(m.participantPersonIds ?? [])]);
        return [...ids].map((personId) => ({
          id: randomUUID(),
          memoryEventId: m.id,
          personId,
          familyId,
          createdAt: now,
        }));
      });
      if (participants.length > 0) {
        tx.insert(memoryEventParticipant).values(participants).run();
      }

      if (contributionsJson.length > 0) {
        tx.insert(contributionTable)
          .values(
            contributionsJson.map((c) => ({
              id: c.id,
              memoryEventId: c.memoryEventId,
              authorPersonId: c.authorPersonId,
              // User ids belong to the destroyed instance and are deliberately
              // not restored. Portable Person/name/mode provenance remains.
              recordedByUserId: null,
              recordedByPersonId: c.recordedByPersonId ?? null,
              recordedByNameSnapshot: c.recordedByNameSnapshot ?? null,
              recordingMode: c.recordingMode ?? "legacy",
              rawText: c.rawText ?? null,
              transcript: c.transcript ?? null,
              editedText: c.editedText ?? null,
              audioAssetId: c.audioAssetId ?? null,
              visibility: c.visibility ?? "family",
              createdAt: parseDate(c.createdAt) ?? now,
              updatedAt: parseDate(c.updatedAt) ?? parseDate(c.createdAt) ?? now,
            })),
          )
          .run();
      }

      if (factsJson.length > 0) {
        tx.insert(factTable)
          .values(
            factsJson.map((f) => ({
              id: f.id,
              memoryEventId: f.memoryEventId,
              statement: f.statement,
              status: f.status ?? "user_confirmed",
              createdAt: parseDate(f.createdAt) ?? now,
              updatedAt: parseDate(f.createdAt) ?? now,
            })),
          )
          .run();
      }

      if (factSourcesJson.length > 0) {
        tx.insert(factSource)
          .values(
            factSourcesJson.map((s) => ({
              id: s.id,
              familyId,
              factId: s.factId,
              sourceType: s.sourceType,
              sourceId: s.sourceId,
              quote: s.quote,
              startMs: s.startMs,
              endMs: s.endMs,
              createdAt: parseDate(s.createdAt) ?? now,
            })),
          )
          .run();
      }

      if (transcriptsJson.length > 0) {
        tx.insert(assetTranscriptTable)
          .values(
            transcriptsJson.map((t) => ({
              id: t.id,
              familyId,
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
              createdAt: parseDate(t.createdAt) ?? now,
              updatedAt: parseDate(t.updatedAt) ?? parseDate(t.createdAt) ?? now,
            })),
          )
          .run();
      }

      if (storiesJson.length > 0) {
        tx.insert(storyTable)
          .values(
            storiesJson.map((st) => ({
              id: st.id,
              familyId,
              kind: st.kind,
              periodStart: new Date(st.periodStart),
              periodEnd: new Date(st.periodEnd),
              title: st.title,
              status: st.status,
              editedAt: st.editedAt ? new Date(st.editedAt) : null,
              publishedAt: st.publishedAt ? new Date(st.publishedAt) : null,
              publishedByUserId: st.publishedByUserId,
              createdByJobId: null,
              createdAt: parseDate(st.createdAt) ?? now,
              updatedAt: parseDate(st.updatedAt) ?? parseDate(st.createdAt) ?? now,
            })),
          )
          .run();
        if (storyParagraphsJson.length > 0) {
          tx.insert(storyParagraphTable)
            .values(
              storyParagraphsJson.map((pp) => ({
                id: pp.id,
                familyId,
                storyId: pp.storyId,
                position: pp.position,
                kind: pp.kind,
                text: pp.text,
                createdAt: parseDate(pp.createdAt) ?? now,
                updatedAt: parseDate(pp.updatedAt) ?? parseDate(pp.createdAt) ?? now,
              })),
            )
            .run();
        }
        if (storySourcesJson.length > 0) {
          tx.insert(storySourceTable)
            .values(
              storySourcesJson.map((ss) => ({
                id: ss.id,
                familyId,
                paragraphId: ss.paragraphId,
                sourceType: ss.sourceType,
                sourceId: ss.sourceId,
                quote: ss.quote,
                createdAt: parseDate(ss.createdAt) ?? now,
              })),
            )
            .run();
        }
      }

      if (capsulesJson.length > 0) {
        tx.insert(capsuleTable)
          .values(
            capsulesJson.map((c) => ({
              id: c.id,
              familyId,
              title: c.title,
              unlockType: c.unlockType,
              unlockValue: c.unlockValue,
              status: c.status ?? "draft",
              sealedAt: parseDate(c.sealedAt),
              openedAt: parseDate(c.openedAt),
              createdAt: parseDate(c.createdAt) ?? now,
              updatedAt: parseDate(c.createdAt) ?? now,
            })),
          )
          .run();

        const capEvents = capsulesJson.flatMap((c) =>
          (c.memoryEventIds ?? []).map((memoryEventId) => ({
            id: randomUUID(),
            capsuleId: c.id,
            memoryEventId,
            familyId,
            createdAt: now,
          })),
        );
        if (capEvents.length > 0) tx.insert(capsuleEvent).values(capEvents).run();

        const capAssets = capsulesJson.flatMap((c) =>
          (c.assetIds ?? []).map((assetId) => ({
            id: randomUUID(),
            capsuleId: c.id,
            assetId,
            familyId,
            createdAt: now,
          })),
        );
        if (capAssets.length > 0) tx.insert(capsuleAsset).values(capAssets).run();

        const capContribs = capsulesJson.flatMap((c) =>
          (c.contributionIds ?? []).map((contributionId) => ({
            id: randomUUID(),
            capsuleId: c.id,
            contributionId,
            familyId,
            createdAt: now,
          })),
        );
        if (capContribs.length > 0) {
          tx.insert(capsuleContribution).values(capContribs).run();
        }
      if (capsuleQuestionJson.length > 0) {
        tx.insert(futureQuestionTable)
          .values(
            capsuleQuestionJson.map((q) => ({
              id: q.id,
              familyId,
              capsuleId: q.capsuleId,
              questionText: q.questionText,
              createdByUserId: operatorUserId,
              createdAt: parseDate(q.createdAt) ?? now,
            })),
          )
          .run();
        if (capsuleReplyJson.length > 0) {
          tx.insert(capsuleReplyTable)
            .values(
              capsuleReplyJson.map((r) => ({
                id: r.id,
                familyId,
                questionId: r.questionId,
                capsuleId:
                  capsuleQuestionJson.find((q) => q.id === r.questionId)?.capsuleId ?? "",
                authorPersonId: r.authorPersonId,
                text: r.text,
                assetId: r.assetId,
                createdAt: parseDate(r.createdAt) ?? now,
              })),
            )
            .run();
        }
      }
      }

      // The verification belongs to the restore transaction. If it ran after
      // commit, a read/verification failure could report a failed restore even
      // though the database and originals had already been mutated.
      const expectedCapsuleEventCount = capsulesJson.reduce(
        (total, capsule) => total + (capsule.memoryEventIds?.length ?? 0),
        0,
      );
      const expectedCapsuleAssetCount = capsulesJson.reduce(
        (total, capsule) => total + (capsule.assetIds?.length ?? 0),
        0,
      );
      const expectedCapsuleContributionCount = capsulesJson.reduce(
        (total, capsule) => total + (capsule.contributionIds?.length ?? 0),
        0,
      );
      const [
        familyRow,
        peopleCount,
        assetCount,
        eventCount,
        contribCount,
        factCount,
        factSourceCount,
        transcriptCount,
        capsuleCount,
        inboxItemCount,
        inboxItemAssetCount,
        memoryEventAssetCount,
        memoryEventParticipantCount,
        memoryEventTagCount,
        capsuleEventCount,
        capsuleAssetCount,
        capsuleContributionCount,
        storyCount,
        storyParagraphCount,
        storySourceCount,
        capsuleQuestionCount,
        capsuleReplyCount,
      ] = [
        tx
          .select({ value: count() })
          .from(familyTable)
          .where(eq(familyTable.id, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(personTable)
          .where(eq(personTable.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(assetTable)
          .where(eq(assetTable.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(memoryEvent)
          .where(eq(memoryEvent.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(contributionTable)
          .innerJoin(memoryEvent, eq(contributionTable.memoryEventId, memoryEvent.id))
          .where(eq(memoryEvent.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(factTable)
          .innerJoin(memoryEvent, eq(factTable.memoryEventId, memoryEvent.id))
          .where(eq(memoryEvent.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(factSource)
          .innerJoin(factTable, eq(factSource.factId, factTable.id))
          .innerJoin(memoryEvent, eq(factTable.memoryEventId, memoryEvent.id))
          .where(eq(memoryEvent.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(assetTranscriptTable)
          .where(eq(assetTranscriptTable.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(capsuleTable)
          .where(eq(capsuleTable.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(inboxItem)
          .where(eq(inboxItem.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(inboxItemAsset)
          .where(eq(inboxItemAsset.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(memoryEventAsset)
          .where(eq(memoryEventAsset.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(memoryEventParticipant)
          .where(eq(memoryEventParticipant.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(memoryEventTag)
          .where(eq(memoryEventTag.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(capsuleEvent)
          .where(eq(capsuleEvent.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(capsuleAsset)
          .where(eq(capsuleAsset.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(capsuleContribution)
          .where(eq(capsuleContribution.familyId, familyId))
          .all(),
        tx.select({ value: count() }).from(storyTable).where(eq(storyTable.familyId, familyId)).all(),
        tx
          .select({ value: count() })
          .from(storyParagraphTable)
          .where(eq(storyParagraphTable.familyId, familyId))
          .all(),
        tx
          .select({ value: count() })
          .from(storySourceTable)
          .where(eq(storySourceTable.familyId, familyId))
          .all(),
        tx.select({ value: count() }).from(futureQuestionTable).where(eq(futureQuestionTable.familyId, familyId)).all(),
        tx
          .select({ value: count() })
          .from(capsuleReplyTable)
          .where(eq(capsuleReplyTable.familyId, familyId))
          .all(),
      ];
      const num = (rows: Array<{ value: number }>) =>
        Number(rows[0]?.value ?? 0);
      const countChecks = {
        family: { actual: num(familyRow), expected: 1 },
        assets: { actual: num(assetCount), expected: data.manifest.assets.length },
        people: { actual: num(peopleCount), expected: peopleJson.length },
        events: { actual: num(eventCount), expected: memoriesJson.length },
        contributions: { actual: num(contribCount), expected: contributionsJson.length },
        facts: { actual: num(factCount), expected: factsJson.length },
        factSources: { actual: num(factSourceCount), expected: factSourcesJson.length },
        stories: { actual: num(storyCount), expected: storiesJson.length },
        storyParagraphs: { actual: num(storyParagraphCount), expected: storyParagraphsJson.length },
        storySources: { actual: num(storySourceCount), expected: storySourcesJson.length },
        capsuleQuestions: { actual: num(capsuleQuestionCount), expected: capsuleQuestionJson.length },
        capsuleReplies: { actual: num(capsuleReplyCount), expected: capsuleReplyJson.length },
        transcripts: { actual: num(transcriptCount), expected: transcriptsJson.length },
        capsules: { actual: num(capsuleCount), expected: capsulesJson.length },
        inboxItems: { actual: num(inboxItemCount), expected: inboxItemsJson.length },
        inboxItemAssets: { actual: num(inboxItemAssetCount), expected: inboxItemAssetsJson.length },
        memoryEventAssets: { actual: num(memoryEventAssetCount), expected: eventAssets.length },
        memoryEventParticipants: { actual: num(memoryEventParticipantCount), expected: participants.length },
        memoryEventTags: { actual: num(memoryEventTagCount), expected: eventTags.length },
        capsuleEvents: { actual: num(capsuleEventCount), expected: expectedCapsuleEventCount },
        capsuleAssets: { actual: num(capsuleAssetCount), expected: expectedCapsuleAssetCount },
        capsuleContributions: { actual: num(capsuleContributionCount), expected: expectedCapsuleContributionCount },
      };
      const mismatches = Object.entries(countChecks)
        .filter(([, { actual, expected }]) => actual !== expected)
        .map(([name, { actual, expected }]) => `${name}: ${actual} != ${expected}`);
      requireCondition(
        mismatches.length === 0,
        "post_verify_failed",
        `恢复后行数校验失败（${mismatches.join("; ")}）`,
      );
    });
  } catch (err) {
    // 回滚：删除已写入的文件，保持「无半恢复状态」
    for (const key of writtenKeys) {
      try {
        storage.delete(key);
      } catch {
        // 尽力而为
      }
    }
    if (err instanceof RestoreError) throw err;
    throw new RestoreError("db_restore_failed", `数据库恢复失败: ${(err as Error).message}`);
  }

  // 3) 审计留痕。recordAudit 自身为 best-effort，不会把已提交恢复改报为失败。
  await recordAudit(familyId, AUDIT_KINDS.restoreCompleted, operatorUserId, {
    zipBytes: archiveBytes,
    people: peopleJson.length,
    assets: data.manifest.assets.length,
    events: memoriesJson.length,
    contributions: contributionsJson.length,
    facts: factsJson.length,
    factSources: factSourcesJson.length,
    tags: eventTags.length,
    transcripts: transcriptsJson.length,
    capsules: capsulesJson.length,
    inboxItems: inboxItemsJson.length,
    inboxItemAssets: inboxItemAssetsJson.length,
  });

  // 4) 全文索引是可重建 derivative：恢复完成后整体重建（失败不阻断恢复本身）。
  try {
    const { rebuildSearchIndex } = await import("@/lib/search/service");
    rebuildSearchIndex();
  } catch {
    // 索引可随时用 `npm run search:rebuild` 手动重建
  }

  return {
    familyId,
    people: peopleJson.length,
    assets: data.manifest.assets.length,
    events: memoriesJson.length,
    contributions: contributionsJson.length,
    facts: factsJson.length,
    factSources: factSourcesJson.length,
    tags: eventTags.length,
    transcripts: transcriptsJson.length,
    capsules: capsulesJson.length,
    inboxItems: inboxItemsJson.length,
    inboxItemAssets: inboxItemAssetsJson.length,
    filesWritten: writtenKeys.length,
  };
}

/** 测试/内存调用方：复用同一流式 ZIP reader；调用方已经持有压缩包 Buffer。 */
export async function restoreFromZip(
  zipBuffer: Buffer,
  operatorUserId: string,
  opts: { limits?: RestoreLimits } = {},
): Promise<RestoreReport> {
  const limits = opts.limits ?? RESTORE_LIMITS;
  await assertRestoreOperator(operatorUserId);
  requireCondition(
    zipBuffer.byteLength > 0 &&
      zipBuffer.byteLength < limits.maxTotalUncompressedBytes,
    "zip_too_large",
    "ZIP 压缩包本身超出大小限制。",
  );
  let zipFile: ZipFile;
  try {
    zipFile = await openZipBuffer(zipBuffer);
  } catch (error) {
    throw zipFailure(error);
  }
  const archive = await createRestoreArchive(zipFile, limits);
  try {
    return await restoreFromArchive(
      archive,
      zipBuffer.byteLength,
      operatorUserId,
      limits,
    );
  } finally {
    archive.close();
  }
}

/** CLI/运维用：从文件句柄按需读取 ZIP，不把压缩包载入 JS heap。 */
export async function restoreFromZipFile(
  zipPath: string,
  operatorUserId: string,
): Promise<RestoreReport> {
  await assertRestoreOperator(operatorUserId);
  const archiveBytes = statSync(zipPath).size;
  requireCondition(
    archiveBytes > 0 && archiveBytes < RESTORE_LIMITS.maxTotalUncompressedBytes,
    "zip_too_large",
    "ZIP 压缩包本身超出大小限制。",
  );
  let zipFile: ZipFile;
  try {
    zipFile = await openZipPath(zipPath);
  } catch (error) {
    throw zipFailure(error);
  }
  const archive = await createRestoreArchive(zipFile, RESTORE_LIMITS);
  try {
    return await restoreFromArchive(
      archive,
      archiveBytes,
      operatorUserId,
      RESTORE_LIMITS,
    );
  } finally {
    archive.close();
  }
}
