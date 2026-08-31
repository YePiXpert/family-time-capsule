import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";
import type { MemoryAssistant } from "@/lib/ai/types";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-video-analysis-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "video-analysis-setup-token";
process.env.AUTH_SECRET = "video-analysis-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { asset: assetTable } = await import("@/db/schema/asset");
const { assetAnalysis } = await import("@/db/schema/analysis");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { requestVideoAnalysis } = await import("@/lib/analysis/service");
const { createAnalyzeAssetVideoHandler } = await import(
  "@/lib/ai/handlers/analyze-asset-video"
);

const setup = await performSetup({
  token: "video-analysis-setup-token",
  displayName: "爸爸",
  email: "dad-video@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "视频理解测试家庭",
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
if (!binding.familyTimezone || binding.childLaterUnlockAge === null) {
  throw new Error("binding incomplete");
}

const adminContext: FamilyContext = {
  userId: adminId,
  userName: "爸爸",
  familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone,
  childLaterUnlockAge: binding.childLaterUnlockAge,
};

const VISION_RUNTIME: AiJobRuntimeIdentity = {
  provider: { id: "test-provider", displayName: "Test", external: false },
  capabilities: {
    text: { available: false, model: null, reason: "not_configured" },
    vision: { available: true, model: "test-vision-v1", reason: "configured" },
    transcription: { available: false, model: null, reason: "not_configured" },
    embeddings: { available: false, model: null, reason: "not_configured" },
  },
};

const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.isChild, true))
  .get();
if (!child) throw new Error("child missing");

function makeEvent(): string {
  const id = randomUUID();
  const now = new Date("2026-08-21T00:00:00.000Z");
  getDb()
    .insert(memoryEvent)
    .values({
      id,
      familyId,
      childPersonId: child!.id,
      title: "一段记忆",
      occurredAt: now,
      occurredAtPrecision: "exact",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

let assetSerial = 0;
function makeVideoAsset(durationMs: number | null): string {
  assetSerial += 1;
  const now = new Date();
  const id = randomUUID();
  getDb()
    .insert(assetTable)
    .values({
      id,
      familyId,
      type: "video",
      originalFilename: `视频${assetSerial}.mp4`,
      mimeType: "video/mp4",
      bytes: 5_000,
      sha256: createHash("sha256").update(`video-${assetSerial}`).digest("hex"),
      storageKey: `originals/${familyId}/${id}/video.mp4`,
      capturedAt: now,
      importedAt: now,
      timeSource: "file_metadata",
      width: 1920,
      height: 1080,
      durationMs,
      createdByUserId: adminId,
      originalAssetId: null,
      derivativeType: null,
      createdAt: now,
    })
    .run();
  return id;
}

function linkAsset(eventId: string, assetId: string): void {
  getDb()
    .insert(memoryEventAsset)
    .values({
      id: randomUUID(),
      memoryEventId: eventId,
      assetId,
      familyId,
      createdAt: new Date(),
    })
    .run();
}

function makeLease(entityId: string) {
  return {
    jobId: randomUUID(),
    familyId,
    jobType: "analyze.asset_video.v1" as const,
    entityType: "asset" as const,
    entityId,
    requiredCapability: "vision" as const,
    providerId: "test-provider",
    model: "test-vision-v1",
    providerExternal: false,
    consentVersion: null,
    triggerMode: "manual" as const,
    contentVisibility: "family" as const,
    requestedByUserId: adminId,
    attemptNumber: 1,
    leaseGeneration: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    workerId: "test-worker",
  };
}

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function makeVisionAssistant(): MemoryAssistant {
  return {
    provider: VISION_RUNTIME.provider,
    capabilities: VISION_RUNTIME.capabilities,
    supports: (capability: string) => capability === "vision",
    generateText: vi.fn().mockRejectedValue(new Error("not supported")),
    analyzeImage: vi.fn().mockResolvedValue({
      text: "【描述】孩子在客厅地毯上爬行。\n\n【图中文字】\n",
      finishReason: "stop",
      provenance: {
        providerId: "test-provider",
        providerName: "Test",
        model: "test-vision-v1",
      },
    }),
    transcribeAudio: vi.fn().mockRejectedValue(new Error("not supported")),
    createEmbeddings: vi.fn().mockRejectedValue(new Error("not supported")),
  };
}

describe("M3-G：视频理解（analyze.asset_video.v1）", () => {
  it("抽代表帧 → 逐帧 vision → 汇总为一行 video_frames analysis", async () => {
    const eventId = makeEvent();
    const assetId = makeVideoAsset(60_000);
    linkAsset(eventId, assetId);

    const handler = createAnalyzeAssetVideoHandler({
      extractFrames: async (_absPath, options) => {
        expect(options.durationSeconds).toBe(60);
        return {
          status: "ok",
          frames: [
            { atSeconds: 0.5, bytes: fakeJpeg },
            { atSeconds: 30, bytes: fakeJpeg },
            { atSeconds: 59.5, bytes: fakeJpeg },
          ],
        };
      },
      probe: async () => ({ durationMs: 60_000 }),
    });

    const lease = makeLease(assetId);
    const assistant = makeVisionAssistant();
    const result = await handler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      result.commit(tx, {
        jobId: lease.jobId,
        familyId,
        entityType: "asset",
        entityId: assetId,
        requestedByUserId: adminId,
        attemptNumber: 1,
      }),
    );

    expect(assistant.analyzeImage).toHaveBeenCalledTimes(3);

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, assetId))
      .get()!;
    expect(row.analyzedVia).toBe("video_frames");
    expect(row.provider).toBe("test-provider");
    expect(row.description).toContain("[00:00]");
    expect(row.description).toContain("[00:30]");
    expect(row.description).toContain("3 个代表帧");
    expect(row.description).toContain("孩子在客厅地毯上爬行");

    // rerun upsert：仍是单行
    const rerun = await handler({
      lease: makeLease(assetId),
      assistant: makeVisionAssistant(),
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      rerun.commit(tx, {
        jobId: randomUUID(),
        familyId,
        entityType: "asset",
        entityId: assetId,
        requestedByUserId: adminId,
        attemptNumber: 1,
      }),
    );
    const count = getDb()
      .select({ id: assetAnalysis.id })
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, assetId))
      .all();
    expect(count).toHaveLength(1);
  });

  it("ffmpeg 不可用 → 优雅降级（非重试失败，不写任何行）", async () => {
    const assetId = makeVideoAsset(10_000);
    const handler = createAnalyzeAssetVideoHandler({
      extractFrames: async () => ({ status: "unavailable" }),
    });
    await expect(
      handler({
        lease: makeLease(assetId),
        assistant: makeVisionAssistant(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "ffmpeg_unavailable", retryable: false });

    expect(
      getDb()
        .select({ id: assetAnalysis.id })
        .from(assetAnalysis)
        .where(eq(assetAnalysis.assetId, assetId))
        .all(),
    ).toHaveLength(0);
  });

  it("抽帧全部失败 → 非重试失败；非视频素材直接拒绝", async () => {
    const assetId = makeVideoAsset(10_000);
    const failedHandler = createAnalyzeAssetVideoHandler({
      extractFrames: async () => ({ status: "failed" }),
    });
    await expect(
      failedHandler({
        lease: makeLease(assetId),
        assistant: makeVisionAssistant(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "frame_extraction_failed", retryable: false });

    const eventId = makeEvent();
    const imageAssetId = randomUUID();
    const now = new Date();
    getDb()
      .insert(assetTable)
      .values({
        id: imageAssetId,
        familyId,
        type: "image",
        originalFilename: "照片.jpg",
        mimeType: "image/jpeg",
        bytes: 100,
        sha256: createHash("sha256").update("img").digest("hex"),
        storageKey: `originals/${familyId}/${imageAssetId}/photo.jpg`,
        capturedAt: now,
        importedAt: now,
        timeSource: "file_metadata",
        width: 100,
        height: 100,
        durationMs: null,
        createdByUserId: adminId,
        originalAssetId: null,
        derivativeType: null,
        createdAt: now,
      })
      .run();
    linkAsset(eventId, imageAssetId);

    const handler = createAnalyzeAssetVideoHandler();
    await expect(
      handler({
        lease: makeLease(imageAssetId),
        assistant: makeVisionAssistant(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported_asset_type", retryable: false });
  });

  it("无时长元数据时通过 ffprobe 补齐；请求侧校验类型与可见性", async () => {
    const eventId = makeEvent();
    const assetId = makeVideoAsset(null);
    linkAsset(eventId, assetId);

    let probedPath: string | null = null;
    const handler = createAnalyzeAssetVideoHandler({
      extractFrames: async (_absPath, options) => {
        expect(options.durationSeconds).toBe(12);
        return { status: "ok", frames: [{ atSeconds: 6, bytes: fakeJpeg }] };
      },
      probe: async (absPath) => {
        probedPath = absPath;
        return { durationMs: 12_000 };
      },
    });
    const lease = makeLease(assetId);
    const result = await handler({
      lease,
      assistant: makeVisionAssistant(),
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      result.commit(tx, {
        jobId: lease.jobId,
        familyId,
        entityType: "asset",
        entityId: assetId,
        requestedByUserId: adminId,
        attemptNumber: 1,
      }),
    );
    expect(probedPath).toContain(assetId);
    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, assetId))
      .get()!;
    expect(row.description).toContain("[00:06]");

    // 请求侧：可见的原始视频可入队；不存在的素材报错
    const queued = requestVideoAnalysis(adminContext, assetId, {
      runtime: VISION_RUNTIME,
    });
    expect(queued.ok).toBe(true);
    const missing = requestVideoAnalysis(adminContext, randomUUID(), {
      runtime: VISION_RUNTIME,
    });
    expect(missing).toEqual({ ok: false, error: "asset_not_found" });
  });
});
