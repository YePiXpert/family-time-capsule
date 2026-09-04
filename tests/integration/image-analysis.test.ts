import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-image-analysis-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "image-analysis-setup-token";
process.env.AUTH_SECRET = "image-analysis-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may keep the SQLite WAL handle briefly after close; ignore cleanup.
  }
});

const { getDb } = await import("@/db");
const { assetAnalysis } = await import("@/db/schema/analysis");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { contribution } = await import("@/db/schema/contribution");
const { memoryEvent } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { requestImageAnalysis } = await import("@/lib/analysis/service");
const { runAiWorkerOnce } = await import("@/jobs/runtime");
const { createProductionAiJobRegistry } = await import("@/jobs/registry");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { buildFamilyExport } = await import("@/lib/export/service");

const setup = await performSetup({
  token: "image-analysis-setup-token",
  displayName: "图像分析管理员",
  email: "image-analysis-admin@example.com",
  password: "image-analysis-password-long-enough",
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "image-analysis-admin@example.com"))
  .get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin!.id, {
  familyName: "图像分析集成测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2020-05-01",
  selfDisplayName: "管理员",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;
const adminBinding = await getUserBinding(admin!.id);
if (
  adminBinding.familyId === null ||
  adminBinding.personId === null ||
  adminBinding.familyTimezone === null ||
  adminBinding.childLaterUnlockAge === null
) {
  throw new Error("admin binding incomplete");
}
const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
  .get();
if (!child) throw new Error("child missing");

const editorId = randomUUID();
const contributorId = randomUUID();
getDb()
  .insert(userTable)
  .values([
    {
      id: editorId,
      name: "图像分析编辑者",
      email: "image-analysis-editor@example.com",
      emailVerified: false,
      role: "editor",
      familyId,
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    },
    {
      id: contributorId,
      name: "图像分析贡献者",
      email: "image-analysis-contributor@example.com",
      emailVerified: false,
      role: "contributor",
      familyId,
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    },
  ])
  .run();

const fakeAssistantForRuntime = new DeterministicFakeMemoryAssistant({
  seed: "image-analysis-runtime",
});
const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: fakeAssistantForRuntime.provider,
  capabilities: fakeAssistantForRuntime.capabilities,
};

function adminContext() {
  return {
    userId: admin!.id,
    userName: "图像分析管理员",
    familyId,
    personId: adminBinding.personId!,
    role: adminBinding.role,
    accountEnabled: true as const,
    isGuardian: true,
    familyTimezone: adminBinding.familyTimezone!,
    childLaterUnlockAge: adminBinding.childLaterUnlockAge!,
  };
}

function contributorContext() {
  return {
    userId: contributorId,
    userName: "图像分析贡献者",
    familyId,
    personId: null,
    role: "contributor" as const,
    accountEnabled: true as const,
    isGuardian: false,
    familyTimezone: adminBinding.familyTimezone!,
    childLaterUnlockAge: adminBinding.childLaterUnlockAge!,
  };
}

async function ingestPhoto(filename: string) {
  const fixtures = path.join(__dirname, "..", "fixtures");
  const result = await ingestImage({
    familyId,
    createdByUserId: admin!.id,
    filename,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.jpg")),
      Buffer.from(randomUUID()),
    ]),
    clientLastModifiedMs: null,
  });
  if (result.status !== "stored") throw new Error("image ingest failed");
  return result.asset;
}

describe("image analysis end-to-end", () => {
  it("enqueue → worker → row exists; rerun replaces", async () => {
    const imageAsset = await ingestPhoto("集成测试.jpg");

    const enqueued = requestImageAnalysis(adminContext(), imageAsset.id, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(enqueued).toMatchObject({ ok: true, created: true });
    if (!enqueued.ok) throw new Error("enqueue failed");

    const workerResult = await runAiWorkerOnce({
      assistant: new DeterministicFakeMemoryAssistant({
        seed: "image-analysis-integration",
      }),
      registry: createProductionAiJobRegistry(),
      leaseMs: 60_000,
    });
    expect(workerResult.status).toBe("completed");
    expect(workerResult.jobId).toBe(enqueued.jobId);

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, imageAsset.id))
      .get();
    expect(row).toBeTruthy();
    expect(row!.description).toContain("Deterministic fake image analysis");
    expect(row!.analyzedVia).toBe("original");

    const rerun = requestImageAnalysis(adminContext(), imageAsset.id, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) throw new Error("rerun enqueue failed");

    await runAiWorkerOnce({
      assistant: new DeterministicFakeMemoryAssistant({
        seed: "image-analysis-integration-rerun",
      }),
      registry: createProductionAiJobRegistry(),
      leaseMs: 60_000,
    });

    const afterRerun = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, imageAsset.id))
      .get();
    expect(afterRerun!.createdByJobId).toBe(rerun.jobId);
  });

  it("contributor role cannot enqueue image analysis", async () => {
    const imageAsset = await ingestPhoto("贡献者权限.jpg");
    const result = requestImageAnalysis(contributorContext(), imageAsset.id, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(result.ok).toBe(false);
  });

  it("visibility-restricted image cannot be automatic", async () => {
    const imageAsset = await ingestPhoto("私密照片.jpg");
    const eventId = randomUUID();
    getDb()
      .insert(memoryEvent)
      .values({
        id: eventId,
        familyId,
        childPersonId: child.id,
        title: "私密事件",
        occurredAt: new Date("2026-08-31T00:00:00.000Z"),
        occurredAtPrecision: "exact",
        status: "confirmed",
        createdAt: new Date("2026-08-31T00:00:00.000Z"),
        updatedAt: new Date("2026-08-31T00:00:00.000Z"),
      })
      .run();
    getDb()
      .insert(contribution)
      .values({
        id: randomUUID(),
        memoryEventId: eventId,
        authorPersonId: adminBinding.personId!,
        recordingMode: "legacy",
        rawText: "私密讲述",
        audioAssetId: imageAsset.id,
        visibility: "private",
        createdAt: new Date("2026-08-31T00:00:00.000Z"),
        updatedAt: new Date("2026-08-31T00:00:00.000Z"),
      })
      .run();

    const manual = requestImageAnalysis(adminContext(), imageAsset.id, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(manual.ok).toBe(true);

    const { enqueueAiJob } = await import("@/lib/ai/jobs");
    const automatic = enqueueAiJob(
      {
        familyId,
        requestedByUserId: admin!.id,
        jobType: "analyze.asset_image.v1",
        entityType: "asset",
        entityId: imageAsset.id,
        requiredCapability: "vision",
        triggerMode: "automatic",
        sources: [{ kind: "asset", id: imageAsset.id }],
      },
      { runtime: INTERNAL_RUNTIME },
    );
    expect(automatic).toEqual({
      ok: false,
      error: "automatic_restricted_content_forbidden",
    });
  });

  it("analysis is not present in family export", async () => {
    const imageAsset = await ingestPhoto("导出排除.jpg");
    const enqueued = requestImageAnalysis(adminContext(), imageAsset.id, {
      runtime: INTERNAL_RUNTIME,
    });
    if (!enqueued.ok) throw new Error("enqueue failed");
    for (let i = 0; i < 3; i++) {
      const result = await runAiWorkerOnce({
        assistant: new DeterministicFakeMemoryAssistant({
          seed: `image-analysis-export-${i}`,
        }),
        registry: createProductionAiJobRegistry(),
        leaseMs: 60_000,
      });
      if (result.status === "idle") break;
    }

    const row = getDb()
      .select()
      .from(assetAnalysis)
      .where(eq(assetAnalysis.assetId, imageAsset.id))
      .get();
    expect(row).toBeTruthy();

    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const root = "family-time-capsule-export";

    expect(zip.file(`${root}/analysis.json`)).toBeNull();
    expect(zip.file(`${root}/asset-analysis.json`)).toBeNull();

    const manifest = JSON.parse(
      await zip.file(`${root}/manifest.json`)!.async("string"),
    );
    expect(manifest.fileCount).toBe(
      manifest.assets.length + 25,
    );

    const files = Object.keys(zip.files).filter((n) =>
      n.startsWith(`${root}/`) && n.endsWith(".json"),
    );
    for (const file of files) {
      const text = await zip.file(file)!.async("string");
      expect(text).not.toContain("Deterministic fake image analysis");
      expect(text).not.toContain(row!.description);
      expect(text).not.toContain("ocr_text");
    }
  });
});
