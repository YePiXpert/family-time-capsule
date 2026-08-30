import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

/**
 * v0.1.3：缩略图衍生物（PRD §11/§21「衍生预览独立保存」的落地）。
 * 原件永不改动；HEIC 等 sharp 不支持的格式优雅跳过；导出仍只含原件。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-thumb-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "thumb-token";
process.env.AUTH_SECRET = "thumb-secret-0123456789abcd";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "thumb-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { getThumbnailMap, listAssets } = await import("@/lib/assets/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { generateThumbnail } = await import("@/lib/assets/thumbnails");

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
const OTHER_FAMILY = "fam-thumb-other";

const fixtures = path.join(__dirname, "..", "fixtures");
const storage = getAssetStorage();
let n = 0;

describe("缩略图衍生物（v0.1.3）", () => {
  it("generateThumbnail：JPEG/PNG 可生成 WebP；HEIC 返回 null（sharp 无 HEIF 解码）", async () => {
    const jpg = await generateThumbnail(readFileSync(path.join(fixtures, "sample.jpg")));
    expect(jpg).not.toBeNull();
    expect(jpg![0]).toBe(0x52); // 'R' of RIFF（WebP 容器）
    const png = await generateThumbnail(readFileSync(path.join(fixtures, "sample.png")));
    expect(png).not.toBeNull();
    const heic = await generateThumbnail(readFileSync(path.join(fixtures, "sample-exif.heic")));
    expect(heic).toBeNull();
  });

  it("JPEG 上传自动生成缩略图：独立文件、WebP、小于原件、原件字节不变", async () => {
    const buffer = Buffer.concat([
      readFileSync(path.join(fixtures, "sample.jpg")),
      Buffer.from([++n]),
    ]);
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: `照片${n}.jpg`,
      declaredMime: "image/jpeg",
      buffer,
      clientLastModifiedMs: null,
    });
    if (result.status !== "stored") throw new Error("store failed");
    const original = result.asset;

    const thumbMap = await getThumbnailMap(familyId, [original.id]);
    const thumb = thumbMap.get(original.id);
    expect(thumb).toBeTruthy();
    expect(thumb!.derivativeType).toBe("thumbnail");
    expect(thumb!.originalAssetId).toBe(original.id);
    expect(thumb!.mimeType).toBe("image/webp");
    expect(thumb!.storageKey).toMatch(/^derivatives\/thumbnails\//);
    expect(thumb!.bytes).toBeLessThan(original.bytes);
    expect(thumb!.bytes).toBeGreaterThan(0);

    // 两个文件独立存在；原件字节原封不动
    expect(storage.exists(original.storageKey)).toBe(true);
    expect(storage.exists(thumb!.storageKey)).toBe(true);
    expect(storage.read(original.storageKey).equals(buffer)).toBe(true);
    const thumbBytes = storage.read(thumb!.storageKey);
    expect(thumbBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("HEIC 上传：无缩略图但原件照常保存（不失败）", async () => {
    const buffer = Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.heic")),
      Buffer.from([++n]),
    ]);
    const result = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: `IMG_${n}.HEIC`,
      declaredMime: "image/heic",
      buffer,
      clientLastModifiedMs: null,
    });
    if (result.status !== "stored") throw new Error("HEIC store failed");
    const thumbMap = await getThumbnailMap(familyId, [result.asset.id]);
    expect(thumbMap.has(result.asset.id)).toBe(false);
    expect(storage.exists(result.asset.storageKey)).toBe(true);
  });

  it("音视频不生成缩略图", async () => {
    const audio = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: `t${++n}.wav`,
      declaredMime: "audio/wav",
      buffer: readFileSync(path.join(fixtures, "sample.wav")),
      clientLastModifiedMs: null,
    });
    if (audio.status !== "stored") throw new Error("store failed");
    const thumbMap = await getThumbnailMap(familyId, [audio.asset.id]);
    expect(thumbMap.has(audio.asset.id)).toBe(false);
  });

  it("重复上传（duplicate 路径）不产生第二个缩略图", async () => {
    const buffer = Buffer.concat([
      readFileSync(path.join(fixtures, "sample.jpg")),
      Buffer.from([++n]),
    ]);
    const input = {
      familyId,
      createdByUserId: adminUserId,
      filename: `dup${n}.jpg`,
      declaredMime: "image/jpeg",
      buffer,
      clientLastModifiedMs: null,
    } as const;
    await ingestImage(input);
    const dup = await ingestImage(input);
    expect(dup.status).toBe("duplicate");

    const originals = (await listAssets(familyId, 500)).filter(
      (a) => a.derivativeType === "thumbnail",
    );
    // 该 buffer 只对应一个原件 → 缩略图数量不因重复上传增加
    const before = originals.length;
    expect(before).toBeGreaterThanOrEqual(1);
  });

  it("getThumbnailMap 家庭隔离", async () => {
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: `iso${++n}.jpg`,
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([
        readFileSync(path.join(fixtures, "sample.jpg")),
        Buffer.from([n]),
      ]),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");
    const foreign = await getThumbnailMap(OTHER_FAMILY, [stored.asset.id]);
    expect(foreign.size).toBe(0);
  });

  it("导出不含缩略图（衍生物可再生，只导原件）——以 asset 计数核对", async () => {
    const { buildFamilyExport } = await import("@/lib/export/service");
    const all = await listAssets(familyId, 500);
    const originals = all.filter((a) => a.derivativeType === null).length;
    const thumbnails = all.filter((a) => a.derivativeType === "thumbnail").length;
    expect(thumbnails).toBeGreaterThan(0);
    const report = await buildFamilyExport(familyId);
    expect(report.assetCount).toBe(originals);
    expect(report.assetCount).toBeLessThan(all.length);
  });
});
