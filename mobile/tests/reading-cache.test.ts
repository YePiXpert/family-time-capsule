/// <reference types="node" />
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createReadStream,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ReadingManifest } from "../src/reading/types";
const state = vi.hoisted(() => ({
  root: "",
  bytes: 0,
  delay: 0,
  downloads: [] as string[],
  free: 2 ** 32,
  db: null as unknown,
  aborts: 0,
  chunkMax: 0,
}));
const root = mkdtempSync(path.join(tmpdir(), "fictional-native-reading-"));
state.root = root;
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_: string, v: string) => hash(v),
}));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => {
    const Database = createRequire(import.meta.url)("better-sqlite3");
    const db = new Database(path.join(root, name));
    state.db = db;
    const adapter = {
      execAsync: async (sql: string) => db.exec(sql),
      getFirstAsync: async (sql: string, ...args: unknown[]) =>
        db.prepare(sql).get(...args) ?? null,
      getAllAsync: async (sql: string, ...args: unknown[]) =>
        db.prepare(sql).all(...args),
      runAsync: async (sql: string, ...args: unknown[]) =>
        db.prepare(sql).run(...args),
      withExclusiveTransactionAsync: async (
        fn: (tx: unknown) => Promise<void>,
      ) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          await fn(adapter);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    };
    return adapter;
  },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get exists() {
      return existsSync(fileURLToPath(this.uri));
    }
    get size() {
      return statSync(fileURLToPath(this.uri)).size;
    }
    open() {
      const fd = openSync(fileURLToPath(this.uri), "r");
      return {
        readBytes(n: number) {
          state.chunkMax = Math.max(state.chunkMax, n);
          const b = Buffer.alloc(n);
          const got = readSync(fd, b);
          return b.subarray(0, got);
        },
        close() {
          closeSync(fd);
        },
      };
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: `file://${state.root}/`,
  getFreeDiskStorageAsync: async () => state.free,
  makeDirectoryAsync: async (uri: string) =>
    mkdirSync(fileURLToPath(uri), { recursive: true }),
  deleteAsync: async (uri: string) =>
    rmSync(fileURLToPath(uri), { force: true, recursive: true }),
  readDirectoryAsync: async (uri: string) => readdirSync(fileURLToPath(uri)),
  createDownloadResumable: (
    url: string,
    uri: string,
    options: { headers: Record<string, string> },
    progress: (v: { totalBytesWritten: number }) => void,
  ) => {
    let paused = false;
    return {
      pauseAsync: async () => {
        paused = true;
        state.aborts++;
      },
      downloadAsync: async () => {
        expect(options.headers.Authorization).toBe(
          "Bearer fictional-reader-token",
        );
        const id = new URL(url).pathname.split("/").at(-1)!;
        state.downloads.push(id);
        const fd = openSync(fileURLToPath(uri), "w");
        let written = 0;
        try {
          for await (const chunk of createReadStream(
            path.join(root, `source-${id}`),
            { highWaterMark: 16384 },
          )) {
            if (paused) return undefined;
            const { writeSync } = await import("node:fs");
            writeSync(fd, chunk);
            written += chunk.length;
            state.bytes += chunk.length;
            progress({ totalBytesWritten: written });
            if (state.delay)
              await new Promise((r) => setTimeout(r, state.delay));
          }
        } finally {
          closeSync(fd);
        }
        return { status: 200, uri };
      },
    };
  },
}));
const native = await import("../src/reading/native"),
  { ReadingError, downloadKey, ReadingDownloads } =
    await import("../src/reading/engine");
const credentials = {
  serverUrl: "https://fictional.example.test",
  token: "fictional-reader-token",
};
const photo = Buffer.alloc(1024 * 1024, 71),
  voice = Buffer.alloc(2 * 1024 * 1024, 83);
writeFileSync(path.join(root, "source-photo"), photo);
writeFileSync(path.join(root, "source-voice"), voice);
mkdirSync(path.join(root, "captures"));
mkdirSync(path.join(root, "outbox"));
writeFileSync(path.join(root, "captures", "only-original.jpg"), photo);
writeFileSync(
  path.join(root, "outbox", "pending.json"),
  '{"pending":"fictional"}',
);
let manifest: ReadingManifest,
  mode = 200,
  user = "fictional-user",
  family = "fictional-family";
const fixture = (): ReadingManifest => ({
  schemaVersion: 1,
  kind: "book",
  id: "fictional-book",
  revision: 1,
  digest: "a".repeat(64),
  userId: user,
  familyId: family,
  audience: "family",
  title: "虚构离线成长册",
  subtitle: "",
  timezone: "Asia/Shanghai",
  chapters: [{ id: "chapter", title: "第一周", blocks: [] }],
  media: [
    {
      id: "photo",
      type: "image",
      filename: "fictional.jpg",
      mimeType: "image/jpeg",
      bytes: photo.length,
      sha256: hash(photo),
      width: 100,
      height: 100,
      durationMs: null,
      author: null,
      dateLabel: "2024年1月1日",
      memoryEventId: null,
      transcript: null,
    },
    {
      id: "voice",
      type: "audio",
      filename: "fictional.wav",
      mimeType: "audio/wav",
      bytes: voice.length,
      sha256: hash(voice),
      width: null,
      height: null,
      durationMs: 60000,
      author: "虚构爸爸",
      dateLabel: "讲述于 2024年1月2日",
      memoryEventId: null,
      transcript: { text: "原话", edited: false, segments: [] },
    },
  ],
  bytes: photo.length + voice.length + 4096,
});
beforeEach(() => {
  mode = 200;
  state.delay = 0;
  state.downloads = [];
  state.free = 2 ** 32;
  manifest = fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (mode === 0) throw Error("network offline");
      return new Response(
        JSON.stringify(
          url.endsWith("/identity")
            ? { userId: user, familyId: family }
            : manifest,
        ),
        { status: mode, headers: { "content-type": "application/json" } },
      );
    }),
  );
});
afterAll(() => {
  (state.db as { close(): void })?.close();
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
it("streams, pauses, resumes only unfinished files, hashes bounded chunks, reopens SQLite progress and clears only the reader directory", async () => {
  const { scope } = await native.resolveReadingScope(credentials),
    transport = native.nativeReadingTransport(credentials, scope),
    entry = await native.readingDownloads.queue(scope, manifest, transport);
  state.delay = 1;
  const running = native.readingDownloads.resume(scope, entry.key, transport);
  await vi.waitFor(() => expect(state.downloads).toContain("voice"));
  await native.readingDownloads.pause(entry.key);
  await running;
  const paused = await native.nativeReadingStore.get(entry.key);
  expect(paused?.state).toBe("paused");
  expect(paused?.completed).toEqual(["photo"]);
  expect(state.aborts).toBeGreaterThan(0);
  state.delay = 0;
  await native.readingDownloads.resume(scope, entry.key, transport);
  expect(state.downloads.filter((id) => id === "photo")).toHaveLength(1);
  expect((await native.nativeReadingStore.get(entry.key))?.state).toBe("ready");
  expect(
    hash(
      readFileSync(
        fileURLToPath(native.readingFileUri(entry.key, manifest.media[1]!)),
      ),
    ),
  ).toBe(hash(voice));
  expect(state.chunkMax).toBe(65536);
  await native.readingDownloads.saveProgress(entry.key, {
    chapter: 0,
    page: 2,
    media: { voice: 12.5 },
  });
  const Database = createRequire(import.meta.url)("better-sqlite3"),
    reopened = new Database(path.join(root, "family-reader-cache.sqlite"));
  expect(
    JSON.parse(
      reopened
        .prepare("SELECT progress_json FROM reading_download WHERE key=?")
        .get(entry.key).progress_json,
    ).media.voice,
  ).toBe(12.5);
  reopened.close();
  mode = 0;
  expect(
    await new ReadingDownloads(native.nativeReadingStore).revalidate(
      scope,
      entry.key,
      transport,
    ),
  ).toBe("offline");
  expect((await native.resolveReadingScope(credentials)).scope.key).toBe(
    scope.key,
  );
  await native.clearReadingScope(scope, credentials);
  expect(await native.nativeReadingStore.get(entry.key)).toBeNull();
  expect(existsSync(path.join(root, "reader-downloads", entry.key))).toBe(
    false,
  );
  expect(
    hash(readFileSync(path.join(root, "captures", "only-original.jpg"))),
  ).toBe(hash(photo));
  expect(readFileSync(path.join(root, "outbox", "pending.json"), "utf8")).toBe(
    '{"pending":"fictional"}',
  );
});
it("separates servers, accounts and families; access denial removes cached files while network errors do not", async () => {
  const { scope } = await native.resolveReadingScope(credentials),
    transport = native.nativeReadingTransport(credentials, scope),
    e = await native.readingDownloads.queue(scope, manifest, transport);
  await native.readingDownloads.resume(scope, e.key, transport);
  const other = await native.resolveReadingScope({
    ...credentials,
    serverUrl: "https://second.example.test",
  });
  expect(other.scope.key).not.toBe(scope.key);
  expect(await native.nativeReadingStore.list(other.scope.key)).toEqual([]);
  const unknown = { ...credentials, token: "different-token" };
  await expect(
    native.resolveReadingScope(unknown, { offline: true }),
  ).rejects.toThrow("在线验证");
  mode = 503;
  await expect(
    native.readingDownloads.revalidate(scope, e.key, transport),
  ).rejects.toMatchObject({ status: 503 });
  expect(await native.nativeReadingStore.get(e.key)).not.toBeNull();
  mode = 403;
  const removed = vi.fn(),
    unsubscribe = native.readingDownloads.subscribe(removed);
  await expect(
    native.readingDownloads.revalidate(scope, e.key, transport),
  ).rejects.toMatchObject({ status: 403 });
  expect(removed).toHaveBeenCalledWith(e.key);
  unsubscribe();
  expect(existsSync(path.join(root, "reader-downloads", e.key))).toBe(false);
  mode = 200;
  await native.readingDownloads.queue(scope, manifest, transport);
  family = "another-family";
  const changed = await native.resolveReadingScope(credentials);
  expect(changed.scope.key).not.toBe(scope.key);
  expect(await native.nativeReadingStore.list(scope.key)).toEqual([]);
  family = "fictional-family";
});
it("enforces disk and reservation quotas, retries corrupt transfers and prevents simultaneous transfers", async () => {
  const { scope } = await native.resolveReadingScope(credentials),
    transport = native.nativeReadingTransport(credentials, scope);
  state.free = 1;
  await expect(
    native.readingDownloads.queue(scope, manifest, transport),
  ).rejects.toThrow("空间不足");
  state.free = 2 ** 32;
  await expect(
    native.readingDownloads.queue(
      scope,
      { ...manifest, bytes: 513 * 1024 * 1024 },
      transport,
    ),
  ).rejects.toThrow("配额已满");
  expect(await native.nativeReadingStore.list(scope.key)).toEqual([]);
  const entry = await native.readingDownloads.queue(scope, manifest, transport);
  writeFileSync(path.join(root, "source-photo"), Buffer.alloc(photo.length, 0));
  await expect(
    native.readingDownloads.resume(scope, entry.key, transport),
  ).rejects.toThrow("校验失败");
  expect((await native.nativeReadingStore.get(entry.key))?.state).toBe(
    "failed",
  );
  expect(
    existsSync(
      fileURLToPath(native.readingFileUri(entry.key, manifest.media[0]!)),
    ),
  ).toBe(false);
  writeFileSync(path.join(root, "source-photo"), photo);
  state.delay = 1;
  const results = await Promise.allSettled([
    native.readingDownloads.resume(scope, entry.key, transport),
    native.readingDownloads.resume(scope, entry.key, transport),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  manifest = { ...manifest, digest: "b".repeat(64) };
  await expect(
    native.readingDownloads.revalidate(scope, entry.key, transport),
  ).rejects.toBeInstanceOf(ReadingError);
  expect(await native.nativeReadingStore.get(entry.key)).toBeNull();
  expect(() => downloadKey(scope, "book", "../../outbox")).toThrow();
});


it("device erasure stops active downloads and clears every scope, binding and orphaned file", async () => {
  const { scope } = await native.resolveReadingScope(credentials);
  const transport = native.nativeReadingTransport(credentials, scope);
  const entry = await native.readingDownloads.queue(scope, manifest, transport);
  const other = await native.resolveReadingScope({ ...credentials, serverUrl: "https://other.example.test" });
  const otherEntry = await native.readingDownloads.queue(other.scope, manifest, transport);
  const orphan = path.join(root, "reader-downloads", "orphaned.partial");
  mkdirSync(path.dirname(orphan), { recursive: true });
  writeFileSync(orphan, "partial private media");
  state.delay = 2;
  const running = native.readingDownloads.resume(scope, entry.key, transport);
  while (!state.downloads.length) await new Promise((resolve) => setTimeout(resolve, 1));
  const removed = vi.fn();
  const unsubscribe = native.readingDownloads.subscribe(removed);
  const clearing = native.clearAllReadingDownloads();
  await expect(native.readingDownloads.queue(scope, manifest, transport)).rejects.toThrow("正在清理");
  await Promise.all([running, clearing]);
  unsubscribe();
  expect(state.aborts).toBeGreaterThan(0);
  expect(removed).toHaveBeenCalledWith(entry.key);
  expect(removed).toHaveBeenCalledWith(otherEntry.key);
  expect(await native.nativeReadingStore.list()).toEqual([]);
  expect(existsSync(path.join(root, "reader-downloads"))).toBe(false);
  await expect(native.resolveReadingScope(credentials, { offline: true })).rejects.toThrow("在线验证");
  await expect(native.resolveReadingScope({ ...credentials, serverUrl: "https://other.example.test" }, { offline: true })).rejects.toThrow("在线验证");
  // The reading layer leaves original erasure to the existing full-device flow.
  expect(existsSync(path.join(root, "captures", "only-original.jpg"))).toBe(true);
  await native.clearAllReadingDownloads();
  const fresh = await native.resolveReadingScope(credentials);
  expect((await native.readingDownloads.queue(fresh.scope, manifest, transport)).state).toBe("queued");
});

it("device erasure drains an in-flight identity response so it cannot restore a deleted binding", async () => {
  let complete!: () => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
    complete = () => resolve(Response.json({ userId: user, familyId: family }));
  })));
  const identity = native.resolveReadingScope(credentials);
  while (!complete) await new Promise((resolve) => setTimeout(resolve, 1));
  const clearing = native.clearAllReadingDownloads();
  complete();
  await Promise.allSettled([identity, clearing]);
  expect(await native.nativeReadingStore.list()).toEqual([]);
  await expect(native.resolveReadingScope(credentials, { offline: true })).rejects.toThrow("在线验证");
});
