import { createHash, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { count, eq } from "drizzle-orm";
import JSZip from "jszip";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { family as familyTable, person as personTable } from "@/db/schema/family";
import {
  contribution as contributionTable,
  fact as factTable,
} from "@/db/schema/contribution";
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
import { user as userTable } from "@/db/schema/auth";
import { getAssetStorage } from "@/lib/assets/storage";
import { EXPORT_ROOT_DIR, EXPORT_VERSION } from "@/lib/export/service";

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
  assets: ManifestAsset[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const UUID_LIKE = /^[0-9a-zA-Z_-]{6,64}$/;

function requireCondition(cond: unknown, code: string, message: string): asserts cond {
  if (!cond) throw new RestoreError(code, message);
}


/** ZIP 条目名必须位于导出根目录之内（防 traversal / 绝对路径 / 盘符） */
function assertSafeEntryName(name: string) {
  const normalized = typeof name === "string" ? name.replaceAll("\\", "/") : "";
  requireCondition(
    !normalized.includes("..") &&
      !normalized.startsWith("/") &&
      !/^[a-zA-Z]:/.test(normalized) &&
      !normalized.endsWith("/") &&
      normalized.startsWith(`${EXPORT_ROOT_DIR}/`),
    "unsafe_entry",
    `ZIP 条目名不安全: ${name}`,
  );
  const parts = normalized.split("/").filter((p) => p.length > 0);
  requireCondition(
    parts[0] === EXPORT_ROOT_DIR && parts.length >= 2,
    "unsafe_entry",
    `ZIP 条目名逃逸导出根目录: ${name}`,
  );
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
  capsules: number;
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

/** 读取并校验 ZIP（结构 + 限制 + 哈希 + 引用完整性），返回解析后的数据集 */
async function loadAndVerifyZip(zipBuffer: Buffer, limits: RestoreLimits) {
  requireCondition(
    zipBuffer.byteLength > 0 && zipBuffer.byteLength < limits.maxTotalUncompressedBytes,
    "zip_too_large",
    "ZIP 压缩包本身超出大小限制。",
  );

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err) {
    throw new RestoreError("bad_zip", `ZIP 无法解析: ${(err as Error).message}`);
  }

  // 条目枚举 + traversal + zip bomb 限制
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  requireCondition(
    entries.length <= limits.maxEntries,
    "too_many_entries",
    `ZIP 条目数超限（${entries.length} > ${limits.maxEntries}）`,
  );
  let totalBytes = 0;
  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    // JSZip 元数据中的 uncompressedSize
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    if (typeof size === "number") {
      requireCondition(
        size <= limits.maxSingleFileBytes,
        "file_too_large",
        `条目解压后过大: ${entry.name}`,
      );
      totalBytes += size;
    }
  }
  requireCondition(
    totalBytes <= limits.maxTotalUncompressedBytes,
    "zip_bomb",
    `ZIP 总解压大小超限（${(totalBytes / 1024 / 1024 / 1024).toFixed(2)}GB）`,
  );

  // manifest
  const manifestFile = zip.file(`${EXPORT_ROOT_DIR}/manifest.json`);
  requireCondition(manifestFile, "missing_manifest", "缺少 manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await manifestFile!.async("string"));
  } catch {
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

  // JSON 实体文件
  async function readJson<T>(name: string): Promise<T> {
    const f = zip.file(`${EXPORT_ROOT_DIR}/${name}`);
    requireCondition(f, "missing_json", `缺少 ${name}`);
    try {
      return JSON.parse(await f!.async("string")) as T;
    } catch {
      throw new RestoreError("bad_json", `${name} 无法解析`);
    }
  }

  const familyJson = await readJson<{
    id: string;
    name: string;
    timezone: string;
    createdAt: string | null;
    updatedAt: string | null;
  }>("family.json");
  const peopleJson = await readJson<
    Array<{
      id: string;
      displayName: string;
      relationToChild?: string | null;
      isChild?: boolean;
      birthDate?: string | null;
      createdAt?: string | null;
    }>
  >("people.json");
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
    }>
  >("memories.json");
  const contributionsJson = await readJson<
    Array<{
      id: string;
      memoryEventId: string;
      authorPersonId: string;
      rawText?: string | null;
      editedText?: string | null;
      audioAssetId?: string | null;
      visibility?: string;
      createdAt?: string | null;
    }>
  >("contributions.json");
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

  // 结构与引用完整性
  requireCondition(
    familyJson.id === manifest.familyId,
    "bad_manifest",
    "family.json.id 与 manifest.familyId 不一致",
  );
  const personIds = new Set(peopleJson.map((p) => p.id));
  const assetIds = new Set(manifest.assets.map((a) => a.assetId));
  requireCondition(
    assetIds.size === manifest.assets.length,
    "bad_manifest",
    "manifest.assets 存在重复 assetId",
  );
  const eventIds = new Set(memoriesJson.map((m) => m.id));
  for (const m of memoriesJson) {
    requireCondition(
      typeof m.title === "string" && m.title.length > 0,
      "bad_json",
      `memories: 事件 ${m.id} 缺少标题`,
    );
    requireCondition(
      personIds.has(m.childPersonId),
      "bad_refs",
      `memories: 事件 ${m.id} 引用未知 childPerson ${m.childPersonId}`,
    );
    for (const pid of m.participantPersonIds ?? []) {
      requireCondition(personIds.has(pid), "bad_refs", `事件 ${m.id} 引用未知参与人 ${pid}`);
    }
    for (const aid of m.assetIds ?? []) {
      requireCondition(assetIds.has(aid), "bad_refs", `事件 ${m.id} 引用未知素材 ${aid}`);
    }
  }
  for (const c of contributionsJson) {
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
  }
  for (const f of factsJson) {
    requireCondition(eventIds.has(f.memoryEventId), "bad_refs", `fact ${f.id} 引用未知事件`);
    requireCondition(
      typeof f.statement === "string" && f.statement.length > 0,
      "bad_json",
      `fact ${f.id} 缺少陈述`,
    );
  }
  const contributionIds = new Set(contributionsJson.map((c) => c.id));
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

  // 全部原件字节 + SHA-256 复核
  const assetBuffers = new Map<string, Buffer>();
  for (const entry of manifest.assets) {
    requireCondition(
      UUID_LIKE.test(entry.assetId),
      "bad_manifest",
      `assetId 非法: ${entry.assetId}`,
    );
    requireCondition(
      typeof entry.relativePath === "string" &&
        entry.relativePath.startsWith("originals/"),
      "bad_manifest",
      `素材 ${entry.assetId} 的 relativePath 非法`,
    );
    const file = zip.file(`${EXPORT_ROOT_DIR}/${entry.relativePath}`);
    requireCondition(
      file,
      "missing_asset",
      `manifest 引用的文件不存在: ${entry.relativePath}`,
    );
    const buf = await file!.async("nodebuffer");
    requireCondition(
      buf.byteLength === entry.bytes,
      "hash_mismatch",
      `${entry.relativePath}: 字节数不符`,
    );
    const sha = createHash("sha256").update(buf).digest("hex");
    requireCondition(
      sha === entry.sha256,
      "hash_mismatch",
      `${entry.relativePath}: SHA-256 不符（备份可能损坏）`,
    );
    assetBuffers.set(entry.assetId, buf);
  }

  return {
    manifest,
    familyJson,
    peopleJson,
    memoriesJson,
    contributionsJson,
    factsJson,
    capsulesJson,
    assetBuffers,
  };
}

/**
 * 执行恢复。前置：目标实例业务数据为空；operatorUserId 为已存在用户
 * （通常是通过 /setup 新建的管理员），恢复内容的 created_by 指向该用户。
 */
export async function restoreFromZip(
  zipBuffer: Buffer,
  operatorUserId: string,
  opts: { limits?: RestoreLimits } = {},
): Promise<RestoreReport> {
  const limits = opts.limits ?? RESTORE_LIMITS;
  await assertRestoreTargetEmpty();
  const db = getDb();
  const operator = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, operatorUserId))
    .limit(1);
  requireCondition(
    Boolean(operator[0]),
    "bad_operator",
    `operator 用户不存在: ${operatorUserId}`,
  );

  const data = await loadAndVerifyZip(zipBuffer, limits);
  const {
    familyJson,
    peopleJson,
    memoriesJson,
    contributionsJson,
    factsJson,
    capsulesJson,
    assetBuffers,
  } = data;

  const storage = getAssetStorage();
  const familyId = familyJson.id;
  const now = new Date();

  // 1) 先写文件（DB 失败时回滚删除）；storageKey 以 putOriginal 实际返回为准
  const writtenKeys: string[] = [];
  const storageKeyByAsset = new Map<string, string>();
  try {
    for (const a of data.manifest.assets) {
      const buffer = assetBuffers.get(a.assetId)!;
      const ext = a.relativePath.split(".").pop() ?? "bin";
      const captured = parseDate(a.capturedAt);
      const imported = parseDate(a.importedAt) ?? now;
      const { storageKey } = storage.putOriginal(
        familyId,
        a.assetId,
        ext,
        buffer,
        captured ?? imported,
      );
      writtenKeys.push(storageKey);
      storageKeyByAsset.set(a.assetId, storageKey);
    }

    // 2) DB 事务恢复全部业务表
    db.transaction((tx) => {
      tx.insert(familyTable)
        .values({
          id: familyId,
          name: familyJson.name,
          timezone: familyJson.timezone || "Asia/Shanghai",
          createdAt: parseDate(familyJson.createdAt) ?? now,
          updatedAt: parseDate(familyJson.updatedAt) ?? now,
        })
        .run();

      tx.insert(personTable)
        .values(
          peopleJson.map((p) => ({
            id: p.id,
            familyId,
            displayName: p.displayName,
            relationToChild: p.relationToChild ?? null,
            isChild: p.isChild ?? false,
            birthDate: p.birthDate ?? null,
            createdAt: parseDate(p.createdAt) ?? now,
            updatedAt: parseDate(p.createdAt) ?? now,
          })),
        )
        .run();

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
              rawText: c.rawText ?? null,
              editedText: c.editedText ?? null,
              audioAssetId: c.audioAssetId ?? null,
              visibility: c.visibility ?? "family",
              createdAt: parseDate(c.createdAt) ?? now,
              updatedAt: parseDate(c.createdAt) ?? now,
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
      }
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

  // 3) 恢复后复核：行数与引用抽查
  const [familyRow, peopleCount, assetCount, eventCount, contribCount, factCount, capsuleCount] =
    await Promise.all([
      db.select({ value: count() }).from(familyTable).where(eq(familyTable.id, familyId)),
      db.select({ value: count() }).from(personTable).where(eq(personTable.familyId, familyId)),
      db.select({ value: count() }).from(assetTable).where(eq(assetTable.familyId, familyId)),
      db.select({ value: count() }).from(memoryEvent).where(eq(memoryEvent.familyId, familyId)),
      db
        .select({ value: count() })
        .from(contributionTable)
        .innerJoin(memoryEvent, eq(contributionTable.memoryEventId, memoryEvent.id))
        .where(eq(memoryEvent.familyId, familyId)),
      db
        .select({ value: count() })
        .from(factTable)
        .innerJoin(memoryEvent, eq(factTable.memoryEventId, memoryEvent.id))
        .where(eq(memoryEvent.familyId, familyId)),
      db.select({ value: count() }).from(capsuleTable).where(eq(capsuleTable.familyId, familyId)),
    ]);
  const num = (r: Array<{ value: number }>) => Number(r[0]?.value ?? 0);
  requireCondition(
    num(familyRow) === 1 &&
      num(assetCount) === data.manifest.assets.length &&
      num(peopleCount) === peopleJson.length &&
      num(eventCount) === memoriesJson.length &&
      num(contribCount) === contributionsJson.length &&
      num(factCount) === factsJson.length &&
      num(capsuleCount) === capsulesJson.length,
    "post_verify_failed",
    "恢复后行数校验失败（数据库与导出不一致）",
  );

  return {
    familyId,
    people: num(peopleCount),
    assets: num(assetCount),
    events: num(eventCount),
    contributions: num(contribCount),
    facts: num(factCount),
    capsules: num(capsuleCount),
    filesWritten: writtenKeys.length,
  };
}

/** CLI/测试用：从文件路径恢复 */
export async function restoreFromZipFile(
  zipPath: string,
  operatorUserId: string,
): Promise<RestoreReport> {
  const { readFileSync } = await import("node:fs");
  void statSync;
  return restoreFromZip(readFileSync(zipPath), operatorUserId);
}
