import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

/**
 * v0.1.3：导出/恢复审计日志。
 * 记录是 best-effort；设置页「最近操作」直接消费本服务。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-audit-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "audit-token";
process.env.AUTH_SECRET = "audit-secret-0123456789abcd";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "audit-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { buildFamilyExport } = await import("@/lib/export/service");
const { listRecentAudit, AUDIT_KINDS } = await import("@/lib/audit/service");

const db = getDb();
const adminUserId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(adminUserId, {
  familyName: "我们一家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const OTHER_FAMILY = "fam-audit-other";

const fixtures = path.join(__dirname, "..", "fixtures");

describe("导出审计（v0.1.3）", () => {
  it("导出成功后写入 export.created：操作者/字节数/原件数", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "a.jpg",
      declaredMime: "image/jpeg",
      buffer: readFileSync(path.join(fixtures, "sample-exif.jpg")),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");

    const report = await buildFamilyExport(familyId, { actorUserId: adminUserId });
    const entries = await listRecentAudit(familyId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const exportEntry = entries.find(
      (e) => e.kind === AUDIT_KINDS.exportCreated,
    );
    expect(exportEntry).toBeTruthy();
    expect(exportEntry!.actorUserId).toBe(adminUserId);
    expect(exportEntry!.actorName).toBe("爸爸");
    expect(exportEntry!.detail.fileName).toBe(report.fileName);
    expect(exportEntry!.detail.bytes).toBe(report.bytes);
    expect(exportEntry!.detail.assetCount).toBeGreaterThanOrEqual(1);
  });

  it("审计按家庭隔离", async () => {
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    expect(await listRecentAudit(OTHER_FAMILY)).toHaveLength(0);
  });

  it("未指定 actor 时记录为系统操作（actorUserId null）", async () => {
    await buildFamilyExport(familyId);
    const entries = await listRecentAudit(familyId, 5);
    const latest = entries.find((e) => e.kind === AUDIT_KINDS.exportCreated);
    expect(latest!.actorUserId).toBeNull();
  });
});
