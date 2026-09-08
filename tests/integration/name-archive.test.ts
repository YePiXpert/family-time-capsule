import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { afterAll, expect, it, vi } from "vitest";
const dirs: string[] = [];
const root = "family-time-capsule-export";
afterAll(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function instance() {
  const dir = mkdtempSync(path.join(tmpdir(), "ftc-name-archive-")); dirs.push(dir);
  process.env.DATA_DIR = dir; process.env.AUTH_SECRET = "fixture-name-archive-secret-1234567"; process.env.INITIAL_SETUP_TOKEN = "name-archive";
  vi.resetModules();
  const db = await import("@/db");
  const schema = { ...await import("@/db/schema/auth"), ...await import("@/db/schema/family"), ...await import("@/db/schema/memory"), ...await import("@/db/schema/asset"), ...await import("@/db/schema/suggestion"), ...await import("@/db/schema/ai-job") };
  const setup = await import("@/lib/auth/setup");
  expect((await setup.performSetup({ token: "name-archive", displayName: "虚构管理员", email: `${randomUUID()}@fixture.invalid`, password: "name-archive-fixture-password" })).ok).toBe(true);
  const actor = db.getDb().select().from(schema.user).get()!;
  return { db, schema, actor, family: await import("@/lib/family/service"), names: await import("@/lib/names/service"), queue: await import("@/lib/ai/jobs"), export: await import("@/lib/export/service"), restore: await import("@/lib/restore/service") };
}
async function json(zip: JSZip, file: string) { return JSON.parse(await zip.file(`${root}/${file}`)!.async("string")); }

it("preserves adoption, rejection, undo and original bytes through restore and a second export without replaying jobs", async () => {
  const a = await instance();
  const onboarding = await a.family.completeOnboarding(a.actor.id, { familyName: "虚构归档", timezone: "Asia/Shanghai", childDisplayName: "孩子", childBirthDate: "2020-01-01", selfDisplayName: "管理员", selfRelationToChild: "家人", selfIsGuardian: true });
  if (!onboarding.ok) throw new Error("fixture family failed");
  const familyId = onboarding.familyId;
  const { createTextInboxItem, getInboxEntry } = await import("@/lib/inbox/service");
  const { confirmInboxEntry } = await import("@/lib/memories/service");
  const { ingestImage } = await import("@/lib/assets/ingest");
  const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
  const runtime = new DeterministicFakeMemoryAssistant();
  const eventIds: string[] = [], suggestionIds: string[] = [];
  for (const operation of ["accept", "reject", "undo"] as const) {
    const item = await createTextInboxItem(familyId, `完整原文 ${operation}`);
    const confirmed = await confirmInboxEntry(familyId, (await getInboxEntry(familyId, item.id))!, { title: `IMG_旧名称_${operation}` });
    if (!confirmed.ok) throw new Error("fixture event failed");
    const eventId = confirmed.eventId; eventIds.push(eventId);
    a.db.getDb().update(a.schema.memoryEvent).set({ titleSource: "legacy_unknown" }).where(eq(a.schema.memoryEvent.id, eventId)).run();
    const queued = a.queue.enqueueAiJob({ familyId, requestedByUserId: a.actor.id, jobType: "test.name_archive.v1", entityType: "memory_event", entityId: eventId, requiredCapability: "text", triggerMode: "manual", sources: [{ kind: "memory_event", id: eventId }] }, { runtime });
    const lease = a.queue.claimNextAiJob("archive-worker", { runtime });
    if (!queued.ok || !lease || !a.queue.completeAiJob(lease, { runtime }).ok) throw new Error("fixture queue failed");
    const id = randomUUID(); suggestionIds.push(id);
    a.db.getDb().insert(a.schema.aiSuggestion).values({ id, familyId, entityType: "memory_event", entityId: eventId, suggestionType: "title", valueJson: JSON.stringify({ title: "窗边阅读的一段午后" }), provider: runtime.provider.id, model: runtime.capabilities.text.model!, sourceFingerprint: "f".repeat(64), createdByJobId: queued.jobId, targetRevision: 0 }).run();
    const input = { suggestionId: id, suggestionRevision: 0, targetKind: "memory_event" as const, targetId: eventId, targetRevision: 0 };
    expect((await a.names.reviewTitleSuggestion(familyId, a.actor.id, { ...input, operation: operation === "reject" ? "reject" : "accept" })).ok).toBe(true);
    if (operation === "undo") expect((await a.names.reviewTitleSuggestion(familyId, a.actor.id, { ...input, operation: "undo", suggestionRevision: 1, targetRevision: 1 })).ok).toBe(true);
  }
  const originalBytes = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg"));
  const image = await ingestImage({ familyId, createdByUserId: a.actor.id, filename: "IMG_原件.jpg", declaredMime: "image/jpeg", buffer: originalBytes, clientLastModifiedMs: null });
  if (image.status !== "stored") throw new Error("fixture original failed");
  expect((await a.names.renameTarget(familyId, a.actor.id, { kind: "asset", id: image.asset.id, revision: 0, title: "人工素材名称" })).ok).toBe(true);
  const exported = await a.export.buildDisasterExport(familyId);
  const originalZip = await JSZip.loadAsync(readFileSync(exported.filePath));
  const reviews = await json(originalZip, "name-reviews.json");
  expect(reviews.map((row: { status: string }) => row.status).sort()).toEqual(["accepted", "rejected", "rejected"]);
  expect(JSON.stringify(reviews)).not.toMatch(/createdByJobId|leaseOwner|consentVersion|apiKey/u);
  const manifest = await json(originalZip, "manifest.json");
  expect(manifest.modules.nameReviews).toBe(1);
  a.db.closeDatabase();

  const b = await instance();
  const accepted = reviews.find((row: { status: string }) => row.status === "accepted");
  for (const corruptedRows of [[{ ...accepted, status: "pending" }], [{ ...accepted, appliedRevision: 999 }], [{ ...accepted, entityId: randomUUID() }], [{ ...accepted, previousName: { text: "旧名称", source: "forged" } }], [accepted, accepted]]) {
    const corrupted = await JSZip.loadAsync(readFileSync(exported.filePath));
    corrupted.file(`${root}/name-reviews.json`, JSON.stringify(corruptedRows));
    await expect(b.restore.restoreFromZip(await corrupted.generateAsync({ type: "nodebuffer" }), b.actor.id)).rejects.toMatchObject({ code: "bad_refs" });
    expect(b.db.getDb().select().from(b.schema.family).all()).toHaveLength(0);
  }
  const missing = await JSZip.loadAsync(readFileSync(exported.filePath)); missing.remove(`${root}/name-reviews.json`);
  await expect(b.restore.restoreFromZip(await missing.generateAsync({ type: "nodebuffer" }), b.actor.id)).rejects.toMatchObject({ code: "missing_json" });
  await b.restore.restoreFromZipFile(exported.filePath, b.actor.id);
  expect(b.db.getDb().select().from(b.schema.aiJob).all()).toEqual([]);
  expect(b.db.getDb().select().from(b.schema.aiProcessingConsent).all()).toEqual([]);
  const restoredImage = b.db.getDb().select().from(b.schema.asset).where(eq(b.schema.asset.id, image.asset.id)).get()!;
  expect(restoredImage).toMatchObject({ displayName: "人工素材名称", nameSource: "manual", nameRevision: 1, originalFilename: image.asset.originalFilename, sha256: image.asset.sha256, storageKey: image.asset.storageKey, capturedAt: image.asset.capturedAt });
  const { getAssetStorage } = await import("@/lib/assets/storage");
  expect(getAssetStorage().read(restoredImage.storageKey)).toEqual(originalBytes);
  const again = await b.export.buildDisasterExport(familyId);
  const againZip = await JSZip.loadAsync(readFileSync(again.filePath));
  const sort = (rows: Array<{ id: string }>) => rows.sort((left, right) => left.id.localeCompare(right.id));
  expect(sort(await json(againZip, "name-reviews.json"))).toEqual(sort(reviews));
  expect(sort(await json(againZip, "memories.json"))).toEqual(sort(await json(originalZip, "memories.json")));
  const adult = (await b.family.listPeople(familyId)).find(person => !person.isChild)!;
  expect((await b.family.bindRestoredFamily(b.actor.id, adult.id)).ok).toBe(true);
  expect((await b.names.reviewTitleSuggestion(familyId, b.actor.id, { suggestionId: suggestionIds[0]!, suggestionRevision: 1, targetKind: "memory_event", targetId: eventIds[0]!, targetRevision: 1, operation: "undo" })).ok).toBe(true);
  expect(b.db.getDb().select().from(b.schema.memoryEvent).where(eq(b.schema.memoryEvent.id, eventIds[0]!)).get()).toMatchObject({ title: "IMG_旧名称_accept", titleSource: "legacy_unknown", titleRevision: 2 });
  b.db.closeDatabase();

  // A real old-format shape: no module, no provenance fields. Canonical names
  // remain verbatim; restoration must not infer a source from IMG_* patterns.
  const c = await instance();
  const old = await JSZip.loadAsync(readFileSync(exported.filePath));
  old.remove(`${root}/name-reviews.json`);
  delete manifest.modules.nameReviews; manifest.fileCount--;
  for (const entry of manifest.assets) { delete entry.displayName; delete entry.nameSource; delete entry.nameRevision; }
  old.file(`${root}/manifest.json`, JSON.stringify(manifest));
  for (const file of ["memories.json", "inbox-items.json"]) {
    const rows = await json(old, file);
    for (const row of rows) { delete row.titleSource; delete row.titleRevision; }
    old.file(`${root}/${file}`, JSON.stringify(rows));
  }
  await c.restore.restoreFromZip(await old.generateAsync({ type: "nodebuffer" }), c.actor.id);
  expect(c.db.getDb().select().from(c.schema.aiSuggestion).all()).toEqual([]);
  expect(c.db.getDb().select().from(c.schema.memoryEvent).where(eq(c.schema.memoryEvent.id, eventIds[1]!)).get()).toMatchObject({ title: "IMG_旧名称_reject", titleSource: "legacy_unknown", titleRevision: 0 });
  expect(c.db.getDb().select().from(c.schema.asset).where(eq(c.schema.asset.id, image.asset.id)).get()).toMatchObject({ originalFilename: "IMG_原件.jpg", sha256: image.asset.sha256, displayName: null, nameSource: "legacy_unknown", nameRevision: 0 });
  c.db.closeDatabase();
});
