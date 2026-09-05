import * as SQLite from "expo-sqlite";
import * as FS from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Credentials } from "../types";
import { READING_LIMITS, type ReadingKind, type ReadingMedia } from "./types";
import {
  ReadingDownloads,
  ReadingError,
  validateReadingManifest,
  type DownloadEntry,
  type DownloadSummary,
  type ReadingScope,
  type ReadingStore,
  type ReadingTransport,
} from "./engine";
const root = () => {
  if (!FS.documentDirectory) throw new ReadingError("阅读缓存目录不可用。");
  return `${FS.documentDirectory}reader-downloads/`;
};
function safeKey(key: string) {
  if (!/^[a-f0-9]{64}\/(book|collection)-[a-zA-Z0-9_-]{1,128}$/.test(key))
    throw new ReadingError("阅读缓存路径无效。");
  return key;
}
function safeAsset(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new ReadingError("媒体缓存路径无效。");
  return id;
}
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/rtf": "rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};
export function readingFileUri(
  key: string,
  media: Pick<ReadingMedia, "id" | "mimeType">,
) {
  return `${root()}${safeKey(key)}/${safeAsset(media.id)}.${extensions[media.mimeType] ?? "bin"}`;
}
let connection: Promise<SQLite.SQLiteDatabase> | null = null;
async function db() {
  connection ??= (async () => {
    const db = await SQLite.openDatabaseAsync("family-reader-cache.sqlite");
    await db.execAsync(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS reading_download(key TEXT PRIMARY KEY NOT NULL,scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,state TEXT NOT NULL,reserved_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,error TEXT,updated_at INTEGER NOT NULL,manifest_json TEXT NOT NULL,completed_json TEXT NOT NULL,progress_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS reading_scope_idx ON reading_download(scope,updated_at);
 CREATE TABLE IF NOT EXISTS reading_binding(credential_hash TEXT PRIMARY KEY NOT NULL,scope_json TEXT NOT NULL);
 UPDATE reading_download SET state='paused' WHERE state='downloading';`);
    return db;
  })();
  return connection;
}
type Row = {
  key: string;
  scope: string;
  kind: ReadingKind;
  id: string;
  title: string;
  state: DownloadEntry["state"];
  reserved_bytes: number;
  stored_bytes: number;
  error: string | null;
  updated_at: number;
  manifest_json: string;
  completed_json: string;
  progress_json: string;
};
const summary = (r: Row): DownloadSummary => ({
  key: r.key,
  scope: r.scope,
  kind: r.kind,
  id: r.id,
  title: r.title,
  state: r.state,
  reservedBytes: r.reserved_bytes,
  storedBytes: r.stored_bytes,
  error: r.error,
  updatedAt: r.updated_at,
});
const values = (e: DownloadEntry) => [
  e.key,
  e.scope,
  e.kind,
  e.id,
  e.title,
  e.state,
  e.reservedBytes,
  e.storedBytes,
  e.error,
  e.updatedAt,
  JSON.stringify(e.manifest),
  JSON.stringify(e.completed),
  JSON.stringify(e.progress),
];
export const nativeReadingStore: ReadingStore = {
  async get(key) {
    const row = await (
      await db()
    ).getFirstAsync<Row>(
      "SELECT * FROM reading_download WHERE key=?",
      safeKey(key),
    );
    return row
      ? {
          ...summary(row),
          manifest: validateReadingManifest(JSON.parse(row.manifest_json)),
          completed: JSON.parse(row.completed_json),
          progress: JSON.parse(row.progress_json),
        }
      : null;
  },
  async list(scope) {
    return (
      await (
        await db()
      ).getAllAsync<Row>(
        `SELECT key,scope,kind,id,title,state,reserved_bytes,stored_bytes,error,updated_at FROM reading_download ${scope ? "WHERE scope=?" : ""} ORDER BY updated_at DESC LIMIT 100`,
        ...(scope ? [scope] : []),
      )
    ).map(summary);
  },
  async reserve(e) {
    safeKey(e.key);
    const free = await FS.getFreeDiskStorageAsync();
    if (free < e.reservedBytes + 64 * 1024 * 1024)
      throw new ReadingError("手机可用空间不足，请先清理不需要的阅读下载。");
    await (
      await db()
    ).withExclusiveTransactionAsync(async (tx) => {
      if (
        await tx.getFirstAsync(
          "SELECT key FROM reading_download WHERE key=?",
          e.key,
        )
      )
        return;
      const used = await tx.getFirstAsync<{
        total: number;
        family: number;
        n: number;
      }>(
        "SELECT coalesce(sum(reserved_bytes),0) total,coalesce(sum(case when scope=? then reserved_bytes else 0 end),0) family,count(*) n FROM reading_download",
        e.scope,
      );
      if (
        !used ||
        used.n >= 100 ||
        used.total + e.reservedBytes > READING_LIMITS.globalCacheBytes ||
        used.family + e.reservedBytes > READING_LIMITS.cacheBytes
      )
        throw new ReadingError(
          "阅读下载配额已满：每个连接 512 MiB，手机合计 1 GiB / 100 份。请清理旧下载。",
        );
      await tx.runAsync(
        "INSERT INTO reading_download VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ...values(e),
      );
    });
  },
  async save(e) {
    safeKey(e.key);
    await (
      await db()
    ).runAsync(
      "UPDATE reading_download SET state=?,stored_bytes=?,error=?,updated_at=?,completed_json=? WHERE key=?",
      e.state,
      e.storedBytes,
      e.error,
      Date.now(),
      JSON.stringify(e.completed),
      e.key,
    );
  },
  async remove(key) {
    await (
      await db()
    ).runAsync("DELETE FROM reading_download WHERE key=?", safeKey(key));
  },
  async progress(key, progress) {
    await (
      await db()
    ).runAsync(
      "UPDATE reading_download SET progress_json=? WHERE key=?",
      JSON.stringify(progress),
      safeKey(key),
    );
  },
};
export const readingDownloads = new ReadingDownloads(nativeReadingStore);
async function request(credentials: Credentials, path: string) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `${credentials.serverUrl.replace(/\/+$/, "")}${path}`,
      {
        headers: { authorization: `Bearer ${credentials.token}` },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new ReadingError(
        [401, 403, 404, 409].includes(response.status)
          ? "账号、作品或来源已失效，旧阅读缓存已撤下。"
          : "服务器暂时无法提供阅读内容。",
        response.status,
      );
    if (
      Number(response.headers.get("content-length")) >
      READING_LIMITS.metadataBytes
    )
      throw new ReadingError("阅读响应超过容量限制。", 502);
    const body = await response.text();
    if (body.length > READING_LIMITS.metadataBytes)
      throw new ReadingError("阅读响应超过容量限制。", 502);
    try {
      return JSON.parse(body);
    } catch {
      throw new ReadingError("服务器阅读响应无效。", 502);
    }
  } catch (e) {
    if (e instanceof ReadingError) throw e;
    throw new ReadingError("无法连接服务器，已下载内容可继续阅读。", 0);
  } finally {
    clearTimeout(timeout);
  }
}
const hash = (s: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export async function resolveReadingScope(
  credentials: Credentials,
  options: { offline?: boolean } = {},
): Promise<{ scope: ReadingScope; online: boolean }> {
  const serverUrl = credentials.serverUrl.replace(/\/+$/, ""),
    credentialHash = await hash(JSON.stringify([serverUrl, credentials.token]));
  const previous = await (
    await db()
  ).getFirstAsync<{ scope_json: string }>(
    "SELECT scope_json FROM reading_binding WHERE credential_hash=?",
    credentialHash,
  );
  if (options.offline) {
    if (previous)
      return { scope: JSON.parse(previous.scope_json), online: false };
    throw new ReadingError("请先用此账号在线验证一次，再离线阅读下载。", 0);
  }
  try {
    const identity = await request(credentials, "/api/reading/identity");
    if (
      typeof identity?.userId !== "string" ||
      typeof identity.familyId !== "string"
    )
      throw new ReadingError("阅读账号响应无效。", 502);
    const scope = {
      key: await hash(
        JSON.stringify([serverUrl, identity.userId, identity.familyId]),
      ),
      serverUrl,
      userId: identity.userId,
      familyId: identity.familyId,
    };
    if (previous) {
      const old = JSON.parse(previous.scope_json) as ReadingScope;
      if (old.key !== scope.key) {
        const transport = nativeReadingTransport(credentials, old);
        for (const row of await nativeReadingStore.list(old.key))
          await readingDownloads.remove(row.key, transport);
      }
    }
    await (
      await db()
    ).runAsync(
      "INSERT INTO reading_binding VALUES(?,?) ON CONFLICT(credential_hash) DO UPDATE SET scope_json=excluded.scope_json",
      credentialHash,
      JSON.stringify(scope),
    );
    return { scope, online: true };
  } catch (e) {
    if (e instanceof ReadingError && e.status === 0 && previous)
      return { scope: JSON.parse(previous.scope_json), online: false };
    if (
      e instanceof ReadingError &&
      [401, 403, 404].includes(e.status) &&
      previous
    ) {
      const old = JSON.parse(previous.scope_json) as ReadingScope;
      const transport = nativeReadingTransport(credentials, old);
      for (const row of await nativeReadingStore.list(old.key))
        await readingDownloads.remove(row.key, transport);
      await (
        await db()
      ).runAsync(
        "DELETE FROM reading_binding WHERE credential_hash=?",
        credentialHash,
      );
    }
    throw e;
  }
}
export function nativeReadingTransport(
  credentials: Credentials,
  scope: ReadingScope,
): ReadingTransport {
  const mediaIndex = new Map<string, ReadingMedia>();
  const file = (key: string, id: string) => {
    const m = mediaIndex.get(id);
    if (!m) throw new ReadingError("媒体清单缺失。");
    return readingFileUri(key, m);
  };
  return {
    async manifest(kind, id) {
      const manifest = validateReadingManifest(
        await request(
          credentials,
          `/api/reading/${kind}/${encodeURIComponent(id)}`,
        ),
      );
      manifest.media.forEach((m) => mediaIndex.set(m.id, m));
      return manifest;
    },
    async download(manifest, assetId, key, onProgress, signal) {
      const uri = file(key, assetId);
      await FS.makeDirectoryAsync(`${root()}${safeKey(key)}`, {
        intermediates: true,
      });
      let last = 0,
        lastByteAt = Date.now(),
        timedOut = false,
        tooLarge = false;
      const transfer = FS.createDownloadResumable(
        `${scope.serverUrl}/api/reading/${manifest.kind}/${encodeURIComponent(manifest.id)}/files/${encodeURIComponent(assetId)}?digest=${manifest.digest}`,
        uri,
        { headers: { Authorization: `Bearer ${credentials.token}` } },
        (p) => {
          lastByteAt = Date.now();
          if (p.totalBytesWritten > (mediaIndex.get(assetId)?.bytes ?? 0)) {
            tooLarge = true;
            void transfer.pauseAsync().catch(() => {});
          }
          if (Date.now() - last > 250) {
            last = Date.now();
            onProgress(p.totalBytesWritten);
          }
        },
      );
      const abort = () => {
        void transfer.pauseAsync().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      const watchdog = setInterval(() => {
        if (Date.now() - lastByteAt > 60000) {
          timedOut = true;
          void transfer.pauseAsync().catch(() => {});
        }
      }, 1000);
      try {
        if (signal.aborted) throw new ReadingError("已暂停。");
        const result = await transfer.downloadAsync();
        if (timedOut)
          throw new ReadingError("下载超过一分钟没有进展，请重试。", 408);
        if (tooLarge) throw new ReadingError("下载超出声明大小，已停止。", 502);
        if (signal.aborted) throw new ReadingError("已暂停。");
        if (!result || result.status !== 200)
          throw new ReadingError(
            result && [401, 403, 404, 409].includes(result.status)
              ? "权限或来源变化，已撤下缓存。"
              : "下载失败，可重试。",
            result?.status ?? 0,
          );
      } catch (e) {
        await FS.deleteAsync(uri, { idempotent: true });
        throw e;
      } finally {
        clearInterval(watchdog);
        signal.removeEventListener("abort", abort);
      }
    },
    async verify(key, id, bytes, expected) {
      const f = new File(file(key, id));
      if (!f.exists || f.size !== bytes) return false;
      const digest = sha256.create(),
        handle = f.open();
      let read = 0,
        chunks = 0;
      try {
        while (read < bytes) {
          const chunk = handle.readBytes(Math.min(64 * 1024, bytes - read));
          if (!chunk.length) return false;
          digest.update(chunk);
          read += chunk.length;
          if (++chunks % 8 === 0)
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return (
          Array.from(digest.digest(), (n) =>
            n.toString(16).padStart(2, "0"),
          ).join("") === expected
        );
      } finally {
        handle.close();
      }
    },
    async removeFile(key, id) {
      const dir = `${root()}${safeKey(key)}/`;
      const names = await FS.readDirectoryAsync(dir).catch(() => []);
      for (const name of names.filter(
        (n) => n.startsWith(`${safeAsset(id)}.`) && /^[a-zA-Z0-9_.-]+$/.test(n),
      ))
        await FS.deleteAsync(`${dir}${name}`, { idempotent: true });
    },
    async removeDirectory(key) {
      await FS.deleteAsync(`${root()}${safeKey(key)}`, { idempotent: true });
    },
  };
}
let validating = false;
export async function revalidateReadingDownloads(credentials: Credentials) {
  if (validating) return;
  validating = true;
  try {
    const { scope, online } = await resolveReadingScope(credentials);
    if (!online) return;
    const transport = nativeReadingTransport(credentials, scope);
    for (const entry of await nativeReadingStore.list(scope.key)) {
      try {
        await readingDownloads.revalidate(scope, entry.key, transport);
      } catch (e) {
        if (
          !(e instanceof ReadingError) ||
          ![401, 403, 404, 409].includes(e.status)
        )
          break;
      }
    }
  } finally {
    validating = false;
  }
}
export async function clearReadingScope(
  scope: ReadingScope,
  credentials: Credentials,
) {
  const transport = nativeReadingTransport(credentials, scope);
  for (const entry of await nativeReadingStore.list(scope.key))
    await readingDownloads.remove(entry.key, transport);
}
