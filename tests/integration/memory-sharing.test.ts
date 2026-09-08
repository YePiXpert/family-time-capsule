import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-memory-sharing-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-memory-sharing-fixture";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventReader } = await import("@/db/schema/memory");
const { contribution } = await import("@/db/schema/contribution");
const service = await import("@/lib/memories/service");
const { storeOriginal } = await import("@/lib/assets/service");
const { saveDraft, publishDraft } = await import("@/lib/drafts/service");
const { emptyDraftContent } = await import("@/lib/drafts/model");
const { createContribution } = await import("@/lib/contributions/service");
const { GET: read } = await import("@/app/api/mobile/v1/memories/[id]/route");
getDb().insert(family).values({ id: "family", name: "合成分享家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-sharing`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (id: string): FamilyContext => ({ userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
function event(visibility = "private") {
  const id = randomUUID();
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: "私人旧事", bodyText: "保存的原话", occurredAt: new Date("1980-06-04T10:00:00Z"), occurredAtPrecision: "unknown", status: "confirmed", visibility, createdByUserId: "a" }).run();
  return id;
}
const get = (actor: string, id: string) => read(new Request(`http://localhost/api/mobile/v1/memories/${id}`, { headers: { authorization: `Bearer ${actor}-synthetic-sharing` } }), { params: Promise.resolve({ id }) });
const share = (actor: string, id: string, visibility: string, readers: string[], revision: number, mutationId = randomUUID()) => service.updateMemoryEventVisibility(ctx(actor), id, visibility, readers, revision, mutationId);
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("clearing selected readers has a defined result and never crashes an empty insert", async () => {
  const id = event();
  expect(await share("a", id, "members", [], 0)).toMatchObject({ ok: false, error: "invalid" });
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.visibility).toBe("private");
});
it("lost sharing responses replay once and reused mutation keys cannot expand the audience", async () => {
  const id = event(); const mutationId = randomUUID();
  expect((await share("a", id, "members", ["b"], 0, mutationId)).ok).toBe(true);
  expect((await share("a", id, "members", ["b"], 0, mutationId)).ok).toBe(true);
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.titleRevision).toBe(1);
  expect(await share("a", id, "family", [], 0, mutationId)).toMatchObject({ ok: false, error: "conflict" });
  expect((await get("b", id)).status).toBe(200);
  expect((await get("c", id)).status).toBe(404);
});
it("a readable contributor's words and private recording cannot be widened by the event owner", async () => {
  const id = event("members");
  getDb().insert(memoryEventReader).values({ id: randomUUID(), familyId: "family", memoryEventId: id, userId: "b" }).run();
  const words = await createContribution("family", { memoryEventId: id, authorPersonId: "person-b", recordedByUserId: "b", rawText: "B 仅在当前读者范围内讲的往事", visibility: "family" });
  if (!words.ok) throw new Error(words.error);
  const voice = await storeOriginal({ familyId: "family", createdByUserId: "b", type: "audio", originalFilename: "b-private.wav", mimeType: "audio/wav", extension: "wav", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.wav")), timeSource: "import_time", visibility: "private" });
  if (voice.status !== "stored") throw new Error(voice.status);
  getDb().update(contribution).set({ audioAssetId: voice.asset.id }).where(eq(contribution.id, words.contributionId)).run();
  expect((await get("a", id)).status).toBe(200);
  expect(await share("a", id, "members", ["b", "c"], 0)).toMatchObject({ ok: false, error: "source_reshare_forbidden" });
  expect((await get("c", id)).status).toBe(404);
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.titleRevision).toBe(0);
});
it("owned private photos and voice follow explicit event readers and revoke without changing root visibility", async () => {
  const originals = [];
  for (const [index, type] of ["image", "image", "audio"].entries()) {
    const audio = type === "audio";
    const stored = await storeOriginal({ familyId: "family", createdByUserId: "a", type: audio ? "audio" : "image", originalFilename: `own-${index}.${audio ? "wav" : "png"}`, mimeType: audio ? "audio/wav" : "image/png", extension: audio ? "wav" : "png", buffer: Buffer.concat([readFileSync(path.join(__dirname, `../fixtures/sample.${audio ? "wav" : "png"}`)), Buffer.from(randomUUID())]), timeSource: "import_time", visibility: "private" });
    if (stored.status !== "stored") throw new Error(stored.status);
    originals.push(stored.asset);
  }
  const draftId = randomUUID();
  const saved = saveDraft(ctx("a"), draftId, 0, randomUUID(), { ...emptyDraftContent(), title: "两照片和原声的私人旧事", text: "时间不详的旧事正文", visibility: "private", occurredAtPrecision: "unknown", items: originals.map(asset => ({ id: randomUUID(), assetId: asset.id, localCaptureRef: null, caption: "" })) });
  const published = publishDraft(ctx("a"), draftId, saved.revision);
  const id = published.memoryEventId!;
  expect((await get("b", id)).status).toBe(404);
  expect((await share("a", id, "members", ["b"], 0)).ok).toBe(true);
  const readable = await get("b", id);
  expect(readable.status).toBe(200);
  expect(await readable.json()).toMatchObject({ occurredAtPrecision: "unknown", assets: expect.arrayContaining(originals.map(a => expect.objectContaining({ id: a.id }))) });
  expect((await get("c", id)).status).toBe(404);
  expect((await share("a", id, "private", [], 1)).ok).toBe(true);
  expect((await get("b", id)).status).toBe(404);
  const { asset } = await import("@/db/schema/asset");
  for (const original of originals) expect(getDb().select().from(asset).where(eq(asset.id, original.id)).get()?.visibility).toBe("private");
});
it("an owned cover from another memory grants media access with the event and revokes it", async () => {
  const photo = await storeOriginal({ familyId: "family", createdByUserId: "a", type: "image", originalFilename: "separate-cover.png", mimeType: "image/png", extension: "png", buffer: Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample.png")), Buffer.from(randomUUID())]), timeSource: "import_time", visibility: "private" });
  if (photo.status !== "stored") throw new Error(photo.status);
  const id = event();
  expect((await service.updateMemoryEvent("family", id, "a", { coverAssetId: photo.asset.id, expectedTitleRevision: 0, mutationId: randomUUID() })).ok).toBe(true);
  expect((await share("a", id, "members", ["b"], 1)).ok).toBe(true);
  const { createContributionAccessSnapshot, canReadContributionAsset, readableAssetPredicate } = await import("@/lib/authz/contribution-access");
  const { asset } = await import("@/db/schema/asset");
  const { and, sql } = await import("drizzle-orm");
  const readable = (actor: string) => getDb().select().from(asset).where(and(eq(asset.id, photo.asset.id), readableAssetPredicate(createContributionAccessSnapshot(ctx(actor)), sql`${asset.id}`))).get();
  expect(await canReadContributionAsset(createContributionAccessSnapshot(ctx("b")), photo.asset.id)).toBe(true);
  expect(readable("b")).toBeDefined(); expect(readable("c")).toBeUndefined();
  expect((await share("a", id, "private", [], 2)).ok).toBe(true);
  expect(await canReadContributionAsset(createContributionAccessSnapshot(ctx("b")), photo.asset.id)).toBe(false);
  expect(readable("b")).toBeUndefined(); expect(readable("a")).toBeDefined();
});

it("sharing rejects departed and other-family accounts without changing its reader scope", async () => {
  const id = event();
  getDb().update(user).set({ disabledAt: new Date() }).where(eq(user.id, "b")).run();
  try { expect(await share("a", id, "members", ["b"], 0)).toMatchObject({ ok: false, error: "invalid_reader" }); }
  finally { getDb().update(user).set({ disabledAt: null }).where(eq(user.id, "b")).run(); }
  getDb().insert(family).values({ id: "other-family", name: "其他家庭" }).run();
  getDb().insert(user).values({ id: "other-user", familyId: "other-family", name: "同名账号", email: "other@fixture.invalid", role: "admin" }).run();
  expect(await share("a", id, "members", ["other-user"], 0)).toMatchObject({ ok: false, error: "invalid_reader" });
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event).toMatchObject({ visibility: "private", titleRevision: 0 });
});
it("historical cover references do not create new grants to somebody else's private original", async () => {
  const photo = await storeOriginal({ familyId: "family", createdByUserId: "a", type: "image", originalFilename: "historical-unapproved-cover.png", mimeType: "image/png", extension: "png", buffer: Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample.png")), Buffer.from(randomUUID())]), timeSource: "import_time", visibility: "private" });
  if (photo.status !== "stored") throw new Error(photo.status);
  const id = event("family");
  getDb().update(memoryEvent).set({ createdByUserId: "b", coverAssetId: photo.asset.id }).where(eq(memoryEvent.id, id)).run();
  const { createContributionAccessSnapshot, canReadContributionAsset, readableAssetPredicate } = await import("@/lib/authz/contribution-access");
  const { asset } = await import("@/db/schema/asset");
  const { and, sql } = await import("drizzle-orm");
  expect(await canReadContributionAsset(createContributionAccessSnapshot(ctx("c")), photo.asset.id)).toBe(false);
  expect(getDb().select().from(asset).where(and(eq(asset.id, photo.asset.id), readableAssetPredicate(createContributionAccessSnapshot(ctx("c")), sql`${asset.id}`))).get()).toBeUndefined();
  const { PATCH } = await import("@/app/api/mobile/v1/memories/[id]/route");
  const unchangedCover = await PATCH(new Request(`http://localhost/api/mobile/v1/memories/${id}`, { method: "PATCH", headers: { authorization: "Bearer a-synthetic-sharing", "content-type": "application/json" }, body: JSON.stringify({ bodyText: "只是修改正文", coverAssetId: photo.asset.id, expectedRevision: 0, mutationId: randomUUID() }) }), { params: Promise.resolve({ id }) });
  expect(unchangedCover.status).toBe(200);
  expect(await canReadContributionAsset(createContributionAccessSnapshot(ctx("c")), photo.asset.id)).toBe(false);
  expect(await service.updateMemoryEvent("family", id, "b", { coverAssetId: photo.asset.id, expectedTitleRevision: 1, mutationId: randomUUID() })).toMatchObject({ ok: false, error: "bad_cover" });
});
