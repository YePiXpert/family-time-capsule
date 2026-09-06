import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-organizer-"));
process.env.DATA_DIR = dir; process.env.AUTH_SECRET = "organizer-test-secret-0123456789"; process.env.INITIAL_SETUP_TOKEN = "organizer";
const { getDb, closeDatabase } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { asset } = await import("@/db/schema/asset");
const { aiJob, aiJobDependency, aiJobSource } = await import("@/db/schema/ai-job");
const { assetTranscript } = await import("@/db/schema/transcript");
const { aiSuggestion } = await import("@/db/schema/suggestion");
const { inboxItem, inboxItemAsset } = await import("@/db/schema/inbox");
const { memoryEvent } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const { requestInboxItemSuggestions, requestEventSuggestions } = await import("@/lib/suggestions/service");
const { listReviewableSuggestions } = await import("@/lib/suggestions/access");
const { getNameReview, renameTarget, reviewTitleSuggestion } = await import("@/lib/names/service");
const { enqueueAiJob, claimNextAiJob, completeAiJob, failAiJob, retryAiJob, requestAiJobCancellation } = await import("@/lib/ai/jobs");
const { runAiWorkerOnce } = await import("@/jobs/runtime");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { AiJobHandlerError } = await import("@/jobs/types");
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
expect((await performSetup({ token: "organizer", displayName: "不应外发的管理员名", email: "organizer@fixture.invalid", password: "organizer-fixture-password" })).ok).toBe(true);
const actor = getDb().select().from(user).get()!;
const family = await completeOnboarding(actor.id, { familyName: "虚构整理", timezone: "Asia/Shanghai", childDisplayName: "不应外发的孩子名", childBirthDate: "2020-01-01", selfDisplayName: "不应外发的管理员名", selfRelationToChild: "家人", selfIsGuardian: true });
if (!family.ok) throw new Error("fixture family failed");
const familyId = family.familyId;
const binding = await getUserBinding(actor.id);
const context: FamilyContext = { userId: actor.id, userName: actor.name, familyId, personId: binding.personId, role: "admin", accountEnabled: true, isGuardian: true, familyTimezone: "Asia/Shanghai", childLaterUnlockAge: 18 };
function assistant() {
  const ai = new DeterministicFakeMemoryAssistant();
  const text = vi.spyOn(ai, "generateText").mockImplementation(async input => {
    const prompt = JSON.stringify(input.messages);
    for (const secret of [familyId, actor.id, "不应外发的孩子名", "不应外发的管理员名", "IMG_"]) expect(prompt).not.toContain(secret);
    return { text: JSON.stringify({ title: "窗边摆着一盆绿色植物", locationText: null, facts: [], occurredAt: null, timePrecision: "approximate", personNames: [], tags: ["绿植"] }), finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.text.model! } };
  });
  const vision = vi.spyOn(ai, "analyzeImage").mockResolvedValue({ text: "【描述】窗边摆着绿色植物。\n【图中文字】", finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.vision.model! } });
  return { ai, text, vision };
}
let suffix = 0;
async function photo() {
  const bytes = Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample-exif.jpg")), Buffer.from(String(++suffix))]);
  const stored = await ingestImage({ familyId, createdByUserId: actor.id, filename: `IMG_${suffix}.jpg`, declaredMime: "image/jpeg", buffer: bytes, clientLastModifiedMs: null });
  if (stored.status !== "stored") throw new Error("fixture ingest failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  return { item, original: stored.asset, bytes };
}
function textItem() {
  const id = randomUUID();
  getDb().insert(inboxItem).values({ id, familyId, kind: "text", rawText: "今天在窗边给绿植浇水。", titleSource: "rule_generated" }).run();
  return id;
}
function job(id: string) { return getDb().select().from(aiJob).where(eq(aiJob.id, id)).get()!; }

it("persists image→naming across a DB restart, deduplicates clicks, and follows early confirmation", async () => {
  const { ai, text, vision } = assistant(); const p = await photo();
  const queued = requestInboxItemSuggestions(context, p.item.id, { runtime: ai }); expect(queued.ok).toBe(true); if (!queued.ok) throw new Error(queued.error);
  expect(requestInboxItemSuggestions(context, p.item.id, { runtime: ai })).toEqual({ ...queued, created: false });
  expect(getDb().select().from(aiJobDependency).where(eq(aiJobDependency.jobId, queued.jobId)).all()).toHaveLength(1);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(vision).toHaveBeenCalledOnce(); expect(text).not.toHaveBeenCalled();
  expect(job(queued.jobId).attempts).toBe(0);
  closeDatabase();
  const entry = await getInboxEntry(familyId, p.item.id); if (!entry) throw new Error("entry missing");
  const confirmed = await confirmInboxEntry(familyId, entry); if (!confirmed.ok) throw new Error(confirmed.error);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed", jobId: queued.jobId });
  const review = await getNameReview(familyId, actor.id, "memory_event", confirmed.eventId);
  expect(review?.suggestions).toHaveLength(1); expect(review?.suggestions[0].valid).toBe(true);
  const suggestion = review!.suggestions[0];
  expect(listReviewableSuggestions(familyId, actor.id, "memory_event", confirmed.eventId).map(row => row.suggestionType)).toEqual(expect.arrayContaining(["title", "tag"]));
  expect(await reviewTitleSuggestion(familyId, actor.id, { suggestionId: suggestion.id, suggestionRevision: suggestion.revision, targetKind: "memory_event", targetId: confirmed.eventId, targetRevision: review!.target.revision, operation: "accept" })).toMatchObject({ ok: true });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, confirmed.eventId)).get()?.title).toBe("窗边摆着一盆绿色植物");
  expect(getDb().select().from(asset).where(eq(asset.id, p.original.id)).get()).toEqual(p.original);
  expect(getAssetStorage().read(p.original.storageKey)).toEqual(p.bytes);
  expect(text).toHaveBeenCalledOnce(); expect(vision).toHaveBeenCalledOnce();
});

it("runs text without assets and remaps a ready suggestion at confirmation", async () => {
  const { ai, text, vision } = assistant(); const id = textItem();
  expect(requestInboxItemSuggestions(context, id, { runtime: ai }).ok).toBe(true);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  const entry = await getInboxEntry(familyId, id); const confirmed = await confirmInboxEntry(familyId, entry!);
  if (!confirmed.ok) throw new Error(confirmed.error);
  expect((await getNameReview(familyId, actor.id, "memory_event", confirmed.eventId))?.suggestions[0].valid).toBe(true);
  expect(text).toHaveBeenCalledOnce(); expect(vision).not.toHaveBeenCalled();
});

it("does not commit a late title after manual naming or changing title during confirmation", async () => {
  for (const confirm of [false, true]) {
    const { ai, text } = assistant(); const id = textItem();
    expect(requestInboxItemSuggestions(context, id, { runtime: ai }).ok).toBe(true);
    text.mockImplementationOnce(async () => {
      if (confirm) {
        expect((await confirmInboxEntry(familyId, (await getInboxEntry(familyId, id))!, { title: "人工确认的名称" })).ok).toBe(true);
      } else expect((await renameTarget(familyId, actor.id, { kind: "inbox_item", id, revision: 0, title: "人工名称" })).ok).toBe(true);
      return { text: JSON.stringify({ title: "晚到的名称", occurredAt: null, personNames: [], tags: [] }), finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.text.model! } };
    });
    expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "discarded", errorCode: "source_changed" });
    expect(getDb().select().from(aiSuggestion).where(eq(aiSuggestion.entityId, id)).all()).toHaveLength(0);
  }
});

it("pauses on prerequisite failure, retries only failed work, and preserves successful analysis", async () => {
  const { ai, vision, text } = assistant(); const p = await photo();
  vision.mockRejectedValueOnce(new AiJobHandlerError("fixture_failure", false));
  const queued = requestInboxItemSuggestions(context, p.item.id, { runtime: ai }); if (!queued.ok) throw new Error(queued.error);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "failed" });
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "idle" });
  expect(job(queued.jobId)).toMatchObject({ status: "cancelled", attempts: 0, lastErrorCode: "dependency_failed" });
  const retried = retryAiJob(context, queued.jobId, { runtime: ai }); if (!retried.ok) throw new Error(retried.error);
  expect(retryAiJob(context, queued.jobId, { runtime: ai })).toEqual({ ...retried, created: false });
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  text.mockRejectedValueOnce(new AiJobHandlerError("fixture_naming_failure", false));
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "failed", jobId: retried.jobId });
  expect(retryAiJob(context, retried.jobId, { runtime: ai }).ok).toBe(true);
  closeDatabase();
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(vision).toHaveBeenCalledTimes(2); expect(text).toHaveBeenCalledTimes(2);
});

it("keeps audio edits readable and invalidates a pending name after a transcript correction", async () => {
  const { ai, text } = assistant();
  const stored = await ingestMedia({ familyId, createdByUserId: actor.id, kind: "audio", filename: "原始声音.wav", declaredMime: "audio/wav", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.wav")), clientLastModifiedMs: null });
  if (stored.status !== "stored") throw new Error("audio fixture failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const transcribe = vi.spyOn(ai, "transcribeAudio").mockResolvedValue({ text: "今天给绿植浇水。", language: "zh", durationSeconds: null, segments: [], provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.transcription.model! } });
  expect(requestInboxItemSuggestions(context, item.id, { runtime: ai }).ok).toBe(true);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(text).not.toHaveBeenCalled();
  getDb().update(assetTranscript).set({ editedTranscript: "人工修订：窗边绿植浇水。", status: "user_edited" }).where(eq(assetTranscript.assetId, stored.asset.id)).run();
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(JSON.stringify(text.mock.calls[0][0].messages)).toContain("人工修订：窗边绿植浇水。");
  expect((await getNameReview(familyId, actor.id, "inbox_item", item.id))?.suggestions[0].valid).toBe(true);
  getDb().update(assetTranscript).set({ editedTranscript: "再次修订，实际是室外的花。" }).where(eq(assetTranscript.assetId, stored.asset.id)).run();
  expect((await getNameReview(familyId, actor.id, "inbox_item", item.id))?.suggestions).toHaveLength(0);
  expect(transcribe).toHaveBeenCalledOnce();
});

it("rolls back partial enqueue when a capability is unavailable and rejects bad JSON without retry", async () => {
  const { ai, text } = assistant(); const p = await photo();
  const count = getDb().select().from(aiJob).all().length;
  const runtime = { provider: ai.provider, capabilities: { ...ai.capabilities, text: { available: false, model: null, reason: "not_configured" as const } } };
  expect(requestInboxItemSuggestions(context, p.item.id, { runtime })).toEqual({ ok: false, error: "capability_unavailable" });
  expect(getDb().select().from(aiJob).all()).toHaveLength(count);
  const id = textItem(); const queued = requestInboxItemSuggestions(context, id, { runtime: ai }); if (!queued.ok) throw new Error(queued.error);
  text.mockResolvedValueOnce({ text: 'prefix {"title":"bad","personNames":[],"tags":[]} suffix', finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.text.model! } });
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "failed", errorCode: "bad_provider_output" });
  expect(job(queued.jobId)).toMatchObject({ status: "failed", attempts: 1 });
});

it("preserves source guards, rejects dependency cycles/mutation, and never leases a waiting child", async () => {
  const { ai } = assistant(); const id = textItem();
  const source = [{ kind: "inbox_item" as const, id }];
  const enqueue = (type: string, dependencies: string[] = []) => enqueueAiJob({ familyId, requestedByUserId: actor.id, jobType: type, entityType: "inbox_item", entityId: id, requiredCapability: "text", triggerMode: "manual", sources: source, dependencies }, { runtime: ai });
  const a = enqueue("fixture.parent"); if (!a.ok) throw new Error(a.error);
  const b = enqueue("fixture.child", [a.jobId]); if (!b.ok) throw new Error(b.error);
  expect(() => getDb().insert(aiJobDependency).values({ jobId: a.jobId, dependsOnJobId: b.jobId }).run()).toThrow(/invalid AI dependency/);
  expect(() => getDb().delete(aiJobDependency).where(eq(aiJobDependency.jobId, b.jobId)).run()).toThrow(/cannot be removed/);
  expect(() => getDb().update(aiJobSource).set({ sourceId: "changed" }).where(eq(aiJobSource.jobId, a.jobId)).run()).toThrow(/immutable/);
  expect(() => getDb().delete(aiJobSource).where(eq(aiJobSource.jobId, a.jobId)).run()).toThrow(/cannot be removed/);
  expect(() => getDb().update(aiJob).set({ targetRevision: 100 }).where(eq(aiJob.id, a.jobId)).run()).toThrow(/immutable/);
  const lease = claimNextAiJob("fixture-worker-a", { runtime: ai }); expect(lease?.jobId).toBe(a.jobId);
  expect(claimNextAiJob("fixture-worker-b", { runtime: ai })).toBeNull();
  expect(completeAiJob(lease!, { runtime: ai }).ok).toBe(true);
  const child = claimNextAiJob("fixture-worker-b", { runtime: ai }); expect(child?.jobId).toBe(b.jobId);
  expect(failAiJob(child!, "fixture_failure", false, { runtime: ai }).ok).toBe(true);
});

it("cancellation or deleting a confirmed source prevents downstream naming", async () => {
  for (const deleted of [false, true]) {
    const { ai, text } = assistant(); const p = await photo();
    const queued = requestInboxItemSuggestions(context, p.item.id, { runtime: ai }); if (!queued.ok) throw new Error(queued.error);
    const parent = getDb().select().from(aiJobDependency).where(eq(aiJobDependency.jobId, queued.jobId)).get()!;
    if (!deleted) {
      expect(requestAiJobCancellation(context, parent.dependsOnJobId, { runtime: ai }).ok).toBe(true);
      expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "idle" });
    } else {
      expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
      const confirmed = await confirmInboxEntry(familyId, (await getInboxEntry(familyId, p.item.id))!); if (!confirmed.ok) throw new Error(confirmed.error);
      getDb().update(memoryEvent).set({ deletedAt: new Date() }).where(and(eq(memoryEvent.id, confirmed.eventId), eq(memoryEvent.familyId, familyId))).run();
      expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "idle" });
    }
    expect(text).not.toHaveBeenCalled(); expect(job(queued.jobId).status).toBe("cancelled");
  }
});


it("organizes an explicitly selected photo/audio/text bundle without copying originals or creating an event", async () => {
  const { ai, text, vision } = assistant(); const p = await photo();
  const audio = getDb().select().from(asset).where(eq(asset.type, "audio")).get()!;
  const bundle = textItem();
  getDb().update(inboxItem).set({ kind: "bundle" }).where(eq(inboxItem.id, bundle)).run();
  getDb().insert(inboxItemAsset).values([p.original.id, audio.id].map(assetId => ({ id: randomUUID(), inboxItemId: bundle, assetId, familyId }))).run();
  const originalCount = getDb().select().from(asset).all().length;
  const eventCount = getDb().select().from(memoryEvent).all().length;
  const transcribe = vi.spyOn(ai, "transcribeAudio");
  const queued = requestInboxItemSuggestions(context, bundle, { runtime: ai }); if (!queued.ok) throw new Error(queued.error);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(text).not.toHaveBeenCalled();
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed", jobId: queued.jobId });
  const sent = JSON.stringify(text.mock.calls[0][0].messages);
  expect(sent).toContain("今天在窗边给绿植浇水"); expect(sent).toContain("窗边摆着绿色植物"); expect(sent).toContain("再次修订，实际是室外的花");
  expect(sent).not.toContain(audio.id); expect(sent).not.toContain(p.original.id);
  expect(getDb().select().from(asset).all()).toHaveLength(originalCount);
  expect(getDb().select().from(memoryEvent).all()).toHaveLength(eventCount);
  expect(vision).toHaveBeenCalledOnce(); expect(transcribe).not.toHaveBeenCalled();
});

it("cancels unused prerequisites but keeps a shared prerequisite needed by another selection", async () => {
  const { ai, text, vision } = assistant(); const p = await photo();
  const other = textItem();
  getDb().insert(inboxItemAsset).values({ id: randomUUID(), inboxItemId: other, assetId: p.original.id, familyId }).run();
  const a = requestInboxItemSuggestions(context, p.item.id, { runtime: ai }); const b = requestInboxItemSuggestions(context, other, { runtime: ai });
  if (!a.ok || !b.ok) throw new Error("enqueue failed");
  const prerequisite = getDb().select().from(aiJobDependency).where(eq(aiJobDependency.jobId, a.jobId)).get()!.dependsOnJobId;
  expect(requestAiJobCancellation(context, a.jobId, { runtime: ai }).ok).toBe(true);
  expect(job(prerequisite).status).toBe("pending");
  expect(requestAiJobCancellation(context, b.jobId, { runtime: ai }).ok).toBe(true);
  expect(job(prerequisite).status).toBe("cancelled");
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "idle" });
  expect(text).not.toHaveBeenCalled(); expect(vision).not.toHaveBeenCalled();
});

it("never guesses picture content from filename/date when no valid analysis exists", async () => {
  const { ai, text } = assistant(); const p = await photo();
  // Simulate a pre-upgrade task with no persisted analysis prerequisite.
  expect(enqueueAiJob({ familyId, requestedByUserId: actor.id, jobType: "suggest.inbox_item.v1", entityType: "inbox_item", entityId: p.item.id, requiredCapability: "text", triggerMode: "manual", sources: [{ kind: "asset", id: p.original.id }] }, { runtime: ai }).ok).toBe(true);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "failed", errorCode: "insufficient_evidence" });
  expect(text).not.toHaveBeenCalled();
});


it("filters legacy, unauthorized and stale pending fields consistently for the old Web cards", async () => {
  const { ai } = assistant(); const id = textItem();
  expect(requestInboxItemSuggestions(context, id, { runtime: ai }).ok).toBe(true);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(listReviewableSuggestions(familyId, actor.id, "inbox_item", id).map(row => row.suggestionType)).toEqual(["title", "tag"]);
  const viewer = randomUUID();
  getDb().insert(user).values({ id: viewer, name: "viewer", email: `${viewer}@fixture.invalid`, emailVerified: false, role: "viewer", familyId, createdAt: new Date(), updatedAt: new Date() }).run();
  expect(listReviewableSuggestions(familyId, viewer, "inbox_item", id)).toHaveLength(0);
  expect((await renameTarget(familyId, actor.id, { kind: "inbox_item", id, revision: 0, title: "人工名称" })).ok).toBe(true);
  expect(listReviewableSuggestions(familyId, actor.id, "inbox_item", id)).toHaveLength(0);
  getDb().insert(aiSuggestion).values({ id: randomUUID(), familyId, entityType: "inbox_item", entityId: id, suggestionType: "title", valueJson: JSON.stringify({ title: "无法证明来源的旧建议" }), provider: ai.provider.id, model: ai.capabilities.text.model!, status: "pending", targetRevision: 1, sourceFingerprint: "0".repeat(64) }).run();
  expect(listReviewableSuggestions(familyId, actor.id, "inbox_item", id)).toHaveLength(0);
});


it("runs archived photo/text through the same stages and does not expose private contributions", async () => {
  const { ai, text, vision } = assistant(); const p = await photo();
  getDb().update(inboxItem).set({ rawText: "照片的原始备注：今天给窗边绿植浇水。" }).where(eq(inboxItem.id, p.item.id)).run();
  const confirmed = await confirmInboxEntry(familyId, (await getInboxEntry(familyId, p.item.id))!); if (!confirmed.ok) throw new Error(confirmed.error);
  const { createContribution } = await import("@/lib/contributions/service");
  for (const visibility of ["private", "family"] as const) expect((await createContribution(familyId, { memoryEventId: confirmed.eventId, authorPersonId: binding.personId!, recordedByUserId: actor.id, rawText: visibility === "private" ? "私密文字绝不能成为公开标题" : "公开讲述：给绿色植物浇水。", visibility })).ok).toBe(true);
  const queued = requestEventSuggestions(context, confirmed.eventId, { runtime: ai }); if (!queued.ok) throw new Error(queued.error);
  expect(requestEventSuggestions(context, confirmed.eventId, { runtime: ai })).toEqual({ ...queued, created: false });
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" }); expect(text).not.toHaveBeenCalled();
  closeDatabase();
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed", jobId: queued.jobId });
  const prompt = JSON.stringify(text.mock.calls[0][0].messages);
  expect(prompt).toContain("照片的原始备注"); expect(prompt).toContain("公开讲述"); expect(prompt).toContain("窗边摆着绿色植物"); expect(prompt).not.toContain("私密文字绝不能成为公开标题");
  expect((await getNameReview(familyId, actor.id, "memory_event", confirmed.eventId))?.suggestions[0].valid).toBe(true);
  expect(vision).toHaveBeenCalledOnce();
});

it("fences a contribution that becomes private while the text request is in flight", async () => {
  const { ai, text } = assistant(); const id = textItem();
  const confirmed = await confirmInboxEntry(familyId, (await getInboxEntry(familyId, id))!); if (!confirmed.ok) throw new Error(confirmed.error);
  const { createContribution } = await import("@/lib/contributions/service");
  const { contribution } = await import("@/db/schema/contribution");
  const made = await createContribution(familyId, { memoryEventId: confirmed.eventId, authorPersonId: binding.personId!, recordedByUserId: actor.id, rawText: "最初公开的讲述", visibility: "family" }); expect(made.ok).toBe(true);
  expect(requestEventSuggestions(context, confirmed.eventId, { runtime: ai }).ok).toBe(true);
  text.mockImplementationOnce(async () => {
    getDb().update(contribution).set({ visibility: "private" }).where(eq(contribution.memoryEventId, confirmed.eventId)).run();
    return { text: JSON.stringify({ title: "现在私密的内容", locationText: null, occurredAt: null, tags: [], personNames: [], facts: [] }), finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.text.model! } };
  });
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "discarded", errorCode: "source_changed" });
  expect(listReviewableSuggestions(familyId, actor.id, "memory_event", confirmed.eventId)).toHaveLength(0);
  expect(getDb().select().from(aiSuggestion).where(eq(aiSuggestion.entityId, confirmed.eventId)).all()).toHaveLength(0);
});

it("does not reinterpret an old single-item name as the title of a newly merged memory", async () => {
  const { ai, text } = assistant(); const a = textItem(); const b = textItem();
  expect(requestInboxItemSuggestions(context, a, { runtime: ai }).ok).toBe(true);
  const { mergeInboxEntries } = await import("@/lib/memories/service");
  const merged = await mergeInboxEntries(familyId, [a, b], { title: "人工确认的多素材记忆" }); if (!merged.ok) throw new Error(merged.error);
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "idle" });
  expect(text).not.toHaveBeenCalled();
  expect((await getNameReview(familyId, actor.id, "memory_event", merged.eventId))?.suggestions).toHaveLength(0);
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, merged.eventId)).get()?.title).toBe("人工确认的多素材记忆");
});
