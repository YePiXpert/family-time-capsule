import {
  ENTITY_KINDS,
  emptyLibrary,
  normalizeLibrary,
  rootOf,
  validateLibrary,
  type EntityKind,
  type Library,
} from "./model";
/** v1：魔数 + 整库 JSON 清单 + 素材原始字节。只读兼容，不再产出。 */
export const BACKUP_MAGIC = new TextEncoder().encode("XIAOMEI1");
export const HEADER_LIMIT = 16 * 1024 * 1024;
/** v2：魔数 + meta + 实体 NDJSON + 按内容去重的素材字节。 */
export const BACKUP_MAGIC_V2 = new TextEncoder().encode("XIAOMEI2");
/**
 * meta 里只有根字段与素材清单，不含记录正文——正文在 NDJSON 段里逐行流式读写。
 * 所以这个上限跟着素材条数走，而不是跟着写了多少字走，不会像 v1 那样在记录变多
 * 之后突然撞墙。三万段素材的清单约 2.3MB。
 */
export const META_LIMIT = 64 * 1024 * 1024;
export type BackupBlob = { sha256: string; bytes: number };
export type BackupMetaV2 = {
  format: "xiaomei-local";
  version: 2;
  createdAt: string;
  root: Partial<Library>;
  entityBytes: number;
  entityCount: number;
  blobs: BackupBlob[];
};
export type BackupManifest = {
  format: "xiaomei-local";
  version: 1;
  createdAt: string;
  library: Library;
  mediaOrder: string[];
};
export function encodeHeader(library: Library): Uint8Array {
  validateLibrary(library);
  if (Object.values(library.drafts).some((d) => d.recordingFile))
    throw new Error("请先恢复或结束未完成的录音，再备份。");
  const manifest: BackupManifest = {
    format: "xiaomei-local",
    version: 1,
    createdAt: new Date().toISOString(),
    library,
    mediaOrder: Object.keys(library.media).sort(),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  if (json.length > HEADER_LIMIT) throw new Error("备份清单过大。");
  const header = new Uint8Array(12 + json.length);
  header.set(BACKUP_MAGIC);
  new DataView(header.buffer).setUint32(8, json.length);
  header.set(json, 12);
  return header;
}
export function decodeManifest(json: Uint8Array): BackupManifest {
  if (json.length > HEADER_LIMIT) throw new Error("备份清单过大。");
  const m = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(json),
  ) as BackupManifest;
  if (
    m.format !== "xiaomei-local" ||
    m.version !== 1 ||
    !Array.isArray(m.mediaOrder)
  )
    throw new Error("不是受支持的小美成长记备份。");
  normalizeLibrary(m.library);
  validateLibrary(m.library);
  const ids = Object.keys(m.library.media).sort();
  if (
    m.mediaOrder.length !== ids.length ||
    new Set(m.mediaOrder).size !== ids.length ||
    m.mediaOrder.some((i) => !ids.includes(i)) ||
    Object.values(m.library.drafts).some((d) => d.recordingFile)
  )
    throw new Error("备份素材清单无效。");
  return m;
}
/** 每行一个实体：{"kind":..,"id":..,"e":{..}}。顺序固定，便于逐字比对。 */
export function encodeEntities(library: Library): Uint8Array {
  const lines: string[] = [];
  for (const kind of ENTITY_KINDS)
    for (const id of Object.keys(library[kind]).sort())
      lines.push(
        JSON.stringify({
          kind,
          id,
          e: (library[kind] as Record<string, unknown>)[id],
        }),
      );
  return new TextEncoder().encode(lines.map((l) => `${l}\n`).join(""));
}
/** 素材按 sha256 去重后的字节清单，顺序固定。 */
export function backupBlobs(library: Library): BackupBlob[] {
  const seen = new Map<string, BackupBlob>();
  for (const id of Object.keys(library.media).sort()) {
    const m = library.media[id]!;
    if (!seen.has(m.sha256)) seen.set(m.sha256, { sha256: m.sha256, bytes: m.bytes });
  }
  return [...seen.values()];
}
export function encodeMetaV2(
  library: Library,
  entityBytes: number,
  entityCount: number,
): Uint8Array {
  validateLibrary(library);
  if (Object.values(library.drafts).some((d) => d.recordingFile))
    throw new Error("请先恢复或结束未完成的录音，再备份。");
  const meta: BackupMetaV2 = {
    format: "xiaomei-local",
    version: 2,
    createdAt: new Date().toISOString(),
    root: rootOf(library),
    entityBytes,
    entityCount,
    blobs: backupBlobs(library),
  };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  if (json.length > META_LIMIT) throw new Error("备份清单过大。");
  const head = new Uint8Array(12 + json.length);
  head.set(BACKUP_MAGIC_V2);
  new DataView(head.buffer).setUint32(8, json.length);
  head.set(json, 12);
  return head;
}
export function decodeMetaV2(json: Uint8Array): BackupMetaV2 {
  if (json.length > META_LIMIT) throw new Error("备份清单过大。");
  const m = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(json),
  ) as BackupMetaV2;
  if (
    m.format !== "xiaomei-local" ||
    m.version !== 2 ||
    !m.root ||
    typeof m.root !== "object" ||
    !Number.isSafeInteger(m.entityBytes) ||
    m.entityBytes < 0 ||
    !Number.isSafeInteger(m.entityCount) ||
    m.entityCount < 0 ||
    !Array.isArray(m.blobs) ||
    m.blobs.some(
      (b) =>
        !b ||
        !/^[a-f0-9]{64}$/.test(b.sha256) ||
        !Number.isSafeInteger(b.bytes) ||
        b.bytes < 1,
    ) ||
    new Set(m.blobs.map((b) => b.sha256)).size !== m.blobs.length
  )
    throw new Error("不是受支持的小美成长记备份。");
  return m;
}
/** 把 meta 的根与 NDJSON 段拼回整库，并按开库同一套规则校验。 */
export function decodeLibraryV2(meta: BackupMetaV2, entities: Uint8Array): Library {
  const state = { ...emptyLibrary(), ...meta.root } as Library;
  for (const kind of ENTITY_KINDS)
    (state as unknown as Record<string, unknown>)[kind] = {};
  const text = new TextDecoder("utf-8", { fatal: true }).decode(entities);
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : [];
  if (lines.length !== meta.entityCount)
    throw new Error("备份内容不完整。");
  for (const line of lines) {
    const row = JSON.parse(line) as { kind: EntityKind; id: string; e: unknown };
    const collection = (state as unknown as Record<string, unknown>)[row.kind] as
      | Record<string, unknown>
      | undefined;
    if (!collection || !ENTITY_KINDS.includes(row.kind) || typeof row.id !== "string")
      throw new Error("不是受支持的小美成长记备份。");
    collection[row.id] = row.e;
  }
  normalizeLibrary(state);
  validateLibrary(state);
  if (Object.values(state.drafts).some((d) => d.recordingFile))
    throw new Error("备份素材清单无效。");
  const wanted = new Set(Object.values(state.media).map((m) => m.sha256));
  const carried = new Set(meta.blobs.map((b) => b.sha256));
  if (
    wanted.size !== carried.size ||
    [...wanted].some((h) => !carried.has(h)) ||
    meta.blobs.some((b) =>
      Object.values(state.media).every(
        (m) => m.sha256 !== b.sha256 || m.bytes !== b.bytes,
      ),
    )
  )
    throw new Error("备份素材清单无效。");
  return state;
}
