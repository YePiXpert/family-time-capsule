import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-transcription-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "transcription-setup-token";
process.env.AUTH_SECRET = "transcription-test-secret-0123456789";

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
const { assetTranscript } = await import("@/db/schema/transcript");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { contribution } = await import("@/db/schema/contribution");
const { memoryEvent } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestMedia } = await import("@/lib/assets/ingest");
const {
  requestTranscription,
  saveEditedTranscript,
} = await import("@/lib/transcripts/service");
const { runAiWorkerOnce } = await import("@/jobs/runtime");
const { createProductionAiJobRegistry } = await import("@/jobs/registry");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { buildDisasterExport } = await import("@/lib/export/service");

const setup = await performSetup({
  token: "transcription-setup-token",
  displayName: "转录管理员",
  email: "transcription-admin@example.com",
  password: "transcription-password-long-enough",
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "transcription-admin@example.com"))
  .get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin!.id, {
  familyName: "转录集成测试家庭",
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
      name: "转录编辑者",
      email: "transcription-editor@example.com",
      emailVerified: false,
      role: "editor",
      familyId,
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    },
    {
      id: contributorId,
      name: "转录贡献者",
      email: "transcription-contributor@example.com",
      emailVerified: false,
      role: "contributor",
      familyId,
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    },
  ])
  .run();

const fakeAssistantForRuntime = new DeterministicFakeMemoryAssistant({
  seed: "transcription-runtime",
});
const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: fakeAssistantForRuntime.provider,
  capabilities: fakeAssistantForRuntime.capabilities,
};

function adminContext() {
  return {
    userId: admin!.id,
    userName: "转录管理员",
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
    userName: "转录贡献者",
    familyId,
    personId: null,
    role: "contributor" as const,
    accountEnabled: true as const,
    isGuardian: false,
    familyTimezone: adminBinding.familyTimezone!,
    childLaterUnlockAge: adminBinding.childLaterUnlockAge!,
  };
}

async function ingestAudio(filename: string) {
  const fixtures = path.join(__dirname, "..", "fixtures");
  const result = await ingestMedia({
    familyId,
    createdByUserId: admin!.id,
    kind: "audio",
    filename,
    declaredMime: "audio/wav",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample.wav")),
      Buffer.from(randomUUID()),
    ]),
    clientLastModifiedMs: null,
  });
  if (result.status !== "stored") throw new Error("audio ingest failed");
  return result.asset;
}

describe("transcription end-to-end", () => {
  it("enqueue → worker → row exists; user edit → rerun → edited text intact", async () => {
    const audioAsset = await ingestAudio("集成测试.wav");

    const enqueued = requestTranscription(adminContext(), audioAsset.id, { runtime: INTERNAL_RUNTIME });
    expect(enqueued).toMatchObject({ ok: true, created: true });
    if (!enqueued.ok) throw new Error("enqueue failed");

    const workerResult = await runAiWorkerOnce({
      assistant: new DeterministicFakeMemoryAssistant({
        seed: "transcription-integration",
      }),
      registry: createProductionAiJobRegistry(),
      leaseMs: 60_000,
    });
    expect(workerResult.status).toBe("completed");
    expect(workerResult.jobId).toBe(enqueued.jobId);

    const row = getDb()
      .select()
      .from(assetTranscript)
      .where(eq(assetTranscript.assetId, audioAsset.id))
      .get();
    expect(row).toBeTruthy();
    expect(row!.status).toBe("machine");
    expect(row!.rawTranscript).toContain("Deterministic fake transcript");

    const editResult = saveEditedTranscript(
      adminContext(),
      audioAsset.id,
      "这是人工修订后的转录文本。",
    );
    expect(editResult).toEqual({ ok: true });

    const rerun = requestTranscription(adminContext(), audioAsset.id, { runtime: INTERNAL_RUNTIME });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) throw new Error("rerun enqueue failed");

    await runAiWorkerOnce({
      assistant: new DeterministicFakeMemoryAssistant({
        seed: "transcription-integration-rerun",
      }),
      registry: createProductionAiJobRegistry(),
      leaseMs: 60_000,
    });

    const afterRerun = getDb()
      .select()
      .from(assetTranscript)
      .where(eq(assetTranscript.assetId, audioAsset.id))
      .get();
    expect(afterRerun!.editedTranscript).toBe("这是人工修订后的转录文本。");
    expect(afterRerun!.status).toBe("user_edited");
    expect(afterRerun!.rawTranscript).toContain("Deterministic fake transcript");
  });

  it("contributor role cannot enqueue transcription", async () => {
    const audioAsset = await ingestAudio("贡献者权限.wav");
    const result = requestTranscription(contributorContext(), audioAsset.id, { runtime: INTERNAL_RUNTIME });
    expect(result.ok).toBe(false);
  });

  it("visibility-restricted contribution audio cannot be automatic", async () => {
    const audioAsset = await ingestAudio("私密音频.wav");
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
        audioAssetId: audioAsset.id,
        visibility: "private",
        createdAt: new Date("2026-08-31T00:00:00.000Z"),
        updatedAt: new Date("2026-08-31T00:00:00.000Z"),
      })
      .run();

    // Manual trigger by admin works because admin can see private content.
    const manual = requestTranscription(adminContext(), audioAsset.id, { runtime: INTERNAL_RUNTIME });
    expect(manual.ok).toBe(true);

    // There is no automatic mode exposed by the UI/service; attempting to
    // enqueue with automatic mode directly fails on restricted visibility.
    const { enqueueAiJob } = await import("@/lib/ai/jobs");
    const automatic = enqueueAiJob(
      {
        familyId,
        requestedByUserId: admin!.id,
        jobType: "transcribe.asset.v1",
        entityType: "asset",
        entityId: audioAsset.id,
        requiredCapability: "transcription",
        triggerMode: "automatic",
        sources: [{ kind: "asset", id: audioAsset.id }],
      },
      { runtime: INTERNAL_RUNTIME },
    );
    expect(automatic).toEqual({
      ok: false,
      error: "automatic_restricted_content_forbidden",
    });
  });

  it("uses durable transcript revisions, preserves clear edits, and rejects stale actor privileges", async () => {
    const audio = await ingestAudio("人工转录版本.wav");
    expect(saveEditedTranscript(adminContext(), audio.id, "最初的人工文字", { expectedRevision: null })).toEqual({ ok: true });
    const first = getDb().select().from(assetTranscript).where(eq(assetTranscript.assetId, audio.id)).get()!;
    expect(first).toMatchObject({ revision: 0, editedTranscript: "最初的人工文字", provider: "manual", model: "manual" });
    expect(saveEditedTranscript(adminContext(), audio.id, "另一端的过期文字", { expectedRevision: null })).toEqual({ ok: false, error: "conflict" });
    expect(saveEditedTranscript(adminContext(), audio.id, "", { expectedRevision: 0 })).toEqual({ ok: true });
    expect(saveEditedTranscript(adminContext(), audio.id, "过期文字不能覆盖清空", { expectedRevision: 0 })).toEqual({ ok: false, error: "conflict" });
    expect(getDb().select().from(assetTranscript).where(eq(assetTranscript.assetId, audio.id)).get()).toMatchObject({ revision: 1, editedTranscript: "", status: "user_edited" });
    expect(saveEditedTranscript({ ...contributorContext(), role: "admin" }, audio.id, "伪造角色", { expectedRevision: 1 })).toEqual({ ok: false, error: "forbidden" });
  });

  it("export contains transcripts.json and restore reproduces raw+edited", async () => {
    const audioAsset = await ingestAudio("导出恢复.wav");
    const enqueued = requestTranscription(adminContext(), audioAsset.id, { runtime: INTERNAL_RUNTIME });
    if (!enqueued.ok) throw new Error("enqueue failed");
    // Earlier tests may leave one pending job; drain the queue until our asset's
    // job is completed.
    for (let i = 0; i < 3; i++) {
      const result = await runAiWorkerOnce({
        assistant: new DeterministicFakeMemoryAssistant({ seed: `export-restore-${i}` }),
        registry: createProductionAiJobRegistry(),
        leaseMs: 60_000,
      });
      if (result.status === "idle") break;
    }
    saveEditedTranscript(adminContext(), audioAsset.id, "恢复后仍应看到的人工修订。");

    const exported = await buildDisasterExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const transcriptsJson = JSON.parse(
      await zip.file("family-time-capsule-export/transcripts.json")!.async("string"),
    );
    expect(Array.isArray(transcriptsJson)).toBe(true);
    expect(transcriptsJson.length).toBeGreaterThanOrEqual(1);
    const ours = transcriptsJson.find((t: { assetId: string }) => t.assetId === audioAsset.id);
    expect(ours).toBeTruthy();
    expect(ours.rawTranscript).toContain("Deterministic fake transcript");
    expect(ours.editedTranscript).toBe("恢复后仍应看到的人工修订。");
    expect(ours.status).toBe("user_edited");
    expect(ours.revision).toBe(1);

    // Restore into a fresh empty instance
    const restoreDir = mkdtempSync(path.join(tmpdir(), "ftc-transcription-restore-"));
    process.env.DATA_DIR = restoreDir;
    const { vi } = await import("vitest");
    vi.resetModules();
    const m = {
      db: await import("@/db"),
      setup: await import("@/lib/auth/setup"),
      restoreSvc: await import("@/lib/restore/service"),
      transcript: await import("@/db/schema/transcript"),
    };
    const setupB = await m.setup.performSetup({
      token: "transcription-setup-token",
      displayName: "新管理员",
      email: "restore-admin@example.com",
      password: "restore-password-long-enough",
    });
    if (!setupB.ok) throw new Error("setup B failed");
    const adminBId = (
      await m.db.getDb().select({ id: userTable.id }).from(userTable)
    )[0].id;

    const report = await m.restoreSvc.restoreFromZipFile(exported.filePath, adminBId);
    expect(report.transcripts).toBe(transcriptsJson.length);

    const restored = await m.db.getDb()
      .select()
      .from(m.transcript.assetTranscript)
      .where(eq(m.transcript.assetTranscript.assetId, audioAsset.id))
      .get();
    expect(restored).toBeTruthy();
    expect(restored!.rawTranscript).toBe(ours.rawTranscript);
    expect(restored!.editedTranscript).toBe("恢复后仍应看到的人工修订。");
    expect(restored!.status).toBe("user_edited");
    expect(restored!.revision).toBe(ours.revision);
    // The manual-only row and its intentional empty edit survive the same archive.
    const manualRow = transcriptsJson.find((t: { provider: string }) => t.provider === "manual");
    expect(manualRow).toMatchObject({ editedTranscript: "", revision: 1 });
    expect(m.db.getDb().select().from(m.transcript.assetTranscript).where(eq(m.transcript.assetTranscript.id, manualRow.id)).get()).toMatchObject({ editedTranscript: "", revision: 1, provider: "manual" });

    const reexport = await (await import("@/lib/export/service")).buildDisasterExport(familyId);
    const secondZip = await JSZip.loadAsync(readFileSync(reexport.filePath));
    expect(JSON.parse(await secondZip.file("family-time-capsule-export/transcripts.json")!.async("string"))).toEqual(transcriptsJson);
    m.db.closeDatabase();

    // A pre-revision archive from the manual editor used empty provider/model.
    const legacyRows = transcriptsJson.map((row: Record<string, unknown>) => {
      const legacy = { ...row }; delete legacy.revision;
      if (legacy.provider === "manual") { legacy.provider = ""; legacy.model = ""; }
      return legacy;
    });
    zip.file("family-time-capsule-export/transcripts.json", JSON.stringify(legacyRows));
    const legacyPath = path.join(restoreDir, "legacy-transcript.zip");
    writeFileSync(legacyPath, await zip.generateAsync({ type: "nodebuffer" }));
    const legacyDir = mkdtempSync(path.join(tmpdir(), "ftc-transcription-legacy-"));
    process.env.DATA_DIR = legacyDir; vi.resetModules();
    const legacyDb = await import("@/db");
    try {
      const setup = await (await import("@/lib/auth/setup")).performSetup({ token: "transcription-setup-token", displayName: "旧档恢复", email: "legacy@example.com", password: "legacy-password-long-enough" });
      expect(setup.ok).toBe(true);
      const legacyAdmin = legacyDb.getDb().select().from((await import("@/db/schema/auth")).user).get()!;
      await (await import("@/lib/restore/service")).restoreFromZipFile(legacyPath, legacyAdmin.id);
      const rows = legacyDb.getDb().select().from((await import("@/db/schema/transcript")).assetTranscript).all();
      expect(rows).toHaveLength(transcriptsJson.length);
      expect(rows.every(row => row.revision === 0)).toBe(true);
      expect(rows.find(row => row.id === manualRow.id)).toMatchObject({ editedTranscript: "", provider: "manual", model: "manual" });
    } finally { legacyDb.closeDatabase(); rmSync(legacyDir, { recursive: true, force: true }); }
    rmSync(restoreDir, { recursive: true, force: true });
    process.env.DATA_DIR = dataDir;
  });
});
