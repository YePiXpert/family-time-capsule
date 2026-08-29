import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-exif-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "exif-setup-token";
process.env.AUTH_SECRET = "exif-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "exif-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, updateAssetCapturedAt } = await import("@/lib/assets/ingest");
const { getAsset } = await import("@/lib/assets/service");

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

const fixtures = path.join(__dirname, "..", "fixtures");

describe("EXIF capturedAt（#006）", () => {
  it("关键场景：8 月 10 日照片 8 月 29 日上传 → capturedAt=8/10，importedAt=8/29", async () => {
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "旧照片.jpg",
      declaredMime: "image/jpeg",
      buffer: readFileSync(path.join(fixtures, "sample-exif.jpg")),
      // 即使客户端声称 lastModified 是 8/29，EXIF 优先
      clientLastModifiedMs: new Date("2026-08-29T20:00:00Z").getTime(),
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;

    // EXIF 2026:08:10 09:30:00 无偏移 → 家庭时区 Asia/Shanghai → UTC 01:30
    expect(row.timeSource).toBe("embedded_metadata");
    expect(row.capturedAt?.toISOString()).toBe("2026-08-10T01:30:00.000Z");
    expect(row.importedAt.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-08-29T00:00:00Z").getTime(),
    );
    // 原始 EXIF 快照完整保留
    const metadata = JSON.parse(row.metadataJson ?? "{}");
    expect(metadata.exif.DateTimeOriginal).toBe("2026:08:10 09:30:00");
  });

  it("显式 OffsetTimeOriginal 优先于家庭时区", async () => {
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "带时区.jpg",
      declaredMime: "image/jpeg",
      buffer: readFileSync(path.join(fixtures, "sample-exif-offset.jpg")),
      clientLastModifiedMs: null,
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    expect(result.asset.capturedAt?.toISOString()).toBe("2026-08-10T01:30:00.000Z");
  });

  it("用户修正时间 → timeSource=user_confirmed，metadata 不删", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "要改时间的.jpg",
      declaredMime: "image/jpeg",
      buffer: readFileSync(path.join(fixtures, "sample-exif.jpg")),
      clientLastModifiedMs: null,
    });
    if (stored.status === "duplicate") {
      // 前面已存过同一字节——用已有行继续验证修正
      const updated = await updateAssetCapturedAt(
        familyId,
        stored.existing.id,
        new Date("2026-08-11T12:00:00.000Z"),
      );
      expect(updated?.timeSource).toBe("user_confirmed");
      expect(updated?.capturedAt?.toISOString()).toBe("2026-08-11T12:00:00.000Z");
      expect(JSON.parse(updated?.metadataJson ?? "{}").exif.DateTimeOriginal).toBe(
        "2026:08:10 09:30:00",
      );
      return;
    }
    if (stored.status !== "stored") return;
    const updated = await updateAssetCapturedAt(
      familyId,
      stored.asset.id,
      new Date("2026-08-11T12:00:00.000Z"),
    );
    expect(updated?.timeSource).toBe("user_confirmed");
    expect(updated?.capturedAt?.toISOString()).toBe("2026-08-11T12:00:00.000Z");
    // 原始 metadata 原样保留
    expect(JSON.parse(updated?.metadataJson ?? "{}").exif.DateTimeOriginal).toBe(
      "2026:08:10 09:30:00",
    );
  });

  it("updateAssetCapturedAt 受 family 作用域限制", async () => {
    const { sql } = await import("drizzle-orm");
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES ('fam-exif-other', '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "隔离用.jpg",
      declaredMime: "image/jpeg",
      buffer: readFileSync(path.join(fixtures, "sample.jpg")),
      clientLastModifiedMs: new Date("2026-08-20T00:00:00Z").getTime(),
    });
    expect(stored.status).toBe("stored");
    if (stored.status !== "stored") return;

    // 其他家庭视角更新：无效果
    const missed = await updateAssetCapturedAt(
      "fam-exif-other",
      stored.asset.id,
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(missed).toBeUndefined();
    const still = await getAsset(familyId, stored.asset.id);
    expect(still?.timeSource).toBe("file_metadata");
  });
});
