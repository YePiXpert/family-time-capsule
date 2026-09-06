import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-name-review-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "name-review-fixture";
process.env.AUTH_SECRET = "name-review-fixture-secret-0123456789";
const { getDb, closeDatabase } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const { aiSuggestion } = await import("@/db/schema/suggestion");
const { inboxItem } = await import("@/db/schema/inbox");
const { renameTarget, reviewTitleSuggestion, getNameReview } = await import("@/lib/names/service");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { createTextInboxItem, getInboxEntry, updateInboxDraft } = await import("@/lib/inbox/service");
const { confirmInboxEntry, updateMemoryEvent } = await import("@/lib/memories/service");
afterAll(() => { closeDatabase(); rmSync(dataDir, { recursive: true, force: true }); });

expect((await performSetup({ token: "name-review-fixture", displayName: "虚构管理员", email: "names@fixture.invalid", password: "name-review-fixture-password" })).ok).toBe(true);
const admin = getDb().select().from(user).get()!;
const onboarding = await completeOnboarding(admin.id, { familyName: "虚构名称测试", timezone: "Asia/Shanghai", childDisplayName: "孩子", childBirthDate: "2020-01-01", selfDisplayName: "虚构管理员", selfRelationToChild: "家人", selfIsGuardian: true });
if (!onboarding.ok) throw new Error("fixture onboarding failed");
const familyId = onboarding.familyId;

async function fixtureEvent() {
  const item = await createTextInboxItem(familyId, "一段用于测试的文字");
  const result = await confirmInboxEntry(familyId, (await getInboxEntry(familyId, item.id))!, { title: "IMG_OLD_不能猜来源" });
  if (!result.ok) throw new Error("fixture confirm failed");
  getDb().update(memoryEvent).set({ titleSource: "legacy_unknown" }).where(eq(memoryEvent.id, result.eventId)).run();
  return getDb().select().from(memoryEvent).where(eq(memoryEvent.id, result.eventId)).get()!;
}

const { ingestImage } = await import("@/lib/assets/ingest");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { enqueueAiJob, claimNextAiJob, completeAiJob } = await import("@/lib/ai/jobs");
const runtime = new DeterministicFakeMemoryAssistant();
const source = await ingestImage({ familyId, createdByUserId: admin.id, filename: "review-source.jpg", declaredMime: "image/jpeg", buffer: readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg")), clientLastModifiedMs: null });
if (source.status !== "stored") throw new Error("source fixture failed");
const sourceAssetId = source.asset.id;

function suggestion(kind: "memory_event" | "inbox_item", id: string, revision: number | null, title = "窗边读书的一段午后") {
  const queued = enqueueAiJob({ familyId, requestedByUserId: admin.id, jobType: `test.title.${randomUUID()}`, entityType: kind, entityId: id, requiredCapability: "text", triggerMode: "manual", sources: kind === "memory_event" ? [{ kind: "memory_event", id }] : [{ kind: "asset", id: sourceAssetId }] }, { runtime });
  if (!queued.ok) throw new Error("fixture enqueue failed");
  const lease = claimNextAiJob("name-review-worker", { runtime });
  if (!lease || lease.jobId !== queued.jobId || !completeAiJob(lease, { runtime }).ok) throw new Error("fixture completion failed");
  const row = { id: randomUUID(), familyId, createdByJobId: queued.jobId, entityType: kind, entityId: id, suggestionType: "title", targetRevision: revision, valueJson: JSON.stringify({ title }), provider: "deterministic-fake", model: runtime.capabilities.text.model!, sourceFingerprint: "f".repeat(64) };
  getDb().insert(aiSuggestion).values(row).run();
  return { suggestionId: row.id, suggestionRevision: 0, targetKind: kind, targetId: id, targetRevision: revision ?? 0 };
}

it("accept and undo preserve prior unknown provenance with monotonic versions", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: true, revision: 1, suggestionRevision: 1 });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, event.id)).get()).toMatchObject({ title: "窗边读书的一段午后", titleSource: "accepted_ai", titleRevision: 1 });
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, suggestionRevision: 1, targetRevision: 1, operation: "undo" })).toMatchObject({ ok: true, revision: 2 });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, event.id)).get()).toMatchObject({ title: event.title, titleSource: "legacy_unknown", titleRevision: 2 });
  expect(getDb().select().from(aiSuggestion).where(eq(aiSuggestion.id, input.suggestionId)).get()).toMatchObject({ status: "rejected", revision: 2, undoneAt: expect.any(Date) });
});

it("manual naming wins over late suggestions and stale clients cannot overwrite it", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  expect((await renameTarget(familyId, admin.id, { kind: "memory_event", id: event.id, title: "我亲手写的标题", revision: 0 })).ok).toBe(true);
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "conflict" });
  expect(await renameTarget(familyId, admin.id, { kind: "memory_event", id: event.id, title: "另一个客户端的旧输入", revision: 0 })).toMatchObject({ ok: false, error: "conflict" });
  expect((getDb().select().from(memoryEvent).where(eq(memoryEvent.id, event.id)).get())?.title).toBe("我亲手写的标题");
  // Ignoring an obsolete suggestion does not mutate the manually renamed target.
  expect((await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "reject" })).ok).toBe(true);
});

it("two simultaneous adopters produce one version, and later manual edits prevent undo", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  const results = await Promise.all([reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" }), reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })]);
  expect(results.filter(row => row.ok)).toHaveLength(1);
  expect((await renameTarget(familyId, admin.id, { kind: "memory_event", id: event.id, revision: 1, title: "采用后我又修改过" })).ok).toBe(true);
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, targetRevision: 2, suggestionRevision: 1, operation: "undo" })).toMatchObject({ ok: false, error: "conflict" });
});

it("persists inbox adoption and protects it from a concurrently saved metadata form", async () => {
  const item = await createTextInboxItem(familyId, "收件箱文字全文独立保留");
  const input = suggestion("inbox_item", item.id, item.titleRevision);
  expect((await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept", editedTitle: "我修订过的建议" })).ok).toBe(true);
  expect(getDb().select().from(inboxItem).where(eq(inboxItem.id, item.id)).get()).toMatchObject({ draftTitle: "我修订过的建议", titleSource: "manual", titleRevision: 1, rawText: "收件箱文字全文独立保留" });
  await Promise.all([updateInboxDraft(familyId, item.id, { locationText: "窗边" }), renameTarget(familyId, admin.id, { kind: "inbox_item", id: item.id, revision: 1, title: "最新人工名称" })]);
  expect(getDb().select().from(inboxItem).where(eq(inboxItem.id, item.id)).get()?.draftTitle).toBe("最新人工名称");
});

it("an event metadata edit cannot reset a name changed while the edit was preparing", async () => {
  const event = await fixtureEvent();
  await Promise.all([updateMemoryEvent(familyId, event.id, admin.id, { locationText: "家中" }), renameTarget(familyId, admin.id, { kind: "memory_event", id: event.id, revision: 0, title: "并发保存的人工标题" })]);
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, event.id)).get()?.title).toBe("并发保存的人工标题");
});

it("legacy suggestions without a proven target version cannot replace a canonical title", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, null);
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "stale_suggestion" });
  expect((await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "reject" })).ok).toBe(true);
});

it("asset display naming preserves the original filename, storage key, hash, bytes and times", async () => {
  const { asset } = await import("@/db/schema/asset");
  const { getAssetStorage } = await import("@/lib/assets/storage");
  const original = { asset: getDb().select().from(asset).where(eq(asset.id, sourceAssetId)).get()! };
  expect((await renameTarget(familyId, admin.id, { kind: "asset", id: original.asset.id, revision: 0, title: "一张手工命名的照片" })).ok).toBe(true);
  const after = getDb().select().from(asset).where(eq(asset.id, original.asset.id)).get()!;
  expect(after).toEqual({ ...original.asset, displayName: "一张手工命名的照片", nameSource: "manual", nameRevision: 1 });
  expect(getAssetStorage().read(after.storageKey)).toEqual(readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg")));
});

it("checks the live account and the supplied target instead of trusting a suggestion id", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  expect((await reviewTitleSuggestion(familyId, admin.id, { ...input, targetId: randomUUID(), operation: "accept" })).ok).toBe(false);
  expect((await reviewTitleSuggestion(randomUUID(), admin.id, { ...input, operation: "accept" })).ok).toBe(false);
  const editorId = randomUUID();
  getDb().insert(user).values({ id: editorId, familyId, name: "权限测试编辑", email: `${editorId}@fixture.invalid`, emailVerified: true, role: "editor", createdAt: new Date(), updatedAt: new Date() }).run();
  getDb().update(user).set({ role: "viewer" }).where(eq(user.id, editorId)).run();
  expect(await reviewTitleSuggestion(familyId, editorId, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "forbidden" });
});

it("rejects unproven, unfinished and mismatched result provenance", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  const row = getDb().select().from(aiSuggestion).where(eq(aiSuggestion.id, input.suggestionId)).get()!;
  expect((await getNameReview(familyId, admin.id, "memory_event", event.id))?.suggestions).toHaveLength(1);
  getDb().update(aiSuggestion).set({ createdByJobId: null }).where(eq(aiSuggestion.id, row.id)).run();
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "stale_suggestion" });
  getDb().update(aiSuggestion).set({ createdByJobId: row.createdByJobId, model: "forged-model" }).where(eq(aiSuggestion.id, row.id)).run();
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "stale_suggestion" });
  getDb().update(aiSuggestion).set({ model: row.model }).where(eq(aiSuggestion.id, row.id)).run();
  const unfinished = enqueueAiJob({ familyId, requestedByUserId: admin.id, jobType: "test.unfinished.title", entityType: "memory_event", entityId: event.id, requiredCapability: "text", triggerMode: "manual", sources: [{ kind: "memory_event", id: event.id }] }, { runtime });
  if (!unfinished.ok) throw new Error("pending fixture failed");
  getDb().update(aiSuggestion).set({ createdByJobId: unfinished.jobId }).where(eq(aiSuggestion.id, row.id)).run();
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "stale_suggestion" });
  expect((await getNameReview(familyId, admin.id, "memory_event", event.id))?.suggestions).toEqual([]);
  const finishedLease = claimNextAiJob("name-review-worker", { runtime });
  if (!finishedLease || !completeAiJob(finishedLease, { runtime }).ok) throw new Error("fixture cleanup failed");
});

it("source changes invalidate adoption even without a title revision change", async () => {
  const event = await fixtureEvent();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  await updateMemoryEvent(familyId, event.id, admin.id, { locationText: "变化后的地点" });
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "stale_suggestion" });
});

it("cannot adopt a private-context suggestion into a family-visible event title", async () => {
  const event = await fixtureEvent();
  const actor = getDb().select().from(user).where(eq(user.id, admin.id)).get()!;
  const { createContribution } = await import("@/lib/contributions/service");
  const created = await createContribution(familyId, { memoryEventId: event.id, authorPersonId: actor.personId!, recordedByUserId: actor.id, rawText: "只属于私密上下文的文字", visibility: "private" });
  if (!created.ok) throw new Error("private fixture failed");
  const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
  const { enqueueAiJob } = await import("@/lib/ai/jobs");
  const assistant = new DeterministicFakeMemoryAssistant();
  const input = suggestion("memory_event", event.id, event.titleRevision);
  const queued = enqueueAiJob({ familyId, requestedByUserId: actor.id, jobType: "test.title.v1", entityType: "memory_event", entityId: event.id, requiredCapability: "text", triggerMode: "manual", sources: [{ kind: "contribution", id: created.contributionId }] }, { runtime: assistant });
  if (!queued.ok) throw new Error("private job fixture failed");
  getDb().update(aiSuggestion).set({ createdByJobId: queued.jobId }).where(eq(aiSuggestion.id, input.suggestionId)).run();
  expect(await reviewTitleSuggestion(familyId, admin.id, { ...input, operation: "accept" })).toMatchObject({ ok: false, error: "private_context" });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, event.id)).get()?.title).toBe(event.title);
});
