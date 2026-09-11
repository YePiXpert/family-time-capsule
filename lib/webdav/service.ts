import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { backupRun, type BackupRunRow } from "@/db/schema/backup";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { buildActorExport } from "@/lib/export/service";
import type { FamilyContext } from "@/lib/family/context";

/**
 * WebDAV BackupTarget 服务（M6）。
 *
 * - 凭据只从 env 读取（WEBDAV_URL/WEBDAV_USERNAME/WEBDAV_PASSWORD），
 *   任何日志/导出/客户端输出都只包含 host 与 path，绝不含用户名密码；
 * - SSRF 边界：仅允许 https，或显式 loopback http（本地测试/同机 NAS）；
 *   不跟随重定向；URL 解析后强制重新序列化防混淆；
 * - 流程：verified export → PUT 临时文件 → GET 回读校验 SHA-256 →
 *   MOVE 原子改名；仅在 MOVE 不支持时降级直传。最终路径回读验证后才成功。
 * - 这是当前账号可导出的档案副本；全实例灾备使用宿主机 ftc backup。
 */

export type WebDavTargetConfig = {
  baseUrl: string;
  username: string;
  password: string;
  remoteDirectory: string;
};

export type TargetResolution =
  | { ok: true; config: WebDavTargetConfig; hostLabel: string }
  | { ok: false; error: "not_configured" | "unsafe_url" };

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    (isIP(host) === 4 && host.startsWith("127."))
  );
}

/** 解析 env 目标配置；URL 安全校验在此时完成（每次运行重新读取 env）。 */
export function resolveWebDavTarget(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): TargetResolution {
  const rawUrl = (env.WEBDAV_URL ?? "").trim();
  const username = (env.WEBDAV_USERNAME ?? "").trim();
  const password = env.WEBDAV_PASSWORD ?? "";
  const remoteDirectory = (env.WEBDAV_DIRECTORY ?? "/family-time-capsule").replace(/\/+$/u, "");
  if (!rawUrl || !username || !password) {
    return { ok: false, error: "not_configured" };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "unsafe_url" };
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) {
    return { ok: false, error: "unsafe_url" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "unsafe_url" }; // URL 内嵌凭据不允许
  }
  return {
    ok: true,
    config: {
      baseUrl: parsed.toString().replace(/\/+$/u, ""),
      username,
      password,
      remoteDirectory,
    },
    hostLabel: parsed.host,
  };
}

type WebDavRequestInit = RequestInit & { duplex?: "half" };
type WebDavFetch = (url: string, init: WebDavRequestInit) => Promise<Response>;

class WebDavTimeoutError extends Error {}

/** The deadline includes reading the body, not just receiving HTTP headers. */
async function webDavRequest<T>(
  fetchImpl: WebDavFetch,
  url: string,
  init: WebDavRequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upload = init.body instanceof Readable ? init.body : null;
  // Observe early stream errors even if fetch rejects before opening the file.
  const uploadFinished = upload ? finished(upload).catch(() => undefined) : null;
  let response: Response | undefined;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) throw new WebDavTimeoutError();
    throw error;
  } finally {
    // Close both directions before removing the operational export file.
    upload?.destroy();
    await uploadFinished;
    await response?.body?.cancel().catch(() => undefined);
    clearTimeout(timer);
  }
}

export type BackupOutcome =
  | { ok: true; runId: string; strategy: "verified-upload" | "direct-upload"; sha256: string; bytes: number }
  | { ok: false; error: string; runId?: string };

function authHeader(config: WebDavTargetConfig): Record<string, string> {
  const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  return { authorization: `Basic ${token}` };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function fileUploadInit(
  filePath: string,
  headers: Record<string, string>,
  bytes: number,
): WebDavRequestInit {
  return {
    method: "PUT",
    headers: {
      ...headers,
      "content-type": "application/zip",
      "content-length": String(bytes),
    },
    // Node fetch accepts a Node Readable when duplex is set. Keep the archive
    // on disk instead of duplicating the whole ZIP in the JS heap.
    body: createReadStream(filePath) as unknown as BodyInit,
    duplex: "half",
    redirect: "manual",
  };
}

async function hashResponseBody(response: Response, maxBytes: number): Promise<{
  sha256: string;
  bytes: number;
}> {
  if (!response.body) throw new Error("empty response body");
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("WebDAV verification response exceeds export size");
        return { sha256: "", bytes };
      }
      hash.update(buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** 执行一次备份。fetch 可注入（测试 fake WebDAV）。 */
export async function runWebDavBackup(
  context: FamilyContext,
  options: {
    fetchImpl?: WebDavFetch;
    env?: Partial<NodeJS.ProcessEnv>;
    now?: Date;
    /** Per HTTP transfer, including the response body; default ten minutes. */
    requestTimeoutMs?: number;
  } = {},
): Promise<BackupOutcome> {
  try {
    assertFamilyCapability(context.role, "backup:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const target = resolveWebDavTarget(options.env);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutSetting = (options.env ?? process.env).WEBDAV_REQUEST_TIMEOUT_MS?.trim();
  const configuredTimeout = timeoutSetting
    ? (/^\d+$/u.test(timeoutSetting) ? Number(timeoutSetting) : NaN)
    : 600_000;
  const timeoutMs = options.requestTimeoutMs ?? configuredTimeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    return { ok: false, error: "invalid_timeout" };
  }
  const request = <T>(url: string, init: WebDavRequestInit, consume: (response: Response) => Promise<T>) =>
    webDavRequest(fetchImpl, url, init, timeoutMs, consume);
  const statusOnly = async (response: Response) => response.status;
  const db = getDb();
  const now = options.now ?? new Date();

  const runId = randomUUID();
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  // Clock precision and clock rollback cannot cause two runs to overwrite a copy.
  const finalPath = `${target.config.remoteDirectory}/family-time-capsule-${stamp}-${runId}.zip`;
  const tempPath = `${finalPath}.tmp`;

  db.insert(backupRun)
    .values({
      id: runId,
      familyId: context.familyId,
      status: "running",
      remotePath: finalPath,
      startedAt: now,
      attempts: 1,
      triggeredByUserId: context.userId,
    })
    .run();

  const fail = async (error: string): Promise<BackupOutcome> => {
    db.update(backupRun)
      .set({ status: "failed", error, finishedAt: new Date() })
      .where(eq(backupRun.id, runId))
      .run();
    return { ok: false, error, runId };
  };

  // 1) verified export（导出内部已做逐字节 SHA 校验，不一致会抛错）
  let exportResult;
  try {
    exportResult = await buildActorExport(context);
  } catch {
    // Exceptions may contain private filenames, provider URLs or credentials.
    return fail("export_failed");
  }
  const base = target.config.baseUrl;
  const headers = authHeader(target.config);
  const tempUrl = `${base}${tempPath}`;
  const finalUrl = `${base}${finalPath}`;

  try {
    const sha256 = await hashFile(exportResult.filePath);
    // 2) 上传到临时路径
    const put = await request(
      tempUrl,
      fileUploadInit(exportResult.filePath, headers, exportResult.bytes),
      statusOnly,
    );
    if (put !== 200 && put !== 201 && put !== 204) {
      return fail(`temp_upload_failed: HTTP ${put}`);
    }

    const verify = (url: string, stage: string) => request(
      url, { method: "GET", headers, redirect: "manual" }, async (response) => {
        if (response.status !== 200) return `${stage}_read_failed: HTTP ${response.status}`;
        const actual = await hashResponseBody(response, exportResult.bytes);
        return actual.bytes === exportResult.bytes && actual.sha256 === sha256
          ? null : `${stage}_checksum_mismatch`;
      },
    );
    // 3) 验证临时副本，保留它直到最终路径也通过验证。
    const tempError = await verify(tempUrl, "verify");
    if (tempError) return fail(tempError);

    // 4) 原子改名；不支持时降级为直接上传最终路径 + 清理临时文件
    let strategy: "verified-upload" | "direct-upload" = "verified-upload";
    // 标准 WebDAV MOVE：请求 URL 是源（临时文件），Destination 头是目标
    const move = await request(tempUrl, {
      method: "MOVE",
      headers: { ...headers, destination: finalUrl, overwrite: "F" },
      redirect: "manual",
    }, statusOnly);
    if (move === 405 || move === 501) {
      // Permission, redirect, conflict and server errors are failures, not a
      // reason to bypass the MOVE error with another write.
      const directPut = await request(
        finalUrl,
        fileUploadInit(exportResult.filePath, { ...headers, "if-none-match": "*" }, exportResult.bytes),
        statusOnly,
      );
      if (directPut !== 200 && directPut !== 201 && directPut !== 204) {
        return fail(`final_upload_failed: HTTP ${directPut}`);
      }
      strategy = "direct-upload";
    } else if (move !== 201 && move !== 204) {
      return fail(`move_failed: HTTP ${move}`);
    }

    // A verified temporary does not prove that MOVE or the fallback PUT stored
    // the right bytes at the final path. Only this check allows success.
    const finalError = await verify(finalUrl, "final_verify");
    if (finalError) return fail(finalError);
    if (strategy === "direct-upload") {
      await request(tempUrl, { method: "DELETE", headers, redirect: "manual" }, statusOnly).catch(
        () => undefined,
      );
    }

    db.update(backupRun)
      .set({
        status: "succeeded",
        sha256,
        bytes: exportResult.bytes,
        strategy,
        finishedAt: new Date(),
      })
      .where(eq(backupRun.id, runId))
      .run();
    return { ok: true, runId, strategy, sha256, bytes: exportResult.bytes };
  } catch (error) {
    return fail(error instanceof WebDavTimeoutError ? "webdav_timeout" : "webdav_error");
  } finally {
    // buildActorExport creates an operational temporary. Upload paths reopen
    // it as needed, then cleanup happens for every success/failure branch.
    await unlink(exportResult.filePath).catch(() => undefined);
  }
}

export function listBackupRuns(context: FamilyContext): BackupRunRow[] {
  try {
    assertFamilyCapability(context.role, "backup:manage");
  } catch {
    return [];
  }
  return getDb()
    .select()
    .from(backupRun)
    .where(eq(backupRun.familyId, context.familyId))
    .orderBy(desc(backupRun.startedAt))
    .limit(50)
    .all();
}

/** 重试：等价于再次执行（verified export 全量重传）。 */
export async function retryWebDavBackup(
  context: FamilyContext,
  options: Parameters<typeof runWebDavBackup>[1] = {},
): Promise<BackupOutcome> {
  return runWebDavBackup(context, options);
}

export function backupTargetStatus(
  context: FamilyContext,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): {
  configured: boolean;
  hostLabel: string | null;
} {
  try {
    assertFamilyCapability(context.role, "backup:manage");
  } catch {
    return { configured: false, hostLabel: null };
  }
  const target = resolveWebDavTarget(env);
  return target.ok
    ? { configured: true, hostLabel: target.hostLabel }
    : { configured: false, hostLabel: null };
}
