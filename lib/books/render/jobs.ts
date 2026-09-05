import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bookRenderJob, bookRenderLease } from "@/db/schema/book-render-job";
import { asset } from "@/db/schema/asset";
import type { FamilyContext } from "@/lib/family/context";
import { getLiveFamilyPrincipal } from "@/lib/authz/principal";
import { getAssetStorage } from "@/lib/assets/storage";
import { DATA_DIR } from "@/lib/paths";
import {
  BookError,
  ensureBookRenderVersion,
  getBookProject,
  getBookVersion,
} from "../projects/service";
import { collectBookReadingMedia } from "../projects/media";
import {
  bookSourceTarget,
  createBookSourceResolver,
  sourceFingerprint,
} from "../projects/sources";
import {
  BOOK_RENDER_LIMITS as LIMIT,
  BOOK_TEMPLATE_VERSION,
  type BookRenderFormat,
  type RenderInput,
} from "./types";
export const RENDER_ROOT = path.join(DATA_DIR, "book-renders");
type Job = typeof bookRenderJob.$inferSelect;
function artifactPath(job: Job) {
  return path.join(
    RENDER_ROOT,
    job.familyId,
    `${job.id}-${job.attempt}.${job.format === "reading_zip" ? "zip" : job.format}`,
  );
}
function renderState(context: FamilyContext, id: string, revision: number, format: BookRenderFormat) {
  const book = getBookVersion(context, id, revision);
  if (book.blockedBlockIds.length)
    throw new BookError("source_unavailable", 409);
  const used = new Set(book.blocks.flatMap((b) => b.sourceIds));
  if (book.coverAssetId) {
    const cover = book.sources.find((s) => s.assetId === book.coverAssetId);
    if (!cover) throw new BookError("source_unavailable", 409);
    used.add(cover.id);
  }
  const resolver = createBookSourceResolver(context, book.audience);
  const fingerprints = [...used].sort().map((id) => {
    const ref = book.sources.find((s) => s.id === id);
    if (!ref) throw new BookError("source_unavailable", 409);
    const r = resolver(ref.kind, bookSourceTarget(ref));
    if (!r.state.available) throw new BookError("source_unavailable", 409);
    const state = {
      ...r.state,
      asset: r.state.asset ? { ...r.state.asset, previewAssetId: null } : null,
    };
    return [id, bookSourceTarget(ref), r.fingerprint, state];
  });
  return {
    book: {
      ...book,
      sources: book.sources.filter((s) => used.has(s.id)),
      sourceStates: Object.fromEntries(
        Object.entries(book.sourceStates).filter(([id]) => used.has(id)),
      ),
    },
    digest: sourceFingerprint([
      book.id,
      revision,
      book.audience,
      book.timezone,
      book.coverAssetId,
      fingerprints,
      format === "reading_zip" ? collectBookReadingMedia(context, book).map(m=>[m.asset.id,m.fingerprint,m.state]) : null,
    ]),
  };
}
function authorizeJob(context: FamilyContext, id: string) {
  const row = getDb()
    .select()
    .from(bookRenderJob)
    .where(
      and(
        eq(bookRenderJob.id, id),
        eq(bookRenderJob.familyId, context.familyId),
      ),
    )
    .get();
  if (!row) throw new BookError("not_found", 404);
  getBookProject(context, row.projectId);
  return row;
}
function status(context: FamilyContext, row: Job) {
  let downloadable = false;
  if (row.status === "succeeded") {
    try {
      downloadable =
        row.templateVersion === BOOK_TEMPLATE_VERSION &&
        renderState(context, row.projectId, row.revision, row.format).digest ===
        row.sourceDigest;
    } catch {
      /* Live sources can be unavailable. */
    }
  }
  return {
    id: row.id,
    projectId: row.projectId,
    revision: row.revision,
    format: row.format,
    audience: row.audience,
    status: row.status,
    progress: row.progress,
    pages: row.pages,
    bytes: row.bytes,
    sha256: row.sha256,
    errorCode: row.errorCode,
    downloadable,
    updatedAt: row.updatedAt.toISOString(),
  };
}
export function listBookRenders(context: FamilyContext, id: string) {
  getBookProject(context, id);
  return getDb()
    .select()
    .from(bookRenderJob)
    .where(
      and(
        eq(bookRenderJob.projectId, id),
        eq(bookRenderJob.familyId, context.familyId),
      ),
    )
    .orderBy(desc(bookRenderJob.createdAt), desc(bookRenderJob.id))
    .limit(30)
    .all()
    .map((row) => status(context, row));
}
export function getBookRender(context: FamilyContext, id: string) {
  return status(context, authorizeJob(context, id));
}
export function requestBookRender(
  context: FamilyContext,
  id: string,
  revision: number,
  format: BookRenderFormat,
) {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !["pdf", "epub", "reading_zip"].includes(format)
  )
    throw new BookError("invalid_render");
  return getDb().transaction((tx) => {
    ensureBookRenderVersion(context, id, revision);
    const { book, digest } = renderState(context, id, revision, format);
    const key = sourceFingerprint([
      id,
      revision,
      BOOK_TEMPLATE_VERSION,
      format,
      book.audience,
      book.audience === "personal" ? context.personId : null,
      digest,
    ]);
    const prior = tx
      .select()
      .from(bookRenderJob)
      .where(
        and(
          eq(bookRenderJob.familyId, context.familyId),
          eq(bookRenderJob.idempotencyKey, key),
        ),
      )
      .get();
    if (prior) return status(context, prior);
    const pending = tx.get<{ n: number; family: number }>(
      sql`select count(*) n,coalesce(sum(case when family_id=${context.familyId} then 1 else 0 end),0) family from book_render_job where status in ('queued','running')`,
    )!;
    if (pending.n >= 100 || pending.family >= 20)
      throw new BookError("render_queue_full", 429);
    const jobId = randomUUID();
    tx.insert(bookRenderJob)
      .values({
        id: jobId,
        familyId: context.familyId,
        projectId: id,
        requestedByUserId: context.userId,
        revision,
        templateVersion: BOOK_TEMPLATE_VERSION,
        format,
        audience: book.audience,
        idempotencyKey: key,
        sourceDigest: digest,
      })
      .run();
    return status(context, authorizeJob(context, jobId));
  });
}
export async function changeBookRender(
  context: FamilyContext,
  id: string,
  operation: "cancel" | "retry" | "remove",
) {
  const row = authorizeJob(context, id);
  // Family readers may download; only the requester or a book editor controls a job.
  if (
    row.requestedByUserId !== context.userId &&
    !getBookProject(context, row.projectId).canWrite
  )
    throw new BookError("forbidden", 403);
  if (operation === "retry") {
    if (
      (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) ||
      !["failed", "cancelled"].includes(row.status)
    )
      throw new BookError("invalid_job_state", 409);
    if (
      row.templateVersion !== BOOK_TEMPLATE_VERSION ||
      renderState(context, row.projectId, row.revision, row.format).digest !==
        row.sourceDigest
    )
      throw new BookError("source_changed", 409);
    const pending = getDb().get<{ n: number; family: number }>(
      sql`select count(*) n,coalesce(sum(case when family_id=${context.familyId} then 1 else 0 end),0) family from book_render_job where status in ('queued','running')`,
    )!;
    if (pending.n >= 100 || pending.family >= 20)
      throw new BookError("render_queue_full", 429);
    getDb()
      .update(bookRenderJob)
      .set({
        status: "queued",
        progress: 0,
        errorCode: null,
        requestedByUserId: context.userId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(bookRenderJob.id, id), eq(bookRenderJob.status, row.status)),
      )
      .run();
  } else if (operation === "cancel" || operation === "remove") {
    if (operation === "cancel" && !["queued", "running"].includes(row.status))
      throw new BookError("invalid_job_state", 409);
    getDb()
      .update(bookRenderJob)
      .set({ status: "cancelled", errorCode: null, updatedAt: new Date() })
      .where(eq(bookRenderJob.id, id))
      .run();
    if (operation === "remove") {
      await rm(artifactPath(row), { force: true });
      getDb()
        .update(bookRenderJob)
        .set({ bytes: null, sha256: null, pages: null })
        .where(eq(bookRenderJob.id, id))
        .run();
    }
  } else throw new BookError("invalid_operation");
  return getBookRender(context, id);
}
export async function readableBookArtifact(context: FamilyContext, id: string) {
  const row = authorizeJob(context, id);
  if (row.status !== "succeeded") throw new BookError("render_not_ready", 409);
  if (
    row.templateVersion !== BOOK_TEMPLATE_VERSION ||
    renderState(context, row.projectId, row.revision, row.format).digest !==
      row.sourceDigest
  )
    throw new BookError("source_changed", 409);
  const file = artifactPath(row),
    info = await stat(file).catch(() => null);
  if (!info || info.size !== row.bytes)
    throw new BookError("render_missing", 410);
  return {
    row,
    path: file,
    title: getBookVersion(context, row.projectId, row.revision).title,
  };
}
async function buildInput(
  context: FamilyContext,
  row: Job,
): Promise<RenderInput> {
  const state = renderState(context, row.projectId, row.revision, row.format);
  if (
    state.digest !== row.sourceDigest ||
    row.templateVersion !== BOOK_TEMPLATE_VERSION
  )
    throw new BookError("source_changed", 409);
  const images: RenderInput["images"] = {};
  for (const source of Object.values(state.book.sourceStates)) {
    if (source.asset?.type !== "image") continue;
    const a = getDb()
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.id, source.asset.id),
          eq(asset.familyId, context.familyId),
        ),
      )
      .get();
    if (!a || a.originalAssetId) throw new BookError("source_unavailable", 409);
    images[a.id] = {
      path: getAssetStorage().resolvePath(a.storageKey),
      bytes: a.bytes,
      width: a.width,
      height: a.height,
    };
  }
  return {
    book: state.book,
    images,
    media: row.format === "reading_zip" ? collectBookReadingMedia(context,state.book).map(m=>({id:m.asset.id,path:getAssetStorage().resolvePath(m.asset.storageKey),bytes:m.asset.bytes,type:m.asset.type,mimeType:m.asset.mimeType,filename:m.asset.originalFilename,label:m.state.label})) : [],
    format: row.format,
    fontPath: path.join(
      process.cwd(),
      "resources",
      "fonts",
      "NotoSansCJKsc-Regular.otf",
    ),
  };
}
async function runChild(
  job: Job | null,
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
) {
  const candidates = [
    path.join(process.cwd(), "ops", "render-book.mjs"),
    ...(process.argv[1]?.endsWith("worker.mjs")
      ? [path.join(path.dirname(process.argv[1]), "render-book.mjs")]
      : []),
    ...(process.env.NODE_ENV === "production"
      ? [path.join(process.cwd(), ".next", "ops", "render-book.mjs")]
      : []),
  ];
  const bundled = candidates.find((file) => existsSync(file)),
    dev = path.join(process.cwd(), "scripts", "render-book.mts");
  const args = bundled
    ? ["--max-old-space-size=384", bundled, inputPath, outputPath]
    : [
        "--max-old-space-size=384",
        "--import",
        "tsx",
        "--conditions=react-server",
        dev,
        inputPath,
        outputPath,
      ];
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, UV_THREADPOOL_SIZE: "1" },
  });
  let buffer = "",
    errorCode = "",
    pages = 0,
    progress = 0,
    complete = false,
    stderrBytes = 0,
    checking = false;
  function stop(code: string) {
    if (!errorCode) errorCode = code;
    child.kill("SIGKILL");
  }
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 4096) {
      stop("invalid_worker_output");
      return;
    }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const result = JSON.parse(line);
        if (result.error) errorCode = String(result.error).slice(0, 100);
        if (Number.isSafeInteger(result.pages)) pages = result.pages;
        if (result.complete) complete = true;
        if (job && Number.isSafeInteger(result.progress)) {
          progress = Math.min(95, Math.max(progress, result.progress));
          getDb()
            .update(bookRenderJob)
            .set({
              progress,
              pages,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(bookRenderJob.id, job.id),
                eq(bookRenderJob.status, "running"),
                eq(bookRenderJob.attempt, job.attempt),
              ),
            )
            .run();
        }
      } catch {
        stop("invalid_worker_output");
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 8192) stop("invalid_worker_output");
  });
  const abort = () => stop("worker_interrupted");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => stop("render_timeout"),
    Math.max(
      1,
      Math.min(
        LIMIT.timeoutMs,
        (compatibilityScope.getStore()?.deadline ??
          Date.now() + LIMIT.timeoutMs) - Date.now(),
      ),
    ),
  );
  const monitor = setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      if (job) {
        const live = getDb()
          .select()
          .from(bookRenderJob)
          .where(eq(bookRenderJob.id, job.id))
          .get();
        if (!live || live.status !== "running" || live.attempt !== job.attempt)
          stop("cancelled");
      }
      const file = await stat(outputPath).catch(() => null);
      if (file && file.size > LIMIT.outputBytes) stop("output_limit_exceeded");
    })()
      .catch(() => stop("worker_interrupted"))
      .finally(() => {
        checking = false;
      });
  }, 150);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0 || !complete || errorCode)
      throw new Error(errorCode || "render_failed");
    return pages;
  } finally {
    clearTimeout(timeout);
    clearInterval(monitor);
    signal?.removeEventListener("abort", abort);
  }
}
let lastCleanup = 0;
async function cleanupRenderFiles() {
  if (Date.now() - lastCleanup < 60000) return;
  lastCleanup = Date.now();
  for (const entry of await readdir(RENDER_ROOT, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(RENDER_ROOT, entry.name);
    if (entry.name.startsWith("work-")) {
      const info = await stat(dir).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LIMIT.leaseMs)
        await rm(dir, { recursive: true, force: true });
      continue;
    }
    for (const name of await readdir(dir).catch(() => [])) {
      const match = /^([0-9a-f-]{36})-(\d+)\.(pdf|epub|zip)$/.exec(name);
      if (!match) continue;
      const row = getDb()
        .select()
        .from(bookRenderJob)
        .where(
          and(
            eq(bookRenderJob.id, match[1]!),
            eq(bookRenderJob.familyId, entry.name),
          ),
        )
        .get();
      if (
        row &&
        row.attempt === Number(match[2]) &&
        (row.status === "succeeded" ||
          (row.status === "running" &&
            row.leaseUntil &&
            row.leaseUntil.getTime() > Date.now()))
      )
        continue;
      const file = path.join(dir, name),
        info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LIMIT.leaseMs)
        await rm(file, { force: true });
    }
  }
}
export async function runBookWorkerOnce(
  options: { signal?: AbortSignal } = {},
) {
  const db = getDb(),
    now = new Date();
  await cleanupRenderFiles();
  const job = db.transaction((tx) => {
    tx.update(bookRenderJob)
      .set({
        status: "failed",
        errorCode: "worker_interrupted",
        leaseUntil: null,
        updatedAt: now,
      })
      .where(
        sql`status='running' and lease_until<${Math.floor(now.getTime() / 1000)}`,
      )
      .run();
    if (
      tx
        .select()
        .from(bookRenderJob)
        .where(
          sql`status='running' or (status='cancelled' and lease_until>${Math.floor(now.getTime() / 1000)})`,
        )
        .get()
    )
      return null;
    const queued = tx
      .select()
      .from(bookRenderJob)
      .where(eq(bookRenderJob.status, "queued"))
      .orderBy(asc(bookRenderJob.createdAt), asc(bookRenderJob.id))
      .limit(1)
      .get();
    if (!queued) return null;
    const attempt = queued.attempt + 1;
    if (!acquirePermit(`${queued.id}-${attempt}`)) return null;
    tx.update(bookRenderJob)
      .set({
        status: "running",
        attempt,
        progress: 1,
        leaseUntil: new Date(now.getTime() + LIMIT.leaseMs),
        updatedAt: now,
      })
      .where(eq(bookRenderJob.id, queued.id))
      .run();
    return { ...queued, status: "running" as const, attempt };
  });
  if (!job) return "idle";
  let work: string | null = null,
    published: string | null = null;
  try {
    if (!job.requestedByUserId) throw new Error("requester_unavailable");
    const context = {
      ...(await getLiveFamilyPrincipal(job.requestedByUserId, job.familyId)),
      userName: "",
    };
    const input = await buildInput(context, job);
    await mkdir(RENDER_ROOT, { recursive: true });
    work = await mkdtemp(path.join(RENDER_ROOT, "work-"));
    const payload = JSON.stringify(input);
    if (Buffer.byteLength(payload) > 4 * 1024 * 1024)
      throw new Error("book_too_large");
    const inputPath = path.join(work, "input.json"),
      outputPath = path.join(work, "output");
    await writeFile(inputPath, payload, { mode: 0o600 });
    const pages = await runChild(job, inputPath, outputPath, options.signal),
      info = await stat(outputPath);
    if (info.size > LIMIT.outputBytes) throw new Error("output_limit_exceeded");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(outputPath)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const live = {
      ...(await getLiveFamilyPrincipal(job.requestedByUserId, job.familyId)),
      userName: "",
    };
    if (
      renderState(live, job.projectId, job.revision, job.format).digest !== job.sourceDigest
    )
      throw new Error("source_changed");
    const file = artifactPath(job);
    await mkdir(path.dirname(file), { recursive: true });
    await rename(outputPath, file);
    published = file;
    db.transaction((tx) => {
      const current = tx
        .select()
        .from(bookRenderJob)
        .where(eq(bookRenderJob.id, job.id))
        .get();
      if (
        !current ||
        current.status !== "running" ||
        current.attempt !== job.attempt ||
        !current.leaseUntil ||
        current.leaseUntil.getTime() < Date.now() ||
        options.signal?.aborted
      )
        throw new Error("worker_interrupted");
      if (
        renderState(live, job.projectId, job.revision, job.format).digest !==
        job.sourceDigest
      )
        throw new Error("source_changed");
      const used = tx.get<{ bytes: number }>(
        sql`select coalesce(sum(bytes),0) bytes from book_render_job where family_id=${job.familyId}`,
      )!.bytes;
      if (used + info.size > LIMIT.familyBytes)
        throw new Error("render_quota_exceeded");
      tx.update(bookRenderJob)
        .set({
          status: "succeeded",
          progress: 100,
          pages,
          bytes: info.size,
          sha256,
          errorCode: null,
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(bookRenderJob.id, job.id))
        .run();
    });
    published = null;
    return "succeeded";
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const code = /^[a-z_]+(?:_U[0-9A-F]+)?$/.test(message)
      ? message
      : "render_failed";
    db.update(bookRenderJob)
      .set({
        status: "failed",
        errorCode: code,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookRenderJob.id, job.id),
          eq(bookRenderJob.status, "running"),
          eq(bookRenderJob.attempt, job.attempt),
        ),
      )
      .run();
    return "failed";
  } finally {
    releasePermit(`${job.id}-${job.attempt}`);
    if (published) await rm(published, { force: true });
    if (work) await rm(work, { recursive: true, force: true });
    db.update(bookRenderJob)
      .set({ leaseUntil: null })
      .where(
        and(
          eq(bookRenderJob.id, job.id),
          eq(bookRenderJob.attempt, job.attempt),
          sql`status!='running'`,
        ),
      )
      .run();
  }
}
export async function runBookWorkerLoop(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      await runBookWorkerOnce({ signal });
    } catch {
      /* A temporary queue failure must not stop uploads or the other workers. */
    }
    await delay(1500, undefined, { signal }).catch(() => {});
  }
}

function acquirePermit(token: string) {
  return getDb().transaction((tx) => {
    const row = tx
      .select()
      .from(bookRenderLease)
      .where(eq(bookRenderLease.id, 1))
      .get();
    if (row && row.expiresAt.getTime() > Date.now()) return false;
    tx.insert(bookRenderLease)
      .values({ id: 1, token, expiresAt: new Date(Date.now() + LIMIT.leaseMs) })
      .onConflictDoUpdate({
        target: bookRenderLease.id,
        set: { token, expiresAt: new Date(Date.now() + LIMIT.leaseMs) },
      })
      .run();
    return true;
  });
}
function releasePermit(token: string) {
  getDb().delete(bookRenderLease).where(eq(bookRenderLease.token, token)).run();
}

const compatibilityScope = new AsyncLocalStorage<{
  token: string;
  deadline: number;
}>();
export function assertCompatibilityRenderBudget() {
  const scope = compatibilityScope.getStore();
  if (scope && Date.now() > scope.deadline)
    throw new BookError("render_timeout", 503);
}
export async function withCompatibilityRender<T>(
  fn: () => Promise<T>,
): Promise<T> {
  if (compatibilityScope.getStore()) return fn();
  const token = randomUUID();
  if (!acquirePermit(token)) throw new BookError("render_busy", 429);
  try {
    return await compatibilityScope.run(
      { token, deadline: Date.now() + LIMIT.timeoutMs },
      fn,
    );
  } finally {
    releasePermit(token);
  }
}
async function legacyOutput(value: unknown): Promise<Buffer> {
  return withCompatibilityRender(async () => {
    let dir: string | null = null;
    try {
      assertCompatibilityRenderBudget();
      const payload = JSON.stringify(value);
      if (Buffer.byteLength(payload) > 24 * 1024 * 1024)
        throw new BookError("book_too_large", 400);
      await mkdir(RENDER_ROOT, { recursive: true });
      dir = await mkdtemp(path.join(RENDER_ROOT, "work-"));
      const input = path.join(dir, "input.json"),
        output = path.join(dir, "output");
      await writeFile(input, payload, { mode: 0o600 });
      await runChild(null, input, output);
      const info = await stat(output);
      if (info.size > LIMIT.outputBytes)
        throw new BookError("output_limit_exceeded");
      return await readFile(output);
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });
}
export function renderLegacyPdfIsolated(
  pages: import("../pdf").PdfPageInput[],
) {
  return legacyOutput({
    kind: "legacy_pdf",
    pages,
    fontPath: path.join(
      process.cwd(),
      "resources",
      "fonts",
      "NotoSansCJKsc-Regular.otf",
    ),
  });
}
export function renderLegacyEpubIsolated(
  book: import("../epub").EpubBook,
  uuid: string,
) {
  return legacyOutput({ kind: "legacy_epub", book, uuid });
}
