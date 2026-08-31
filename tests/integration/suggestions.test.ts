import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";
import type { MemoryAssistant } from "@/lib/ai/types";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-suggestions-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "suggestions-setup-token";
process.env.AUTH_SECRET = "suggestions-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { aiSuggestion, factSource } = await import("@/db/schema/suggestion");
const { memoryEvent, memoryEventParticipant } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const {
  completeOnboarding,
  getUserBinding,
  addPerson,
} = await import("@/lib/family/service");
const {
  claimNextAiJob,
  enqueueAiJob,
  finalizeAiJob,
} = await import("@/lib/ai/jobs");
const {
  requestEventSuggestions,
  resolveSuggestion,
  listEventTags,
  listPendingSuggestions,
} = await import("@/lib/suggestions/service");
const { addFact } = await import("@/lib/contributions/service");
const { createContribution } = await import("@/lib/contributions/service");
const { buildFamilyExport } = await import("@/lib/export/service");

const { suggestEventMetadataHandler } = await import(
  "@/lib/ai/handlers/suggest-event-metadata"
);

const setup = await performSetup({
  token: "suggestions-setup-token",
  displayName: "爸爸",
  email: "dad-suggestions@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "建议测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const adminBinding = await getUserBinding(admin.id);
if (
  adminBinding.familyId === null ||
  adminBinding.personId === null ||
  adminBinding.familyTimezone === null ||
  adminBinding.childLaterUnlockAge === null
) {
  throw new Error("admin binding incomplete");
}
const adminPersonId = adminBinding.personId;

const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.isChild, true))
  .get();
if (!child) throw new Error("child missing");

const momAdded = await addPerson(familyId, { displayName: "妈妈", relationToChild: "妈妈" });
if (!momAdded.ok) throw new Error("add mom failed");
const momPersonId = momAdded.personId;

const viewerId = randomUUID();
getDb()
  .insert(userTable)
  .values({
    id: viewerId,
    name: "访客",
    email: "viewer-suggestions@example.com",
    emailVerified: false,
    role: "viewer",
    familyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();

const adminContext = {
  userId: admin.id,
  userName: "爸爸",
  familyId,
  personId: adminPersonId,
  role: adminBinding.role,
  accountEnabled: true as const,
  isGuardian: true,
  familyTimezone: adminBinding.familyTimezone,
  childLaterUnlockAge: adminBinding.childLaterUnlockAge,
};

const viewerContext = {
  ...adminContext,
  userId: viewerId,
  userName: "访客",
  personId: null,
  role: "viewer" as const,
  isGuardian: false,
};

const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: {
    id: "test-provider",
    displayName: "Test Provider",
    external: false,
  },
  capabilities: {
    text: { available: true, model: "test-text-v1", reason: "configured" },
    vision: { available: false, model: null, reason: "not_configured" },
    transcription: { available: false, model: null, reason: "not_configured" },
    embeddings: { available: false, model: null, reason: "not_configured" },
  },
};

function makeEvent(title = "一段记忆"): string {
  const id = randomUUID();
  const now = new Date("2026-08-31T00:00:00.000Z");
  getDb()
    .insert(memoryEvent)
    .values({
      id,
      familyId,
      childPersonId: child!.id,
      title,
      occurredAt: now,
      occurredAtPrecision: "exact",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function makeAssistant(payload: unknown): MemoryAssistant {
  return {
    provider: INTERNAL_RUNTIME.provider,
    capabilities: INTERNAL_RUNTIME.capabilities,
    supports: (capability: string) => capability === "text",
    generateText: vi.fn().mockResolvedValue({
      text: JSON.stringify(payload),
      finishReason: "stop",
      provenance: {
        providerId: "test-provider",
        providerName: "Test Provider",
        model: "test-text-v1",
      },
    }),
    analyzeImage: vi.fn().mockRejectedValue(new Error("not supported")),
    transcribeAudio: vi.fn().mockRejectedValue(new Error("not supported")),
    createEmbeddings: vi.fn().mockRejectedValue(new Error("not supported")),
  };
}

async function runSuggestionJob(
  eventId: string,
  payload: unknown,
  requestedByUserId: string = admin!.id,
): Promise<{ jobId: string }> {
  const assistant = makeAssistant(payload);
  const queued = enqueueAiJob(
    {
      familyId,
      requestedByUserId,
      jobType: "suggest.event_metadata.v1",
      entityType: "memory_event",
      entityId: eventId,
      requiredCapability: "text",
      triggerMode: "manual",
      sources: [{ kind: "memory_event", id: eventId }],
    },
    { runtime: INTERNAL_RUNTIME },
  );
  if (!queued.ok) throw new Error(`enqueue failed: ${queued.error}`);
  const lease = claimNextAiJob("suggestions-test-worker", {
    runtime: INTERNAL_RUNTIME,
    leaseMs: 5_000,
  });
  if (!lease || lease.jobId !== queued.jobId) {
    throw new Error("job not claimed");
  }
  const result = await suggestEventMetadataHandler({
    lease,
    assistant: assistant as unknown as MemoryAssistant,
    signal: new AbortController().signal,
  });
  const finalized = finalizeAiJob(
    lease,
    (tx, context) => result.commit(tx, context),
    { runtime: INTERNAL_RUNTIME },
  );
  if (!finalized.ok) throw new Error(`finalize failed: ${finalized.error}`);
  return { jobId: queued.jobId };
}

describe("source-linked AI suggestions (M3-C)", () => {
  it("viewer cannot request suggestions", () => {
    const eventId = makeEvent();
    const result = requestEventSuggestions(viewerContext, eventId, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("accepts title/location/person/tag suggestions", async () => {
    const eventId = makeEvent("一段记忆");
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: admin!.id,
      rawText: "今天带孩子去公园，妈妈也在。",
      visibility: "family",
    });

    await runSuggestionJob(eventId, {
      title: "公园游玩",
      locationText: "家附近的公园",
      tags: ["户外", "亲子"],
      personNames: ["妈妈"],
      facts: ["孩子和妈妈一起去了公园。"],
    });

    const pending = await listPendingSuggestions(familyId, "memory_event", eventId);
    expect(pending.length).toBeGreaterThan(0);

    const titleSuggestion = pending.find((s) => s.suggestionType === "title")!;
    const locationSuggestion = pending.find((s) => s.suggestionType === "location")!;
    const personSuggestion = pending.find((s) => s.suggestionType === "person")!;
    const tagSuggestions = pending.filter((s) => s.suggestionType === "tag");

    expect(await resolveSuggestion(familyId, admin.id, titleSuggestion.id, "accept")).toEqual({
      ok: true,
    });
    expect(
      await resolveSuggestion(familyId, admin.id, locationSuggestion.id, "accept"),
    ).toEqual({ ok: true });
    expect(
      await resolveSuggestion(familyId, admin.id, personSuggestion.id, "accept"),
    ).toEqual({ ok: true });
    for (const tagSuggestion of tagSuggestions) {
      expect(await resolveSuggestion(familyId, admin.id, tagSuggestion.id, "accept")).toEqual({
        ok: true,
      });
    }

    const event = getDb()
      .select()
      .from(memoryEvent)
      .where(eq(memoryEvent.id, eventId))
      .get()!;
    expect(event.title).toBe("公园游玩");
    expect(event.locationText).toBe("家附近的公园");

    const participants = getDb()
      .select()
      .from(memoryEventParticipant)
      .where(eq(memoryEventParticipant.memoryEventId, eventId))
      .all();
    expect(participants.map((p) => p.personId)).toContain(momPersonId);

    const tags = await listEventTags(familyId, eventId);
    expect(tags.sort()).toEqual(["亲子", "户外"]);

    const resolved = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.entityId, eventId))
      .all();
    expect(resolved.every((s) => s.status === "accepted")).toBe(true);
  });

  it("rejects suggestions and keeps tombstones", async () => {
    const eventId = makeEvent();
    await runSuggestionJob(eventId, {
      title: "应被拒绝",
      locationText: null,
      tags: [],
      personNames: [],
      facts: [],
    });

    const pending = await listPendingSuggestions(familyId, "memory_event", eventId);
    const titleSuggestion = pending.find((s) => s.suggestionType === "title")!;
    expect(await resolveSuggestion(familyId, admin.id, titleSuggestion.id, "reject")).toEqual({
      ok: true,
    });

    const after = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.id, titleSuggestion.id))
      .get()!;
    expect(after.status).toBe("rejected");
    expect(after.resolvedByUserId).toBe(admin.id);
  });

  it("rerun replaces pending suggestions", async () => {
    const eventId = makeEvent();
    const firstLease = {
      jobId: randomUUID(),
      familyId,
      jobType: "suggest.event_metadata.v1",
      entityType: "memory_event",
      entityId: eventId,
      requiredCapability: "text" as const,
      providerId: "test-provider",
      model: "test-text-v1",
      providerExternal: false,
      consentVersion: null,
      triggerMode: "manual" as const,
      contentVisibility: "family" as const,
      requestedByUserId: admin!.id,
      attemptNumber: 1,
      leaseGeneration: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      workerId: "test-worker",
    };
    const first = await suggestEventMetadataHandler({
      lease: firstLease,
      assistant: makeAssistant({
        title: "第一次",
        locationText: null,
        tags: [],
        personNames: [],
        facts: [],
      }) as unknown as MemoryAssistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      first.commit(tx, {
        jobId: firstLease.jobId,
        familyId,
        entityType: "memory_event",
        entityId: eventId,
        requestedByUserId: admin!.id,
        attemptNumber: 1,
      }),
    );

    let pending = await listPendingSuggestions(familyId, "memory_event", eventId);
    expect(pending.length).toBe(1);
    const firstId = pending[0].id;

    const secondLease = { ...firstLease, jobId: randomUUID() };
    const second = await suggestEventMetadataHandler({
      lease: secondLease,
      assistant: makeAssistant({
        title: "第二次",
        locationText: null,
        tags: [],
        personNames: [],
        facts: [],
      }) as unknown as MemoryAssistant,
      signal: new AbortController().signal,
    });
    getDb().transaction((tx) =>
      second.commit(tx, {
        jobId: secondLease.jobId,
        familyId,
        entityType: "memory_event",
        entityId: eventId,
        requestedByUserId: admin!.id,
        attemptNumber: 1,
      }),
    );

    pending = await listPendingSuggestions(familyId, "memory_event", eventId);
    expect(pending.length).toBe(1);
    expect(pending[0].id).not.toBe(firstId);
    expect(pending[0].valueJson).toContain("第二次");
  });

  it("does not send private contributions to AI", async () => {
    const eventId = makeEvent();
    const assistant = makeAssistant({
      title: null,
      locationText: null,
      tags: [],
      personNames: [],
      facts: [],
    });
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: admin!.id,
      rawText: "公开内容",
      visibility: "family",
    });
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: admin!.id,
      rawText: "私密内容",
      visibility: "private",
    });

    const queued = enqueueAiJob(
      {
        familyId,
        requestedByUserId: admin.id,
        jobType: "suggest.event_metadata.v1",
        entityType: "memory_event",
        entityId: eventId,
        requiredCapability: "text",
        triggerMode: "manual",
        sources: [{ kind: "memory_event", id: eventId }],
      },
      { runtime: INTERNAL_RUNTIME },
    );
    if (!queued.ok) throw new Error("enqueue failed");
    const lease = claimNextAiJob("suggestions-privacy-worker", {
      runtime: INTERNAL_RUNTIME,
      leaseMs: 5_000,
    });
    if (!lease) throw new Error("job not claimed");

    await suggestEventMetadataHandler({
      lease,
      assistant: assistant as unknown as MemoryAssistant,
      signal: new AbortController().signal,
    });

    const prompt = (assistant.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .messages[0].content as string;
    expect(prompt).toContain("公开内容");
    expect(prompt).not.toContain("私密内容");
  });

  it("exports fact sources and accepted tags", async () => {
    const eventId = makeEvent("导出测试");
    await addFact(familyId, eventId, "手工确认的事实。");
    await runSuggestionJob(eventId, {
      title: null,
      locationText: null,
      tags: ["旅行"],
      personNames: [],
      facts: ["AI 建议的事实。"],
    });

    const tagSuggestion = (await listPendingSuggestions(familyId, "memory_event", eventId)).find(
      (s) => s.suggestionType === "tag",
    )!;
    await resolveSuggestion(familyId, admin.id, tagSuggestion.id, "accept");

    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(
      (await import("node:fs")).readFileSync(exported.filePath),
    );
    const root = "family-time-capsule-export";
    const memories = JSON.parse(await zip.file(`${root}/memories.json`)!.async("string"));
    const eventExport = memories.find((m: { id: string }) => m.id === eventId);
    expect(eventExport.tags).toContain("旅行");

    const factSources = JSON.parse(
      await zip.file(`${root}/fact-sources.json`)!.async("string"),
    );
    expect(factSources.length).toBeGreaterThanOrEqual(2);
    expect(factSources.some((s: { sourceType: string }) => s.sourceType === "user_text")).toBe(
      true,
    );
  });

  it("manual facts carry user_text source", async () => {
    const eventId = makeEvent();
    const f = await addFact(familyId, eventId, "手工事实必须有来源。");
    expect(f).toBeTruthy();
    const sources = getDb()
      .select()
      .from(factSource)
      .where(eq(factSource.factId, f!.id))
      .all();
    expect(sources).toHaveLength(1);
    expect(sources[0].sourceType).toBe("user_text");
    expect(sources[0].sourceId).toBeNull();
  });
});
