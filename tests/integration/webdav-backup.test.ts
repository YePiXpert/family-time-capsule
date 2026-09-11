import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-webdav-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "webdav-setup-token";
process.env.AUTH_SECRET = "webdav-test-secret";

let server: Server | undefined;
let serverUrl = "";
/** 模拟 WebDAV 存储（内存） */
const store = new Map<string, Buffer>();
let moveSupported = true;
let failNextUpload = false;
let moveStatus: number | null = null;
let corruptFinal = false;
let finalReadStatus: number | null = null;
let stallFinalRead = false;
let finalUploads = 0;

beforeEach(() => {
  moveSupported = true;
  failNextUpload = false;
  moveStatus = null;
  corruptFinal = false;
  finalReadStatus = null;
  stallFinalRead = false;
  finalUploads = 0;
});

function finalBytes(body: Buffer) {
  if (!corruptFinal) return body;
  const corrupted = Buffer.from(body);
  corrupted[0] ^= 0xff; // Same length: byte count alone cannot verify a backup.
  return corrupted;
}

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { backupRun } = await import("@/db/schema/backup");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const {
  resolveWebDavTarget,
  runWebDavBackup,
  listBackupRuns,
  backupTargetStatus,
} = await import("@/lib/webdav/service");

const setup = await performSetup({
  token: "webdav-setup-token",
  displayName: "爸爸",
  email: "dad-webdav@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "备份测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const binding = await getUserBinding(adminId);
if (
  !binding.familyTimezone ||
  binding.childLaterUnlockAge === null ||
  binding.personId === null
) {
  throw new Error("binding incomplete");
}
const adminTimezone = binding.familyTimezone;
const adminUnlockAge = binding.childLaterUnlockAge;
const adminPersonId = binding.personId;

const context: FamilyContext = {
  userId: adminId,
  userName: "爸爸",
  familyId,
  personId: adminPersonId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: adminTimezone,
  childLaterUnlockAge: adminUnlockAge,
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (failNextUpload && req.method === "PUT") {
      failNextUpload = false;
      res.writeHead(507).end();
      return;
    }
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const final = url.endsWith(".zip");
        if (final) finalUploads++;
        const body = Buffer.concat(chunks);
        store.set(url, final ? finalBytes(body) : body);
        res.writeHead(201).end();
      });
      return;
    }
    if (req.method === "GET") {
      if (url.endsWith(".zip") && finalReadStatus !== null) {
        res.writeHead(finalReadStatus).end();
        return;
      }
      const body = store.get(url);
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/zip" });
      if (url.endsWith(".zip") && stallFinalRead) {
        res.write(body.subarray(0, 10)); // Headers arrive; body never completes.
      } else {
        res.end(body);
      }
      return;
    }
    if (req.method === "MOVE") {
      if (moveStatus !== null) {
        res.writeHead(moveStatus).end();
        return;
      }
      if (!moveSupported) {
        res.writeHead(405).end();
        return;
      }
      const destinationHeader = req.headers.destination;
      const destination = Array.isArray(destinationHeader)
        ? destinationHeader[0]
        : destinationHeader;
      if (!destination) {
        res.writeHead(400).end();
        return;
      }
      const destPath = new URL(destination).pathname;
      const body = store.get(url);
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      store.delete(url);
      store.set(destPath, finalBytes(body));
      res.writeHead(201).end();
      return;
    }
    if (req.method === "DELETE") {
      store.delete(url);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    serverUrl = `http://127.0.0.1:${address.port}`;
  }
});

describe("M6：WebDAV 目标解析", () => {
  it("env 未配置 → not_configured；不安全 URL 拒绝", () => {
    expect(resolveWebDavTarget({})).toEqual({ ok: false, error: "not_configured" });
    expect(
      resolveWebDavTarget({
        WEBDAV_URL: "http://nas.example.com",
        WEBDAV_USERNAME: "u",
        WEBDAV_PASSWORD: "p",
      }),
    ).toEqual({ ok: false, error: "unsafe_url" });
    expect(
      resolveWebDavTarget({
        WEBDAV_URL: "https://user:pass@nas.example.com",
        WEBDAV_USERNAME: "u",
        WEBDAV_PASSWORD: "p",
      }),
    ).toEqual({ ok: false, error: "unsafe_url" });
  });

  it("https 与 loopback http 允许", () => {
    expect(
      resolveWebDavTarget({
        WEBDAV_URL: "https://nas.example.com/dav",
        WEBDAV_USERNAME: "u",
        WEBDAV_PASSWORD: "p",
      }).ok,
    ).toBe(true);
    expect(
      resolveWebDavTarget({
        WEBDAV_URL: serverUrl,
        WEBDAV_USERNAME: "u",
        WEBDAV_PASSWORD: "p",
      }).ok,
    ).toBe(true);
  });

  it.each(["127.backup.example", "127.0.0.1.backup.example"])("a loopback-looking hostname %s cannot receive credentials over HTTP", (host) => {
    expect(resolveWebDavTarget({
      WEBDAV_URL: `http://${host}`,
      WEBDAV_USERNAME: "u",
      WEBDAV_PASSWORD: "p",
    })).toEqual({ ok: false, error: "unsafe_url" });
  });
});

describe("M6：WebDAV 备份执行", () => {
  const env = () => ({
    WEBDAV_URL: serverUrl,
    WEBDAV_USERNAME: "backup-user",
    WEBDAV_PASSWORD: "backup-pass",
    WEBDAV_DIRECTORY: "/remote-backups",
  });

  it("verified upload + 原子改名（MOVE 支持）", async () => {
    moveSupported = true;
    const uploadBodies: unknown[] = [];
    const result = await runWebDavBackup(context, {
      env: env(),
      fetchImpl: async (url, init) => {
        if (init.method === "PUT") uploadBodies.push(init.body);
        const response = await fetch(url, init);
        if (init.method === "GET") {
          // The production verifier must consume response.body incrementally.
          // A regression to whole-response buffering fails this test directly.
          Object.defineProperty(response, "arrayBuffer", {
            value: () => {
              throw new Error("arrayBuffer must not be used");
            },
          });
        }
        return response;
      },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.strategy).toBe("verified-upload");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(uploadBodies.length).toBe(1);
    expect(uploadBodies[0]).not.toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(uploadBodies[0])).toBe(false);

    // 远端只有最终文件（临时已被 MOVE 消费）
    const keys = [...store.keys()];
    expect(keys.some((k) => k.endsWith(".zip") && !k.endsWith(".tmp"))).toBe(true);
    expect(keys.some((k) => k.endsWith(".tmp"))).toBe(false);

    // 历史
    const runs = listBackupRuns(context);
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].strategy).toBe("verified-upload");

    // 状态页（不泄漏凭据）
    const status = backupTargetStatus(context, env());
    expect(status.configured).toBe(true);
  });

  it("MOVE 不支持 → 降级 direct-upload 并清理临时文件", async () => {
    moveSupported = false;
    const result = await runWebDavBackup(context, { env: env() });
    if (!result.ok) throw new Error(result.error);
    expect(result.strategy).toBe("direct-upload");
    const keys = [...store.keys()];
    expect(keys.some((k) => k.endsWith(".tmp"))).toBe(false);
    moveSupported = true;
  });

  it("上传失败 → run 落库为 failed 且可重试成功", async () => {
    failNextUpload = true;
    const failed = await runWebDavBackup(context, { env: env() });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("expected failure");
    expect(failed.error).toContain("temp_upload_failed");

    let runs = listBackupRuns(context);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("temp_upload_failed");

    // 重试成功
    const retried = await runWebDavBackup(context, { env: env() });
    expect(retried.ok).toBe(true);
    runs = listBackupRuns(context);
    expect(runs[0].status).toBe("succeeded");
  });

  it("失败错误信息不含凭据", async () => {
    failNextUpload = true;
    await runWebDavBackup(context, { env: env() });
    const runs = getDb().select().from(backupRun).all();
    for (const run of runs) {
      expect(run.error ?? "").not.toContain("backup-pass");
      expect(run.error ?? "").not.toContain("backup-user");
    }
    const serialized = JSON.stringify(listBackupRuns(context));
    expect(serialized).not.toContain("backup-pass");
  });

  it("未配置 env → not_configured", async () => {
    const result = await runWebDavBackup(context, { env: {} });
    expect(result).toEqual({ ok: false, error: "not_configured" });
  });

  const savedRun = (runId: string) => getDb().select().from(backupRun).where(eq(backupRun.id, runId)).get()!;

  it.each([302, 207, 403, 500])("MOVE HTTP %i must not report success or attempt a direct overwrite", async (status) => {
    moveStatus = status;
    const result = await runWebDavBackup(context, { env: env() });
    expect(result).toMatchObject({ ok: false, error: `move_failed: HTTP ${status}` });
    if (result.ok || !result.runId) throw new Error("expected recorded failure");
    expect(savedRun(result.runId)).toMatchObject({ status: "failed", sha256: null });
    expect(finalUploads).toBe(0);
  });

  it.each([true, false])("checks the final bytes even when MOVE supported=%s", async (supported) => {
    moveSupported = supported;
    corruptFinal = true;
    const result = await runWebDavBackup(context, { env: env() });
    expect(result).toMatchObject({ ok: false, error: "final_verify_checksum_mismatch" });
    if (result.ok || !result.runId) throw new Error("expected recorded failure");
    const run = savedRun(result.runId);
    expect(run).toMatchObject({ status: "failed", sha256: null });
    // A verified temporary is retained if a fallback upload cannot be verified.
    if (!supported) expect(store.has(`${run.remotePath}.tmp`)).toBe(true);
  });

  it("a successful MOVE followed by a missing final file is a failed backup", async () => {
    finalReadStatus = 404;
    const result = await runWebDavBackup(context, { env: env() });
    expect(result).toMatchObject({ ok: false, error: "final_verify_read_failed: HTTP 404" });
    if (result.ok || !result.runId) throw new Error("expected recorded failure");
    expect(savedRun(result.runId).status).toBe("failed");
  });

  it("two backups with the same clock timestamp retain separate remote copies", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = await runWebDavBackup(context, { env: env(), now });
    if (!first.ok) throw new Error(first.error);
    const firstPath = savedRun(first.runId).remotePath;
    const firstBytes = Buffer.from(store.get(firstPath)!);
    const second = await runWebDavBackup(context, { env: env(), now });
    if (!second.ok) throw new Error(second.error);
    expect(savedRun(second.runId).remotePath).not.toBe(firstPath);
    expect(store.get(firstPath)).toEqual(firstBytes);
  });

  it("transport exception details cannot expose credentials in results or history", async () => {
    const result = await runWebDavBackup(context, {
      env: env(),
      fetchImpl: async () => { throw new Error("request failed for backup-user:backup-pass"); },
    });
    expect(result).toMatchObject({ ok: false, error: "webdav_error" });
    if (result.ok || !result.runId) throw new Error("expected recorded failure");
    expect(savedRun(result.runId).error).toBe("webdav_error");
  });

  it("a stalled final response body times out and leaves a failed run", async () => {
    stallFinalRead = true;
    const result = await runWebDavBackup(context, { env: { ...env(), WEBDAV_REQUEST_TIMEOUT_MS: "100" } });
    expect(result).toMatchObject({ ok: false, error: "webdav_timeout" });
    if (result.ok || !result.runId) throw new Error("expected recorded failure");
    expect(savedRun(result.runId)).toMatchObject({ status: "failed", sha256: null });
    expect(savedRun(result.runId).finishedAt).toBeInstanceOf(Date);
  });

  it.each(["-1", "0", "NaN", "1.5", "2147483648"])("invalid timeout %s is refused before starting an upload", async (timeout) => {
    const count = getDb().select().from(backupRun).all().length;
    expect(await runWebDavBackup(context, { env: { ...env(), WEBDAV_REQUEST_TIMEOUT_MS: timeout } }))
      .toEqual({ ok: false, error: "invalid_timeout" });
    expect(getDb().select().from(backupRun).all()).toHaveLength(count);
  });
});
