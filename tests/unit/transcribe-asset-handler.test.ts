import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-transcribe-handler-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "transcribe-handler-setup-token";
process.env.AUTH_SECRET = "transcribe-handler-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { asset } = await import("@/db/schema/asset");
const { assetTranscript } = await import("@/db/schema/transcript");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { transcribeAssetHandler } = await import(
  "@/lib/ai/handlers/transcribe-asset"
);
const { getAssetStorage } = await import("@/lib/assets/storage");

const setup = await performSetup({
  token: "transcribe-handler-setup-token",
  displayName: "转录测试管理员",
  email: "transcribe-handler-admin@example.com",
  password: "transcribe-handler-password-long-enough",
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "transcribe-handler-admin@example.com"))
  .get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "转录测试家庭",
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

function makeAsset(
  overrides: Partial<typeof asset.$inferInsert> = {},
): { id: string; storageKey: string; sha256: string; buffer: Buffer } {
  const id = randomUUID();
  const buffer = Buffer.from(`fake audio bytes for transcription ${randomUUID()}`);
  const sha256 = sha(buffer.toString("base64"));
  const date = new Date("2026-08-31T00:00:00.000Z");
  const storageKey = `originals/${familyId}/${date.getFullYear()}/${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}/${id}.mp3`;
  getDb()
    .insert(asset)
    .values({
      id,
      familyId,
      type: "audio",
      originalFilename: "original-name.mp3",
      mimeType: "audio/mpeg",
      bytes: buffer.byteLength,
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
  const targetPath = getAssetStorage().resolvePath(storageKey);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, buffer);
  return { id, storageKey, sha256, buffer };
}

function makeLease(entityId: string): import("@/lib/ai/jobs").AiJobLease {
  return {
    jobId: randomUUID(),
    familyId,
    jobType: "transcribe.asset.v1",
    entityType: "asset",
    entityId,
    requiredCapability: "transcription",
    providerId: "deterministic-fake",
    model: "fake-stt-v1",
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

describe("transcribe.asset.v1 handler", () => {
  it("commits a machine transcript on happy path", async () => {
    const { id } = makeAsset();
    const lease = makeLease(id);
    const result = await transcribeAssetHandler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) => result.commit(tx, {
      jobId: lease.jobId,
      familyId: lease.familyId,
      entityType: lease.entityType,
      entityId: lease.entityId,
      requestedByUserId: lease.requestedByUserId,
      attemptNumber: lease.attemptNumber,
    }));

    const row = getDb()
      .select()
      .from(assetTranscript)
      .where(eq(assetTranscript.assetId, id))
      .get();
    expect(row).toBeTruthy();
    expect(row!.status).toBe("machine");
    expect(row!.rawTranscript).toContain("Deterministic fake transcript");
    expect(row!.editedTranscript).toBeNull();
    expect(row!.createdByJobId).toBe(lease.jobId);
    expect(row!.sourceSha256).toBe(
      getDb().select({ sha256: asset.sha256 }).from(asset).where(eq(asset.id, id)).get()!.sha256,
    );
  });

  it("rerun preserves an existing user-edited transcript", async () => {
    const { id, sha256 } = makeAsset();
    const now = new Date();
    getDb()
      .insert(assetTranscript)
      .values({
        id: randomUUID(),
        familyId,
        assetId: id,
        language: null,
        provider: "old",
        model: "old",
        rawTranscript: "old machine text",
        editedTranscript: "user edited text",
        segmentsJson: null,
        status: "user_edited",
        sourceSha256: sha256,
        createdByJobId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const lease = makeLease(id);
    const result = await transcribeAssetHandler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) => result.commit(tx, {
      jobId: lease.jobId,
      familyId: lease.familyId,
      entityType: lease.entityType,
      entityId: lease.entityId,
      requestedByUserId: lease.requestedByUserId,
      attemptNumber: lease.attemptNumber,
    }));

    const row = getDb()
      .select()
      .from(assetTranscript)
      .where(eq(assetTranscript.assetId, id))
      .get();
    expect(row!.editedTranscript).toBe("user edited text");
    expect(row!.status).toBe("user_edited");
    expect(row!.rawTranscript).toContain("Deterministic fake transcript");
    expect(row!.provider).toBe("deterministic-fake");
  });

  it("uses a neutral filename and never the family original filename", async () => {
    const { id } = makeAsset({ originalFilename: "family-secret-name.mp3" });
    const lease = makeLease(id);
    let capturedFileName: string | undefined;
    const spyAssistant = new DeterministicFakeMemoryAssistant({
      seed: "handler-test",
    });
    const original = spyAssistant.transcribeAudio.bind(spyAssistant);
    spyAssistant.transcribeAudio = async (input) => {
      capturedFileName = input.audio.fileName;
      return original(input);
    };

    const result = await transcribeAssetHandler({
      lease,
      assistant: spyAssistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) => result.commit(tx, {
      jobId: lease.jobId,
      familyId: lease.familyId,
      entityType: lease.entityType,
      entityId: lease.entityId,
      requestedByUserId: lease.requestedByUserId,
      attemptNumber: lease.attemptNumber,
    }));

    expect(capturedFileName).toBe("audio.mp3");
    expect(capturedFileName).not.toContain("family-secret-name");
  });

  it("rejects with safe non-retryable codes", async () => {
    const audioAsset = makeAsset();
    const derivativeAudio = makeAsset({
      originalAssetId: audioAsset.id,
      derivativeType: "transcode",
    });
    const imageAsset = makeAsset({ type: "image", mimeType: "image/jpeg" });
    const videoUnsupported = makeAsset({
      type: "video",
      mimeType: "video/quicktime",
    });
    const tooLarge = makeAsset({ bytes: 26 * 1024 * 1024 });

    await expect(
      transcribeAssetHandler({
        lease: makeLease("missing-asset"),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "asset_not_found", retryable: false });

    await expect(
      transcribeAssetHandler({
        lease: makeLease(derivativeAudio.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "derivative_not_transcribable",
      retryable: false,
    });

    await expect(
      transcribeAssetHandler({
        lease: makeLease(imageAsset.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported_asset_type", retryable: false });

    await expect(
      transcribeAssetHandler({
        lease: makeLease(videoUnsupported.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported_media_type", retryable: false });

    await expect(
      transcribeAssetHandler({
        lease: makeLease(tooLarge.id),
        assistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "audio_too_large", retryable: false });
  });
});
