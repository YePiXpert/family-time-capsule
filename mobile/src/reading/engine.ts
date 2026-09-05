import {
  READING_LIMITS,
  type ReadingKind,
  type ReadingManifest,
} from "./types";
export type ReadingScope = {
  key: string;
  serverUrl: string;
  userId: string;
  familyId: string;
};
export type ReadingProgress = {
  chapter: number;
  page: number;
  media: Record<string, number>;
};
export type DownloadState =
  "queued" | "downloading" | "paused" | "ready" | "failed";
export type DownloadSummary = {
  key: string;
  scope: string;
  kind: ReadingKind;
  id: string;
  title: string;
  state: DownloadState;
  reservedBytes: number;
  storedBytes: number;
  error: string | null;
  updatedAt: number;
};
export type DownloadEntry = DownloadSummary & {
  manifest: ReadingManifest;
  completed: string[];
  progress: ReadingProgress;
};
export interface ReadingStore {
  get(key: string): Promise<DownloadEntry | null>;
  list(scope?: string): Promise<DownloadSummary[]>;
  reserve(entry: DownloadEntry): Promise<void>;
  save(entry: DownloadEntry): Promise<void>;
  remove(key: string): Promise<void>;
  progress(key: string, value: ReadingProgress): Promise<void>;
}
export interface ReadingTransport {
  manifest(kind: ReadingKind, id: string): Promise<ReadingManifest>;
  download(
    manifest: ReadingManifest,
    assetId: string,
    key: string,
    progress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  verify(
    key: string,
    assetId: string,
    bytes: number,
    sha256: string,
  ): Promise<boolean>;
  removeFile(key: string, assetId: string): Promise<void>;
  removeDirectory(key: string): Promise<void>;
}
export class ReadingError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
const safeId = /^[a-zA-Z0-9_-]{1,128}$/;
export function validateReadingManifest(value: unknown): ReadingManifest {
  const m = value as ReadingManifest;
  if (
    !m ||
    m.schemaVersion !== 1 ||
    !["book", "collection"].includes(m.kind) ||
    !safeId.test(m.id) ||
    !safeId.test(m.userId) ||
    !safeId.test(m.familyId) ||
    !/^[a-f0-9]{64}$/.test(m.digest) ||
    !Number.isSafeInteger(m.revision) ||
    m.revision < 1 ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes < 0 ||
    !Array.isArray(m.chapters) ||
    m.chapters.length > 51 ||
    !Array.isArray(m.media) ||
    m.media.length > READING_LIMITS.files ||
    typeof m.title !== "string" ||
    m.title.length > 500 ||
    typeof m.subtitle !== "string" ||
    typeof m.timezone !== "string" ||
    !["family", "personal"].includes(m.audience)
  )
    throw new ReadingError("阅读清单无效。", 502);
  const ids = new Set<string>();
  let mediaBytes = 0;
  for (const a of m.media) {
    if (
      !a ||
      !safeId.test(a.id) ||
      ids.has(a.id) ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      typeof a.filename !== "string" ||
      typeof a.mimeType !== "string" ||
      !["image", "audio", "video", "document"].includes(a.type) ||
      typeof a.dateLabel !== "string" ||
      !(a.author === null || typeof a.author === "string") ||
      (a.transcript !== null &&
        (!a.transcript ||
          typeof a.transcript.text !== "string" ||
          typeof a.transcript.edited !== "boolean" ||
          !Array.isArray(a.transcript.segments) ||
          a.transcript.segments.length > 10000 ||
          a.transcript.segments.some(
            (s) =>
              !s ||
              typeof s.text !== "string" ||
              !Number.isFinite(s.startSeconds) ||
              !Number.isFinite(s.endSeconds) ||
              s.startSeconds < 0 ||
              s.endSeconds < s.startSeconds,
          )))
    )
      throw new ReadingError("媒体清单无效。", 502);
    ids.add(a.id);
    mediaBytes += a.bytes;
  }
  let blocks = 0;
  for (const c of m.chapters) {
    if (
      !c ||
      !safeId.test(c.id) ||
      typeof c.title !== "string" ||
      !Array.isArray(c.blocks)
    )
      throw new ReadingError("阅读章节无效。", 502);
    for (const b of c.blocks) {
      if (
        ++blocks > 1001 ||
        !b ||
        !safeId.test(b.id) ||
        !["text", "image", "double", "collage", "quote", "date"].includes(
          b.kind,
        ) ||
        typeof b.dateLabel !== "string" ||
        !(b.author === null || typeof b.author === "string") ||
        !(b.memoryEventId === null || safeId.test(b.memoryEventId)) ||
        typeof b.text !== "string" ||
        typeof b.caption !== "string" ||
        !Array.isArray(b.images) ||
        b.images.some(
          (id) =>
            !ids.has(id) ||
            !m.media.some((a) => a.id === id && a.type === "image"),
        ) ||
        !Array.isArray(b.sourceLabels) ||
        b.sourceLabels.some((s) => typeof s !== "string") ||
        !b.layout ||
        !["contain", "cover"].includes(b.layout.fit) ||
        typeof b.layout.breakBefore !== "boolean" ||
        !Array.isArray(b.layout.focus) ||
        b.layout.focus.length > 4 ||
        b.layout.focus.some(
          (f) =>
            !f ||
            !Number.isFinite(f.x) ||
            !Number.isFinite(f.y) ||
            f.x < 0 ||
            f.x > 1 ||
            f.y < 0 ||
            f.y > 1,
        )
      )
        throw new ReadingError("阅读内容无效。", 502);
    }
  }
  if (
    mediaBytes > m.bytes ||
    JSON.stringify(m).length > READING_LIMITS.metadataBytes
  )
    throw new ReadingError("阅读清单超过容量限制。", 502);
  return m;
}
export function downloadKey(
  scope: ReadingScope,
  kind: ReadingKind,
  id: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(scope.key) ||
    !safeId.test(id) ||
    !["book", "collection"].includes(kind)
  )
    throw new ReadingError("阅读路径无效。");
  return `${scope.key}/${kind}-${id}`;
}
function checkScope(scope: ReadingScope, m: ReadingManifest) {
  if (m.familyId !== scope.familyId || m.userId !== scope.userId)
    throw new ReadingError("服务器账号或家庭已变化，请重新连接。", 403);
}
const revoked = (e: unknown) =>
  e instanceof ReadingError && [401, 403, 404, 409].includes(e.status);
/** One bounded transfer; pauses resume from verified completed files, never persist auth headers/resume blobs. */
export class ReadingDownloads {
  private active: {
    key: string;
    controller: AbortController;
    done: Promise<void>;
  } | null = null;
  private listeners = new Set<(removedKey?: string) => void>();
  private liveBytes = 0;
  private resetting = false;
  private operations = new Set<Promise<unknown>>();

  /** Serialize device-wide erasure against every in-flight cache operation. */
  withCacheOperation<T>(fn: () => Promise<T>): Promise<T> {
    if (this.resetting)
      return Promise.reject(new ReadingError("正在清理本机阅读数据，请稍后重试。"));
    const work = Promise.resolve().then(() => {
      if (this.resetting) throw new ReadingError("正在清理本机阅读数据，请稍后重试。");
      return fn();
    });
    this.operations.add(work);
    return work.finally(() => { this.operations.delete(work); });
  }

  async clearAll(cleanup: () => Promise<void>): Promise<void> {
    if (this.resetting) throw new ReadingError("正在清理本机阅读数据，请稍后重试。");
    this.resetting = true;
    try {
      this.active?.controller.abort();
      await Promise.allSettled([...this.operations]);
      const entries = await this.store.list();
      await cleanup();
      entries.forEach((entry) => this.emit(entry.key));
      this.emit();
    } finally {
      this.resetting = false;
    }
  }

  queue(scope: ReadingScope, manifest: ReadingManifest, transport: ReadingTransport) {
    return this.withCacheOperation(() => this.queueEntry(scope, manifest, transport));
  }
  pause(key: string) {
    return this.withCacheOperation(() => this.pauseEntry(key));
  }
  remove(key: string, transport: ReadingTransport) {
    return this.withCacheOperation(() => this.removeEntry(key, transport));
  }
  resume(scope: ReadingScope, key: string, transport: ReadingTransport) {
    return this.withCacheOperation(() => this.resumeEntry(scope, key, transport));
  }
  revalidate(scope: ReadingScope, key: string, transport: ReadingTransport) {
    return this.withCacheOperation(() => this.revalidateEntry(scope, key, transport));
  }
  saveProgress(key: string, value: ReadingProgress) {
    return this.withCacheOperation(() => this.saveEntryProgress(key, value));
  }
  constructor(readonly store: ReadingStore) {}
  subscribe(fn: (removedKey?: string) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(removedKey?: string) {
    this.listeners.forEach((fn) => fn(removedKey));
  }
  transferProgress(key: string) {
    return this.active?.key === key ? this.liveBytes : 0;
  }
  private async queueEntry(
    scope: ReadingScope,
    manifest: ReadingManifest,
    transport: ReadingTransport,
  ) {
    const m = validateReadingManifest(manifest);
    checkScope(scope, m);
    const key = downloadKey(scope, m.kind, m.id),
      old = await this.store.get(key);
    if (old?.manifest.digest === m.digest) return old;
    if (old) await this.remove(key, transport);
    const entry: DownloadEntry = {
      key,
      scope: scope.key,
      kind: m.kind,
      id: m.id,
      title: m.title,
      state: "queued",
      reservedBytes: m.bytes,
      storedBytes: 0,
      error: null,
      updatedAt: Date.now(),
      manifest: m,
      completed: [],
      progress: { chapter: 0, page: 0, media: {} },
    };
    await this.store.reserve(entry);
    this.emit();
    return entry;
  }
  private async pauseEntry(key: string) {
    if (this.active?.key === key) {
      this.active.controller.abort();
      await this.active.done;
    } else {
      const e = await this.store.get(key);
      if (e && e.state !== "ready") {
        await this.store.save({ ...e, state: "paused", updatedAt: Date.now() });
        this.emit();
      }
    }
  }
  private async removeEntry(key: string, transport: ReadingTransport) {
    if (this.active?.key === key) await this.pause(key);
    await transport.removeDirectory(key);
    await this.store.remove(key);
    this.emit(key);
  }
  private async resumeEntry(scope: ReadingScope, key: string, transport: ReadingTransport) {
    if (this.active)
      throw new ReadingError("另一份阅读内容正在下载，请先暂停它。");
    const entry = await this.store.get(key);
    if (!entry || entry.scope !== scope.key)
      throw new ReadingError("下载不存在。", 404);
    if (this.active)
      throw new ReadingError("另一份阅读内容正在下载，请先暂停它。");
    if (this.resetting) throw new ReadingError("正在清理本机阅读数据，请稍后重试。");
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active = { key, controller, done };
    this.liveBytes = 0;
    try {
      const remote = validateReadingManifest(
        await transport.manifest(entry.kind, entry.id),
      );
      checkScope(scope, remote);
      if (remote.digest !== entry.manifest.digest)
        throw new ReadingError("作品或来源已有变化，请重新下载。", 409);
      entry.state = "downloading";
      entry.error = null;
      await this.store.save(entry);
      this.emit();
      for (const file of entry.manifest.media) {
        if (controller.signal.aborted) break;
        if (
          entry.completed.includes(file.id) &&
          (await transport.verify(key, file.id, file.bytes, file.sha256))
        )
          continue;
        entry.completed = entry.completed.filter((id) => id !== file.id);
        await transport.removeFile(key, file.id);
        this.liveBytes = 0;
        await transport.download(
          entry.manifest,
          file.id,
          key,
          (bytes) => {
            this.liveBytes = bytes;
            this.emit();
          },
          controller.signal,
        );
        if (controller.signal.aborted) {
          await transport.removeFile(key, file.id);
          break;
        }
        if (!(await transport.verify(key, file.id, file.bytes, file.sha256))) {
          await transport.removeFile(key, file.id);
          throw new ReadingError("下载校验失败，请重试。");
        }
        entry.completed.push(file.id);
        entry.storedBytes = entry.manifest.media
          .filter((m) => entry.completed.includes(m.id))
          .reduce((n, m) => n + m.bytes, 0);
        entry.updatedAt = Date.now();
        this.liveBytes = 0;
        await this.store.save(entry);
        this.emit();
      }
      if (controller.signal.aborted) entry.state = "paused";
      else {
        const final = validateReadingManifest(
          await transport.manifest(entry.kind, entry.id),
        );
        checkScope(scope, final);
        if (final.digest !== entry.manifest.digest)
          throw new ReadingError("来源变化，已撤下旧阅读缓存。", 409);
        entry.state = "ready";
      }
      await this.store.save(entry);
    } catch (e) {
      if (revoked(e)) {
        await transport.removeDirectory(key);
        await this.store.remove(key);
        this.emit(key);
        throw e;
      }
      entry.state = controller.signal.aborted ? "paused" : "failed";
      entry.error = controller.signal.aborted ? null : (e as Error).message;
      entry.updatedAt = Date.now();
      await this.store.save(entry);
      if (!controller.signal.aborted) throw e;
    } finally {
      this.active = null;
      this.liveBytes = 0;
      this.emit();
      finish();
    }
  }
  private async revalidateEntry(
    scope: ReadingScope,
    key: string,
    transport: ReadingTransport,
  ): Promise<"online" | "offline"> {
    const entry = await this.store.get(key);
    if (!entry || entry.scope !== scope.key)
      throw new ReadingError("下载不存在。", 404);
    try {
      const live = validateReadingManifest(
        await transport.manifest(entry.kind, entry.id),
      );
      checkScope(scope, live);
      if (live.digest !== entry.manifest.digest)
        throw new ReadingError(
          "作品或来源变化，已撤下旧缓存，请重新下载。",
          409,
        );
      return "online";
    } catch (e) {
      if (revoked(e)) {
        await this.remove(key, transport);
        throw e;
      }
      if (e instanceof ReadingError && e.status === 0) return "offline";
      throw e;
    }
  }
  private async saveEntryProgress(key: string, value: ReadingProgress) {
    if (
      !Number.isSafeInteger(value.chapter) ||
      value.chapter < 0 ||
      !Number.isSafeInteger(value.page) ||
      value.page < 0
    )
      return;
    const media = Object.fromEntries(
      Object.entries(value.media)
        .filter(([id, n]) => safeId.test(id) && Number.isFinite(n) && n >= 0)
        .slice(0, READING_LIMITS.files),
    );
    await this.store.progress(key, {
      chapter: value.chapter,
      page: value.page,
      media,
    });
  }
}
