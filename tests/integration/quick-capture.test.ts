import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import type { FamilyContext } from "@/lib/family/context";

const dir = mkdtempSync(path.join(tmpdir(), "ftc-quick-capture-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "quick-capture-fixture-secret-only";
process.env.INITIAL_SETUP_TOKEN = "quick-capture";
const { getDb, closeDatabase } = await import("@/db");
const { user, session } = await import("@/db/schema/auth");
const { asset } = await import("@/db/schema/asset");
const { memoryEvent } = await import("@/db/schema/memory");
const { aiJob, aiJobSource } = await import("@/db/schema/ai-job");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { emptyDraftContent } = await import("@/lib/drafts/model");
const { saveDraft, getDraft, publishDraft } = await import("@/lib/drafts/service");
const { publishCapture } = await import("@/lib/drafts/capture");
const { inferCaptureTime } = await import("@/lib/drafts/capture-time");
const { runAiWorkerOnce } = await import("@/jobs/runtime");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { listReviewableSuggestions } = await import("@/lib/suggestions/access");
const { getNameReview, reviewTitleSuggestion } = await import("@/lib/names/service");
const { POST } = await import("@/app/api/mobile/v1/drafts/[id]/publish/route");
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
expect((await performSetup({ token: "quick-capture", displayName: "记录者", email: "capture@fixture.invalid", password: "fictional-password" })).ok).toBe(true);
const actor = getDb().select().from(user).get()!;
const family = await completeOnboarding(actor.id, { familyName: "虚构家庭", timezone: "Asia/Shanghai", childDisplayName: "", childBirthDate: "", selfDisplayName: "记录者", selfRelationToChild: "家人", selfIsGuardian: false });
if (!family.ok) throw new Error(family.error);
const binding = await getUserBinding(actor.id);
const context: FamilyContext = { userId: actor.id, userName: actor.name, familyId: family.familyId, personId: binding.personId, role: binding.role, accountEnabled: true, isGuardian: false, familyTimezone: "Asia/Shanghai", childLaterUnlockAge: 18 };
let suffix = 0;
async function photo(exif = true) {
  const buffer = Buffer.concat([readFileSync(path.join(__dirname, `../fixtures/${exif ? "sample-exif" : "sample"}.jpg`)), Buffer.from(String(++suffix))]);
  const result = await ingestImage({ familyId: context.familyId, createdByUserId: actor.id, filename: "照片.jpg", declaredMime: "image/jpeg", visibility: "private", buffer, clientLastModifiedMs: Date.now() });
  if (result.status !== "stored") throw new Error(result.status);
  return { original: result.asset, buffer };
}
function newDraft(assetIds: string[] = [], patch: Partial<ReturnType<typeof emptyDraftContent>> = {}) {
  return saveDraft(context, randomUUID(), 0, randomUUID(), { ...emptyDraftContent(), items: assetIds.map(assetId => ({ id: randomUUID(), assetId, localCaptureRef: null, caption: "" })), ...patch });
}
function assistant() {
  const ai = new DeterministicFakeMemoryAssistant();
  const text = vi.spyOn(ai, "generateText").mockResolvedValue({ text: JSON.stringify({ title: "窗边的一盆绿植", locationText: null, facts: [], occurredAt: null, timePrecision: "approximate", personNames: [], tags: ["绿植"] }), finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.text.model! } });
  const vision = vi.spyOn(ai, "analyzeImage").mockResolvedValue({ text: "【描述】窗边的一盆绿植。\n【图中文字】", finishReason: "stop", provenance: { providerId: ai.provider.id, providerName: ai.provider.displayName, model: ai.capabilities.vision.model! } });
  return { ai, text, vision };
}

it("saves a photo without any fields, derives a date from EXIF and keeps original bytes private", async () => {
  const p = await photo(), d = newDraft([p.original.id]);
  const result = publishCapture(context, d.id, d.revision, false);
  expect(result).toMatchObject({ status: "published", occurredAtPrecision: "date_only", title: "", processing: { state: "skipped", reason: "not_requested" } });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: context.familyTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(p.original.capturedAt!);
  expect(result.occurredAt).toBe(new Date(`${day}T00:00:00+08:00`).toISOString());
  expect(getDraft(context, d.id)).toMatchObject({ occurredAt: result.occurredAt, occurredAtPrecision: "date_only" });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, result.memoryEventId!)).get()?.title).toBe("一段家庭记忆");
  expect(getDb().select().from(asset).where(eq(asset.id, p.original.id)).get()).toEqual(p.original);
  expect(getAssetStorage().read(p.original.storageKey)).toEqual(p.buffer);
});

it("does not fabricate event dates from modification time, missing metadata or mixed days", async () => {
  const p = await photo(false), d = newDraft([p.original.id]);
  expect(p.original.timeSource).toBe("file_metadata");
  expect(publishCapture(context, d.id, d.revision, false)).toMatchObject({ occurredAt: null, occurredAtPrecision: "unknown" });
  const originals = ["2020-05-01T15:00:00Z", "2020-05-01T17:00:00Z"].map(value => ({ type: "image", timeSource: "embedded_metadata", capturedAt: new Date(value) }));
  expect(inferCaptureTime(originals, "Asia/Shanghai")).toEqual({ occurredAt: null, occurredAtPrecision: "unknown" });
  expect(inferCaptureTime(originals, "UTC")).toEqual({ occurredAt: "2020-05-01T00:00:00.000Z", occurredAtPrecision: "date_only" });
  expect(inferCaptureTime([...originals, { type: "audio", capturedAt: null, timeSource: "import_time" }], "UTC").occurredAtPrecision).toBe("unknown");
  const text = newDraft([], { text: "记不起日期的一件小事" });
  expect(publishCapture(context, text.id, text.revision, false).occurredAtPrecision).toBe("unknown");
});

it("preserves manual dates and explicit unknown, while keeping legacy date validation", async () => {
  const p = await photo();
  for (const patch of [{ occurredAt: "1988-01-01T00:00:00.000Z", occurredAtPrecision: "year" as const }, { occurredAt: null, occurredAtPrecision: "unknown" as const }]) {
    const d = newDraft([p.original.id], patch);
    expect(publishCapture(context, d.id, d.revision, false)).toMatchObject(patch);
  }
  const legacy = newDraft([p.original.id]);
  expect(() => publishDraft(context, legacy.id, legacy.revision)).toThrow("occurred_at_required");
  const partial = newDraft([p.original.id], { occurredAtPrecision: "month" });
  expect(() => publishCapture(context, partial.id, partial.revision, false)).toThrow("occurred_at_required");
  expect(getDraft(context, partial.id).status).toBe("editing");
});

it("one combined save durably queues image then naming, exposes suggestions and never silently applies them", async () => {
  const { ai, text, vision } = assistant();
  const p = await photo(), d = newDraft([p.original.id]);
  const result = publishCapture(context, d.id, d.revision, true, { runtime: ai });
  expect(result.processing.state).toBe("queued");
  if (result.processing.state !== "queued") throw new Error(result.processing.reason);
  expect(text).not.toHaveBeenCalled(); expect(vision).not.toHaveBeenCalled();
  const stage = getDb().select().from(aiJob).where(and(eq(aiJob.entityId, p.original.id), eq(aiJob.jobType, "analyze.asset_image.v1"))).get()!;
  expect(getDb().select().from(aiJobSource).where(eq(aiJobSource.jobId, stage.id)).all().map(s => s.sourceId)).toEqual(expect.arrayContaining([p.original.id, result.memoryEventId]));
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed", jobId: stage.id });
  expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed", jobId: result.processing.jobId });
  expect(vision).toHaveBeenCalledOnce(); expect(text).toHaveBeenCalledOnce();
  expect(listReviewableSuggestions(context.familyId, actor.id, "memory_event", result.memoryEventId!).map(s => s.suggestionType)).toEqual(expect.arrayContaining(["title", "tag"]));
  const review = (await getNameReview(context.familyId, actor.id, "memory_event", result.memoryEventId!))!;
  expect(review.target.text).toBe("一段家庭记忆");
  const suggestion = review.suggestions[0]!;
  expect(await reviewTitleSuggestion(context.familyId, actor.id, { suggestionId: suggestion.id, suggestionRevision: suggestion.revision, targetKind: "memory_event", targetId: result.memoryEventId!, targetRevision: review.target.revision, operation: "accept" })).toMatchObject({ ok: true });
  const count = getDb().select().from(aiJob).all().length;
  expect(publishCapture(context, d.id, d.revision, true, { runtime: ai })).toMatchObject({ memoryEventId: result.memoryEventId, processing: { state: "skipped", reason: "already_saved" } });
  expect(getDb().select().from(aiJob).all()).toHaveLength(count);
});

it("dual-route capture binds each queued stage to its actual receiver and reuses the same chain", async () => {
  const { createMemoryAssistant } = await import("@/lib/ai/server");
  const { enableAiProcessingConsent } = await import("@/lib/ai/jobs");
  const { requestEventSuggestions } = await import("@/lib/suggestions/service");
  const ai = createMemoryAssistant({ AI_PROVIDER: "dual", AI_BASE_URL: "https://primary.fixture.invalid/v1", AI_API_KEY: "fixture-primary-key", ASR_API_KEY: "fixture-asr-key" });
  const provenance = (capability: "text" | "vision" | "transcription") => ({ providerId: ai.capabilities[capability].providerId!, providerName: ai.capabilities[capability].providerName!, model: ai.capabilities[capability].model! });
  vi.spyOn(ai, "generateText").mockResolvedValue({ text: JSON.stringify({ title: "窗边绿植与一段录音", locationText: null, occurredAt: null, timePrecision: "approximate", tags: [], personNames: [], facts: [] }), finishReason: "stop", provenance: provenance("text") });
  vi.spyOn(ai, "analyzeImage").mockResolvedValue({ text: "【描述】窗边的一盆绿植。\n【图中文字】无。", finishReason: "stop", provenance: provenance("vision") });
  vi.spyOn(ai, "transcribeAudio").mockResolvedValue({ text: "Hello family, this is a test recording.", language: "en", durationSeconds: 2, segments: [], provenance: provenance("transcription") });
  for (const capability of ["text", "vision", "transcription"] as const) {
    expect(enableAiProcessingConsent(context, { capability, allowAutomaticFamilyContent: false }, { runtime: ai }).ok).toBe(true);
  }
  const p = await photo();
  const audio = await ingestMedia({ familyId: context.familyId, createdByUserId: actor.id, filename: "dual.wav", declaredMime: "audio/wav", buffer: readFileSync(path.join(__dirname, "../../resources/ai/smoke.wav")), kind: "audio", visibility: "private" });
  if (audio.status !== "stored") throw new Error(audio.status);
  const d = newDraft([p.original.id, audio.asset.id]);
  const result = publishCapture(context, d.id, d.revision, true, { runtime: ai });
  expect(result.processing, JSON.stringify(result.processing)).toMatchObject({ state: "queued" });
  if (result.processing.state !== "queued") throw new Error(result.processing.reason);
  const rows = getDb().select().from(aiJob).where(eq(aiJob.status, "pending")).all();
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    const receiver = ai.capabilities[row.requiredCapability as "text" | "vision" | "transcription"];
    expect(row).toMatchObject({ providerId: receiver.providerId, configurationId: receiver.configurationId });
  }
  expect(requestEventSuggestions(context, result.memoryEventId!, { runtime: ai })).toMatchObject({ ok: true, created: false, jobId: result.processing.jobId });
  for (let n = 0; n < 3; n++) expect(await runAiWorkerOnce({ assistant: ai })).toMatchObject({ status: "completed" });
  expect(ai.analyzeImage).toHaveBeenCalledOnce();
  expect(ai.transcribeAudio).toHaveBeenCalledOnce();
  expect(ai.generateText).toHaveBeenCalledOnce();
});

it("an AI refusal does not undo publication or leave partially queued stages", async () => {
  const p = await photo(), audio = await ingestMedia({ familyId: context.familyId, createdByUserId: actor.id, filename: "讲述.wav", declaredMime: "audio/wav", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.wav")), kind: "audio", visibility: "private" });
  if (audio.status !== "stored") throw new Error(audio.status);
  const d = newDraft([audio.asset.id, p.original.id]);
  const before = getDb().select().from(aiJob).all().length;
  const result = publishCapture(context, d.id, d.revision, true, { runtime: new DeterministicFakeMemoryAssistant({ capabilities: { vision: false } }) });
  expect(result).toMatchObject({ status: "published", processing: { state: "skipped", reason: "capability_unavailable" } });
  expect(getDb().select().from(aiJob).all()).toHaveLength(before);
  expect(getDraft(context, d.id).status).toBe("published");
});

it("private audiences never trigger processing and changed event context stops queued media before I/O", async () => {
  const { ai, vision } = assistant(), p = await photo();
  const reader = randomUUID();
  getDb().insert(user).values({ id: reader, familyId: context.familyId, name: "读者", email: `${reader}@fixture.invalid`, role: "viewer" }).run();
  for (const visibility of ["private", "members"] as const) {
    const d = newDraft([p.original.id], { visibility, readerUserIds: visibility === "members" ? [reader] : [] });
    expect(publishCapture(context, d.id, d.revision, true, { runtime: ai })).toMatchObject({ status: "published", visibility, processing: { state: "skipped", reason: "private_content" } });
  }
  const d = newDraft([p.original.id]), result = publishCapture(context, d.id, d.revision, true, { runtime: ai });
  expect(result.processing.state).toBe("queued");
  getDb().update(memoryEvent).set({ visibility: "private" }).where(eq(memoryEvent.id, result.memoryEventId!)).run();
  await runAiWorkerOnce({ assistant: ai });
  expect(vision).not.toHaveBeenCalled();
  expect(getDb().select().from(aiJob).where(eq(aiJob.entityId, p.original.id)).all().every(job => job.status !== "completed")).toBe(true);
});

it("quick-save HTTP validates its flags and preserves ordinary auth and ownership", async () => {
  const d = newDraft([], { text: "无需填写其它信息" }), token = randomUUID();
  getDb().insert(session).values({ id: randomUUID(), token, userId: actor.id, expiresAt: new Date(Date.now() + 3600000) }).run();
  const route = { params: Promise.resolve({ id: d.id }) };
  const request = (body: unknown, auth = true) => new Request(`http://localhost/api/mobile/v1/drafts/${d.id}/publish`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  expect((await POST(request({ quickSave: "yes", expectedRevision: d.revision }), route)).status).toBe(400);
  expect((await POST(request({ quickSave: true, expectedRevision: d.revision }, false), route)).status).toBe(401);
  const response = await POST(request({ quickSave: true, expectedRevision: d.revision, organize: false }), route);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "published", occurredAtPrecision: "unknown", processing: { reason: "not_requested" } });
  const other = { ...context, userId: randomUUID() };
  expect(() => publishCapture(other, d.id, d.revision, true)).toThrow("forbidden");
});

it("missing external consent keeps the saved memory and queues no media request", () => {
  const ai = new DeterministicFakeMemoryAssistant();
  const runtime = { provider: { id: "openai-compatible", displayName: "未授权的测试服务", external: true }, capabilities: ai.capabilities };
  const d = newDraft([], { text: "保存成功与 AI 授权是两个结果" });
  const before = getDb().select().from(aiJob).all().length;
  expect(publishCapture(context, d.id, d.revision, true, { runtime })).toMatchObject({ status: "published", processing: { state: "skipped", reason: "capability_not_consented" } });
  expect(getDb().select().from(aiJob).all()).toHaveLength(before);
});

it("a private original becomes family-scoped AI evidence only through an actual snapshotted event reference", async () => {
  const { enqueueAiJob } = await import("@/lib/ai/jobs");
  const ai = new DeterministicFakeMemoryAssistant(), p = await photo();
  const unrelated = newDraft([], { text: "不包含这张私密照片的事件" });
  const event = publishCapture(context, unrelated.id, unrelated.revision, false);
  for (const references of [[{ kind: "asset" as const, id: p.original.id }], [{ kind: "asset" as const, id: p.original.id }, { kind: "memory_event" as const, id: event.memoryEventId! }]]) {
    const input = { familyId: context.familyId, requestedByUserId: actor.id, jobType: "analyze.asset_image.v1", entityType: "asset", entityId: p.original.id, requiredCapability: "vision" as const, sources: references };
    const manual = enqueueAiJob({ ...input, triggerMode: "manual" }, { runtime: ai });
    expect(manual.ok).toBe(true);
    if (!manual.ok) throw new Error(manual.error);
    expect(getDb().select().from(aiJob).where(eq(aiJob.id, manual.jobId)).get()?.contentVisibility).toBe("private");
    expect(enqueueAiJob({ ...input, triggerMode: "automatic" }, { runtime: ai })).toMatchObject({ ok: false, error: "automatic_restricted_content_forbidden" });
  }
});

it("automatic capture requires automatic consent, while an explicitly manual grant still permits manual organization", async () => {
  const { createMemoryAssistant } = await import("@/lib/ai/server");
  const { enableAiProcessingConsent } = await import("@/lib/ai/jobs");
  const runtime = createMemoryAssistant({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://automatic.fixture.invalid/v1", AI_API_KEY: "fixture-key", AI_MODEL: "fixture-text" });
  expect(enableAiProcessingConsent(context, { capability: "text", allowAutomaticFamilyContent: false }, { runtime }).ok).toBe(true);
  const d = newDraft([], { text: "自动授权边界" });
  const count = getDb().select().from(aiJob).all().length;
  const result = publishCapture(context, d.id, d.revision, true, { runtime, triggerMode: "automatic" });
  expect(result.status).toBe("published");
  expect(result.processing.state).toBe("skipped");
  expect(getDb().select().from(aiJob).all()).toHaveLength(count);
  expect(enableAiProcessingConsent(context, { capability: "text", allowAutomaticFamilyContent: true }, { runtime }).ok).toBe(true);
  const allowed = newDraft([], { text: "已允许自动整理" });
  expect(publishCapture(context, allowed.id, allowed.revision, true, { runtime, triggerMode: "automatic" }).processing.state).toBe("queued");
  const job = getDb().select().from(aiJob).all().at(-1)!;
  expect(job.triggerMode).toBe("automatic");
});

it("authorized automatic media processing is anchored to the shared event, and audience revocation stops it", async () => {
  getDb().update(aiJob).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(eq(aiJob.status, "pending")).run();
  const { ai, vision } = assistant();
  const p = await photo(), d = newDraft([p.original.id]);
  const result = publishCapture(context, d.id, d.revision, true, { runtime: ai, triggerMode: "automatic" });
  expect(result.processing.state).toBe("queued");
  const jobs = getDb().select().from(aiJob).all().filter(job => job.requestedByUserId === context.userId && job.triggerMode === "automatic" && job.status === "pending");
  expect(jobs.some(job => job.entityId === p.original.id)).toBe(true);
  expect(getDb().select().from(asset).where(eq(asset.id, p.original.id)).get()?.visibility).toBe("private");
  getDb().update(memoryEvent).set({ visibility: "private" }).where(eq(memoryEvent.id, result.memoryEventId!)).run();
  await runAiWorkerOnce({ assistant: ai });
  await runAiWorkerOnce({ assistant: ai });
  expect(vision).not.toHaveBeenCalled();
  expect(getDb().select().from(aiJob).where(eq(aiJob.entityId, p.original.id)).all().every(job => job.status === "cancelled")).toBe(true);
});
