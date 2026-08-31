import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-analyze-handler-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "analyze-handler-setup-token";
process.env.AUTH_SECRET = "analyze-handler-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { asset } = await import("@/db/schema/asset");
const { assetAnalysis } = await import("@/db/schema/analysis");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { analyzeAssetImageHandler } = await import(
  "@/lib/ai/handlers/analyze-asset-image"
);
const { getAssetStorage } = await import("@/lib/assets/storage");

const setup = await performSetup({
  token: "analyze-handler-setup-token",
  displayName: "图像分析测试管理员",
  email: "analyze-handler-admin@example.com",
  password: "analyze-handler-password-long-enough",
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "analyze-handler-admin@example.com"))
  .get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "图像分析测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2020-05-01",
  selfDisplayName: "管理员",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;
const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
  .get();
if (!child) throw new Error("child missing");

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeAssetFile(storageKey: string, content: string): void {
  const targetPath = getAssetStorage().resolvePath(storageKey);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, Buffer.from(content));
}

function makeAsset(
  overrides: Partial<typeof asset.$inferInsert> = {},
): { id: string; storageKey: string; sha256: string } {
  const id = randomUUID();
  const content = `fake image bytes for analysis ${randomUUID()}`;
  const sha256 = sha(content);
  const date = new Date("2026-08-31T00:00:00.000Z");
  const storageKey = `originals/${familyId}/${date.getFullYear()}/${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}/${id}.jpg`;
  if (!overrides.storageKey) {
    writeAssetFile(storageKey, content);
  }
  getDb()
    .insert(asset)
    .values({
      id,
      familyId,
      type: "image",
      originalFilename: "original-name.jpg",
      mimeType: "image/jpeg",
      bytes: Buffer.from(content).byteLength,
      sha256,
      storageKey,
      importedAt: date,
      timeSource: "import_time",
      createdByUserId: admin!.id,
      originalAssetId: null,
      derivativeType: null,
      ...overrides,
    })
    .run();
  return { id, storageKey, sha256 };
}

function makeLease(entityId: string): import("@/lib/ai/jobs").AiJobLease {
  return {
    jobId: randomUUID(),
    familyId,
    jobType: "analyze.asset_image.v1",
    entityType: "asset",
    entityId,
    requiredCapability: "vision",
    providerId: "deterministic-fake",
    model: "fake-vision-v1",
    providerExternal: false,
    consentVersion: null,
    triggerMode: "manual",
    contentVisibility: "family",
    requestedByUserId: admin!.id,
    attemptNumber: 1,
    leaseGeneration: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    workerId: "test-worker",
  };
}

const assistant = new DeterministicFakeMemoryAssistant({ seed: "handler-test" });

describe("analyze.asset_image.v1 handler", () => {
  it("commits a machine analysis on happy path (original)", async () => {
    const { id } = makeAsset();
    const lease = makeLease(id);
    const result = await analyzeAssetImageHandler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      result.commit(tx, {
        jobId: lease.jobId,
        familyId: lease.familyId,
        entityType: lease.entityType,
        entityId: lease.entityId,
        requestedByUserId: lease.requestedByUserId,
        attemptNumber: lease.attemptNumber,
      }),
    );

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, id))
      .get();
    expect(row).toBeTruthy();
    expect(row!.description).toContain("Deterministic fake image analysis");
    expect(row!.ocrText).toBeNull();
    expect(row!.analyzedVia).toBe("original");
    expect(row!.createdByJobId).toBe(lease.jobId);
    expect(row!.sourceSha256).toBe(
      getDb().select({ sha256: asset.sha256 }).from(asset).where(eq(asset.id, id)).get()!.sha256,
    );
  });

  it("falls back to thumbnail for unsupported MIME like HEIC", async () => {
    const { id: originalId } = makeAsset({ mimeType: "image/heic" });
    const original = getDb()
      .select()
      .from(asset)
      .where(eq(asset.id, originalId))
      .get()!;

    const derivativeId = randomUUID();
    const derivativeContent = `thumbnail bytes for heic ${randomUUID()}`;
    const derivativeSha256 = sha(derivativeContent);
    const date = new Date("2026-08-31T00:00:00.000Z");
    const derivativeStorageKey = `derivatives/thumbnails/${familyId}/${date.getFullYear()}/${String(
      date.getMonth() + 1,
    ).padStart(2, "0")}/${derivativeId}.jpg`;
    writeAssetFile(derivativeStorageKey, derivativeContent);
    getDb()
      .insert(asset)
      .values({
        id: derivativeId,
        familyId,
        type: "image",
        originalFilename: `thumbnail-${original.originalFilename}`,
        mimeType: "image/jpeg",
        bytes: Buffer.from(derivativeContent).byteLength,
        sha256: derivativeSha256,
        storageKey: derivativeStorageKey,
        importedAt: date,
        timeSource: original.timeSource,
        createdByUserId: admin!.id,
        originalAssetId: originalId,
        derivativeType: "thumbnail",
      })
      .run();

    const lease = makeLease(originalId);
    const result = await analyzeAssetImageHandler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      result.commit(tx, {
        jobId: lease.jobId,
        familyId: lease.familyId,
        entityType: lease.entityType,
        entityId: lease.entityId,
        requestedByUserId: lease.requestedByUserId,
        attemptNumber: lease.attemptNumber,
      }),
    );

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, originalId))
      .get();
    expect(row).toBeTruthy();
    expect(row!.analyzedVia).toBe("thumbnail");
    expect(row!.sourceSha256).toBe(original.sha256);
  });

  it("rerun replaces an existing analysis", async () => {
    const { id, sha256 } = makeAsset();
    const now = new Date();
    getDb()
      .insert(assetAnalysis)
      .values({
        id: randomUUID(),
        familyId,
        assetId: id,
        description: "old description",
        ocrText: "old ocr",
        provider: "old",
        model: "old",
        sourceSha256: sha256,
        analyzedVia: "original",
        createdByJobId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const lease = makeLease(id);
    const result = await analyzeAssetImageHandler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      result.commit(tx, {
        jobId: lease.jobId,
        familyId: lease.familyId,
        entityType: lease.entityType,
        entityId: lease.entityId,
        requestedByUserId: lease.requestedByUserId,
        attemptNumber: lease.attemptNumber,
      }),
    );

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, id))
      .get();
    expect(row!.description).toContain("Deterministic fake image analysis");
    expect(row!.provider).toBe("deterministic-fake");
    expect(row!.createdByJobId).toBe(lease.jobId);
  });

  it("puts full text in description when parser cannot find both markers", async () => {
    const { id } = makeAsset();
    const lease = makeLease(id);
    const spyAssistant = new DeterministicFakeMemoryAssistant({
      seed: "handler-test",
    });
    spyAssistant.analyzeImage = async () => ({
      text: "这张图片里只有一些没有章节的自由文本。",
      finishReason: "stop",
      provenance: {
        providerId: "deterministic-fake",
        providerName: "Deterministic offline fake",
        model: "fake-vision-v1",
      },
    });

    const result = await analyzeAssetImageHandler({
      lease,
      assistant: spyAssistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      result.commit(tx, {
        jobId: lease.jobId,
        familyId: lease.familyId,
        entityType: lease.entityType,
        entityId: lease.entityId,
        requestedByUserId: lease.requestedByUserId,
        attemptNumber: lease.attemptNumber,
      }),
    );

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, id))
      .get();
    expect(row!.description).toBe("这张图片里只有一些没有章节的自由文本。");
    expect(row!.ocrText).toBeNull();
  });

  it("rejects with safe non-retryable codes", async () => {
    const imageAsset = makeAsset();
    const derivativeImage = makeAsset({
      originalAssetId: imageAsset.id,
      derivativeType: "preview",
    });
    const audioAsset = makeAsset({ type: "audio", mimeType: "audio/mpeg" });
    const tooLarge = makeAsset({ bytes: 21 * 1024 * 1024 });
    const heicNoThumbnail = makeAsset({ mimeType: "image/heic" });

    await expect(
      analyzeAssetImageHandler({
        lease: makeLease("missing-asset"),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "asset_not_found", retryable: false });

    await expect(
      analyzeAssetImageHandler({
        lease: makeLease(derivativeImage.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "derivative_not_analyzable",
      retryable: false,
    });

    await expect(
      analyzeAssetImageHandler({
        lease: makeLease(audioAsset.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported_asset_type", retryable: false });

    await expect(
      analyzeAssetImageHandler({
        lease: makeLease(tooLarge.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "image_too_large", retryable: false });

    await expect(
      analyzeAssetImageHandler({
        lease: makeLease(heicNoThumbnail.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported_media_type", retryable: false });
  });
});
