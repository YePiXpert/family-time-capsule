import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * RH-005：灾难恢复 roundtrip（真实文件系统 + 真实服务器，零 mock）。
 *
 * create archive A → export → **destroy A** → clean B → restore →
 * boot app against B → login/setup（按恢复设计）→ visit Timeline →
 * verify records → media accessible（含 Range）→ export B → verify B export。
 */

const PORT = "3201";
const BASE = `http://localhost:${PORT}`;

const dirA = mkdtempSync(path.join(tmpdir(), "ftc-rt-a-"));
const dirB = mkdtempSync(path.join(tmpdir(), "ftc-rt-b-"));
process.env.INITIAL_SETUP_TOKEN = "rt-token";
process.env.AUTH_SECRET = "rt-test-secret-0123456789abcdef";

const fixtures = path.join(__dirname, "..", "fixtures");
const read = (name: string) => readFileSync(path.join(fixtures, name));

type Expectation = {
  zipPath: string;
  familyId: string;
  eventTitle: string;
  eventDate: string; // 详情页可见文本（家庭时区）
  ageLabel: string;
  assetId: string;
  assetSha256: string;
  photoEventId: string;
  confirmedTextEventId: string;
  confirmedTextBody: string;
  inboxItems: Array<{
    id: string;
    familyId: string;
    kind: string;
    status: string;
    rawText: string | null;
    memoryEventId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  inboxItemAssets: Array<{
    id: string;
    inboxItemId: string;
    assetId: string;
    familyId: string;
    createdAt: string;
  }>;
};

let expect_: Expectation;
let serverProcess: ReturnType<typeof spawn> | undefined;
let cookie = "";

async function freshModules() {
  vi.resetModules();
  return {
    db: await import("@/db"),
    setup: await import("@/lib/auth/setup"),
    family: await import("@/lib/family/service"),
    ingest: await import("@/lib/assets/ingest"),
    inbox: await import("@/lib/inbox/service"),
    memories: await import("@/lib/memories/service"),
    contributions: await import("@/lib/contributions/service"),
    exportSvc: await import("@/lib/export/service"),
    restoreSvc: await import("@/lib/restore/service"),
    schemaAuth: await import("@/db/schema/auth"),
    schemaInbox: await import("@/db/schema/inbox"),
  };
}

async function startServer() {
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  serverProcess = spawn(process.execPath, [nextBin, "start", "--port", PORT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dirB,
      BETTER_AUTH_URL: BASE,
      AUTH_SECRET: process.env.AUTH_SECRET,
      INITIAL_SETUP_TOKEN: "rt-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout?.on("data", () => {});
  serverProcess.stderr?.on("data", () => {});
  // 等待就绪
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start within 90s（请先 npm run build）");
}

function stopServer() {
  return new Promise<void>((resolve) => {
    if (!serverProcess) return resolve();
    serverProcess.once("exit", () => resolve());
    serverProcess.kill();
    setTimeout(() => {
      serverProcess?.kill("SIGKILL");
      resolve();
    }, 10_000);
  });
}

beforeAll(async () => {
  // ---- Phase A：建档 + 导出（DATA_DIR=A）----
  process.env.DATA_DIR = dirA;
  {
    const m = await freshModules();
    const ok = await m.setup.performSetup({
      token: "rt-token",
      displayName: "爸爸",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    if (!ok.ok) throw new Error("setup A failed");
    const adminId = (
      await m.db.getDb().select({ id: m.schemaAuth.user.id }).from(m.schemaAuth.user)
    )[0].id;
    const on = await m.family.completeOnboarding(adminId, {
      familyName: "我们一家",
      timezone: "Asia/Shanghai",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "爸爸",
      selfRelationToChild: "爸爸",
    });
    if (!on.ok) throw new Error("onboarding A failed");
    const stored = await m.ingest.ingestImage({
      familyId: on.familyId,
      createdByUserId: adminId,
      filename: "出生照片.jpg",
      declaredMime: "image/jpeg",
      buffer: read("sample-exif.jpg"),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("ingest failed");
    const item = await m.inbox.createInboxItemForAsset(on.familyId, stored.asset);
    const entry = (await m.inbox.getInboxEntry(on.familyId, item.id))!;
    const ev = await m.memories.confirmInboxEntry(on.familyId, entry, {
      title: "出生后的第一天",
    });
    if (!ev.ok) throw new Error("confirm failed");

    const pendingTextBody =
      "这是一条超过一百个字符、仍然等待整理的文字记录，用来验证生产构建下的导出、销毁、恢复和再次导出都不会截断内容。".repeat(
        3,
      );
    await m.inbox.createTextInboxItem(on.familyId, pendingTextBody);
    await m.inbox.createInboxItemForAsset(on.familyId, stored.asset);
    await m.inbox.createInboxItemForAsset(on.familyId, {
      ...stored.asset,
      timeSource: "import_time",
    });
    const discarded = await m.inbox.createTextInboxItem(
      on.familyId,
      "这条记录已经被家人丢弃。",
    );
    await m.inbox.discardInboxItem(on.familyId, discarded.id);
    const confirmedTextBody =
      "小满今天第一次认真看了很久的树影。\n这句确认后的原始文字必须完整留下。";
    const confirmedText = await m.inbox.createTextInboxItem(
      on.familyId,
      confirmedTextBody,
    );
    const confirmedTextEntry = (await m.inbox.getInboxEntry(
      on.familyId,
      confirmedText.id,
    ))!;
    const textEvent = await m.memories.confirmInboxEntry(
      on.familyId,
      confirmedTextEntry,
      { title: "窗边的树影" },
    );
    if (!textEvent.ok) throw new Error("text confirm failed");

    const inboxItems = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItem)
    )
      .map((inboxRow) => ({
        id: inboxRow.id,
        familyId: inboxRow.familyId,
        kind: inboxRow.kind,
        status: inboxRow.status,
        rawText: inboxRow.rawText,
        memoryEventId: inboxRow.memoryEventId,
        createdAt: inboxRow.createdAt.toISOString(),
        updatedAt: inboxRow.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const inboxItemAssets = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItemAsset)
    )
      .map((link) => ({
        id: link.id,
        inboxItemId: link.inboxItemId,
        assetId: link.assetId,
        familyId: link.familyId,
        createdAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(pendingTextBody.length).toBeGreaterThan(100);
    expect(new Set(inboxItems.map((inboxRow) => inboxRow.status))).toEqual(
      new Set(["new", "needs_review", "confirmed", "discarded"]),
    );
    const zip = await m.exportSvc.buildFamilyExport(on.familyId);
    expect_ = {
      zipPath: zip.filePath,
      familyId: on.familyId,
      eventTitle: "出生后的第一天",
      eventDate: "2026年8月10日 09:30",
      ageLabel: "出生当天",
      assetId: stored.asset.id,
      assetSha256: stored.asset.sha256,
      photoEventId: ev.eventId,
      confirmedTextEventId: textEvent.eventId,
      confirmedTextBody,
      inboxItems,
      inboxItemAssets,
    };
    m.db.closeDatabase();
  }

  // ---- 灾难：把备份转移到安全位置，然后销毁 A ----
  const safeZip = path.join(tmpdir(), `ftc-rt-survivor-${Date.now()}.zip`);
  const { copyFileSync } = await import("node:fs");
  copyFileSync(expect_.zipPath, safeZip);
  expect_.zipPath = safeZip;
  rmSync(dirA, { recursive: true, force: true });
  expect(() => readFileSync(dirA)).toThrow(); // A 确已不存在

  // ---- Phase B：干净实例 → setup → restore → 绑定 ----
  process.env.DATA_DIR = dirB;
  {
    const m = await freshModules();
    const ok = await m.setup.performSetup({
      token: "rt-token",
      displayName: "新管理员",
      email: "b@example.com",
      password: "b-long-enough-password",
    });
    if (!ok.ok) throw new Error("setup B failed");
    const adminId = (
      await m.db.getDb().select({ id: m.schemaAuth.user.id }).from(m.schemaAuth.user)
    )[0].id;
    const report = await m.restoreSvc.restoreFromZipFile(expect_.zipPath, adminId);
    expect(report.events).toBe(2);
    expect(report.inboxItems).toBe(expect_.inboxItems.length);
    expect(report.inboxItemAssets).toBe(expect_.inboxItemAssets.length);

    const restoredInboxItems = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItem)
    )
      .map((inboxRow) => ({
        id: inboxRow.id,
        familyId: inboxRow.familyId,
        kind: inboxRow.kind,
        status: inboxRow.status,
        rawText: inboxRow.rawText,
        memoryEventId: inboxRow.memoryEventId,
        createdAt: inboxRow.createdAt.toISOString(),
        updatedAt: inboxRow.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const restoredInboxItemAssets = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItemAsset)
    )
      .map((link) => ({
        id: link.id,
        inboxItemId: link.inboxItemId,
        assetId: link.assetId,
        familyId: link.familyId,
        createdAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredInboxItems).toEqual(expect_.inboxItems);
    expect(restoredInboxItemAssets).toEqual(expect_.inboxItemAssets);
    expect(
      await m.contributions.listContributions(
        expect_.familyId,
        expect_.confirmedTextEventId,
      ),
    ).toHaveLength(0);

    // 绑定到「爸爸」
    const people = await m.family.listPeople(expect_.familyId);
    const dad = people.find((p) => p.relationToChild === "爸爸")!;
    const bind = await m.family.bindRestoredFamily(adminId, dad.id);
    expect(bind.ok).toBe(true);
    m.db.closeDatabase();
  }

  // ---- 启动应用（真实服务器，指向 B）----
  await startServer();
}, 180_000);

afterAll(async () => {
  await stopServer();
  // Windows 下句柄释放可能滞后：重试删除，失败不阻断结果
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dirB, { recursive: true, force: true });
      rmSync(expect_?.zipPath ?? "", { force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
});

describe("RH-005 灾难恢复 roundtrip", () => {
  it("服务器存活且登录页可用", async () => {
    const res = await fetch(`${BASE}/login`);
    expect(res.status).toBe(200);
  });

  it("按恢复设计登录（新管理员账号，认证不来自备份）", async () => {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email: "b@example.com", password: "b-long-enough-password" }),
    });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie?.() ?? [];
    const session = cookies.find((c) => c.includes("better-auth.session_token"));
    expect(session, JSON.stringify(cookies)).toBeTruthy();
    cookie = session!.split(";")[0];
  });

  it("时间轴与事件详情展示恢复的事件：标题 / 真实日期 / 年龄一致", async () => {
    const res = await fetch(`${BASE}/timeline`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(expect_.eventTitle);
    expect(html).toContain("2026年8月10日");
    expect(html).toContain(expect_.ageLabel);

    // 图片事件详情页含完整时刻
    const detail = await fetch(`${BASE}/memories/${expect_.photoEventId}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain(expect_.eventDate); // 2026年8月10日 09:30
    expect(detailHtml).toContain(expect_.ageLabel);

    // 已确认文字以无作者的原始来源记录显示，正文不截断，也不伪造 Contribution。
    const textDetail = await fetch(
      `${BASE}/memories/${expect_.confirmedTextEventId}`,
      { headers: { cookie } },
    );
    expect(textDetail.status).toBe(200);
    const textDetailHtml = await textDetail.text();
    for (const line of expect_.confirmedTextBody.split("\n")) {
      expect(textDetailHtml).toContain(line);
    }
    expect(textDetailHtml).toContain("未标注讲述者");
  });

  it("恢复的媒体可访问：字节 SHA-256 与源一致；Range 206；未授权 401", async () => {
    const res = await fetch(`${BASE}/api/media/${expect_.assetId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(createHash("sha256").update(buf).digest("hex")).toBe(expect_.assetSha256);

    const range = await fetch(`${BASE}/api/media/${expect_.assetId}`, {
      headers: { cookie, Range: "bytes=0-9" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toMatch(/^bytes 0-9\//);

    const anon = await fetch(`${BASE}/api/media/${expect_.assetId}`);
    expect(anon.status).toBe(401);
  });

  it("导出 B 并独立校验（verify:export 全绿，哈希与源一致）", async () => {
    const res = await fetch(`${BASE}/api/export`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const zipBuffer = Buffer.from(await res.arrayBuffer());

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    const manifest = JSON.parse(
      await zip.file("family-time-capsule-export/manifest.json")!.async("string"),
    );
    expect(manifest.familyId).toBe(expect_.familyId);
    expect(manifest.fileCount).toBe(manifest.assets.length + 10);
    const shas = new Set(manifest.assets.map((a: { sha256: string }) => a.sha256));
    expect(shas.has(expect_.assetSha256)).toBe(true);
    const inboxItems = JSON.parse(
      await zip
        .file("family-time-capsule-export/inbox-items.json")!
        .async("string"),
    ).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    const inboxItemAssets = JSON.parse(
      await zip
        .file("family-time-capsule-export/inbox-item-assets.json")!
        .async("string"),
    ).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    expect(inboxItems).toEqual(expect_.inboxItems);
    expect(inboxItemAssets).toEqual(expect_.inboxItemAssets);

    // verify:export CLI 独立复核
    const tmpZip = path.join(dirB, "b-export.zip");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tmpZip, zipBuffer);
    const verify = spawnSync(process.execPath, ["scripts/verify-export.mjs", tmpZip], {
      encoding: "utf8",
    });
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
  });

  it("登录限流持久化到 SQLite（v0.1.3）：窗口内超额 429，计数落库", async () => {
    // 说明：better-auth 限流挂在 HTTP 请求层（内部 api 不经过），本测试是真实
    // 生产服务器上的行为验证。此前“按恢复设计登录”测试已消耗 1 次（共 3 次/10s）。
    const attempt = async (password: string) => {
      const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: JSON.stringify({ email: "b@example.com", password }),
      });
      return res.status;
    };
    // 第 2、3 次：密码错误 → 401（不是 429，说明尚未触顶）
    expect(await attempt("wrong-1")).toBe(401);
    expect(await attempt("wrong-2")).toBe(401);
    // 第 4 次：即使密码正确也被限流 → 429
    expect(await attempt("b-long-enough-password")).toBe(429);

    // 计数确实落在 SQLite（另一连接只读 WAL 快照）
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(path.join(dirB, "db", "capsule.sqlite"), { readonly: true });
    const rows = db
      .prepare(`SELECT key, count FROM rate_limit WHERE key LIKE '%sign-in%'`)
      .all() as Array<{ key: string; count: number }>;
    db.close();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].count).toBeGreaterThanOrEqual(3);
  });
});
