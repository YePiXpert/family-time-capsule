import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-assets-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "assets-setup-token";
process.env.AUTH_SECRET = "assets-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const setupResult = await performSetup({
  token: "assets-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!setupResult.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const {
  completeOnboarding,
} = await import("@/lib/family/service");
const {
  storeOriginal,
  storeDerivative,
  getAsset,
  findOriginalBySha256,
  sha256Of,
} = await import("@/lib/assets/service");
const {
  getAssetStorage,
  buildOriginalStorageKey,
  OriginalExistsError,
  StorageKeyError,
} = await import("@/lib/assets/storage");

const db = getDb();
const users = await db.select({ id: userTable.id }).from(userTable);
const adminUserId = users[0].id;
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
const FAMILY_B = "family-b-0000";

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
  "hex",
);

describe("原件保存", () => {
  it("写入文件并落库，storageKey 不含原 filename，按 capturedAt 年月分层", async () => {
    const capturedAt = new Date("2026-08-10T09:30:00.000Z");
    const result = await storeOriginal({
      familyId,
      createdByUserId: adminUserId,
      type: "image",
      originalFilename: "../../我家/女儿 出生第3天.jpg",
      mimeType: "image/png",
      buffer: PNG_BYTES,
      extension: "png",
      capturedAt,
      timeSource: "embedded_metadata",
      width: 1,
      height: 1,
      metadataJson: { exif: { DateTimeOriginal: "2026:08:10 09:30:00" } },
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;

    expect(row.storageKey).toMatch(
      /^originals\/[^/]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/,
    );
    // 路径分段 = capturedAt 的年月（2026/08），不是导入时的 8 月 29 日也无关紧要——
    // 关键是绝不包含原 filename 的任何部分
    expect(row.storageKey).not.toContain("女儿");
    expect(row.storageKey).not.toContain("..");
    expect(row.sha256).toBe(sha256Of(PNG_BYTES));
    expect(row.bytes).toBe(PNG_BYTES.byteLength);
    expect(row.capturedAt?.toISOString()).toBe(capturedAt.toISOString());
    expect(row.importedAt).toBeTruthy();
    expect(row.timeSource).toBe("embedded_metadata");
    // 展示名去掉路径分隔符但保留可读性
    expect(row.originalFilename).toBe("..-..-我家-女儿 出生第3天.jpg");

    const storage = getAssetStorage();
    expect(storage.exists(row.storageKey)).toBe(true);
    expect(storage.read(row.storageKey).equals(PNG_BYTES)).toBe(true);
  });

  it("家庭内相同 SHA-256 返回 duplicate，不写第二个文件", async () => {
    const result = await storeOriginal({
      familyId,
      createdByUserId: adminUserId,
      type: "image",
      originalFilename: "同一张照片-副本.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
      extension: "png",
      capturedAt: null,
      timeSource: "import_time",
    });
    expect(result.status).toBe("duplicate");
    if (result.status !== "duplicate") return;
    expect(result.existing.sha256).toBe(sha256Of(PNG_BYTES));
  });

  it("跨家庭允许相同文件（隔离边界是 family）", async () => {
    // 直接种一个 family B（绕过 onboarding，它只服务首个管理员）
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${FAMILY_B}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    const result = await storeOriginal({
      familyId: FAMILY_B,
      createdByUserId: adminUserId,
      type: "image",
      originalFilename: "same.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
      extension: "png",
      capturedAt: null,
      timeSource: "import_time",
    });
    expect(result.status).toBe("stored");
  });

  it("getAsset 强制 family 作用域", async () => {
    const dup = await findOriginalBySha256(familyId, sha256Of(PNG_BYTES));
    expect(dup).toBeTruthy();
    // family A 的资产在 family B 视角不存在
    expect(await getAsset(FAMILY_B, dup!.id)).toBeUndefined();
    expect(await getAsset(familyId, "not-exist")).toBeUndefined();
  });
});

describe("原件不可覆盖 / 衍生物独立", () => {
  it("putOriginal 对已存在 key 抛错", () => {
    const storage = getAssetStorage();
    const key = buildOriginalStorageKey(familyId, "fixed-asset-id", "png", new Date());
    storage.putOriginal(familyId, "fixed-asset-id", "png", Buffer.from("v1"), new Date());
    expect(() =>
      storage.putOriginal(familyId, "fixed-asset-id", "png", Buffer.from("v2"), new Date()),
    ).toThrow(OriginalExistsError);
    // 原内容未被覆盖
    expect(storage.read(key).toString()).toBe("v1");
  });

  it("derivative 与原件路径分离，互不覆盖", async () => {
    const original = await findOriginalBySha256(familyId, sha256Of(PNG_BYTES));
    expect(original).toBeTruthy();
    const derivative = await storeDerivative(familyId, original!.id, "thumbnail", {
      mimeType: "image/png",
      extension: "png",
      buffer: Buffer.from("thumb-bytes"),
    });
    expect(derivative).toBeTruthy();
    expect(derivative!.storageKey).toMatch(/^derivatives\/thumbnails\//);
    expect(derivative!.storageKey).not.toBe(original!.storageKey);
    expect(derivative!.originalAssetId).toBe(original!.id);
    expect(derivative!.derivativeType).toBe("thumbnail");

    const storage = getAssetStorage();
    // 原件字节原封不动
    expect(storage.read(original!.storageKey).equals(PNG_BYTES)).toBe(true);
    expect(storage.read(derivative!.storageKey).toString()).toBe("thumb-bytes");
  });
});

describe("storage key 安全", () => {
  it("路径穿越 key 被拒绝", () => {
    const storage = getAssetStorage();
    const evil = [
      "originals/../../etc/passwd",
      "originals/foo/../../../capsule.sqlite",
      "../data/originals/x.png",
      "originals//x.png",
      "originals/x..png/../../y",
      "",
    ];
    for (const key of evil) {
      expect(() => storage.resolvePath(key), key).toThrow(StorageKeyError);
      expect(() => storage.read(key), key).toThrow(StorageKeyError);
      expect(() => storage.delete(key), key).toThrow(StorageKeyError);
    }
  });

  it("根目录之外的绝对路径 key 被拒绝", () => {
    const storage = getAssetStorage();
    expect(() => storage.resolvePath("originals/C:/windows/system32")).toThrow(
      StorageKeyError,
    );
  });

  it("正常 key 可解析到根目录之下", () => {
    const storage = getAssetStorage();
    const resolved = storage.resolvePath("originals/fam/2026/08/a.png");
    expect(resolved.startsWith(path.resolve(dataDir))).toBe(true);
  });
});
