import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

/**
 * v0.1.2：用真实 ffprobe 二进制（ffprobe-static，devDependency）验证增强元数据路径。
 * 关闭了 v0.1.1 的已知风险 5：duration / creation_time 提取此前未在真实 ffmpeg 环境跑过。
 * FFPROBE_PATH 在动态导入前设置（probeMedia 每次调用时读取该变量）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-ffprobe-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "ffprobe-token";
process.env.AUTH_SECRET = "ffprobe-secret-0123456789abcd";
// 注入真实 ffprobe 二进制（跨平台：win32/linux/darwin 随平台安装）
process.env.FFPROBE_PATH = (
  createRequire(import.meta.url)("ffprobe-static") as { path: string }
).path;

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "ffprobe-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestMedia } = await import("@/lib/assets/ingest");
const { probeMedia } = await import("@/lib/metadata/ffprobe");

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

describe("真实 ffprobe 元数据提取（v0.1.2）", () => {
  it("单个坏文件不会把后续有效媒体的 ffprobe 全局禁用", async () => {
    const malformed = path.join(dataDir, "malformed.mp4");
    // ISO-BMFF 魔数外观成立但容器不完整，ffprobe 应只拒绝这一份文件。
    writeFileSync(
      malformed,
      Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    );
    expect(await probeMedia(malformed)).toBeNull();

    const valid = await probeMedia(path.join(fixtures, "sample.mov"));
    expect(valid?.durationMs).toBe(1000);
    expect(valid?.creationTime?.toISOString()).toBe("2026-08-15T05:00:00.000Z");
  });

  it("MOV：duration=1s、creation_time=2026-08-15T05:00Z、embedded_metadata", async () => {
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "IMG_0001.MOV",
      declaredMime: "video/quicktime",
      buffer: readFileSync(path.join(fixtures, "sample.mov")),
      clientLastModifiedMs: null, // 不给 fallback，逼出容器内嵌时间
    });
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = result.asset;

    // mvhd: timescale 600 / duration 600 → 1000ms
    expect(row.durationMs).toBe(1000);
    // mvhd creation_time（QuickTime 纪元 1904）→ ffprobe tags.creation_time
    expect(row.capturedAt?.toISOString()).toBe("2026-08-15T05:00:00.000Z");
    expect(row.timeSource).toBe("embedded_metadata");
    // 容器元数据快照
    const meta = JSON.parse(row.metadataJson ?? "{}");
    expect(meta.container.durationMs).toBe(1000);
    expect(meta.container.formatName).toContain("mov");
    expect(meta.ffprobe).toBeTruthy();
  });

  it("WAV：duration=1s（真实可播放样本）", async () => {
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "tone.wav",
      declaredMime: "audio/wav",
      buffer: readFileSync(path.join(fixtures, "sample.wav")),
      clientLastModifiedMs: null,
    });
    if (result.status !== "stored") throw new Error("store failed");
    expect(result.asset.durationMs).toBe(1000);
    // WAV 无 creation_time → 无 fallback 时 import_time
    expect(result.asset.timeSource).toBe("import_time");
  });

  it("M4A：可探测容器（duration 可为 null，取决于样本轨道完整性）", async () => {
    const result = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "audio",
      filename: "memo.m4a",
      declaredMime: "audio/m4a",
      buffer: readFileSync(path.join(fixtures, "sample.m4a")),
      clientLastModifiedMs: null,
    });
    if (result.status !== "stored") throw new Error("store failed");
    // 关键断言：ffprobe 存在时流程照常，不因样本缺 track 而失败
    expect(["import_time", "embedded_metadata", "file_metadata"]).toContain(
      result.asset.timeSource,
    );
  });
});
