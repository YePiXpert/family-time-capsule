import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
        store.set(url, Buffer.concat(chunks));
        res.writeHead(201).end();
      });
      return;
    }
    if (req.method === "GET") {
      const body = store.get(url);
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/zip" }).end(body);
      return;
    }
    if (req.method === "MOVE") {
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
      store.set(destPath, body);
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
});
