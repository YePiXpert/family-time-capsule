import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

/**
 * RH-001：真实媒体格式兼容矩阵。
 * 全部使用 scripts/make-fixtures.mjs 生成的结构合规样本（真实容器，非占位字节）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-realmedia-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "realmedia-token";
process.env.AUTH_SECRET = "realmedia-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const setupOk = await performSetup({
  token: "realmedia-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!setupOk.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { sha256Of } = await import("@/lib/assets/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { createInboxItemForAsset } = await import("@/lib/inbox/service");

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

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "..", "fixtures", name));

let counter = 0;
async function ingestFixture(opts: {
  kind: "image" | "audio" | "video";
  filename: string;
  declaredMime: string;
  bytes: Buffer;
  lastModified?: number | null;
}) {
  const suffix = Buffer.from([++counter]);
  const buffer = Buffer.concat([opts.bytes, suffix]); // 保证家庭内 sha 唯一
  const input = {
    familyId,
    createdByUserId: adminUserId,
    filename: opts.filename,
    declaredMime: opts.declaredMime,
    buffer,
    ...(opts.kind === "image"
      ? { clientLastModifiedMs: opts.lastModified ?? null }
      : { clientLastModifiedMs: opts.lastModified ?? null }),
  };
  return opts.kind === "image"
    ? ingestImage(input)
    : ingestMedia({ ...input, kind: opts.kind });
}

const storage = getAssetStorage();

describe("图片支持矩阵", () => {
  const cases: Array<[string, string, string]> = [
    ["sample.jpg", "image/jpeg", "jpg"],
    ["sample.png", "image/png", "png"],
    ["sample.heic", "image/heic", "heic"],
    ["sample.heif", "image/heif", "heif"],
    ["sample-exif-offset.jpg", "image/jpeg", "jpg"],
  ];

  for (const [file, mime, ext] of cases) {
    it(`${mime}（${file}）可保存：类型/扩展名/SHA-256/字节一致`, async () => {
      const result = await ingestFixture({
        kind: "image",
        filename: file,
        declaredMime: mime,
        bytes: fixture(file),
      });
      expect(result.status, `${file} → ${JSON.stringify(result)}`).toBe("stored");
      if (result.status !== "stored") return;
      const row = result.asset;
      expect(row.type).toBe("image");
      expect(row.mimeType).toBe(mime);
      expect(row.storageKey).toMatch(new RegExp(`\\.${ext}$`));
      // 字节级一致（缓冲 = fixture + 计数后缀）
      const sourceBytes = Buffer.concat([fixture(file), Buffer.from([counter])]);
      expect(row.sha256).toBe(sha256Of(sourceBytes));
      const storedBytes = storage.read(row.storageKey);
      expect(storedBytes.equals(sourceBytes)).toBe(true);
      // 绝不是被转换过的 JPEG（除非本来就是 jpeg）
      if (mime !== "image/jpeg") {
        expect(row.mimeType).not.toBe("image/jpeg");
      }
    });
  }

  it("HEIC 明确要求：不因无法生成缩略图/预览而拒绝原件", async () => {
    const result = await ingestFixture({
      kind: "image",
      filename: "IMG_0001.HEIC",
      declaredMime: "image/heic",
      bytes: fixture("sample.heic"),
    });
    expect(result.status).toBe("stored");
  });

  it("HEIC 与 HEIF 互表（声明 heic、内容 mif1）按同族放行", async () => {
    const result = await ingestFixture({
      kind: "image",
      filename: "cross-brand.heic",
      declaredMime: "image/heic",
      bytes: fixture("sample.heif"), // mif1 品牌
    });
    expect(result.status).toBe("stored");
  });
});

describe("音频支持矩阵", () => {
  const cases: Array<[string, string, string]> = [
    ["sample.m4a", "audio/m4a", "m4a"],
    ["sample.m4a", "audio/x-m4a", "m4a"],
    ["sample.m4a", "audio/mp4", "m4a"],
    ["sample.mp3", "audio/mpeg", "mp3"],
    ["sample.wav", "audio/wav", "wav"],
    ["sample.wav", "audio/x-wav", "wav"],
  ];

  for (const [file, mime, ext] of cases) {
    it(`${mime}（${file}）外部录音可上传`, async () => {
      const result = await ingestFixture({
        kind: "audio",
        filename: file,
        declaredMime: mime,
        bytes: fixture(file),
      });
      expect(result.status, `${mime}`).toBe("stored");
      if (result.status !== "stored") return;
      expect(result.asset.type).toBe("audio");
      expect(result.asset.storageKey).toMatch(new RegExp(`\\.${ext}$`));
    });
  }
});

describe("视频支持矩阵", () => {
  it("video/mp4 可上传，原件字节一致", async () => {
    const result = await ingestFixture({
      kind: "video",
      filename: "clip.mp4",
      declaredMime: "video/mp4",
      bytes: fixture("sample.mp4"),
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const sourceBytes = Buffer.concat([fixture("sample.mp4"), Buffer.from([counter])]);
    expect(storage.read(result.asset.storageKey).equals(sourceBytes)).toBe(true);
  });

  it("video/quicktime（MOV）可上传，原件保留", async () => {
    const result = await ingestFixture({
      kind: "video",
      filename: "IMG_0002.MOV",
      declaredMime: "video/quicktime",
      bytes: fixture("sample.mov"),
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;
    expect(row.mimeType).toBe("video/quicktime");
    expect(row.storageKey).toMatch(/\.mov$/);
    // ffprobe 缺失时 duration 可为 null（增强能力非硬依赖）；存在时为 number
    expect(row.durationMs === null || typeof row.durationMs === "number").toBe(true);
    const sourceBytes = Buffer.concat([fixture("sample.mov"), Buffer.from([counter])]);
    expect(storage.read(row.storageKey).equals(sourceBytes)).toBe(true);
  });
});

describe("无内嵌时间的 fallback（timeSource 正确性）", () => {
  it("图片无 EXIF、无 lastModified → import_time + capturedAt null", async () => {
    const result = await ingestFixture({
      kind: "image",
      filename: "screenshot-no-time.png",
      declaredMime: "image/png",
      bytes: fixture("sample.png"),
      lastModified: null,
    });
    if (result.status !== "stored") throw new Error("store failed");
    expect(result.asset.timeSource).toBe("import_time");
    expect(result.asset.capturedAt).toBeNull();
  });

  it("图片无 EXIF、有 lastModified → file_metadata", async () => {
    const ts = new Date("2026-08-20T02:30:00Z").getTime();
    const result = await ingestFixture({
      kind: "image",
      filename: "wechat-save.jpg",
      declaredMime: "image/jpeg",
      bytes: fixture("sample.jpg"), // 无 EXIF
      lastModified: ts,
    });
    if (result.status !== "stored") throw new Error("store failed");
    expect(result.asset.timeSource).toBe("file_metadata");
    expect(result.asset.capturedAt?.toISOString()).toBe("2026-08-20T02:30:00.000Z");
  });

  it("M4A 无内嵌时间 → import_time；有 lastModified → file_metadata", async () => {
    const a = await ingestFixture({
      kind: "audio",
      filename: "voice.m4a",
      declaredMime: "audio/m4a",
      bytes: fixture("sample.m4a"),
      lastModified: null,
    });
    if (a.status !== "stored") throw new Error("store failed");
    expect(a.asset.timeSource).toBe("import_time");
    expect(a.asset.capturedAt).toBeNull();

    const ts = new Date("2026-08-21T09:00:00Z").getTime();
    const b = await ingestFixture({
      kind: "audio",
      filename: "voice2.m4a",
      declaredMime: "audio/m4a",
      bytes: fixture("sample.m4a"),
      lastModified: ts,
    });
    if (b.status !== "stored") throw new Error("store failed");
    expect(b.asset.timeSource).toBe("file_metadata");
    expect(b.asset.capturedAt?.toISOString()).toBe("2026-08-21T09:00:00.000Z");
  });

  it("MOV 无内嵌时间 → import_time（ffprobe 缺失不影响）", async () => {
    const result = await ingestFixture({
      kind: "video",
      filename: "no-time.mov",
      declaredMime: "video/quicktime",
      bytes: fixture("sample.mov"),
      lastModified: null,
    });
    if (result.status !== "stored") throw new Error("store failed");
    expect(result.asset.timeSource).toBe("import_time");
  });
});

describe("无时间媒体进入收件箱 → needs_review", () => {
  it("import_time 素材自动标记缺少时间", async () => {
    const result = await ingestFixture({
      kind: "audio",
      filename: "review-me.m4a",
      declaredMime: "audio/m4a",
      bytes: fixture("sample.m4a"),
      lastModified: null,
    });
    if (result.status !== "stored") throw new Error("store failed");
    const item = await createInboxItemForAsset(familyId, result.asset);
    expect(item.status).toBe("needs_review");
  });
});

describe("sha256 记录验证", () => {
  it("所有已存 Asset 的 sha256 与磁盘内容一致", async () => {
    const { listAssets } = await import("@/lib/assets/service");
    const assets = await listAssets(familyId, 500);
    expect(assets.length).toBeGreaterThan(10);
    for (const a of assets) {
      const actual = createHash("sha256").update(storage.read(a.storageKey)).digest("hex");
      expect(actual, a.storageKey).toBe(a.sha256);
    }
  });
});
