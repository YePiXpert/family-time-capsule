import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-suggest-handler-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "suggest-handler-setup-token";
process.env.AUTH_SECRET = "suggest-handler-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { aiSuggestion, factSource } = await import("@/db/schema/suggestion");
const { fact } = await import("@/db/schema/contribution");
const { contribution } = await import("@/db/schema/contribution");
const { memoryEvent, memoryEventParticipant } = await import("@/db/schema/memory");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { suggestEventMetadataHandler } = await import(
  "@/lib/ai/handlers/suggest-event-metadata"
);

const setup = await performSetup({
  token: "suggest-handler-setup-token",
  displayName: "建议测试管理员",
  email: "suggest-handler-admin@example.com",
  password: "suggest-handler-password-long-enough",
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const admin = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "suggest-handler-admin@example.com"))
  .get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "建议测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2020-05-01",
  selfDisplayName: "管理员",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
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
  .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
  .get();
if (!child) throw new Error("child missing");

const dadId = randomUUID();
getDb()
  .insert(person)
  .values({
    id: dadId,
    familyId,
    displayName: "爸爸",
    relationToChild: "爸爸",
    isChild: false,
    isGuardian: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();

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
  getDb()
    .insert(memoryEventParticipant)
    .values({
      id: randomUUID(),
      memoryEventId: id,
      personId: child!.id,
      familyId,
      createdAt: now,
    })
    .run();
  return id;
}

function makeContribution(
  memoryEventId: string,
  rawText: string,
  visibility: "family" | "private" = "family",
): string {
  const id = randomUUID();
  const now = new Date();
  getDb()
    .insert(contribution)
    .values({
      id,
      memoryEventId,
      authorPersonId: adminPersonId,
      recordingMode: "legacy",
      rawText,
      visibility,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function makeLease(entityId: string): import("@/lib/ai/jobs").AiJobLease {
  return {
    jobId: randomUUID(),
    familyId,
    jobType: "suggest.event_metadata.v1",
    entityType: "memory_event",
    entityId,
    requiredCapability: "text" as const,
    providerId: "test-provider",
    model: "test-model",
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
}

function makeAssistant(payload: unknown) {
  return {
    provider: {
      id: "test-provider",
      displayName: "Test Provider",
      external: false,
    },
    capabilities: {
      text: { available: true, model: "test-model", reason: "configured" },
      vision: { available: false, model: null, reason: "not_configured" },
      transcription: { available: false, model: null, reason: "not_configured" },
      embeddings: { available: false, model: null, reason: "not_configured" },
    },
    supports: (capability: string) => capability === "text",
    generateText: vi.fn().mockResolvedValue({
      text: JSON.stringify(payload),
      finishReason: "stop",
      provenance: {
        providerId: "test-provider",
        providerName: "Test Provider",
        model: "test-model",
      },
    }),
    analyzeImage: vi.fn().mockRejectedValue(new Error("not supported")),
    transcribeAudio: vi.fn().mockRejectedValue(new Error("not supported")),
    createEmbeddings: vi.fn().mockRejectedValue(new Error("not supported")),
  };
}

function commitResult(
  result: Awaited<ReturnType<typeof suggestEventMetadataHandler>>,
  lease: import("@/lib/ai/jobs").AiJobLease,
) {
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
}

describe("suggest.event_metadata.v1 handler", () => {
  it("commits title/location/person/tag/fact suggestions on happy path", async () => {
    const eventId = makeEvent("一段记忆");
    makeContribution(eventId, "今天带孩子去公园玩，爸爸也来了。", "family");
    const lease = makeLease(eventId);
    const assistant = makeAssistant({
      title: "公园玩耍",
      locationText: "家附近的公园",
      tags: ["户外", "亲子"],
      personNames: ["爸爸"],
      facts: ["孩子和爸爸一起去了公园。"],
    });

    const result = await suggestEventMetadataHandler({
      lease,
      assistant: assistant as unknown as import("@/lib/ai/types").MemoryAssistant,
      signal: new AbortController().signal,
    });
    commitResult(result, lease);

    const suggestions = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.entityId, eventId))
      .all();
    expect(suggestions.length).toBe(5);
    expect(suggestions.some((s) => s.suggestionType === "title")).toBe(true);
    expect(suggestions.some((s) => s.suggestionType === "location")).toBe(true);
    expect(suggestions.some((s) => s.suggestionType === "person")).toBe(true);
    expect(suggestions.some((s) => s.suggestionType === "tag")).toBe(true);

    const tagSuggestions = getDb()
      .select()
      .from(aiSuggestion)
      .where(
        and(
          eq(aiSuggestion.entityId, eventId),
          eq(aiSuggestion.suggestionType, "tag"),
        ),
      )
      .all();
    expect(tagSuggestions.map((s) => (JSON.parse(s.valueJson) as { tag: string }).tag).sort()).toEqual([
      "亲子",
      "户外",
    ]);

    const facts = getDb()
      .select()
      .from(fact)
      .where(eq(fact.memoryEventId, eventId))
      .all();
    expect(facts.length).toBe(1);
    expect(facts[0].status).toBe("ai_suggested");

    const sources = getDb()
      .select()
      .from(factSource)
      .where(eq(factSource.factId, facts[0].id))
      .all();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((s) => s.sourceType === "contribution")).toBe(true);
  });

  it("throws bad_provider_output for malformed JSON", async () => {
    const eventId = makeEvent();
    const lease = makeLease(eventId);
    const assistant = makeAssistant({});
    assistant.generateText = vi.fn().mockResolvedValue({
      text: "not json",
      finishReason: "stop",
      provenance: {
        providerId: "test-provider",
        providerName: "Test Provider",
        model: "test-model",
      },
    });

    await expect(
      suggestEventMetadataHandler({
        lease,
        assistant: assistant as unknown as import("@/lib/ai/types").MemoryAssistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "bad_provider_output", retryable: true });
  });

  it("drops unknown person names instead of creating invalid refs", async () => {
    const eventId = makeEvent("一段记忆");
    const lease = makeLease(eventId);
    const assistant = makeAssistant({
      title: null,
      locationText: null,
      tags: [],
      personNames: ["陌生人"],
      facts: [],
    });

    const result = await suggestEventMetadataHandler({
      lease,
      assistant: assistant as unknown as import("@/lib/ai/types").MemoryAssistant,
      signal: new AbortController().signal,
    });
    commitResult(result, lease);

    const suggestions = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.entityId, eventId))
      .all();
    expect(suggestions.some((s) => s.suggestionType === "person")).toBe(false);
  });

  it("truncates context when total length exceeds limit", async () => {
    const eventId = makeEvent("一段记忆");
    const longText = "去公园。".repeat(10_000);
    makeContribution(eventId, longText, "family");
    const lease = makeLease(eventId);
    const assistant = makeAssistant({
      title: "长文测试",
      locationText: null,
      tags: [],
      personNames: [],
      facts: [],
    });

    const result = await suggestEventMetadataHandler({
      lease,
      assistant: assistant as unknown as import("@/lib/ai/types").MemoryAssistant,
      signal: new AbortController().signal,
    });
    commitResult(result, lease);

    expect(assistant.generateText).toHaveBeenCalledTimes(1);
    const prompt = assistant.generateText.mock.calls[0][0].messages[0].content as string;
    expect(prompt.length).toBeLessThan(30_000);

    const suggestions = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.entityId, eventId))
      .all();
    expect(suggestions.some((s) => s.suggestionType === "title")).toBe(true);
  });

  it("throws event_not_found for missing event", async () => {
    const lease = makeLease("missing-event");
    const assistant = makeAssistant({
      title: null,
      locationText: null,
      tags: [],
      personNames: [],
      facts: [],
    });

    await expect(
      suggestEventMetadataHandler({
        lease,
        assistant: assistant as unknown as import("@/lib/ai/types").MemoryAssistant,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "event_not_found", retryable: false });
  });

  it("does not include private contributions in context", async () => {
    const eventId = makeEvent("一段记忆");
    makeContribution(eventId, "公开内容", "family");
    makeContribution(eventId, "私密内容", "private");
    const lease = makeLease(eventId);
    const assistant = makeAssistant({
      title: null,
      locationText: null,
      tags: [],
      personNames: [],
      facts: [],
    });

    await suggestEventMetadataHandler({
      lease,
      assistant: assistant as unknown as import("@/lib/ai/types").MemoryAssistant,
      signal: new AbortController().signal,
    });

    const prompt = assistant.generateText.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("公开内容");
    expect(prompt).not.toContain("私密内容");
  });
});
