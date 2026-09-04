import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "@/lib/family/context";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";
import type { MemoryAssistant } from "@/lib/ai/types";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-review-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "review-setup-token";
process.env.AUTH_SECRET = "review-test-secret-with-sufficient-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { storySource } = await import("@/db/schema/story");
const { reviewPeriod, reviewPeriodEvent } = await import("@/db/schema/review");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { createTextInboxItem, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const {
  generateReviewStory,
  getOrCreateReviewPeriod,
  getReviewOverview,
  reviewReminderAt,
  reviewWindowForDate,
  reviewWindowForInstant,
  requestReviewStoryOptimization,
  setReviewHighlight,
  setReviewProgress,
} = await import("@/lib/review/service");
const { getStory } = await import("@/lib/stories/service");
const { runAiWorkerOnce } = await import("@/jobs/runtime");

const setup = await performSetup({
  token: "review-setup-token", displayName: "妈妈", email: "review@example.test",
  password: "a-long-enough-review-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select().from(user).get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "回顾测试家庭", timezone: "Asia/Shanghai", childDisplayName: "小满",
  childBirthDate: "2024-01-02", selfDisplayName: "妈妈", selfRelationToChild: "妈妈", selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const binding = await getUserBinding(admin.id);
if (!binding.familyId || !binding.familyTimezone) throw new Error("binding failed");
const context: FamilyContext = {
  userId: admin.id, userName: "妈妈", familyId: binding.familyId, personId: binding.personId,
  role: binding.role, accountEnabled: true, isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone, childLaterUnlockAge: binding.childLaterUnlockAge ?? 18,
};

const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: { id: "review-test-provider", displayName: "Review test", external: false },
  capabilities: {
    text: { available: true, model: "review-text-v1", reason: "configured" },
    vision: { available: false, model: null, reason: "not_configured" },
    transcription: { available: false, model: null, reason: "not_configured" },
    embeddings: { available: false, model: null, reason: "not_configured" },
  },
};

async function makeMemory(title: string, occurredAt: string): Promise<string> {
  const item = await createTextInboxItem(context.familyId, `${title}的原始记录`);
  const entry = await getInboxEntry(context.familyId, item.id);
  if (!entry) throw new Error("inbox missing");
  const confirmed = await confirmInboxEntry(context.familyId, entry, { title, occurredAt: new Date(occurredAt) });
  if (!confirmed.ok) throw new Error("confirm failed");
  return confirmed.eventId;
}

describe("weekly family review", () => {
  let sourceReviewId = "";
  let sourceStoryId = "";
  it("computes Shanghai/custom boundaries and the 167-hour New York DST week", () => {
    const shanghai = reviewWindowForInstant(new Date("2026-09-06T16:30:00Z"), "Asia/Shanghai", 1);
    expect(shanghai.key).toBe("2026-09-07");
    expect(shanghai.start.toISOString()).toBe("2026-09-06T16:00:00.000Z");
    const sunday = reviewWindowForDate("2026-09-09", "Asia/Shanghai", 0);
    expect(sunday.key).toBe("2026-09-06");
    const dst = reviewWindowForDate("2026-03-10", "America/New_York", 0);
    expect(dst.key).toBe("2026-03-08");
    expect((dst.end.getTime() - dst.start.getTime()) / 3_600_000).toBe(167);
    expect(reviewReminderAt(dst, "America/New_York", 0, "19:30", new Date("2026-03-08T12:00:00Z"))?.toISOString()).toBe("2026-03-08T23:30:00.000Z");
  });

  it("creates a period idempotently, supports complete/reopen, and permits an empty week", async () => {
    const first = await getOrCreateReviewPeriod(context, { anchorDate: "2026-07-01" });
    const second = await getOrCreateReviewPeriod(context, { anchorDate: "2026-07-02" });
    expect(second.period.id).toBe(first.period.id);
    expect((await getReviewOverview(context, "2026-07-01")).events).toEqual([]);
    await expect(setReviewProgress(context, first.period.id, "complete")).resolves.toEqual({ ok: true });
    expect((await getReviewOverview(context, "2026-07-01")).period.status).toBe("completed");
    await expect(setReviewProgress(context, first.period.id, "reopen")).resolves.toEqual({ ok: true });
    expect((await getReviewOverview(context, "2026-07-01")).period.status).toBe("in_progress");
  });

  it("selects only confirmed in-window events and creates one source-linked draft", async () => {
    const eventId = await makeMemory("一起在公园放风筝", "2026-09-02T02:00:00.000Z");
    const review = await getReviewOverview(context, "2026-09-02", { now: new Date("2026-09-01T00:00:00Z") });
    await expect(setReviewHighlight(context, review.period.id, eventId, true)).resolves.toEqual({ ok: true });
    const first = await generateReviewStory(context, review.period.id);
    const second = await generateReviewStory(context, review.period.id);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: true, storyId: first.ok ? first.storyId : "", existing: true });
    expect(getDb().select().from(reviewPeriod).all().filter((row) => row.id === review.period.id)).toHaveLength(1);
    expect(getDb().select().from(reviewPeriodEvent).all()).toEqual(expect.arrayContaining([expect.objectContaining({ memoryEventId: eventId })]));
    expect(getDb().select().from(storySource).all()).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: "memory_event", sourceId: eventId })]));
    sourceReviewId = review.period.id;
    sourceStoryId = first.ok ? first.storyId : "";
  });

  it("keeps AI optional and refines only an untouched source-linked draft", async () => {
    const external = { ...INTERNAL_RUNTIME, provider: { ...INTERNAL_RUNTIME.provider, external: true } };
    await expect(requestReviewStoryOptimization(context, sourceReviewId, { runtime: external })).resolves.toMatchObject({ ok: false, error: "capability_not_consented" });
    const queued = await requestReviewStoryOptimization(context, sourceReviewId, { runtime: INTERNAL_RUNTIME });
    expect(queued).toMatchObject({ ok: true, storyId: sourceStoryId });
    const assistant = {
      provider: INTERNAL_RUNTIME.provider,
      capabilities: INTERNAL_RUNTIME.capabilities,
      supports: (capability: string) => capability === "text",
      generateText: async () => ({
        text: JSON.stringify({ paragraphs: [{ ref: "N1", text: "九月二日，我们一起在公园放风筝。" }] }),
        finishReason: "stop",
        provenance: { providerId: "review-test-provider", providerName: "Review test", model: "review-text-v1" },
      }),
      analyzeImage: async () => { throw new Error("not supported"); },
      transcribeAudio: async () => { throw new Error("not supported"); },
      createEmbeddings: async () => { throw new Error("not supported"); },
    } as unknown as MemoryAssistant;
    await expect(runAiWorkerOnce({ assistant, workerId: "review-worker" })).resolves.toMatchObject({ status: "completed" });
    const detail = await getStory(context.familyId, sourceStoryId);
    expect(detail?.story).toMatchObject({ id: sourceStoryId, status: "draft", editedAt: null });
    expect(detail?.paragraphs[0]).toMatchObject({ text: "九月二日，我们一起在公园放风筝。" });
    expect(detail?.paragraphs[0]?.sources).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: "memory_event" })]));
  });

  it("keeps viewers read-only", async () => {
    const viewer: FamilyContext = { ...context, role: "viewer" };
    const overview = await getReviewOverview(viewer, "2026-09-02");
    expect(overview.events.length).toBeGreaterThan(0);
    await expect(setReviewProgress(viewer, overview.period.id, "complete")).rejects.toThrow("story:write");
  });
});
