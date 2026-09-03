import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
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

  it("DB 插入失败会回收已落盘文件，不留下孤儿原件", async () => {
    const before = listFiles(path.join(dataDir, "originals", familyId));
    await expect(
      storeOriginal({
        familyId,
        createdByUserId: "missing-user",
        type: "image",
        originalFilename: "must-rollback.png",
        mimeType: "image/png",
        buffer: Buffer.concat([PNG_BYTES, Buffer.from("db-failure")]),
        extension: "png",
        capturedAt: null,
        timeSource: "import_time",
      }),
    ).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
    expect(listFiles(path.join(dataDir, "originals", familyId))).toEqual(before);
  });

  it("20 路并发相同上传只保留一个 canonical 行和一个原件", async () => {
    const bytes = Buffer.concat([PNG_BYTES, Buffer.from("parallel-canonical")]);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        storeOriginal({
          familyId,
          createdByUserId: adminUserId,
          type: "image",
          originalFilename: `parallel-${i}.png`,
          mimeType: "image/png",
          buffer: bytes,
          extension: "png",
          capturedAt: null,
          timeSource: "import_time",
        }),
      ),
    );
    expect(results.filter((result) => result.status === "stored")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(19);
    const ids = new Set(
      results.map((result) =>
        result.status === "stored" ? result.asset.id : result.existing.id,
      ),
    );
    expect(ids.size).toBe(1);
    const canonical = await findOriginalBySha256(familyId, sha256Of(bytes));
    expect(canonical).toBeTruthy();
    const matchingFiles = listFiles(path.join(dataDir, "originals", familyId)).filter(
      (file) => file.includes(canonical!.id),
    );
    expect(matchingFiles).toHaveLength(1);
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

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else result.push(full);
  }
  return result.sort();
}

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

  it("putOriginalStream 流式写入并返回实际字节数与 SHA-256", async () => {
    const storage = getAssetStorage();
    const assetId = "streamed-original-success";
    const date = new Date("2026-09-03T12:00:00.000Z");
    const bytes = Buffer.concat([
      Buffer.from("streamed-original-"),
      Buffer.alloc(128 * 1024, 0x5a),
    ]);

    const result = await storage.putOriginalStream(
      familyId,
      assetId,
      "bin",
      Readable.from([bytes.subarray(0, 17), bytes.subarray(17)]),
      date,
    );

    expect(result).toEqual({
      storageKey: buildOriginalStorageKey(familyId, assetId, "bin", date),
      bytes: bytes.byteLength,
      sha256: sha256Of(bytes),
    });
    expect(storage.read(result.storageKey)).toEqual(bytes);
  });

  it("putOriginalStream 对同 key 并发安全地拒绝覆盖", async () => {
    const storage = getAssetStorage();
    const assetId = "streamed-original-no-overwrite";
    const date = new Date("2026-09-03T13:00:00.000Z");
    const key = buildOriginalStorageKey(familyId, assetId, "bin", date);
    const candidates = [
      Buffer.from("stream-candidate-a"),
      Buffer.from("stream-candidate-b"),
    ];

    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        storage.putOriginalStream(
          familyId,
          assetId,
          "bin",
          Readable.from([candidate]),
          date,
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.any(OriginalExistsError),
    });
    expect(
      candidates.some((candidate) => storage.read(key).equals(candidate)),
    ).toBe(true);

    const unreadSource = Readable.from([Buffer.from("must-not-be-consumed")]);
    await expect(
      storage.putOriginalStream(familyId, assetId, "bin", unreadSource, date),
    ).rejects.toBeInstanceOf(OriginalExistsError);
    expect(unreadSource.destroyed).toBe(true);
  });

  it("putOriginalStream 在来源流失败时清理目标与临时文件", async () => {
    const storage = getAssetStorage();
    const assetId = "streamed-original-source-error";
    const date = new Date("2026-09-03T14:00:00.000Z");
    const key = buildOriginalStorageKey(familyId, assetId, "bin", date);
    const failingStream = Readable.from(
      (async function* () {
        yield Buffer.from("partial-bytes");
        throw new Error("synthetic source failure");
      })(),
    );

    await expect(
      storage.putOriginalStream(familyId, assetId, "bin", failingStream, date),
    ).rejects.toThrow("synthetic source failure");
    expect(storage.exists(key)).toBe(false);
    expect(listFiles(dataDir).filter((file) => file.includes(assetId))).toEqual([]);
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

  it("不同原件可各自保留字节相同的缩略图", async () => {
    const firstOriginal = await findOriginalBySha256(
      familyId,
      sha256Of(PNG_BYTES),
    );
    expect(firstOriginal).toBeTruthy();

    const secondOriginalBytes = Buffer.concat([
      PNG_BYTES,
      Buffer.from("second-original-for-shared-thumbnail"),
    ]);
    const secondOriginalResult = await storeOriginal({
      familyId,
      createdByUserId: adminUserId,
      type: "image",
      originalFilename: "第二张原图.png",
      mimeType: "image/png",
      buffer: secondOriginalBytes,
      extension: "png",
      capturedAt: null,
      timeSource: "import_time",
    });
    expect(secondOriginalResult.status).toBe("stored");
    if (secondOriginalResult.status !== "stored") return;

    const sharedThumbnailBytes = Buffer.from("identical-thumbnail-bytes");
    const firstThumbnail = await storeDerivative(
      familyId,
      firstOriginal!.id,
      "thumbnail",
      {
        mimeType: "image/png",
        extension: "png",
        buffer: sharedThumbnailBytes,
      },
    );
    const secondThumbnail = await storeDerivative(
      familyId,
      secondOriginalResult.asset.id,
      "thumbnail",
      {
        mimeType: "image/png",
        extension: "png",
        buffer: sharedThumbnailBytes,
      },
    );

    expect(firstThumbnail).toBeTruthy();
    expect(secondThumbnail).toBeTruthy();
    expect(firstThumbnail!.id).not.toBe(secondThumbnail!.id);
    expect(firstThumbnail!.sha256).toBe(secondThumbnail!.sha256);
    expect(firstThumbnail!.originalAssetId).toBe(firstOriginal!.id);
    expect(secondThumbnail!.originalAssetId).toBe(
      secondOriginalResult.asset.id,
    );

    const stored = (await db.all(
      sql`SELECT id, original_asset_id
            FROM asset
           WHERE family_id = ${familyId}
             AND sha256 = ${sha256Of(sharedThumbnailBytes)}
             AND original_asset_id IS NOT NULL
        ORDER BY original_asset_id`,
    )) as Array<{ id: string; original_asset_id: string }>;
    expect(stored).toEqual([
      {
        id: firstThumbnail!.id,
        original_asset_id: firstOriginal!.id,
      },
      {
        id: secondThumbnail!.id,
        original_asset_id: secondOriginalResult.asset.id,
      },
    ].sort((left, right) =>
      left.original_asset_id.localeCompare(right.original_asset_id),
    ));

    const storage = getAssetStorage();
    expect(storage.read(firstThumbnail!.storageKey)).toEqual(
      sharedThumbnailBytes,
    );
    expect(storage.read(secondThumbnail!.storageKey)).toEqual(
      sharedThumbnailBytes,
    );
  });

  it("SQLite 用 partial unique index 查询并约束原件", async () => {
    const indexes = (await db.all(
      sql.raw("PRAGMA index_list('asset')"),
    )) as Array<{ name: string; unique: number; partial: number }>;
    expect(indexes.find((candidate) => candidate.name === "asset_family_sha_idx"))
      .toMatchObject({ unique: 1, partial: 1 });

    const definitions = (await db.all(
      sql`SELECT sql
            FROM sqlite_schema
           WHERE type = 'index'
             AND name = 'asset_family_sha_idx'`,
    )) as Array<{ sql: string }>;
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.sql).toMatch(
      /WHERE\s+"asset"\."original_asset_id"\s+is\s+null$/i,
    );

    const plan = (await db.all(
      sql`EXPLAIN QUERY PLAN
          SELECT id
            FROM asset
           WHERE family_id = ${familyId}
             AND sha256 = ${sha256Of(PNG_BYTES)}
             AND original_asset_id IS NULL`,
    )) as Array<{ detail: string }>;
    expect(plan.some((step) => step.detail.includes("asset_family_sha_idx"))).toBe(
      true,
    );
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
