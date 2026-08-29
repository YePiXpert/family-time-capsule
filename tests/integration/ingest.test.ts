import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-ingest-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "ingest-setup-token";
process.env.AUTH_SECRET = "ingest-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const setupResult = await performSetup({
  token: "ingest-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!setupResult.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { getAsset, sha256Of } = await import("@/lib/assets/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { readFileSync } = await import("node:fs");

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

const SAMPLE_JPG = readFileSync(
  path.join(__dirname, "..", "fixtures", "sample.jpg"),
);

describe("ingestImage 图片摄取", () => {
  it("合法 JPEG 入库：尺寸解析、file_metadata 时间、安全 storageKey", async () => {
    const lastModified = new Date("2026-08-15T10:00:00Z").getTime();
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "../../abc.jpg",
      declaredMime: "image/jpeg",
      buffer: SAMPLE_JPG,
      clientLastModifiedMs: lastModified,
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;

    // 恶意 filename 不进入路径，也不逃逸 storage root
    expect(row.storageKey).toMatch(/^originals\/[^/]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(row.storageKey).not.toContain("..");
    const storage = getAssetStorage();
    const abs = storage.resolvePath(row.storageKey);
    expect(abs.startsWith(path.resolve(dataDir))).toBe(true);

    expect(row.width).toBe(4);
    expect(row.height).toBe(4);
    expect(row.timeSource).toBe("file_metadata");
    expect(row.capturedAt?.toISOString()).toBe("2026-08-15T10:00:00.000Z");
    expect(row.importedAt).toBeTruthy();
    expect(row.importedAt.getTime()).toBeGreaterThan(
      new Date("2026-08-29T00:00:00Z").getTime(),
    );
  });

  it("同一文件再次上传返回 duplicate（明确提示，不静默复制）", async () => {
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "same-again.jpg",
      declaredMime: "image/jpeg",
      buffer: SAMPLE_JPG,
      clientLastModifiedMs: null,
    });
    expect(result.status).toBe("duplicate");
    if (result.status !== "duplicate") return;
    expect(result.existing.sha256).toBe(sha256Of(SAMPLE_JPG));
  });

  it("无时间线索时 timeSource=import_time", async () => {
    const before = new Date();
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "no-time.jpg",
      declaredMime: "image/jpeg",
      // 重新构造一个字节不同的 JPEG（无 EXIF、无 lastModified）
      buffer: Buffer.concat([SAMPLE_JPG, Buffer.from([0x00])]),
      clientLastModifiedMs: null,
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    expect(result.asset.timeSource).toBe("import_time");
    expect(result.asset.capturedAt).toBeNull();
    // SQLite 时间戳为秒级精度，按秒比较
    expect(result.asset.importedAt.getTime()).toBeGreaterThanOrEqual(
      Math.floor(before.getTime() / 1000) * 1000,
    );
  });

  it("伪装内容被拒绝（exe 声明为 image/jpeg）", async () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(64, 0x41)]);
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "malware.jpg",
      declaredMime: "image/jpeg",
      buffer: exe,
      clientLastModifiedMs: null,
    });
    expect(result).toEqual({ status: "rejected", error: "content_mismatch" });
  });

  it("家庭隔离：他家庭视角读不到本家庭资产", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "iso.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([SAMPLE_JPG, Buffer.from([0x01])]),
      clientLastModifiedMs: null,
    });
    expect(stored.status).toBe("stored");
    if (stored.status !== "stored") return;
    expect(await getAsset(familyId, stored.asset.id)).toBeTruthy();
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES ('fam-other-x', '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    expect(await getAsset("fam-other-x", stored.asset.id)).toBeUndefined();
  });
});
