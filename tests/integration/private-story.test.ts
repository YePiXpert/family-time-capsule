import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
import type { MemoryAssistant } from "@/lib/ai/types";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";

const dir = mkdtempSync(path.join(tmpdir(), "ftc-private-story-"));
const dirs = [dir];
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-story-secret";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { contribution, fact } = await import("@/db/schema/contribution");
const { story, storyParagraph, storySource } = await import("@/db/schema/story");
const { assetTranscript } = await import("@/db/schema/transcript");
const { factSource } = await import("@/db/schema/suggestion");
const { storeOriginal } = await import("@/lib/assets/service");
const stories = await import("@/lib/stories/service");
const { searchFamily } = await import("@/lib/search/service");
getDb().insert(family).values({ id: "family", name: "合成故事家庭", timezone: "UTC" }).run();
for (const id of ["a", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: id }).run();
  getDb().insert(user).values({ id, personId: `person-${id}`, familyId: "family", name: id, email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-story`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (userId: string): FamilyContext => ({ userId, userName: userId, familyId: "family", personId: `person-${userId}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
afterAll(() => { closeDatabase(); dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); });
let serial = 0;
async function scenario(visibility: "family" | "private" = "family") {
  const id = randomUUID(), anchor = new Date(Date.UTC(2035, serial++, 15));
  const period = stories.periodForKind("monthly", anchor);
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: "私密故事来源标题", occurredAt: anchor, createdByUserId: "a", visibility }).run();
  getDb().insert(fact).values({ id, memoryEventId: id, statement: "秘密向日葵事实" }).run();
  getDb().insert(contribution).values({ id, memoryEventId: id, authorPersonId: "person-a", rawText: "秘密向日葵讲述", visibility: "family" }).run();
  const stored = await storeOriginal({ familyId: "family", createdByUserId: "a", visibility: "private", type: "audio", originalFilename: "合成原声.wav", mimeType: "audio/wav", buffer: Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample.wav")), Buffer.from(id)]), extension: "wav", timeSource: "import_time" });
  if (stored.status !== "stored") throw new Error(stored.status);
  getDb().insert(memoryEventAsset).values({ id, familyId: "family", memoryEventId: id, assetId: stored.asset.id }).run();
  getDb().insert(assetTranscript).values({ id, familyId: "family", assetId: stored.asset.id, provider: "fixture", model: "fixture", rawTranscript: "机器保留", editedTranscript: "秘密向日葵人工转录", sourceSha256: stored.asset.sha256, status: "user_edited" }).run();
  const plans = () => stories.planDeterministicDraft(stories.collectStoryMaterial("family", period), stories.collectTranscriptMaterial("family", period));
  return { id, anchor, period, assetId: stored.asset.id, plans };
}

it("family story collection excludes private events, their facts, narration, and edited transcripts", async () => {
  const s = await scenario("private");
  expect(stories.collectStoryMaterial("family", s.period)).toEqual({ facts: [], contributions: [], transcripts: [], eventTitles: new Map() });
  expect(stories.collectTranscriptMaterial("family", s.period)).toEqual([]);
  const api = await import("@/app/api/mobile/v1/library/[domain]/route");
  const response = await api.POST(new Request("http://localhost/api/mobile/v1/library/stories", { method: "POST", headers: { authorization: "Bearer c-synthetic-story", "content-type": "application/json" }, body: JSON.stringify({ anchor: s.anchor.toISOString() }) }), { params: Promise.resolve({ domain: "stories" }) });
  expect(response.status).toBe(400);
  expect(getDb().select().from(story).all()).toEqual([]);
});

it("confirmed facts cannot widen a private underlying narration, and historical stories disappear from online reads and search after withdrawal", async () => {
  const s = await scenario();
  getDb().insert(factSource).values({ id: s.id, familyId: "family", factId: s.id, sourceType: "contribution", sourceId: s.id }).run();
  const result = stories.createStoryDraft(ctx("c"), { kind: "monthly", anchor: s.anchor, title: "秘密向日葵故事" }, s.plans());
  if (!result.ok) throw new Error(result.error);
  expect(stories.publishStory(ctx("c"), result.storyId)).toEqual({ ok: true });
  expect(await stories.getStory("family", result.storyId)).toBeDefined();
  expect(searchFamily(ctx("c"), { q: "向日葵" }).stories.some(r => r.id === result.storyId)).toBe(true);
  getDb().update(contribution).set({ visibility: "private" }).where(eq(contribution.id, s.id)).run();
  expect(stories.collectStoryMaterial("family", s.period).facts).toEqual([]);
  expect(await stories.getStory("family", result.storyId)).toBeUndefined();
  expect((await stories.listStories("family")).map(s => s.id)).not.toContain(result.storyId);
  expect(searchFamily(ctx("c"), { q: "向日葵" }).stories.some(r => r.id === result.storyId)).toBe(false);
  const api = await import("@/app/api/mobile/v1/library/[domain]/[id]/route");
  expect((await api.GET(new Request("http://localhost/api/test", { headers: { authorization: "Bearer c-synthetic-story" } }), { params: Promise.resolve({ domain: "stories", id: result.storyId }) })).status).toBe(404);
  // Persistent human content is retained; online closure is an authorization decision.
  expect(getDb().select().from(storyParagraph).where(eq(storyParagraph.storyId, result.storyId)).all()).toHaveLength(3);
  getDb().update(story).set({ deletedAt: new Date() }).where(eq(story.id, result.storyId)).run();
  const trash = await import("@/lib/trash/service");
  expect(trash.listTrash(ctx("c")).map(row => row.id)).not.toContain(result.storyId);
  expect(trash.restoreFromTrash(ctx("c"), "story", result.storyId)).toMatchObject({ ok: false });
  expect(trash.purgeFromTrash(ctx("c"), "story", result.storyId)).toMatchObject({ ok: false });
});

it("stale source plans cannot publish or destroy an earlier untouched draft during regeneration", async () => {
  const s = await scenario(), plans = s.plans();
  const original = stories.createStoryDraft(ctx("c"), { kind: "monthly", anchor: s.anchor }, plans);
  if (!original.ok) throw new Error(original.error);
  const before = getDb().all(sql`select * from story_paragraph where story_id=${original.storyId}`);
  getDb().update(memoryEvent).set({ visibility: "private" }).where(eq(memoryEvent.id, s.id)).run();
  expect(stories.regenerateOrCreateStory(ctx("c"), { kind: "monthly", anchor: s.anchor }, plans)).toMatchObject({ ok: false });
  expect(getDb().all(sql`select * from story_paragraph where story_id=${original.storyId}`)).toEqual(before);
  expect(stories.publishStory(ctx("c"), original.storyId)).toMatchObject({ ok: false });
  expect(getDb().select().from(story).where(eq(story.id, original.storyId)).get()?.status).toBe("draft");
});

it("a model response prepared before privacy withdrawal cannot create a shared story before or during final commit", async () => {
  const s = await scenario();
  const { generateStoryHandler } = await import("@/lib/ai/handlers/generate-story");
  const before = getDb().select().from(story).all();
  const generateText = vi.fn(async () => ({ text: JSON.stringify({ title: "模型秘密标题", paragraphs: [{ kind: "narrative", text: "模型整理了向日葵", sources: [{ ref: "F1" }] }] }), finishReason: "stop", provenance: { providerId: "fixture", providerName: "Fixture", model: "fixture" } }));
  const lease = { jobId: randomUUID(), familyId: "family", requestedByUserId: "c", entityId: `monthly@${s.anchor.toISOString()}`, jobType: "generate.story.v1", entityType: "story", requiredCapability: "text", providerId: "fixture", model: "fixture", providerExternal: false, consentVersion: null, triggerMode: "manual", contentVisibility: "family", attemptNumber: 1, leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60000), workerId: "fixture" } as const;
  const prepared = await generateStoryHandler({ lease, assistant: { generateText } as unknown as MemoryAssistant, signal: new AbortController().signal });
  expect(generateText).toHaveBeenCalledOnce();
  expect(getDb().select().from(story).all()).toEqual(before);
  getDb().update(memoryEvent).set({ visibility: "private" }).where(eq(memoryEvent.id, s.id)).run();
  expect(() => getDb().transaction(tx => prepared.commit(tx, lease))).toThrow();
  expect(getDb().select().from(story).all()).toEqual(before);
  expect(getDb().select().from(storySource).all().some(s => s.quote === "模型整理了向日葵")).toBe(false);
});

it("deleting a paragraph cannot erase the AI title's dependencies on unquoted prompt sources", async () => {
  const s = await scenario();
  const { generateStoryHandler } = await import("@/lib/ai/handlers/generate-story");
  const lease = { jobId: randomUUID(), familyId: "family", requestedByUserId: "c", entityId: `monthly@${s.anchor.toISOString()}`, jobType: "generate.story.v1", entityType: "story", requiredCapability: "text", providerId: "fixture", model: "fixture", providerExternal: false, consentVersion: null, triggerMode: "manual", contentVisibility: "family", attemptNumber: 1, leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60000), workerId: "fixture" } as const;
  const prepared = await generateStoryHandler({ lease, signal: new AbortController().signal, assistant: { generateText: async () => ({ text: JSON.stringify({ title: "标题用了未引用的讲述", paragraphs: [
    { kind: "narrative", text: "可移除的首段", sources: [{ ref: "F1" }] },
    { kind: "narrative", text: "保留的向日葵段落", sources: [{ ref: "F1" }] },
  ] }), finishReason: "stop" }) } as unknown as MemoryAssistant });
  getDb().transaction(tx => prepared.commit(tx, lease));
  const created = getDb().select().from(story).where(eq(story.createdByJobId, lease.jobId)).get()!;
  const detail = (await stories.getStory("family", created.id))!;
  expect(stories.deleteParagraph(ctx("c"), detail.paragraphs[0].id)).toEqual({ ok: true });
  expect(stories.publishStory(ctx("c"), created.id)).toEqual({ ok: true });
  getDb().update(contribution).set({ visibility: "private" }).where(eq(contribution.id, s.id)).run();
  expect(await stories.getStory("family", created.id)).toBeUndefined();
  expect(searchFamily(ctx("c"), { q: "向日葵" }).stories.map(s => s.id)).not.toContain(created.id);
  expect(getDb().select().from(storyParagraph).where(eq(storyParagraph.storyId, created.id)).all()).toHaveLength(1);
});

it("the shared AI queue rejects unreadable event sources and detects canonical body changes before dispatch", async () => {
  const s = await scenario("private");
  const jobs = await import("@/lib/ai/jobs");
  const runtime: AiJobRuntimeIdentity = { provider: { id: "fixture", displayName: "Fixture", external: false }, capabilities: {
    text: { available: true, model: "fixture", reason: "configured" },
    vision: { available: false, model: null, reason: "not_configured" },
    transcription: { available: false, model: null, reason: "not_configured" },
    embeddings: { available: false, model: null, reason: "not_configured" },
  } };
  const input = { familyId: "family", requestedByUserId: "c", jobType: "generate.story.v1", entityType: "story", entityId: `monthly@${s.anchor.toISOString()}`, requiredCapability: "text" as const, triggerMode: "manual" as const, sources: [{ kind: "memory_event" as const, id: s.id }] };
  expect(jobs.enqueueAiJob(input, { runtime })).toEqual({ ok: false, error: "source_forbidden_or_not_found" });
  getDb().update(memoryEvent).set({ visibility: "family" }).where(eq(memoryEvent.id, s.id)).run();
  expect(jobs.enqueueAiJob(input, { runtime }).ok).toBe(true);
  const lease = jobs.claimNextAiJob("fixture-worker", { runtime });
  expect(lease).not.toBeNull();
  expect(jobs.validateAiJobExecution(lease!, { runtime }).ok).toBe(true);
  // The canonical body is not the title or the search index; timestamps may be identical.
  getDb().update(memoryEvent).set({ bodyText: "同一秒内重新修订的人工正文" }).where(eq(memoryEvent.id, s.id)).run();
  expect(jobs.validateAiJobExecution(lease!, { runtime }).ok).toBe(false);
});

it("review optimization retains all input dependencies after removing the paragraph whose facts influenced another", async () => {
  const s = await scenario(), otherId = randomUUID();
  getDb().insert(memoryEvent).values({ id: otherId, familyId: "family", title: "另一来源", occurredAt: s.anchor, createdByUserId: "a" }).run();
  getDb().insert(fact).values({ id: otherId, memoryEventId: otherId, statement: "第二段的独立事实" }).run();
  const created = stories.createStoryDraft(ctx("c"), { kind: "monthly", anchor: s.anchor }, [
    { kind: "narrative", text: "第一段", sources: [{ sourceType: "fact", sourceId: s.id, quote: null }] },
    { kind: "narrative", text: "第二段", sources: [{ sourceType: "fact", sourceId: otherId, quote: null }] },
  ]);
  if (!created.ok) throw new Error(created.error);
  const { reviewPeriod } = await import("@/db/schema/review");
  getDb().insert(reviewPeriod).values({ id: s.id, familyId: "family", periodStart: s.period.start, periodEnd: s.period.end, storyId: created.storyId }).run();
  const lease = { jobId: randomUUID(), familyId: "family", requestedByUserId: "c", entityId: s.id, jobType: "optimize.review.story.v1", entityType: "review_period", requiredCapability: "text", providerId: "fixture", model: "fixture", providerExternal: false, consentVersion: null, triggerMode: "manual", contentVisibility: "family", attemptNumber: 1, leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60000), workerId: "fixture" } as const;
  const { optimizeReviewStoryHandler } = await import("@/lib/ai/handlers/optimize-review-story");
  const prepared = await optimizeReviewStoryHandler({ lease, signal: new AbortController().signal, assistant: { generateText: async () => ({ text: JSON.stringify({ paragraphs: [{ ref: "N1", text: "第二段事实被写入第一段" }, { ref: "N2", text: "第二段" }] }), finishReason: "stop" }) } as unknown as MemoryAssistant });
  getDb().transaction(tx => prepared.commit(tx, lease));
  const detail = (await stories.getStory("family", created.storyId))!;
  expect(detail.paragraphs[0].text).toBe("第二段事实被写入第一段");
  expect(stories.deleteParagraph(ctx("c"), detail.paragraphs[1].id)).toEqual({ ok: true });
  getDb().update(memoryEvent).set({ visibility: "private" }).where(eq(memoryEvent.id, otherId)).run();
  expect(await stories.getStory("family", created.storyId)).toBeUndefined();
});

it("bounded review optimization preserves every paragraph outside its model batch", async () => {
  const s = await scenario();
  const plans = Array.from({ length: 70 }, (_, index) => ({ kind: "narrative" as const, text: `必须保留的第${index + 1}段`, sources: [{ sourceType: "fact" as const, sourceId: s.id, quote: null }] }));
  const created = stories.createStoryDraft(ctx("c"), { kind: "monthly", anchor: s.anchor }, plans);
  if (!created.ok) throw new Error(created.error);
  const { reviewPeriod } = await import("@/db/schema/review");
  getDb().insert(reviewPeriod).values({ id: s.id, familyId: "family", periodStart: s.period.start, periodEnd: s.period.end, storyId: created.storyId }).run();
  const lease = { jobId: randomUUID(), familyId: "family", requestedByUserId: "c", entityId: s.id, jobType: "optimize.review.story.v1", entityType: "review_period", requiredCapability: "text", providerId: "fixture", model: "fixture", providerExternal: false, consentVersion: null, triggerMode: "manual", contentVisibility: "family", attemptNumber: 1, leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60000), workerId: "fixture" } as const;
  const { optimizeReviewStoryHandler } = await import("@/lib/ai/handlers/optimize-review-story");
  const prepared = await optimizeReviewStoryHandler({ lease, signal: new AbortController().signal, assistant: { generateText: async () => ({ text: JSON.stringify({ paragraphs: [{ ref: "N1", text: "仅优化第一段" }] }), finishReason: "stop" }) } as unknown as MemoryAssistant });
  getDb().transaction(tx => prepared.commit(tx, lease));
  const detail = (await stories.getStory("family", created.storyId))!;
  expect(detail.paragraphs.map(p => p.text)).toEqual(["仅优化第一段", ...plans.slice(1).map(p => p.text)]);
});

it("story-level input dependencies survive real archive verification and fresh-directory restore", async () => {
  const s = await scenario();
  const inputSources = [{ sourceType: "contribution" as const, sourceId: s.id }];
  const created = stories.createStoryDraft(ctx("c"), { kind: "monthly", anchor: s.anchor, inputSources, createdByJobId: randomUUID() }, [
    { kind: "narrative", text: "依赖未被逐段引用的讲述", sources: [{ sourceType: "fact", sourceId: s.id, quote: null }] },
  ]);
  if (!created.ok) throw new Error(created.error);
  expect(stories.publishStory(ctx("c"), created.storyId)).toEqual({ ok: true });
  getDb().update(contribution).set({ visibility: "private" }).where(eq(contribution.id, s.id)).run();
  const { buildActorExport, buildDisasterExport } = await import("@/lib/export/service");
  const JSZip = (await import("jszip")).default;
  const root = "family-time-capsule-export";
  const actor = await buildActorExport(ctx("c"));
  const actorZip = await JSZip.loadAsync(readFileSync(actor.filePath));
  expect(JSON.parse(await actorZip.file(`${root}/stories.json`)!.async("string")).map((s: { id: string }) => s.id)).not.toContain(created.storyId);
  const disaster = await buildDisasterExport("family"), bytes = readFileSync(disaster.filePath);
  const zip = await JSZip.loadAsync(bytes), rows = JSON.parse(await zip.file(`${root}/stories.json`)!.async("string"));
  expect(rows.find((s: { id: string }) => s.id === created.storyId).inputSources).toEqual(inputSources);
  const checked = spawnSync(process.execPath, ["scripts/verify-export.mjs", disaster.filePath], { encoding: "utf8" });
  expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  closeDatabase();
  const restoredDir = mkdtempSync(path.join(tmpdir(), "ftc-story-restored-")); dirs.push(restoredDir);
  process.env.DATA_DIR = restoredDir; vi.resetModules();
  const restored = await import("@/db");
  try {
    restored.getDb().insert(user).values({ id: "operator", name: "新维护者", email: "operator@fixture.invalid", role: "owner" }).run();
    const { restoreFromZip } = await import("@/lib/restore/service");
    // A forged complete manifest must fail before creating any family or content.
    const tampered = await JSZip.loadAsync(bytes);
    rows.find((s: { id: string }) => s.id === created.storyId).inputSources = [{ sourceType: "fact", sourceId: "missing-fact" }];
    tampered.file(`${root}/stories.json`, JSON.stringify(rows));
    await expect(restoreFromZip(await tampered.generateAsync({ type: "nodebuffer" }), "operator")).rejects.toMatchObject({ code: "bad_refs" });
    expect(restored.getDb().select().from(family).all()).toEqual([]);
    await restoreFromZip(bytes, "operator");
    const row = restored.getDb().select().from(story).where(eq(story.id, created.storyId)).get()!;
    expect(JSON.parse(row.inputSourcesJson!)).toEqual(inputSources);
    expect(await (await import("@/lib/stories/service")).getStory("family", created.storyId)).toBeUndefined();
    expect(restored.getDb().select().from(storyParagraph).where(eq(storyParagraph.storyId, created.storyId)).get()?.text).toBe("依赖未被逐段引用的讲述");
  } finally { restored.closeDatabase(); process.env.DATA_DIR = dir; }
});
