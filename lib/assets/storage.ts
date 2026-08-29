import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";

/**
 * AssetStorage 抽象（PRD §19，Issue #004）。
 * 业务代码禁止直接 fs.writeFile 写媒体目录——一律通过本接口。
 * MVP 实现 LocalFilesystemStorage；未来可加 S3Storage / WebDAVStorage。
 *
 * storageKey 形式（数据库只存 key，不含磁盘绝对路径）：
 *   originals/{familyId}/{yyyy}/{mm}/{assetId}.{ext}
 *   derivatives/{derivativeType}s/{familyId}/{yyyy}/{mm}/{assetId}.{ext}
 *
 * 安全规则：
 * - 上传的原 filename 永远不进入 storageKey（只作为展示名存 DB）；
 * - key 必须通过白名单校验（前缀、字符集、无 .. 、resolve 后不得越出根目录）；
 * - 原件写入后不可覆盖（putOriginal 对已存在 key 抛错）。
 */

export type DerivativeType = "thumbnail" | "preview" | "transcode" | "waveform";

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`unsafe storage key: ${key}`);
    this.name = "StorageKeyError";
  }
}

export class OriginalExistsError extends Error {
  constructor(key: string) {
    super(`original already exists: ${key}`);
    this.name = "OriginalExistsError";
  }
}

const KEY_PATTERN = /^(originals|derivatives)\/[a-z0-9][a-z0-9/_.-]*$/i;

/** 扩展名白名单化：只允许 1–8 位小写字母数字，其余一律替换为 bin */
export function sanitizeExtension(ext: string | undefined): string {
  if (!ext) return "bin";
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^[a-z0-9]{1,8}$/.test(cleaned) ? cleaned : "bin";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 按 capturedAt/importedAt 的年月分层存放（无日期用导入年月） */
export function buildOriginalStorageKey(
  familyId: string,
  assetId: string,
  extension: string,
  dateForPath: Date,
): string {
  return [
    "originals",
    familyId,
    String(dateForPath.getFullYear()),
    pad2(dateForPath.getMonth() + 1),
    `${assetId}.${sanitizeExtension(extension)}`,
  ].join("/");
}

export function buildDerivativeStorageKey(
  derivativeType: DerivativeType,
  familyId: string,
  assetId: string,
  extension: string,
  dateForPath: Date,
): string {
  return [
    "derivatives",
    `${derivativeType}s`,
    familyId,
    String(dateForPath.getFullYear()),
    pad2(dateForPath.getMonth() + 1),
    `${assetId}.${sanitizeExtension(extension)}`,
  ].join("/");
}

export interface PutResult {
  storageKey: string;
  bytes: number;
}

export interface AssetStorage {
  /** 写入原件；key 已存在时抛 OriginalExistsError（原件永不覆盖） */
  putOriginal(
    familyId: string,
    assetId: string,
    extension: string,
    data: Buffer,
    dateForPath: Date,
  ): PutResult;
  /** 写入衍生物；可再生，允许覆盖同 key */
  putDerivative(
    derivativeType: DerivativeType,
    familyId: string,
    assetId: string,
    extension: string,
    data: Buffer,
    dateForPath: Date,
  ): PutResult;
  read(key: string): Buffer;
  createWebStream(key: string): ReadableStream<Uint8Array>;
  exists(key: string): boolean;
  delete(key: string): void;
  /** 绝对路径（仅内部/测试/导出用，业务层不得持久化） */
  resolvePath(key: string): string;
}

export class LocalFilesystemStorage implements AssetStorage {
  private readonly root: string;

  constructor(root: string = DATA_DIR) {
    this.root = path.resolve(root);
    ensureDataDirs(this.root);
  }

  putOriginal(
    familyId: string,
    assetId: string,
    extension: string,
    data: Buffer,
    dateForPath: Date,
  ): PutResult {
    const key = buildOriginalStorageKey(familyId, assetId, extension, dateForPath);
    const target = this.resolvePath(key);
    if (existsSync(target)) throw new OriginalExistsError(key);
    this.write(key, data);
    return { storageKey: key, bytes: data.byteLength };
  }

  putDerivative(
    derivativeType: DerivativeType,
    familyId: string,
    assetId: string,
    extension: string,
    data: Buffer,
    dateForPath: Date,
  ): PutResult {
    const key = buildDerivativeStorageKey(
      derivativeType,
      familyId,
      assetId,
      extension,
      dateForPath,
    );
    this.write(key, data);
    return { storageKey: key, bytes: data.byteLength };
  }

  read(key: string): Buffer {
    return readFileSync(this.resolvePath(key));
  }

  createWebStream(key: string): ReadableStream<Uint8Array> {
    const target = this.resolvePath(key);
    return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  }

  exists(key: string): boolean {
    return existsSync(this.resolvePath(key));
  }

  delete(key: string): void {
    const target = this.resolvePath(key);
    if (existsSync(target)) unlinkSync(target);
    // 清掉因此变空的 yyyy/mm 目录（尽力而为，失败忽略）
    let dir = path.dirname(target);
    for (let i = 0; i < 3; i++) {
      try {
        if (readdirSync(dir).length > 0) break;
        rmdirSync(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
  }

  resolvePath(key: string): string {
    assertSafeKey(key);
    const resolved = path.resolve(this.root, key.replaceAll("\\", "/"));
    const rootWithSep = this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new StorageKeyError(key);
    }
    return resolved;
  }

  private write(key: string, data: Buffer): void {
    const target = this.resolvePath(key);
    mkdirSync(path.dirname(target), { recursive: true });
    // 原子写入：先写临时文件再 rename，避免半写文件被当作原件
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  }
}

function assertSafeKey(key: string): void {
  if (
    typeof key !== "string" ||
    !KEY_PATTERN.test(key) ||
    key.includes("..") ||
    key.includes("//")
  ) {
    throw new StorageKeyError(key);
  }
}

let storageInstance: LocalFilesystemStorage | undefined;

export function getAssetStorage(): LocalFilesystemStorage {
  storageInstance ??= new LocalFilesystemStorage();
  return storageInstance;
}
