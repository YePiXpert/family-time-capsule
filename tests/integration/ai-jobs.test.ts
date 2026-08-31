import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-ai-jobs-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "ai-jobs-setup-token";
process.env.AUTH_SECRET = "ai-jobs-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb, openDatabaseConnection } = await import("@/db");
const { aiJob, aiJobSource, aiWorkerHeartbeat } = await import(
  "@/db/schema/ai-job"
);
const { asset } = await import("@/db/schema/asset");
const { auditLog } = await import("@/db/schema/audit");
const { user: userTable } = await import("@/db/schema/auth");
const { contribution } = await import("@/db/schema/contribution");
const { person } = await import("@/db/schema/family");
const { memoryEvent } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import(
  "@/lib/family/service"
);
const {
  claimNextAiJob,
  completeAiJob,
  enableAiProcessingConsent,
  enqueueAiJob,
  failAiJob,
  finalizeAiJob,
  renewAiJobLease,
  requestAiJobCancellation,
  retryAiJob,
  revokeAiProcessingConsent,
  updateAiWorkerHeartbeat,
  validateAiJobExecution,
} = await import("@/lib/ai/jobs");
const { AUDIT_KINDS, requiredAuditValues } = await import("@/lib/audit/service");

const setup = await performSetup({
  token: "ai-jobs-setup-token",
  displayName: "AI 管理员",
  email: "ai-jobs-admin@example.com",
  password: "ai-jobs-password-long-enough",
});
if (!setup.ok) throw new Error(`AI job setup failed: ${setup.error}`);
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "ai-jobs-admin@example.com"))
  .get();
if (!admin) throw new Error("AI job setup user missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "AI 队列测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2020-05-01",
  selfDisplayName: "AI 管理员",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`AI job onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;
const adminBinding = await getUserBinding(admin.id);
if (
  adminBinding.familyId === null ||
  adminBinding.personId === null ||
  adminBinding.familyTimezone === null ||
  adminBinding.childLaterUnlockAge === null
) {
  throw new Error("AI admin binding incomplete");
}
const adminPersonId = adminBinding.personId;
const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
  .get();
if (!child) throw new Error("AI job child missing");

const adminContext = {
  userId: admin.id,
  userName: "AI 管理员",
  familyId,
  personId: adminPersonId,
  role: adminBinding.role,
  accountEnabled: true as const,
  isGuardian: true,
  familyTimezone: adminBinding.familyTimezone,
  childLaterUnlockAge: adminBinding.childLaterUnlockAge,
};

const editorId = randomUUID();
const viewerId = randomUUID();
const grandmaId = randomUUID();
const eventId = randomUUID();
const assetId = randomUUID();
const familyContributionId = randomUUID();
const stableContributionId = randomUUID();
const privateContributionId = randomUUID();
const parentsContributionId = randomUUID();
const seededAt = new Date("2026-08-31T00:00:00.000Z");

getDb()
  .insert(person)
  .values({
    id: grandmaId,
    familyId,
    displayName: "外婆",
    relationToChild: "外婆",
    isChild: false,
    isGuardian: false,
    createdAt: seededAt,
    updatedAt: seededAt,
  })
  .run();
getDb()
  .insert(userTable)
  .values([
    {
      id: editorId,
      name: "AI 编辑者",
      email: "ai-jobs-editor@example.com",
      emailVerified: false,
      role: "editor",
      familyId,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: viewerId,
      name: "AI 访客",
      email: "ai-jobs-viewer@example.com",
      emailVerified: false,
      role: "viewer",
      familyId,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  ])
  .run();
getDb()
  .insert(asset)
  .values({
    id: assetId,
    familyId,
    type: "image",
    originalFilename: "ai-source.jpg",
    mimeType: "image/jpeg",
    bytes: 4,
    sha256: sha("asset-source"),
    storageKey: `${familyId}/originals/ai-source.jpg`,
    capturedAt: seededAt,
    importedAt: seededAt,
    timeSource: "user_confirmed",
    createdByUserId: admin.id,
    createdAt: seededAt,
  })
  .run();
getDb()
  .insert(memoryEvent)
  .values({
    id: eventId,
    familyId,
    childPersonId: child.id,
    title: "AI 来源事件",
    occurredAt: seededAt,
    occurredAtPrecision: "exact",
    status: "confirmed",
    createdAt: seededAt,
    updatedAt: seededAt,
  })
  .run();

function contributionValues(
  id: string,
  authorPersonId: string,
  visibility: "family" | "private" | "parents" | "child_later",
  rawText: string,
) {
  return {
    id,
    memoryEventId: eventId,
    authorPersonId,
    recordingMode: "legacy",
    rawText,
    visibility,
    createdAt: seededAt,
    updatedAt: seededAt,
  } as const;
}

getDb()
  .insert(contribution)
  .values([
    contributionValues(
      familyContributionId,
      adminPersonId,
      "family",
      "会被修改以验证来源哈希漂移",
    ),
    contributionValues(
      stableContributionId,
      adminPersonId,
      "family",
      "稳定的家庭来源",
    ),
    contributionValues(
      privateContributionId,
      adminPersonId,
      "private",
      "只有作者可以处理",
    ),
    contributionValues(
      parentsContributionId,
      grandmaId,
      "parents",
      "只有显式监护人可以处理",
    ),
  ])
  .run();

const editorContext = {
  ...adminContext,
  userId: editorId,
  userName: "AI 编辑者",
  personId: null,
  role: "editor" as const,
  isGuardian: false,
};
const viewerContext = {
  ...adminContext,
  userId: viewerId,
  userName: "AI 访客",
  personId: null,
  role: "viewer" as const,
  isGuardian: false,
};

const EXTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: {
    id: "openai-compatible",
    displayName: "家庭自选兼容服务",
    external: true,
  },
  capabilities: {
    text: { available: true, model: "memory-text-v1", reason: "configured" },
    vision: { available: true, model: "memory-vision-v1", reason: "configured" },
    transcription: {
      available: true,
      model: "memory-stt-v1",
      reason: "configured",
    },
    embeddings: { available: false, model: null, reason: "not_configured" },
  },
};

const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: {
    id: "deterministic-fake",
    displayName: "Deterministic offline fake",
    external: false,
  },
  capabilities: {
    text: { available: true, model: "fake-text-v1", reason: "configured" },
    vision: { available: true, model: "fake-vision-v1", reason: "configured" },
    transcription: {
      available: true,
      model: "fake-stt-v1",
      reason: "configured",
    },
    embeddings: { available: true, model: "fake-embed-v1", reason: "configured" },
  },
};

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let sequence = 0;
function internalInput(
  sourceId = stableContributionId,
  actorUserId: string = editorId,
  overrides: Partial<Parameters<typeof enqueueAiJob>[0]> = {},
) {
  sequence += 1;
  return {
    familyId,
    requestedByUserId: actorUserId,
    jobType: "test.process.v1",
    entityType: "analysis_run",
    entityId: `run-${sequence}`,
    requiredCapability: "text" as const,
    triggerMode: "manual" as const,
    priority: 100,
    sources: [{ kind: "contribution" as const, id: sourceId }],
    ...overrides,
  };
}

describe.sequential("durable AI jobs and consent", () => {
  it("derives external provider disclosure from trusted runtime", () => {
    const now = new Date("2026-08-31T01:00:00.000Z");
    expect(
      enableAiProcessingConsent(
        editorContext,
        { capability: "text", allowAutomaticFamilyContent: false },
        { runtime: EXTERNAL_RUNTIME, now },
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      enableAiProcessingConsent(
        viewerContext,
        { capability: "text", allowAutomaticFamilyContent: false },
        { runtime: EXTERNAL_RUNTIME, now },
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      enableAiProcessingConsent(
        adminContext,
        { capability: "text", allowAutomaticFamilyContent: false },
        { runtime: INTERNAL_RUNTIME, now },
      ),
    ).toEqual({ ok: false, error: "invalid_input" });

    expect(
      enableAiProcessingConsent(
        adminContext,
        { capability: "text", allowAutomaticFamilyContent: false },
        { runtime: EXTERNAL_RUNTIME, now },
      ),
    ).toEqual({ ok: true, consentVersion: 1 });
    const audit = getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.kind, AUDIT_KINDS.aiConsentEnabled))
      .get();
    expect(audit?.detailJson).toContain("openai-compatible");
    expect(audit?.detailJson).not.toMatch(/api.?key|secret|password/iu);
  });

  it("hydrates visibility/hash and ignores spoofed provider or payload fields", () => {
    const now = new Date("2026-08-31T01:05:00.000Z");
    const spoofed = {
      familyId,
      requestedByUserId: admin.id,
      jobType: "suggestion.extract.v1",
      entityType: "analysis_run",
      entityId: "spoof-attempt",
      requiredCapability: "text" as const,
      triggerMode: "automatic" as const,
      sources: [{ kind: "contribution" as const, id: privateContributionId }],
      providerExternal: false,
      providerId: "fake-local",
      contentVisibility: "family",
      payload: { value: "sk-proj-privateWords" },
    };
    expect(
      enqueueAiJob(spoofed, { runtime: EXTERNAL_RUNTIME, now }),
    ).toEqual({
      ok: false,
      error: "automatic_restricted_content_forbidden",
    });

    const manual = {
      ...spoofed,
      entityId: "manual-private",
      triggerMode: "manual" as const,
    };
    const queued = enqueueAiJob(manual, { runtime: EXTERNAL_RUNTIME, now });
    expect(queued).toMatchObject({ ok: true, created: true });
    if (!queued.ok) return;
    const row = getDb().select().from(aiJob).where(eq(aiJob.id, queued.jobId)).get();
    expect(row).toMatchObject({
      providerId: EXTERNAL_RUNTIME.provider.id,
      providerExternal: true,
      model: "memory-text-v1",
      contentVisibility: "private",
      payloadJson: "{}",
    });
    expect(JSON.stringify(row)).not.toContain("sk-proj-privateWords");

    expect(
      enqueueAiJob(
        {
          ...manual,
          entityId: "editor-private",
          requestedByUserId: editorId,
        },
        { runtime: EXTERNAL_RUNTIME, now },
      ),
    ).toEqual({ ok: false, error: "source_forbidden_or_not_found" });
  });

  it("is idempotent across two SQLite connections and claims distinct jobs", () => {
    const now = new Date("2026-08-31T02:00:00.000Z");
    const second = openDatabaseConnection({
      databasePath: path.join(dataDir, "db", "capsule.sqlite"),
      migrationsFolder: path.join(process.cwd(), "db", "migrations"),
      snapshotDirectory: path.join(dataDir, "backups", "second-connection"),
    });
    try {
      const input = internalInput(stableContributionId, admin.id, {
        entityId: "cross-connection-idempotent",
      });
      const first = enqueueAiJob(input, {
        runtime: INTERNAL_RUNTIME,
        database: getDb(),
        now,
      });
      const duplicate = enqueueAiJob(input, {
        runtime: INTERNAL_RUNTIME,
        database: second.db,
        now: new Date(now.getTime() + 100),
      });
      expect(first).toMatchObject({ ok: true, created: true });
      expect(duplicate).toEqual(
        first.ok
          ? { ok: true, jobId: first.jobId, created: false }
          : expect.anything(),
      );

      const other = enqueueAiJob(
        internalInput(stableContributionId, admin.id, {
          entityId: "cross-connection-other",
        }),
        { runtime: INTERNAL_RUNTIME, now },
      );
      if (!first.ok || !other.ok) throw new Error("concurrent jobs not queued");
      const leaseA = claimNextAiJob("worker-connection-a", {
        runtime: INTERNAL_RUNTIME,
        database: getDb(),
        now,
        leaseMs: 5_000,
      });
      const leaseB = claimNextAiJob("worker-connection-b", {
        runtime: INTERNAL_RUNTIME,
        database: second.db,
        now,
        leaseMs: 5_000,
      });
      expect(leaseA?.jobId).not.toBe(leaseB?.jobId);
      if (leaseA) {
        expect(
          completeAiJob(leaseA, {
            runtime: INTERNAL_RUNTIME,
            database: getDb(),
            now: new Date(now.getTime() + 1_000),
          }),
        ).toEqual({ ok: true });
      }
      if (leaseB) {
        expect(
          completeAiJob(leaseB, {
            runtime: INTERNAL_RUNTIME,
            database: second.db,
            now: new Date(now.getTime() + 1_000),
          }),
        ).toEqual({ ok: true });
      }
    } finally {
      second.sqlite.close();
    }
  });

  it("cancels on source hash and visibility drift before completion", () => {
    const now = new Date("2026-08-31T03:00:00.000Z");
    const queued = enqueueAiJob(
      internalInput(familyContributionId, admin.id),
      { runtime: INTERNAL_RUNTIME, now },
    );
    if (!queued.ok) throw new Error("hash drift job not queued");
    const lease = claimNextAiJob("hash-drift-worker", {
      runtime: INTERNAL_RUNTIME,
      now,
      leaseMs: 5_000,
    });
    if (!lease || lease.jobId !== queued.jobId) throw new Error("hash job not claimed");
    getDb()
      .update(contribution)
      .set({
        editedText: "来源在 Provider 返回前发生变化",
        updatedAt: new Date(now.getTime() + 1_000),
      })
      .where(eq(contribution.id, familyContributionId))
      .run();
    expect(
      validateAiJobExecution(lease, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 1_000),
      }),
    ).toEqual({ ok: false, error: "source_changed" });
    expect(getDb().select().from(aiJob).where(eq(aiJob.id, queued.jobId)).get()?.status).toBe(
      "cancelled",
    );

    const guardianJob = enqueueAiJob(
      internalInput(parentsContributionId, admin.id),
      { runtime: INTERNAL_RUNTIME, now: new Date(now.getTime() + 2_000) },
    );
    if (!guardianJob.ok) throw new Error("guardian job not queued");
    const guardianLease = claimNextAiJob("guardian-drift-worker", {
      runtime: INTERNAL_RUNTIME,
      now: new Date(now.getTime() + 2_000),
      leaseMs: 5_000,
    });
    if (!guardianLease || guardianLease.jobId !== guardianJob.jobId) {
      throw new Error("guardian job not claimed");
    }
    getDb()
      .update(person)
      .set({ isGuardian: false, updatedAt: new Date(now.getTime() + 3_000) })
      .where(eq(person.id, adminPersonId))
      .run();
    expect(
      renewAiJobLease(guardianLease, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 3_000),
        leaseMs: 5_000,
      }),
    ).toBeNull();
    expect(
      getDb().select().from(aiJob).where(eq(aiJob.id, guardianJob.jobId)).get(),
    ).toMatchObject({ status: "cancelled", lastErrorCode: "source_forbidden" });
    getDb()
      .update(person)
      .set({ isGuardian: true, updatedAt: new Date(now.getTime() + 4_000) })
      .where(eq(person.id, adminPersonId))
      .run();
  });

  it("rejects configuration drift and consent revocation in flight", () => {
    const now = new Date("2026-08-31T04:00:00.000Z");
    const configJob = enqueueAiJob(
      {
        familyId,
        requestedByUserId: admin.id,
        jobType: "suggestion.extract.v1",
        entityType: "analysis_run",
        entityId: "configuration-drift",
        requiredCapability: "text",
        triggerMode: "manual",
        priority: 100,
        sources: [{ kind: "memory_event", id: eventId }],
      },
      { runtime: EXTERNAL_RUNTIME, now },
    );
    if (!configJob.ok) throw new Error("config job not queued");
    const changedRuntime: AiJobRuntimeIdentity = {
      ...EXTERNAL_RUNTIME,
      capabilities: {
        ...EXTERNAL_RUNTIME.capabilities,
        text: { available: true, model: "memory-text-v2", reason: "configured" },
      },
    };
    expect(
      claimNextAiJob("configuration-worker", {
        runtime: changedRuntime,
        now,
        leaseMs: 5_000,
      }),
    ).toBeNull();
    expect(
      getDb().select().from(aiJob).where(eq(aiJob.id, configJob.jobId)).get(),
    ).toMatchObject({ status: "cancelled", lastErrorCode: "configuration_changed" });

    const revokeJob = enqueueAiJob(
      {
        familyId,
        requestedByUserId: admin.id,
        jobType: "suggestion.extract.v1",
        entityType: "analysis_run",
        entityId: "consent-revoke",
        requiredCapability: "text",
        triggerMode: "manual",
        priority: 100,
        sources: [{ kind: "asset", id: assetId }],
      },
      { runtime: EXTERNAL_RUNTIME, now: new Date(now.getTime() + 1_000) },
    );
    if (!revokeJob.ok) throw new Error("revoke job not queued");
    const lease = claimNextAiJob("consent-worker", {
      runtime: EXTERNAL_RUNTIME,
      now: new Date(now.getTime() + 1_000),
      leaseMs: 5_000,
    });
    if (!lease || lease.jobId !== revokeJob.jobId) throw new Error("revoke job not claimed");
    expect(
      revokeAiProcessingConsent(adminContext, "text", {
        now: new Date(now.getTime() + 2_000),
      }),
    ).toEqual({ ok: true, consentVersion: 2 });
    expect(
      completeAiJob(lease, {
        runtime: EXTERNAL_RUNTIME,
        now: new Date(now.getTime() + 2_000),
      }),
    ).toEqual({ ok: false, error: "cancel_requested" });
  });

  it("fences expired leases and retries only within max attempts", () => {
    const now = new Date("2026-08-31T05:00:00.000Z");
    const queued = enqueueAiJob(
      internalInput(stableContributionId, admin.id, { maxAttempts: 2 }),
      { runtime: INTERNAL_RUNTIME, now },
    );
    if (!queued.ok) throw new Error("lease job not queued");
    const stale = claimNextAiJob("stale-worker", {
      runtime: INTERNAL_RUNTIME,
      now,
      leaseMs: 5_000,
    });
    if (!stale || stale.jobId !== queued.jobId) throw new Error("lease job not claimed");
    expect(
      completeAiJob(stale, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 5_001),
      }),
    ).toEqual({ ok: false, error: "lease_expired" });
    expect(
      getDb().select().from(aiJob).where(eq(aiJob.id, queued.jobId)).get(),
    ).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "lease_expired" });
    const replacement = claimNextAiJob("replacement-worker", {
      runtime: INTERNAL_RUNTIME,
      now: new Date(now.getTime() + 6_100),
      leaseMs: 5_000,
    });
    if (!replacement || replacement.jobId !== queued.jobId) {
      throw new Error("expired lease was not reclaimed");
    }
    expect(replacement.leaseGeneration).toBe(stale.leaseGeneration + 1);
    expect(
      failAiJob(replacement, "provider_timeout", true, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 7_000),
      }),
    ).toEqual({ ok: true });
    expect(
      getDb().select().from(aiJob).where(eq(aiJob.id, queued.jobId)).get(),
    ).toMatchObject({ status: "failed", attempts: 2, lastErrorCode: "provider_timeout" });

    const retried = retryAiJob(adminContext, queued.jobId, {
      runtime: INTERNAL_RUNTIME,
      now: new Date(now.getTime() + 8_000),
    });
    expect(retried).toMatchObject({ ok: true, created: true });
    if (!retried.ok) throw new Error("failed job was not retried");
    expect(retried.jobId).not.toBe(queued.jobId);
    expect(
      getDb().select().from(aiJob).where(eq(aiJob.id, retried.jobId)).get(),
    ).toMatchObject({ status: "pending", attempts: 0, lastErrorCode: null });
    expect(
      retryAiJob(adminContext, queued.jobId, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 9_000),
      }),
    ).toEqual({ ok: true, jobId: retried.jobId, created: false });
    const retryLease = claimNextAiJob("retry-clone-worker", {
      runtime: INTERNAL_RUNTIME,
      now: new Date(now.getTime() + 9_000),
      leaseMs: 5_000,
    });
    if (!retryLease || retryLease.jobId !== retried.jobId) {
      throw new Error("retry clone not claimed");
    }
    expect(
      completeAiJob(retryLease, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 10_000),
      }),
    ).toEqual({ ok: true });
  });

  it("stops renew after account disable and keeps cancellation monotonic", () => {
    const now = new Date("2026-08-31T06:00:00.000Z");
    const queued = enqueueAiJob(internalInput(), {
      runtime: INTERNAL_RUNTIME,
      now,
    });
    if (!queued.ok) throw new Error("disable job not queued");
    const lease = claimNextAiJob("disabled-worker", {
      runtime: INTERNAL_RUNTIME,
      now,
      leaseMs: 5_000,
    });
    if (!lease || lease.jobId !== queued.jobId) throw new Error("disable job not claimed");
    getDb()
      .update(userTable)
      .set({ disabledAt: now, disabledByUserId: admin.id, updatedAt: now })
      .where(eq(userTable.id, editorId))
      .run();
    expect(
      renewAiJobLease(lease, {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 1_000),
        leaseMs: 5_000,
      }),
    ).toBeNull();
    expect(
      getDb().select().from(aiJob).where(eq(aiJob.id, queued.jobId)).get(),
    ).toMatchObject({ status: "cancelled", lastErrorCode: "authorization_revoked" });

    const adminJob = enqueueAiJob(internalInput(stableContributionId, admin.id), {
      runtime: INTERNAL_RUNTIME,
      now: new Date(now.getTime() + 2_000),
    });
    if (!adminJob.ok) throw new Error("admin cancellation job not queued");
    expect(
      requestAiJobCancellation(adminContext, adminJob.jobId, {
        now: new Date(now.getTime() + 3_000),
      }),
    ).toEqual({ ok: true, status: "cancelled" });
    expect(
      requestAiJobCancellation(adminContext, adminJob.jobId, {
        now: new Date(now.getTime() + 4_000),
      }),
    ).toEqual({ ok: true, status: "unchanged" });
    expect(() =>
      getDb()
        .update(aiJob)
        .set({ lastErrorCode: "tampered" })
        .where(eq(aiJob.id, adminJob.jobId))
        .run(),
    ).toThrow(/invalid AI job state transition/u);
  });

  it("commits durable local effect and completion exactly once", () => {
    const now = new Date("2026-08-31T07:00:00.000Z");
    const queued = enqueueAiJob(
      internalInput(stableContributionId, admin.id),
      { runtime: INTERNAL_RUNTIME, now },
    );
    if (!queued.ok) throw new Error("finalize job not queued");
    const lease = claimNextAiJob("finalize-worker", {
      runtime: INTERNAL_RUNTIME,
      now,
      leaseMs: 5_000,
    });
    if (!lease || lease.jobId !== queued.jobId) throw new Error("finalize job not claimed");
    const auditKind = `ai.test_result.${queued.jobId}`;
    expect(() =>
      finalizeAiJob(
        lease,
        (tx) => {
          tx.insert(auditLog)
            .values(
              requiredAuditValues(
                familyId,
                auditKind,
                admin.id,
                { resultId: "normalized-result-1" },
                new Date(now.getTime() + 1_000),
              ),
            )
            .run();
          throw new Error("simulated local write crash");
        },
        {
          runtime: INTERNAL_RUNTIME,
          now: new Date(now.getTime() + 1_000),
        },
      ),
    ).toThrow("simulated local write crash");
    expect(getDb().select().from(auditLog).where(eq(auditLog.kind, auditKind)).get()).toBeUndefined();
    expect(getDb().select().from(aiJob).where(eq(aiJob.id, queued.jobId)).get()?.status).toBe(
      "running",
    );

    expect(
      finalizeAiJob(
        lease,
        (tx) => {
          tx.insert(auditLog)
            .values(
              requiredAuditValues(
                familyId,
                auditKind,
                admin.id,
                { resultId: "normalized-result-1" },
                new Date(now.getTime() + 2_000),
              ),
            )
            .run();
          return "normalized-result-1";
        },
        {
          runtime: INTERNAL_RUNTIME,
          now: new Date(now.getTime() + 2_000),
        },
      ),
    ).toEqual({ ok: true, value: "normalized-result-1" });
    expect(
      finalizeAiJob(lease, () => "duplicate", {
        runtime: INTERNAL_RUNTIME,
        now: new Date(now.getTime() + 3_000),
      }),
    ).toEqual({ ok: false, error: "lease_lost" });
    expect(
      getDb().select().from(auditLog).where(eq(auditLog.kind, auditKind)).all(),
    ).toHaveLength(1);
  });

  it("enforces immutable source rows and bounded heartbeat metadata", () => {
    const completed = getDb()
      .select({ id: aiJob.id })
      .from(aiJob)
      .where(eq(aiJob.status, "completed"))
      .get();
    if (!completed) throw new Error("completed job missing");
    expect(() =>
      getDb().delete(aiJobSource).where(eq(aiJobSource.jobId, completed.id)).run(),
    ).toThrow(/AI job sources cannot be removed independently/u);
    expect(() =>
      getDb()
        .insert(aiJob)
        .values({
          id: "unsafe-payload-job",
          familyId,
          jobType: "test.process.v1",
          entityType: "analysis_run",
          entityId: "unsafe-payload-run",
          requiredCapability: "text",
          providerId: INTERNAL_RUNTIME.provider.id,
          model: "fake-text-v1",
          providerExternal: false,
          consentVersion: null,
          triggerMode: "manual",
          contentVisibility: "family",
          status: "pending",
          payloadJson: '{"value":"sk-proj-privateWords"}',
          idempotencyKey: sha("unsafe-payload-job"),
          availableAt: seededAt,
          requestedByUserId: admin.id,
          createdAt: seededAt,
          updatedAt: seededAt,
        })
        .run(),
    ).toThrow(/ai_job_payload_check/u);

    const now = new Date("2026-08-31T08:00:00.000Z");
    updateAiWorkerHeartbeat(
      {
        workerId: "worker-heartbeat-1",
        workerVersion: "0.1.3",
        status: "idle",
        now,
      },
      {},
    );
    updateAiWorkerHeartbeat(
      {
        workerId: "worker-heartbeat-1",
        workerVersion: "0.1.3",
        status: "working",
        now: new Date(now.getTime() + 1_000),
      },
      {},
    );
    expect(
      getDb()
        .select()
        .from(aiWorkerHeartbeat)
        .where(eq(aiWorkerHeartbeat.workerId, "worker-heartbeat-1"))
        .get(),
    ).toMatchObject({ status: "working" });
    expect(() =>
      getDb()
        .update(aiWorkerHeartbeat)
        .set({ lastSeenAt: new Date(now.getTime() - 1_000) })
        .where(eq(aiWorkerHeartbeat.workerId, "worker-heartbeat-1"))
        .run(),
    ).toThrow(/invalid AI worker heartbeat update/u);

    // Parent deletion remains the only permitted way to cascade immutable
    // source rows after a terminal job is explicitly purged.
    expect(getDb().delete(aiJob).where(eq(aiJob.id, completed.id)).run().changes).toBe(1);
    expect(
      getDb()
        .select()
        .from(aiJobSource)
        .where(eq(aiJobSource.jobId, completed.id))
        .all(),
    ).toHaveLength(0);
  });
});
