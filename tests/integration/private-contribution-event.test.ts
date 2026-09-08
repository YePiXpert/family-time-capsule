import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-contribution-event-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-contribution-event";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const { contribution } = await import("@/db/schema/contribution");
const access = await import("@/lib/authz/contribution-access");
const service = await import("@/lib/contributions/service");
const { updateMemoryEventVisibility } = await import("@/lib/memories/service");
const { storeOriginal, storeDerivative } = await import("@/lib/assets/service");
const media = await import("@/app/api/media/[assetId]/route");
getDb().insert(family).values({ id: "family", name: "合成讲述家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-contribution`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (id: string): FamilyContext => ({ userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
const snapshot = (id: string) => access.createContributionAccessSnapshot(ctx(id));
function request(actor: string, method = "GET", body?: unknown, range?: string) {
  return new Request("http://localhost/api/test", { method, headers: { authorization: `Bearer ${actor}-synthetic-contribution`, "content-type": "application/json", ...(range ? { range } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function scenario() {
  const id = randomUUID();
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: `隐藏讲述事件-${id}`, bodyText: "独立事件正文", status: "confirmed", occurredAt: new Date(), createdByUserId: "a" }).run();
  const created = await service.createContribution("family", { memoryEventId: id, authorPersonId: "person-c", recordedByUserId: "c", rawText: `事件内的讲述-${id}`, visibility: "family" });
  if (!created.ok) throw new Error(created.error);
  const bytes = Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample.wav")), Buffer.from(id)]);
  const stored = await storeOriginal({ familyId: "family", createdByUserId: "a", type: "audio", originalFilename: "合成原声.wav", mimeType: "audio/wav", buffer: bytes, extension: "wav", timeSource: "import_time", visibility: "private" });
  if (stored.status !== "stored") throw new Error(stored.status);
  const derivative = await storeDerivative("family", stored.asset.id, "waveform", { mimeType: "image/png", extension: "png", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.png")) });
  if (!derivative) throw new Error("derivative_missing");
  getDb().update(contribution).set({ audioAssetId: derivative.id }).where(eq(contribution.id, created.contributionId)).run();
  return { id, contributionId: created.contributionId, original: stored.asset.id, derivative: derivative.id, bytes };
}
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("contribution author also needs the parent event's current reader grant", async () => {
  const s = await scenario();
  expect((await access.listVisibleContributionsForEvent(snapshot("c"), s.id)).map(c => c.id)).toEqual([s.contributionId]);
  expect((await updateMemoryEventVisibility(ctx("a"), s.id, "members", ["b"], 0)).ok).toBe(true);
  expect(await access.listVisibleContributionsForEvent(snapshot("c"), s.id)).toEqual([]);
  expect((await access.listVisibleContributionsForEvent(snapshot("b"), s.id)).map(c => c.id)).toEqual([s.contributionId]);
  expect(access.updateVisibleContributionText(snapshot("c"), s.contributionId, "不能越权改写")).toEqual({ ok: false, error: "forbidden_or_not_found" });
  expect(getDb().select().from(contribution).where(eq(contribution.id, s.contributionId)).get()?.editedText).toBeNull();
  const revision = getDb().select().from(memoryEvent).where(eq(memoryEvent.id, s.id)).get()!.titleRevision;
  expect((await updateMemoryEventVisibility(ctx("a"), s.id, "private", [], revision)).ok).toBe(true);
  expect(await access.listVisibleContributionsForEvent(snapshot("b"), s.id)).toEqual([]);
  expect((await access.listVisibleContributionsForEvent(snapshot("a"), s.id)).map(c => c.id)).toEqual([s.contributionId]);
});
it("private original and derivative Range requests cannot use a family-labeled narration after event withdrawal", async () => {
  const s = await scenario();
  const before = await media.GET(request("c", "GET", undefined, "bytes=0-11"), { params: Promise.resolve({ assetId: s.original }) });
  expect(before.status).toBe(206);
  expect(Buffer.from(await before.arrayBuffer())).toEqual(s.bytes.subarray(0, 12));
  expect((await updateMemoryEventVisibility(ctx("a"), s.id, "members", ["b"], 0)).ok).toBe(true);
  for (const assetId of [s.original, s.derivative]) {
    expect(await access.canReadContributionAsset(snapshot("c"), assetId)).toBe(false);
    expect(getDb().get(sql`select id from asset where id=${assetId} and ${access.readableAssetPredicate(snapshot("c"), sql`asset.id`)}`)).toBeUndefined();
    expect((await media.GET(request("c", "GET", undefined, "bytes=0-11"), { params: Promise.resolve({ assetId }) })).status).toBe(404);
    const allowed = await media.GET(request("b", "GET", undefined, "bytes=0-11"), { params: Promise.resolve({ assetId }) });
    expect(allowed.status).toBe(206); await allowed.arrayBuffer();
  }
});
it("hidden event rejects new contributions and is absent from family voice summaries and person profiles", async () => {
  const s = await scenario();
  expect((await updateMemoryEventVisibility(ctx("a"), s.id, "private", [], 0)).ok).toBe(true);
  const api = await import("@/app/api/mobile/v1/memories/[id]/contributions/route");
  const before = getDb().all(sql`select id from contribution where memory_event_id=${s.id}`);
  const denied = await api.POST(request("c", "POST", { authorPersonId: "person-c", text: "不能向不可读事件投递", visibility: "family" }), { params: Promise.resolve({ id: s.id }) });
  expect(denied.status).toBe(404);
  expect(getDb().all(sql`select id from contribution where memory_event_id=${s.id}`)).toEqual(before);
  expect((await service.listRecentFamilyContributions("family", 100)).map(c => c.memoryEventId)).not.toContain(s.id);
  expect((await service.listRecentVoiceContributions("family", 100)).map(c => c.memoryEventId)).not.toContain(s.id);
  const profile = await (await import("@/lib/family/profile")).getPersonProfile(ctx("c"), "person-c");
  expect(profile?.narratives.map(c => c.memoryEventId)).not.toContain(s.id);
  expect(profile?.voices.map(c => c.memoryEventId)).not.toContain(s.id);
});

it("event withdrawal keeps an independently shared original readable while excluding its private context from automatic AI", async () => {
  const s = await scenario();
  getDb().run(sql`update asset set visibility='family' where id=${s.original}`);
  expect((await updateMemoryEventVisibility(ctx("a"), s.id, "private", [], 0)).ok).toBe(true);
  expect(await access.listVisibleContributionsForEvent(snapshot("c"), s.id)).toEqual([]);
  for (const assetId of [s.original, s.derivative]) {
    expect(getDb().transaction(tx => access.getContributionAssetAccessInTransaction(tx, snapshot("c"), assetId))).toEqual({ readable: true, automaticEligible: false });
    expect(getDb().get(sql`select id from asset where id=${assetId} and ${access.readableAssetPredicate(snapshot("c"), sql`asset.id`)}`)).toEqual({ id: assetId });
  }
});
