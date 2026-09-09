import { rotateSyncGenerationInTransaction } from "@/lib/mobile/sync-state";

import { legacyArchivePrivacy } from "./legacy-privacy";
import { validateArchivePrivacy, type ArchivePrivacy } from "@/lib/export/privacy.mjs";
import { assertLivePhotoPairs } from "@/lib/drafts/model";
import { assetDeletion } from "@/db/schema/asset-deletion";
import { parseAssetDeletions } from "@/lib/assets/deletion-portable.mjs";
import { parseDraftArchive } from "@/lib/drafts/archive";
import { draft, draftItem } from "@/db/schema/draft";
import { parseNameReviews } from "@/lib/names/archive";
import { BOOK_FILES } from "@/lib/books/projects/portable.mjs";
import { parseBookArchive, restoreBookArchive } from "@/lib/books/projects/archive";
import { COLLECTION_FILES } from "@/lib/collections/portable.mjs";
import { parseCollectionArchive, restoreCollectionArchive } from "@/lib/collections/archive";
import "server-only";
import { NAME_SOURCES, nameSource } from "@/lib/naming";

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { Readable } from "node:stream";
import { count, eq, sql } from "drizzle-orm";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { getDb } from "@/db";
import { asset as assetTable, documentText } from "@/db/schema/asset";
import { documentTextCollector } from "@/lib/assets/document-text";
import { family as familyTable, person as personTable } from "@/db/schema/family";
import { inboxItem, inboxItemAsset, inboxItemParticipant } from "@/db/schema/inbox";
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

import { aiSuggestion, factSource, memoryEventTag } from "@/db/schema/suggestion";

import { user as userTable } from "@/db/schema/auth";
import {
  importSession as importSessionTable,
  importSessionDefaultParticipant as importSessionDefaultParticipantTable,
  importSessionItem as importSessionItemTable,
} from "@/db/schema/import";

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

function validateArchiveName(source: unknown, revision: unknown): void {
  requireCondition(source === undefined || NAME_SOURCES.includes(source as typeof NAME_SOURCES[number]), "bad_json", "名称来源非法");
  requireCondition(revision === undefined || (Number.isSafeInteger(revision) && Number(revision) >= 0), "bad_json", "名称版本非法");
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
  displayName?: string | null;
  nameSource?: string;
  nameRevision?: number;
  participantPersonIds?: string[];
  metadataRevision?: number;
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
  modules?: { collections?: number; bookProjects?: number; nameReviews?: number; drafts?: number; assetDeletions?: number };
  assetCount: number;
  assets: ManifestAsset[];
};

type InboxItemArchiveRow = {
  id: string;
  familyId: string;
  kind: string;
  status: string;
  rawText: string | null;
  draftTitle?: string | null;
  titleSource?: string;
  titleRevision?: number;
  draftOccurredAt?: string | null;
  draftLocationText?: string | null;
  participantPersonIds?: string[];
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

type ImportSessionArchiveRow = {
  intakeDestination?: "pending" | "draft" | "library";
  intakeDraftId?: string | null;
  id: string;
  source: string;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  defaultTitle: string | null;
  defaultOccurredAt: string | null;
  defaultLocationText: string | null;
  createdAt: string;
  updatedAt: string;
};

type ImportSessionDefaultParticipantArchiveRow = {
  id: string;
  importSessionId: string;
  personId: string;
  createdAt: string;
};

type ImportSessionItemArchiveRow = {
  id: string;
  importSessionId: string;
  captureId: string;
  filename: string | null;
  declaredMime: string | null;
  totalBytes: number | null;
  lastModified: string | null;
  clientFingerprint: string | null;
  assetId: string | null;
  inboxItemId: string | null;
  status: string;
  errorCode: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
  deletedAt?: string | null;
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
  revision?: number;
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

  inboxItems: number;
  inboxItemAssets: number;
  importSessions: number;
  importSessionItems: number;

  bookProjects: number;
  bookBlocks: number;
  bookRevisions: number;
  collections: number;
  collectionSections: number;
  collectionItems: number;
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
    [1, 2, 3, EXPORT_VERSION].includes(manifest.exportVersion),
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
      childPersonId: string | null;
      title: string;
      bodyText?: string;
      titleSource?: string;
      titleRevision?: number;
      occurredAt: string | null;
      occurredAtPrecision?: string;
      deletedAt?: string | null;
      locationText?: string | null;
      coverAssetId?: string | null;
      status?: string;
      milestoneType?: string | null;
      isPinned?: boolean;
      ageDays?: number | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      assetIds?: string[];
      assetCaptions?: Record<string, string>;
      assetReferences?: { assetId: string; caption: string; livePhotoGroupId?: string; livePhotoRole?: "image" | "video" }[];
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

  const nameReviewsFile = archive.has(`${EXPORT_ROOT_DIR}/name-reviews.json`);
  requireCondition(manifest.modules?.nameReviews === undefined || (manifest.modules.nameReviews === 1 && nameReviewsFile), "missing_json", "名称审核模块缺失或不支持");
  const nameReviewsRaw = nameReviewsFile ? await readJson<unknown>("name-reviews.json") : [];

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

  // 1.1 durable graph: these eight files form one relational unit. Old v1
  // archives omit all of them and restore with empty sessions/portals/reviews;
  // a partial set is corruption and must fail before any original is written.
  const durable11Names = [
    "import-sessions.json",
    "import-session-default-participants.json",
    "import-session-items.json",
    "contribution-requests.json",
    "contribution-request-submissions.json",
    "contribution-portal-submissions.json",
    "review-periods.json",
    "review-period-events.json",
  ].filter(name => manifest.exportVersion < 4 || name.startsWith("import-"));
  const durable11Presence = durable11Names.map((name) =>
    archive.has(`${EXPORT_ROOT_DIR}/${name}`),
  );
  const hasDurable11Files = durable11Presence.every(Boolean);
  requireCondition(
    hasDurable11Files || durable11Presence.every((present) => !present),
    "missing_json",
    "1.1 import/portal/review 关系文件必须全部存在或全部缺失",
  );
  const durable11Raw = new Map<string, unknown>();
  for (const name of durable11Names) {
    const value = hasDurable11Files ? await readJson<unknown>(name) : [];
    requireCondition(Array.isArray(value), "bad_json", `${name} 必须是数组`);
    durable11Raw.set(name, value);
  }
  const importSessionsRaw = durable11Raw.get("import-sessions.json") as unknown[];
  const importDefaultParticipantsRaw = durable11Raw.get(
    "import-session-default-participants.json",
  ) as unknown[];
  const importSessionItemsRaw = durable11Raw.get("import-session-items.json") as unknown[];

  const collectionPresence = COLLECTION_FILES.map((name) => archive.has(`${EXPORT_ROOT_DIR}/${name}`));
  const hasCollections = collectionPresence.every(Boolean);
  requireCondition(hasCollections || collectionPresence.every(p => !p), "missing_json", "相册关系三件套不完整");
  requireCondition(manifest.modules?.collections === undefined || (manifest.modules.collections === 1 && hasCollections), "missing_json", "声明的相册模块缺失或不支持");
  const bookPresence = BOOK_FILES.map(name => archive.has(`${EXPORT_ROOT_DIR}/${name}`));
  const hasBooks = bookPresence.every(Boolean);
  requireCondition(hasBooks || bookPresence.every(p=>!p), "missing_json", "年册关系文件不完整");
  requireCondition(manifest.modules?.bookProjects === undefined || (manifest.modules.bookProjects === 1 && hasBooks), "missing_json", "声明的年册模块缺失或不支持");
  const bookRaw = hasBooks ? await Promise.all(BOOK_FILES.map(name=>readJson<unknown>(name))) : [[],[],[],[],[],[]];
  const collectionRaw = hasCollections ? await Promise.all(COLLECTION_FILES.map(name => readJson<unknown>(name))) : [[],[],[]];

  const hasInboxFiles = Boolean(inboxItemsFile) && Boolean(inboxItemAssetsFile);
  const hasStoryFiles = archive.has(`${EXPORT_ROOT_DIR}/stories.json`);
  const hasDialogueFiles = archive.has(`${EXPORT_ROOT_DIR}/capsule-questions.json`);
  const expectedFileCount =
    manifest.assets.length +
    (manifest.exportVersion >= 2 ? 1 : 0) +
    LEGACY_EXPORT_NON_ASSET_FILE_COUNT - (manifest.exportVersion >= 4 ? 1 : 0) +
    (hasInboxFiles ? 2 : 0) +
    (transcriptsFile ? 1 : 0) +
    (factSourcesFile ? 1 : 0) + (nameReviewsFile ? 1 : 0) + (archive.has(`${EXPORT_ROOT_DIR}/asset-deletions.json`) ? 1 : 0) + (archive.has(`${EXPORT_ROOT_DIR}/drafts.json`) ? 1 : 0) +
    (hasStoryFiles ? 3 : 0) +
    (hasDialogueFiles ? 2 : 0) +
    (hasDurable11Files ? durable11Names.length : 0) + (hasCollections ? COLLECTION_FILES.length : 0) + (hasBooks ? BOOK_FILES.length : 0);
  requireCondition(
    manifest.fileCount === expectedFileCount,
    hasInboxFiles || factSourcesFile || hasStoryFiles || hasDialogueFiles || hasDurable11Files
      ? "bad_manifest"
      : "missing_json",
    hasInboxFiles
      ? "manifest.fileCount 与归档文件集不一致"
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
    validateArchiveName(entry.nameSource, entry.nameRevision);
    requireCondition(entry.displayName === undefined || entry.displayName === null || (typeof entry.displayName === "string" && entry.displayName.length <= 100), "bad_json", "素材展示名非法");
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
  }
  for (const original of manifest.assets) {
    const ids = original.participantPersonIds ?? [];
    requireCondition(Array.isArray(ids) && ids.length <= 50 && new Set(ids).size === ids.length && ids.every(id => personIds.has(id)), "bad_manifest", "素材人物引用非法");
    requireCondition(original.metadataRevision === undefined || (Number.isSafeInteger(original.metadataRevision) && original.metadataRevision >= 0), "bad_manifest", "素材元数据版本非法");
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
    requireCondition(m.bodyText === undefined || typeof m.bodyText === "string", "bad_json", `事件 ${m.id} 正文非法`);
    validateArchiveName(m.titleSource, m.titleRevision);
    requireCondition(
      typeof m.title === "string" && m.title.length > 0,
      "bad_json",
      `memories: 事件 ${m.id} 缺少标题`,
    );
    requireCondition(
      m.childPersonId === null || personIds.has(m.childPersonId),
      "bad_refs",
      `memories: 事件 ${m.id} 引用未知 Person ${m.childPersonId}`,
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
    if (m.assetReferences !== undefined) {
      requireCondition(Array.isArray(m.assetReferences) && JSON.stringify(m.assetReferences.map(r => r?.assetId)) === JSON.stringify(m.assetIds ?? []), "bad_json", `事件 ${m.id} 素材顺序关系无效`);
      requireCondition(m.assetReferences.every(r => isRecord(r) && typeof r.assetId === "string" && typeof r.caption === "string" && r.caption.length <= 2000), "bad_json", `事件 ${m.id} 素材说明无效`);
      try { assertLivePhotoPairs(m.assetReferences); }
      catch { throw new RestoreError("bad_json", `事件 ${m.id} Live Photo 关系无效`); }
      for (const r of m.assetReferences) if (r.livePhotoRole) requireCondition(assetTypeById.get(r.assetId) === r.livePhotoRole, "bad_refs", `事件 ${m.id} Live Photo 组件类型无效`);
    }
    requireCondition(m.assetCaptions === undefined || (m.assetCaptions !== null && typeof m.assetCaptions === "object" && !Array.isArray(m.assetCaptions) && Object.entries(m.assetCaptions).every(([id, caption]) => (m.assetIds ?? []).includes(id) && typeof caption === "string" && caption.length <= 2000)), "bad_json", `事件 ${m.id} 素材说明无效`);
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
    requireCondition(
      m.milestoneType === undefined ||
        m.milestoneType === null ||
        ["first_time", "growth", "family", "learning", "celebration", "other"].includes(
          m.milestoneType,
        ),
      "bad_json",
      `事件 ${m.id} 的 milestoneType 非法`,
    );
    requireCondition(
      m.isPinned === undefined || typeof m.isPinned === "boolean",
      "bad_json",
      `事件 ${m.id} 的 isPinned 非法`,
    );
    for (const pid of m.participantPersonIds ?? []) {
      requireCondition(personIds.has(pid), "bad_refs", `事件 ${m.id} 引用未知参与人 ${pid}`);
    }
    requireCondition(m.deletedAt === undefined || m.deletedAt === null || (typeof m.deletedAt === "string" && parseDate(m.deletedAt) !== null), "bad_json", "invalid memory deletedAt");
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
      item.draftTitle === undefined || item.draftTitle === null ||
        (typeof item.draftTitle === "string" && item.draftTitle.length <= 100),
      "bad_json",
      `inbox item ${item.id} 的草稿标题非法`,
    );
    requireCondition(
      item.draftLocationText === undefined || item.draftLocationText === null ||
        (typeof item.draftLocationText === "string" && item.draftLocationText.length <= 200),
      "bad_json",
      `inbox item ${item.id} 的草稿地点非法`,
    );
    requireCondition(
      item.draftOccurredAt === undefined || item.draftOccurredAt === null ||
        (typeof item.draftOccurredAt === "string" && parseDate(item.draftOccurredAt) !== null),
      "bad_json",
      `inbox item ${item.id} 的草稿时间非法`,
    );
    requireCondition(
      item.participantPersonIds === undefined ||
        (Array.isArray(item.participantPersonIds) &&
          item.participantPersonIds.length <= 50 &&
          item.participantPersonIds.every((personId) => typeof personId === "string" && personIds.has(personId))),
      "bad_refs",
      `inbox item ${item.id} 的草稿人物非法`,
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
    validateArchiveName(item.titleSource, item.titleRevision);
    inboxItemsJson.push({
      id: item.id,
      familyId: item.familyId,
      kind: item.kind,
      status: item.status,
      rawText: item.rawText,
      draftTitle: (item.draftTitle ?? null) as string | null,
      titleSource: nameSource(item.titleSource),
      titleRevision: (item.titleRevision ?? 0) as number,
      draftOccurredAt: (item.draftOccurredAt ?? null) as string | null,
      draftLocationText: (item.draftLocationText ?? null) as string | null,
      participantPersonIds: (item.participantPersonIds ?? []) as string[],
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
    requireCondition(isOptionalArchiveDate(c.deletedAt), "bad_json", "讲述删除时间无效");
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
      typeof t.provider === "string" && (t.provider.length > 0 || (t.status === "user_edited" && typeof t.editedTranscript === "string")),
      "bad_json",
      `transcript ${t.id} 的 provider 非法`,
    );
    requireCondition(
      typeof t.model === "string" && (t.model.length > 0 || (t.status === "user_edited" && typeof t.editedTranscript === "string")),
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
    requireCondition(t.revision === undefined || (Number.isSafeInteger(t.revision) && Number(t.revision) >= 0), "bad_json", `transcript ${t.id} 的 revision 非法`);
    transcriptsJson.push({
      id: t.id as string,
      familyId: t.familyId as string,
      assetId: t.assetId as string,
      language:
        t.language === undefined || t.language === null
          ? null
          : (t.language as string),
      provider: (t.provider || "manual") as string,
      model: (t.model || "manual") as string,
      rawTranscript: t.rawTranscript as string,
      editedTranscript: (t.editedTranscript ?? null) as string | null,
      revision: Number(t.revision ?? 0),
      segmentsJson: (t.segmentsJson ?? null) as string | null,
      status: (t.status ?? "machine") as string,
      sourceSha256: t.sourceSha256 as string,
      createdByJobId: (t.createdByJobId ?? null) as string | null,
      createdAt: t.createdAt as string | null | undefined,
      updatedAt: t.updatedAt as string | null | undefined,
    });
  }

  const IMPORT_SOURCES = new Set(["web", "native", "share", "guest"]);
  const IMPORT_STATUSES = new Set([
    "collecting",
    "uploading",
    "reviewing",
    "completed",
    "cancelled",
  ]);
  const IMPORT_ITEM_STATUSES = new Set([
    "pending",
    "uploading",
    "completed",
    "failed",
    "cancelled",
  ]);
  const importSessionIds = new Set<string>();
  const importSessionsJson: ImportSessionArchiveRow[] = [];
  for (const value of importSessionsRaw) {
    requireCondition(isRecord(value), "bad_json", "import session 必须是对象");
    const row = value;
    requireCondition(
      typeof row.id === "string" && UUID_LIKE.test(row.id) && !importSessionIds.has(row.id),
      "bad_json",
      `import session id 缺失或重复: ${String(row.id)}`,
    );
    importSessionIds.add(row.id);
    requireCondition(
      typeof row.source === "string" && IMPORT_SOURCES.has(row.source),
      "bad_json",
      `import session ${row.id} 的 source 非法`,
    );
    requireCondition(
      typeof row.status === "string" && IMPORT_STATUSES.has(row.status),
      "bad_json",
      `import session ${row.id} 的 status 非法`,
    );
    const counts = [row.totalCount, row.completedCount, row.failedCount];
    requireCondition(
      counts.every((count) => Number.isSafeInteger(count) && (count as number) >= 0) &&
        (row.completedCount as number) + (row.failedCount as number) <=
          (row.totalCount as number),
      "bad_json",
      `import session ${row.id} 的计数非法`,
    );
    requireCondition(
      (row.defaultTitle === null ||
        (typeof row.defaultTitle === "string" && row.defaultTitle.length <= 200)) &&
        (row.defaultLocationText === null ||
          (typeof row.defaultLocationText === "string" &&
            row.defaultLocationText.length <= 200)) &&
        (row.defaultOccurredAt === null || parseDate(row.defaultOccurredAt) !== null),
      "bad_json",
      `import session ${row.id} 的批量默认值非法`,
    );
    requireCondition(
      parseDate(row.createdAt) !== null && parseDate(row.updatedAt) !== null,
      "bad_json",
      `import session ${row.id} 的时间非法`,
    );
    requireCondition(
      row.createdByUserId === undefined && row.familyId === undefined,
      "bad_provenance",
      `import session ${row.id} 不得携带本地 User/Family id`,
    );
    requireCondition((row.intakeDestination === undefined || ["pending", "draft", "library"].includes(String(row.intakeDestination))) &&
      (row.intakeDraftId === undefined || row.intakeDraftId === null || (typeof row.intakeDraftId === "string" && /^[\w-]{1,128}$/u.test(row.intakeDraftId))) &&
      (!row.intakeDraftId || row.intakeDestination === "draft"), "bad_json", "收件去向非法");
    importSessionsJson.push(row as ImportSessionArchiveRow);
  }

  const importDefaultParticipantIds = new Set<string>();
  const importDefaultParticipantPairs = new Set<string>();
  const importDefaultParticipantsJson: ImportSessionDefaultParticipantArchiveRow[] = [];
  for (const value of importDefaultParticipantsRaw) {
    requireCondition(isRecord(value), "bad_json", "import default participant 必须是对象");
    const row = value;
    const pair = `${String(row.importSessionId)}\0${String(row.personId)}`;
    requireCondition(
      typeof row.id === "string" &&
        UUID_LIKE.test(row.id) &&
        !importDefaultParticipantIds.has(row.id) &&
        typeof row.importSessionId === "string" &&
        importSessionIds.has(row.importSessionId) &&
        typeof row.personId === "string" &&
        personIds.has(row.personId) &&
        !importDefaultParticipantPairs.has(pair),
      "bad_refs",
      `import default participant ${String(row.id)} 的引用非法或重复`,
    );
    requireCondition(
      parseDate(row.createdAt) !== null,
      "bad_json",
      `import default participant ${row.id} 的时间非法`,
    );
    importDefaultParticipantIds.add(row.id);
    importDefaultParticipantPairs.add(pair);
    importDefaultParticipantsJson.push(row as ImportSessionDefaultParticipantArchiveRow);
  }

  const importSessionItemIds = new Set<string>();
  const importSessionCapturePairs = new Set<string>();
  const importSessionItemsJson: ImportSessionItemArchiveRow[] = [];
  for (const value of importSessionItemsRaw) {
    requireCondition(isRecord(value), "bad_json", "import session item 必须是对象");
    const row = value;
    const capturePair = `${String(row.importSessionId)}\0${String(row.captureId)}`;
    requireCondition(
      typeof row.id === "string" && UUID_LIKE.test(row.id) && !importSessionItemIds.has(row.id),
      "bad_json",
      `import session item id 缺失或重复: ${String(row.id)}`,
    );
    requireCondition(
      typeof row.importSessionId === "string" && importSessionIds.has(row.importSessionId),
      "bad_refs",
      `import session item ${row.id} 引用未知 session`,
    );
    requireCondition(
      typeof row.captureId === "string" &&
        row.captureId.length >= 1 &&
        row.captureId.length <= 200 &&
        !importSessionCapturePairs.has(capturePair),
      "bad_json",
      `import session item ${row.id} 的 captureId 非法或重复`,
    );
    requireCondition(
      row.filename === null ||
        (typeof row.filename === "string" && row.filename.length >= 1 && row.filename.length <= 255),
      "bad_json",
      `import session item ${row.id} 的 filename 非法`,
    );
    requireCondition(
      row.declaredMime === null ||
        (typeof row.declaredMime === "string" && row.declaredMime.length >= 1 && row.declaredMime.length <= 255),
      "bad_json",
      `import session item ${row.id} 的 declaredMime 非法`,
    );
    requireCondition(
      row.totalBytes === null ||
        (Number.isSafeInteger(row.totalBytes) && (row.totalBytes as number) > 0),
      "bad_json",
      `import session item ${row.id} 的 totalBytes 非法`,
    );
    requireCondition(
      (row.lastModified === null || parseDate(row.lastModified) !== null) &&
        (row.clientFingerprint === null ||
          (typeof row.clientFingerprint === "string" && row.clientFingerprint.length <= 256)),
      "bad_json",
      `import session item ${row.id} 的文件匹配字段非法`,
    );
    requireCondition(
      row.assetId === null || (typeof row.assetId === "string" && assetIds.has(row.assetId)),
      "bad_refs",
      `import session item ${row.id} 引用未知 asset`,
    );
    requireCondition(
      row.inboxItemId === null ||
        (typeof row.inboxItemId === "string" && inboxItemIds.has(row.inboxItemId)),
      "bad_refs",
      `import session item ${row.id} 引用未知 inbox item`,
    );
    requireCondition(
      typeof row.status === "string" && IMPORT_ITEM_STATUSES.has(row.status),
      "bad_json",
      `import session item ${row.id} 的 status 非法`,
    );
    requireCondition(
      row.errorCode === null ||
        (typeof row.errorCode === "string" && row.errorCode.length <= 100),
      "bad_json",
      `import session item ${row.id} 的 errorCode 非法`,
    );
    requireCondition(
      Number.isSafeInteger(row.sortOrder) &&
        (row.sortOrder as number) >= 0 &&
        parseDate(row.createdAt) !== null &&
        parseDate(row.updatedAt) !== null,
      "bad_json",
      `import session item ${row.id} 的顺序或时间非法`,
    );
    requireCondition(
      row.uploadSessionId === undefined && row.familyId === undefined,
      "bad_provenance",
      `import session item ${row.id} 不得携带临时 upload/family id`,
    );
    importSessionItemIds.add(row.id);
    importSessionCapturePairs.add(capturePair);
    importSessionItemsJson.push(row as ImportSessionItemArchiveRow);
  }

  let collectionGraph;
  try { collectionGraph = parseCollectionArchive(collectionRaw[0], collectionRaw[1], collectionRaw[2], manifest.familyId, new Set(memoriesJson.map(m => m.id)), assetIds); }
  catch { throw new RestoreError("bad_refs", "相册编辑关系图无效"); }

  let bookGraph;
  try { bookGraph = parseBookArchive(bookRaw, manifest.familyId, { memory: new Set(memoriesJson.map(m=>m.id)), asset: assetIds, person: new Set(peopleJson.map(p=>p.id)), contribution: new Set(contributionsJson.map(c=>c.id)), collection: new Set(collectionGraph.collections.map(c=>c.id)) }); }
  catch { throw new RestoreError("bad_refs", "年册编辑与历史版本关系图无效"); }

  requireCondition(manifest.modules?.drafts === undefined || (manifest.modules.drafts === 1 && archive.has(`${EXPORT_ROOT_DIR}/drafts.json`)), "missing_json", "声明的草稿模块缺失或不支持");
  let drafts;
  try {
    const rawDrafts = archive.has(`${EXPORT_ROOT_DIR}/drafts.json`) ? await readJson<unknown>("drafts.json") : [];
    drafts = parseDraftArchive(rawDrafts, { inbox: new Set(inboxItemsJson.map(i => i.id)), assets: assetIds, events: new Set(memoriesJson.map(m => m.id)), people: new Set(peopleJson.map(p => p.id)) });
    const draftIds = new Set(drafts.map(row => row.id));
    requireCondition(importSessionsJson.every(row => !row.intakeDraftId || draftIds.has(row.intakeDraftId)), "bad_json", "收件引用的草稿不存在");
  } catch { throw new RestoreError("bad_refs", "草稿聚合与原件引用无效"); }

  requireCondition(manifest.modules?.assetDeletions === undefined || (manifest.modules.assetDeletions === 1 && archive.has(`${EXPORT_ROOT_DIR}/asset-deletions.json`)), "missing_json", "声明的原件删除记录缺失或不支持");
  let assetDeletions;
  try { assetDeletions = parseAssetDeletions(archive.has(`${EXPORT_ROOT_DIR}/asset-deletions.json`) ? await readJson<unknown>("asset-deletions.json") : [], assetIds); }
  catch { throw new RestoreError("bad_refs", "原件删除记录无效"); }

  let nameReviews;
  try { nameReviews = parseNameReviews(nameReviewsRaw, new Map(memoriesJson.map(row => [row.id, row.titleRevision ?? 0])), new Map(inboxItemsJson.map(row => [row.id, row.titleRevision ?? 0])), new Map(manifest.assets.map(row => [row.assetId, row.nameRevision ?? 0]))); }
  catch { throw new RestoreError("bad_refs", "名称审核版本或目标关系无效"); }

  let privacy: ArchivePrivacy | null = null;
  if (manifest.exportVersion >= 2) {
    requireCondition(memoriesJson.every(m => typeof m.bodyText === "string"), "bad_json", "v2 归档缺少记忆正文");
    try { privacy = validateArchivePrivacy(await readJson<unknown>("privacy.json"), { events: eventIds, assets: assetIds, drafts: new Set(drafts.map(d => d.id)), books: new Set(bookGraph.projects.map(p => p.id)), imports: new Set(importSessionsJson.map(i => i.id)), reviewAssets: new Set(inboxItemAssetsJson.map(l => `${l.inboxItemId}:${l.assetId}`)) }); }
    catch { throw new RestoreError("bad_refs", "v2 归档作者和读者关系无效"); }
    requireCondition(drafts.every(d => privacy!.drafts.find(p => p.id === d.id)?.visibility === d.visibility), "bad_refs", "草稿可见性与 v2 权限记录冲突");
    requireCondition(bookGraph.projects.every(p => p.audience !== "personal" || privacy!.books.find(r => r.id === p.id)?.owner !== null), "bad_refs", "个人作品缺少归档作者");
  } else {
    requireCondition(!archive.has(`${EXPORT_ROOT_DIR}/privacy.json`) && memoriesJson.every(m => m.bodyText === undefined), "bad_manifest", "v2 内容不可降级为 v1 恢复");
    privacy = legacyArchivePrivacy({ events: memoriesJson, assets: manifest.assets, drafts, books: bookGraph.projects, imports: importSessionsJson });
  }
  return {
    privacy,
    nameReviews,
    assetDeletions,
    drafts,
    bookGraph,
    collectionGraph,
    archive,
    manifest,
    familyJson,
    peopleJson,
    memoriesJson,
    contributionsJson,
    factsJson,
    factSourcesJson,
    transcriptsJson,

    inboxItemsJson,
    inboxItemAssetsJson,

    importSessionsJson,
    importDefaultParticipantsJson,
    importSessionItemsJson,

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
      (operatorRow.role === "owner" || operatorRow.role === "admin") &&
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
  principalBindings: Record<string, string> = {},
): Promise<RestoreReport> {
  const db = getDb();
  const data = await loadAndVerifyZip(archive, archiveBytes, limits);
  const {
    nameReviews,
    assetDeletions,
    drafts,
    bookGraph,
    collectionGraph,
    familyJson,
    peopleJson,
    memoriesJson,
    contributionsJson,
    factsJson,
    factSourcesJson,
    transcriptsJson,

    inboxItemsJson,
    inboxItemAssetsJson,

    importSessionsJson,
    importDefaultParticipantsJson,
    importSessionItemsJson,

  } = data;

  const storage = getAssetStorage();
  const familyId = familyJson.id;
  const now = new Date();
  const principalUsers = new Map((data.privacy?.principals ?? []).map(p => [p.id, Object.hasOwn(principalBindings, p.id) ? principalBindings[p.id] : randomUUID()]));
  requireCondition(Object.keys(principalBindings).every(id => principalUsers.has(id)), "bad_refs", "作者绑定重复或引用未知身份");
  for (const target of Object.values(principalBindings)) requireCondition(target === operatorUserId, "bad_refs", "初次恢复仅可显式绑定当前 setup 账号；其余身份保留待确认");
  const eventPrivacy = new Map(data.privacy?.events.map(r => [r.id, r]));
  const assetPrivacy = new Map(data.privacy?.assets.map(r => [r.id, r]));
  const draftPrivacy = new Map(data.privacy?.drafts.map(r => [r.id, r]));
  const importPrivacy = new Map(data.privacy?.imports.map(r => [r.id, r]));
  const restoredOwner = (owner: string | null | undefined) => owner ? principalUsers.get(owner)! : null;

  // 事件标签在事务内外都会用到（审计/报告），预先计算
  // Legacy sources are used only when the archive has no canonical body field.
  // An explicit empty body is authoritative and must not resurrect old text.
  function legacyMemoryBody(eventId: string, targetFamilyId: string): string {
    const notes = inboxItemsJson.filter(item => item.familyId === targetFamilyId && item.memoryEventId === eventId && item.rawText?.trim())
      .sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)).map(item => item.rawText!);
    if (notes.length) return notes.join("\n\n");
    return drafts.filter(item => item.memoryEventId === eventId && item.status === "published" && item.text.trim())
      .sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)).map(item => item.text).join("\n\n");
  }

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
  const textByAsset = new Map<string, { text: string; truncated: boolean }>();
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
      const collector = documentTextCollector((a.type ?? typeFromPath(a.relativePath)) === "document" ? a.mimeType : "");
      async function* collectDocument() {
        for await (const chunk of file!) {
          collector.write(chunk);
          yield chunk;
        }
      }
      // The ZIP entry and destination are streamed while the storage layer
      // calculates actual byte count and SHA-256. No archive-sized or
      // original-sized Buffer is created by the file-based CLI path.
      const streamed = await storage.putOriginalStream(
        familyId,
        a.assetId,
        ext,
        Readable.from(collectDocument()),
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
      const extracted = collector.finish();
      if (extracted.text !== null) textByAsset.set(a.assetId, { text: extracted.text, truncated: extracted.truncated });
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

      for (const principal of data.privacy?.principals ?? []) {
        const userId = principalUsers.get(principal.id)!;
        const bound = Object.hasOwn(principalBindings, principal.id);
        if (!bound) tx.insert(userTable).values({ id: userId, name: principal.name, email: `${userId}@restore.invalid`, role: "viewer", familyId, personId: null, disabledAt: now, createdAt: now, updatedAt: now }).run();
        tx.run(sql`insert into restore_principal(id,family_id,archive_principal_id,user_id,state,bound_at) values (${randomUUID()},${familyId},${principal.id},${userId},${bound ? 'bound' : 'unresolved'},${bound ? now.getTime() : null})`);
      }

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
                displayName: a.displayName ?? null,
                nameSource: nameSource(a.nameSource),
                nameRevision: a.nameRevision ?? 0,
                participantIdsJson: JSON.stringify(a.participantPersonIds ?? []),
                metadataRevision: a.metadataRevision ?? 0,
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
                createdByUserId: data.privacy ? restoredOwner(assetPrivacy.get(a.assetId)!.owner)! : operatorUserId,
                visibility: assetPrivacy.get(a.assetId)?.visibility ?? "family",
                originalAssetId: null,
                derivativeType: null,
                createdAt: parseDate(a.importedAt) ?? now,
              };
            }),
          )
          .run();
      }

      for (const [assetId, extracted] of textByAsset) {
        tx.insert(documentText).values({ id: randomUUID(), familyId, assetId, ...extracted, createdAt: now }).run();
      }

      if (memoriesJson.length > 0) {
        tx.insert(memoryEvent)
          .values(
            memoriesJson.map((m) => ({
              id: m.id,
              familyId,
              childPersonId: m.childPersonId,
              title: m.title,
              bodyText: m.bodyText ?? legacyMemoryBody(m.id, familyId),
              visibility: eventPrivacy.get(m.id)?.visibility ?? "family",
              createdByUserId: restoredOwner(eventPrivacy.get(m.id)?.owner),
              titleSource: nameSource(m.titleSource),
              titleRevision: m.titleRevision ?? 0,
              occurredAt: parseDate(m.occurredAt) ?? now,
              occurredAtPrecision: m.occurredAtPrecision ?? "exact",
              locationText: m.locationText ?? null,
              coverAssetId: m.coverAssetId ?? null,
              status: m.status ?? "confirmed",
              deletedAt: parseDate(m.deletedAt),
              milestoneType: m.milestoneType ?? null,
              isPinned: m.isPinned ?? false,
              ageDays: m.ageDays ?? null,
              lastEditedByUserId: null,
              createdAt: parseDate(m.createdAt) ?? now,
              updatedAt: parseDate(m.updatedAt) ?? now,
            })),
          )
          .run();
      }

      for (const row of data.privacy?.events ?? []) for (const reader of new Set(row.readers.map(id => principalUsers.get(id)!))) {
        tx.run(sql`insert into memory_event_reader(id,family_id,memory_event_id,user_id,created_at) values (${randomUUID()},${familyId},${row.id},${reader},${Math.floor(now.getTime()/1000)})`);
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
              draftTitle: item.draftTitle,
              titleSource: nameSource(item.titleSource),
              titleRevision: item.titleRevision ?? 0,
              draftOccurredAt: parseDate(item.draftOccurredAt ?? null),
              draftLocationText: item.draftLocationText,
              memoryEventId: item.memoryEventId,
              createdAt: parseDate(item.createdAt)!,
              updatedAt: parseDate(item.updatedAt)!,
            })),
          )
          .run();
        const inboxParticipants = inboxItemsJson.flatMap((item) =>
          (item.participantPersonIds ?? []).map((personId) => ({
            id: randomUUID(),
            inboxItemId: item.id,
            personId,
            familyId: item.familyId,
            createdAt: parseDate(item.updatedAt) ?? now,
          })),
        );
        if (inboxParticipants.length > 0) {
          tx.insert(inboxItemParticipant).values(inboxParticipants).run();
        }
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

      if (importSessionsJson.length > 0) {
        tx.insert(importSessionTable)
          .values(
            importSessionsJson.map((session) => ({
              id: session.id,
              familyId,
              source: session.source,
              intakeDestination: session.intakeDestination ?? "pending",
              intakeRevision: session.intakeDestination && session.intakeDestination !== "pending" ? 1 : 0,
              status: session.status,
              totalCount: session.totalCount,
              completedCount: session.completedCount,
              failedCount: session.failedCount,
              defaultTitle: session.defaultTitle,
              defaultOccurredAt: parseDate(session.defaultOccurredAt),
              defaultLocationText: session.defaultLocationText,
              createdByUserId: data.privacy ? restoredOwner(importPrivacy.get(session.id)?.owner) : operatorUserId,
              createdAt: parseDate(session.createdAt)!,
              updatedAt: parseDate(session.updatedAt)!,
            })),
          )
          .run();
      }
      if (importDefaultParticipantsJson.length > 0) {
        tx.insert(importSessionDefaultParticipantTable)
          .values(
            importDefaultParticipantsJson.map((link) => ({
              id: link.id,
              familyId,
              importSessionId: link.importSessionId,
              personId: link.personId,
              createdAt: parseDate(link.createdAt)!,
            })),
          )
          .run();
      }
      if (importSessionItemsJson.length > 0) {
        tx.insert(importSessionItemTable)
          .values(
            importSessionItemsJson.map((item) => ({
              id: item.id,
              familyId,
              importSessionId: item.importSessionId,
              captureId: item.captureId,
              filename: item.filename,
              declaredMime: item.declaredMime,
              totalBytes: item.totalBytes,
              lastModified: parseDate(item.lastModified),
              clientFingerprint: item.clientFingerprint,
              uploadSessionId: null,
              assetId: item.assetId,
              inboxItemId: item.inboxItemId,
              status: item.status,
              errorCode: item.errorCode,
              sortOrder: item.sortOrder,
              createdAt: parseDate(item.createdAt)!,
              updatedAt: parseDate(item.updatedAt)!,
            })),
          )
          .run();
      }

      const eventAssets = memoriesJson.flatMap((m) =>
        (m.assetReferences ?? (m.assetIds ?? []).map(assetId => ({ assetId, caption: m.assetCaptions?.[assetId] ?? "", livePhotoGroupId: undefined, livePhotoRole: undefined }))).map((reference, sortOrder) => ({
          id: randomUUID(),
          memoryEventId: m.id,
          assetId: reference.assetId,
          caption: reference.caption,
          livePhotoGroupId: reference.livePhotoGroupId,
          livePhotoRole: reference.livePhotoRole,
          sortOrder,
          familyId,
          createdAt: now,
        })),
      );
      if (eventAssets.length > 0) {
        tx.insert(memoryEventAsset).values(eventAssets).run();
      }

      if (assetDeletions.length) tx.insert(assetDeletion).values(assetDeletions.map(row => ({ ...row, familyId, requestedByUserId: null, storageKeysJson: "[]", cleanedAt: new Date().toISOString() }))).run();
      for (const receipt of data.privacy?.reviewAssets ?? []) tx.run(sql`insert into restored_review_asset(family_id,inbox_item_id,asset_id) values (${familyId},${receipt.inboxItemId},${receipt.assetId})`);
      for (const row of drafts) {
        tx.insert(draft).values({ id: row.id, inboxItemId: row.inboxItemId, familyId, authorUserId: restoredOwner(draftPrivacy.get(row.id)?.owner), readerUserIdsJson: JSON.stringify([...new Set((draftPrivacy.get(row.id)?.readers ?? []).map(id => principalUsers.get(id)!))]), authorPersonId: row.authorPersonId, authorName: row.authorName, title: row.title, text: row.text, occurredAt: row.occurredAt, occurredAtPrecision: row.occurredAtPrecision, locationText: row.locationText, participantIdsJson: JSON.stringify(row.participantIds), visibility: draftPrivacy.get(row.id)?.visibility ?? row.visibility, coverItemId: row.coverItemId, status: row.status, memoryEventId: row.memoryEventId, revision: 0, reviewedRevision: row.inboxItemId && !row.reviewPending ? 0 : null, mutationId: randomUUID(), createdAt: row.createdAt, updatedAt: row.updatedAt }).run();
        for (const [sortOrder, item] of row.items.entries()) tx.insert(draftItem).values({ ...item, draftId: row.id, sortOrder }).run();
      }
      for (const row of importSessionsJson) if (row.intakeDraftId) tx.update(importSessionTable).set({ intakeDraftId: row.intakeDraftId }).where(eq(importSessionTable.id, row.id)).run();

      const participants = memoriesJson.flatMap((m) => {
        const ids = new Set(m.participantPersonIds ?? (m.childPersonId ? [m.childPersonId] : []));
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
              deletedAt: parseDate(c.deletedAt),
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

      if (nameReviews.length > 0) {
        tx.insert(aiSuggestion).values(nameReviews.map(row => ({
          id: row.id, familyId, entityType: row.entityType, entityId: row.entityId, suggestionType: "title",
          valueJson: JSON.stringify({ title: row.title }), provider: row.provider, model: row.model, sourceFingerprint: row.sourceFingerprint,
          status: row.status, revision: row.revision, targetRevision: row.targetRevision, appliedRevision: row.appliedRevision,
          previousNameJson: row.previousName ? JSON.stringify(row.previousName) : null, createdByJobId: null,
          createdAt: new Date(row.createdAt), resolvedAt: new Date(row.resolvedAt), undoneAt: row.undoneAt ? new Date(row.undoneAt) : null,
          resolvedByUserId: row.resolvedByUserId,
        }))).run();
      }

      requireCondition(tx.select({ value: count() }).from(aiSuggestion).where(eq(aiSuggestion.familyId, familyId)).get()?.value === nameReviews.length, "bad_refs", "名称审核恢复数量不一致");

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
              revision: t.revision ?? 0,
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

      restoreCollectionArchive(tx, collectionGraph, familyId);
      restoreBookArchive(tx, bookGraph, familyId, new Map(data.privacy?.books.map(row => [row.id, restoredOwner(row.owner)])));

      rotateSyncGenerationInTransaction(tx);

      // The verification belongs to the restore transaction. If it ran after
      // commit, a read/verification failure could report a failed restore even
      // though the database and originals had already been mutated.

      const [
        familyRow,
        peopleCount,
        assetCount,
        eventCount,
        contribCount,
        factCount,
        factSourceCount,
        transcriptCount,

        inboxItemCount,
        inboxItemAssetCount,
        memoryEventAssetCount,
        memoryEventParticipantCount,
        memoryEventTagCount,

        importSessionCount,
        importDefaultParticipantCount,
        importSessionItemCount,

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

        tx.select({ value: count() }).from(importSessionTable).where(eq(importSessionTable.familyId, familyId)).all(),
        tx.select({ value: count() }).from(importSessionDefaultParticipantTable).where(eq(importSessionDefaultParticipantTable.familyId, familyId)).all(),
        tx.select({ value: count() }).from(importSessionItemTable).where(eq(importSessionItemTable.familyId, familyId)).all(),

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

        importSessions: { actual: num(importSessionCount), expected: importSessionsJson.length },
        importDefaultParticipants: { actual: num(importDefaultParticipantCount), expected: importDefaultParticipantsJson.length },
        importSessionItems: { actual: num(importSessionItemCount), expected: importSessionItemsJson.length },

        transcripts: { actual: num(transcriptCount), expected: transcriptsJson.length },

        inboxItems: { actual: num(inboxItemCount), expected: inboxItemsJson.length },
        inboxItemAssets: { actual: num(inboxItemAssetCount), expected: inboxItemAssetsJson.length },
        memoryEventAssets: { actual: num(memoryEventAssetCount), expected: eventAssets.length },
        memoryEventParticipants: { actual: num(memoryEventParticipantCount), expected: participants.length },
        memoryEventTags: { actual: num(memoryEventTagCount), expected: eventTags.length },

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

    inboxItems: inboxItemsJson.length,
    inboxItemAssets: inboxItemAssetsJson.length,
    importSessions: importSessionsJson.length,
    importSessionItems: importSessionItemsJson.length,

    bookProjects: bookGraph.projects.length,
    bookBlocks: bookGraph.blocks.length,
    bookRevisions: bookGraph.revisions.length,
    collections: collectionGraph.collections.length,
    collectionSections: collectionGraph.sections.length,
    collectionItems: collectionGraph.items.length,
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

    inboxItems: inboxItemsJson.length,
    inboxItemAssets: inboxItemAssetsJson.length,
    importSessions: importSessionsJson.length,
    importSessionItems: importSessionItemsJson.length,

    bookProjects: bookGraph.projects.length,
    bookBlocks: bookGraph.blocks.length,
    bookRevisions: bookGraph.revisions.length,
    collections: collectionGraph.collections.length,
    collectionSections: collectionGraph.sections.length,
    collectionItems: collectionGraph.items.length,
    filesWritten: writtenKeys.length,
  };
}

/** 测试/内存调用方：复用同一流式 ZIP reader；调用方已经持有压缩包 Buffer。 */
export async function restoreFromZip(
  zipBuffer: Buffer,
  operatorUserId: string,
  opts: { limits?: RestoreLimits; principalBindings?: Record<string, string> } = {},
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
      opts.principalBindings,
    );
  } finally {
    archive.close();
  }
}

/** CLI/运维用：从文件句柄按需读取 ZIP，不把压缩包载入 JS heap。 */
export async function restoreFromZipFile(
  zipPath: string,
  operatorUserId: string,
  opts: { principalBindings?: Record<string, string> } = {},
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
      opts.principalBindings,
    );
  } finally {
    archive.close();
  }
}
