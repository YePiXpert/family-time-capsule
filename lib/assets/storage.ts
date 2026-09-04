import "server-only";

import {
  constants,
  createWriteStream,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
const UPLOAD_KEY_PATTERN = /^uploads\/[0-9a-f-]{36}\.part$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

export interface StreamPutResult extends PutResult {
  sha256: string;
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
  /** 流式写入原件；同时计算实际字节数与 SHA-256。 */
  putOriginalStream(
    familyId: string,
    assetId: string,
    extension: string,
    data: Readable,
    dateForPath: Date,
  ): Promise<StreamPutResult>;
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
  /** Create an empty, mode-0600 resumable partial under a server-owned key. */
  createUploadPart(uploadId: string): Promise<string>;
  uploadPartSize(key: string): Promise<number>;
  appendUploadPart(
    key: string,
    offset: number,
    contentLength: number,
    data: Readable,
  ): Promise<{ bytes: number; replayed: boolean }>;
  createUploadReadStream(key: string): Readable;
  resolveUploadPath(key: string): string;
  promoteUploadPart(
    key: string,
    familyId: string,
    assetId: string,
    extension: string,
    dateForPath: Date,
  ): Promise<PutResult>;
  deleteUploadPart(key: string): Promise<void>;
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

  async putOriginalStream(
    familyId: string,
    assetId: string,
    extension: string,
    data: Readable,
    dateForPath: Date,
  ): Promise<StreamPutResult> {
    const key = buildOriginalStorageKey(
      familyId,
      assetId,
      extension,
      dateForPath,
    );
    const target = this.resolvePath(key);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const hash = createHash("sha256");
    let bytes = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      if (existsSync(target)) throw new OriginalExistsError(key);
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(
        data,
        verifier,
        createWriteStream(temporary, { flags: "wx" }),
      );
      // hard-link is an atomic no-overwrite publish on the same filesystem.
      // A competing writer gets EEXIST instead of replacing an original.
      await link(temporary, target);
    } catch (error) {
      // pipeline owns stream cleanup once started. Failures before it starts
      // (for example an already-existing target or mkdir error) need the same
      // explicit release so ZIP entry file descriptors cannot remain open.
      if (!data.destroyed) data.destroy();
      if (
        (error as NodeJS.ErrnoException).code === "EEXIST" &&
        existsSync(target)
      ) {
        throw new OriginalExistsError(key);
      }
      throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return { storageKey: key, bytes, sha256: hash.digest("hex") };
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

  async createUploadPart(uploadId: string): Promise<string> {
    if (!UUID_PATTERN.test(uploadId)) throw new StorageKeyError(uploadId);
    const key = `uploads/${uploadId}.part`;
    const target = this.resolveUploadPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    this.resolveUploadPath(key);
    const handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.close();
    return key;
  }

  async uploadPartSize(key: string): Promise<number> {
    const target = this.resolveUploadPath(key);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new StorageKeyError(key);
    return info.size;
  }

  /**
   * Append one bounded chunk. A fully repeated range is byte-compared against
   * disk and acknowledged without growing the file. Partial overlap is refused
   * so a retry can never splice two different payloads together.
   */
  async appendUploadPart(
    key: string,
    offset: number,
    contentLength: number,
    data: Readable,
  ): Promise<{ bytes: number; replayed: boolean }> {
    const target = this.resolveUploadPath(key);
    const actual = await this.uploadPartSize(key);
    if (offset > actual || offset < 0 || contentLength <= 0) {
      throw new UploadOffsetError(actual);
    }
    if (offset < actual && offset + contentLength > actual) {
      throw new UploadOffsetError(actual);
    }

    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(target, constants.O_RDWR | noFollow);
    let consumed = 0;
    try {
      if (offset < actual) {
        for await (const value of data) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          consumed += chunk.byteLength;
          if (consumed > contentLength) throw new UploadLengthError();
          const disk = Buffer.allocUnsafe(chunk.byteLength);
          const read = await handle.read(
            disk,
            0,
            chunk.byteLength,
            offset + consumed - chunk.byteLength,
          );
          if (read.bytesRead !== chunk.byteLength || !disk.equals(chunk)) {
            throw new UploadReplayMismatchError(actual);
          }
        }
        if (consumed !== contentLength) throw new UploadLengthError();
        return { bytes: actual, replayed: true };
      }

      try {
        for await (const value of data) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          consumed += chunk.byteLength;
          if (consumed > contentLength) throw new UploadLengthError();
          let written = 0;
          while (written < chunk.byteLength) {
            const result = await handle.write(
              chunk,
              written,
              chunk.byteLength - written,
              offset + consumed - chunk.byteLength + written,
            );
            written += result.bytesWritten;
          }
        }
        if (consumed !== contentLength) throw new UploadLengthError();
        await handle.sync();
      } catch (error) {
        // The database still points at the old offset. Restore that exact disk
        // boundary before another request is allowed to recover the session.
        await handle.truncate(offset);
        await handle.sync();
        throw error;
      }
      return { bytes: offset + consumed, replayed: false };
    } finally {
      if (!data.destroyed) data.destroy();
      await handle.close();
    }
  }

  createUploadReadStream(key: string): Readable {
    const target = this.resolveUploadPath(key);
    return createReadStream(target, {
      fd: openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
      autoClose: true,
    });
  }

  resolveUploadPath(key: string): string {
    if (!UPLOAD_KEY_PATTERN.test(key) || key.includes("..")) {
      throw new StorageKeyError(key);
    }
    const resolved = path.resolve(this.root, key);
    const uploadsRoot = path.resolve(this.root, "uploads") + path.sep;
    if (!resolved.startsWith(uploadsRoot)) throw new StorageKeyError(key);
    // O_NOFOLLOW protects the leaf only; reject a substituted parent too.
    for (const [target, directory] of [[path.dirname(resolved), true], [resolved, false]] as const) {
      try {
        const info = lstatSync(target);
        if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
          throw new StorageKeyError(key);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return resolved;
  }

  async promoteUploadPart(
    key: string,
    familyId: string,
    assetId: string,
    extension: string,
    dateForPath: Date,
  ): Promise<PutResult> {
    const source = this.resolveUploadPath(key);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new StorageKeyError(key);
    }
    const storageKey = buildOriginalStorageKey(
      familyId,
      assetId,
      extension,
      dateForPath,
    );
    const target = this.resolvePath(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      // Both trees are inside DATA_DIR, so hard-linking is an atomic,
      // no-overwrite promotion and never copies the payload through JS heap.
      await link(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new OriginalExistsError(storageKey);
      }
      throw error;
    }
    return { storageKey, bytes: sourceInfo.size };
  }

  async deleteUploadPart(key: string): Promise<void> {
    await unlink(this.resolveUploadPath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
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

export class UploadOffsetError extends Error {
  constructor(readonly actualOffset: number) {
    super("upload offset does not match disk");
    this.name = "UploadOffsetError";
  }
}

export class UploadLengthError extends Error {
  constructor() {
    super("upload body length does not match Content-Length");
    this.name = "UploadLengthError";
  }
}

export class UploadReplayMismatchError extends Error {
  constructor(readonly actualOffset: number) {
    super("replayed upload bytes do not match disk");
    this.name = "UploadReplayMismatchError";
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
