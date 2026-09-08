import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";

const dir = mkdtempSync(path.join(tmpdir(), "ftc-private-read-grant-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-read-grant-secret";
const { getDb, closeDatabase } = await import("@/db");
const { family } = await import("@/db/schema/family");
const { user } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { collection, collectionItem } = await import("@/db/schema/collection");
const { storeOriginal, storeDerivative } = await import("@/lib/assets/service");
const grants = await import("@/lib/family/read-grants");
const media = await import("@/app/api/media/[assetId]/route");
getDb().insert(family).values({ id: "family", name: "合成访客家庭", timezone: "UTC" }).run();
for (const id of ["a", "c"]) getDb().insert(user).values({ id, familyId: "family", name: id, email: `${id}@fixture.invalid`, role: "admin" }).run();
const ctx = (userId: string): FamilyContext => ({ userId, userName: userId, familyId: "family", personId: null, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });

async function scenario() {
  const id = randomUUID();
  const bytes = Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample.wav")), Buffer.from(id)]);
  const stored = await storeOriginal({ familyId: "family", createdByUserId: "a", visibility: "private", type: "audio", originalFilename: "只给自己听.wav", mimeType: "audio/wav", buffer: bytes, extension: "wav", timeSource: "import_time" });
  if (stored.status !== "stored") throw new Error(stored.status);
  const derivative = await storeDerivative("family", stored.asset.id, "waveform", { mimeType: "image/png", extension: "png", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.png")) });
  if (!derivative) throw new Error("missing_derivative");
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: `不能外传的标题-${id}`, bodyText: "个人正文", occurredAt: new Date(), createdByUserId: "a", visibility: "private" }).run();
  getDb().insert(memoryEventAsset).values({ id, memoryEventId: id, assetId: stored.asset.id, familyId: "family" }).run();
  getDb().insert(collection).values({ id, familyId: "family", kind: "album", title: "访客相册" }).run();
  // Historical/imported references may predate privacy withdrawal. Membership alone is not consent.
  getDb().insert(collectionItem).values([
    { id, collectionId: id, familyId: "family", memoryEventId: id, caption: "事件说明", position: 0 },
    { id: `${id}-direct`, collectionId: id, familyId: "family", assetId: stored.asset.id, caption: "直接引用", position: 1 },
  ]).run();
  const created = await grants.createReadGrant(ctx("c"), { collectionId: id });
  if (!created.ok) throw new Error(created.error);
  const grant = grants.resolveReadGrant(created.token);
  if (!grant) throw new Error("missing_grant");
  return { id, original: stored.asset.id, derivative: derivative.id, bytes, created, grant };
}
const read = (token: string, assetId: string) => media.GET(new Request(`http://localhost/api/media/${assetId}?grant=${token}`, { headers: { range: "bytes=0-11" } }), { params: Promise.resolve({ assetId }) });

it("a guest album cannot disclose a private event title, original, or derivative through direct membership", async () => {
  const s = await scenario();
  expect(grants.listReadGrantEntries(s.grant)).toEqual([]);
  for (const assetId of [s.original, s.derivative]) {
    expect(grants.readGrantIncludesAsset(s.grant, assetId)).toBe(false);
    expect((await read(s.created.token, assetId)).status).toBe(401);
  }
});

it("explicit family publication permits private-root media, and withdrawal invalidates existing grants and cached resolutions", async () => {
  const s = await scenario();
  getDb().update(memoryEvent).set({ visibility: "family" }).where(eq(memoryEvent.id, s.id)).run();
  expect(grants.listReadGrantEntries(s.grant)).toHaveLength(2);
  const allowed = await read(s.created.token, s.original);
  expect(allowed.status).toBe(206);
  expect(Buffer.from(await allowed.arrayBuffer())).toEqual(s.bytes.subarray(0, 12));
  expect(grants.readGrantIncludesAsset(s.grant, s.derivative)).toBe(true);
  getDb().update(memoryEvent).set({ visibility: "members" }).where(eq(memoryEvent.id, s.id)).run();
  expect(grants.listReadGrantEntries(s.grant)).toEqual([]);
  expect((await read(s.created.token, s.original)).status).toBe(401);
  // Prior independent family sharing remains valid, without exposing the private event or its caption.
  getDb().run(sql`update asset set visibility='family' where id=${s.original}`);
  expect(grants.listReadGrantEntries(s.grant).map(e => e.caption)).toEqual(["直接引用"]);
  expect(grants.readGrantIncludesAsset(s.grant, s.derivative)).toBe(true);
  expect(grants.revokeReadGrant(ctx("c"), s.created.grantId)).toEqual({ ok: true });
  expect(grants.listReadGrantEntries(s.grant)).toEqual([]);
  expect(grants.readGrantIncludesAsset(s.grant, s.original)).toBe(false);
});

it("disabling the grant creator invalidates tokens, cached grant objects, and stale creation contexts", async () => {
  const s = await scenario();
  getDb().update(memoryEvent).set({ visibility: "family" }).where(eq(memoryEvent.id, s.id)).run();
  expect(grants.readGrantIncludesAsset(s.grant, s.original)).toBe(true);
  getDb().update(user).set({ disabledAt: new Date() }).where(eq(user.id, "c")).run();
  try {
    expect(grants.resolveReadGrant(s.created.token)).toBeNull();
    expect(grants.listReadGrantEntries(s.grant)).toEqual([]);
    expect(grants.readGrantIncludesAsset(s.grant, s.original)).toBe(false);
    expect((await read(s.created.token, s.original)).status).toBe(401);
    expect(await grants.createReadGrant(ctx("c"), { collectionId: s.id })).toEqual({ ok: false, error: "forbidden" });
  } finally { getDb().update(user).set({ disabledAt: null }).where(eq(user.id, "c")).run(); }
});
