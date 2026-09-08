import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-private-library-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-library-secret";
const { getDb, closeDatabase } = await import("@/db");
const { family } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventAsset, memoryEventReader } = await import("@/db/schema/memory");
const { ingestImage } = await import("@/lib/assets/ingest");
const library = await import("@/lib/assets/library");
const detailApi = await import("@/app/api/mobile/v1/assets/[id]/route");
const libraryApi = await import("@/app/api/mobile/v1/assets/route");
getDb().insert(family).values({ id: "family", name: "合成家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(user).values({ id, familyId: "family", name: id, email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-library`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const a: FamilyContext = { userId: "a", userName: "a", familyId: "family", personId: null, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 };
const b = { ...a, userId: "b" }, c = { ...a, userId: "c" };
function request(actor: string, method = "GET", body?: unknown) {
  return new Request("http://localhost/api/mobile/v1/assets", { method, headers: { authorization: `Bearer ${actor}-synthetic-library`, origin: "http://localhost", host: "localhost", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function photo(filename: string, visibility: "family" | "private" = "family") {
  const result = await ingestImage({ familyId: "family", createdByUserId: "a", filename, declaredMime: "image/jpeg", buffer: readFileSync(path.join(__dirname, "../fixtures", filename)), clientLastModifiedMs: null, visibility });
  if (result.status !== "stored") throw new Error(result.status);
  return result.asset.id;
}
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("shared original metadata omits private event links and hidden referenced counts; library HTTP cannot edit a hidden event", async () => {
  const shared = await photo("sample.jpg"), extra = await photo("sample-exif.jpg");
  const eventId = randomUUID();
  getDb().insert(memoryEvent).values({ id: eventId, familyId: "family", title: "私密事件不应被关联详情泄露", occurredAt: new Date(), status: "confirmed", visibility: "private", createdByUserId: "a" }).run();
  getDb().insert(memoryEventAsset).values({ id: randomUUID(), familyId: "family", memoryEventId: eventId, assetId: shared }).run();
  const response = await detailApi.GET(request("c"), { params: Promise.resolve({ id: shared }) });
  expect(response.status).toBe(200);
  const card = await response.json();
  expect(card.memories).toEqual([]);
  expect(card.referenced).toBe(false);
  expect(library.listLibraryAssets(c).entries.find(e => e.id === shared)?.referenced).toBe(false);
  expect(library.getLibraryAsset(a, shared).memories).toEqual([{ id: eventId, title: "私密事件不应被关联详情泄露" }]);
  const before = getDb().select().from(memoryEvent).where(eq(memoryEvent.id, eventId)).get();
  const denied = await libraryApi.POST(request("c", "POST", { operation: "memory", targetId: eventId, assetIds: [extra] }));
  expect(denied.status).toBe(404);
  expect(await denied.json()).toEqual({ error: "not_found" });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, eventId)).get()).toEqual(before);
  expect(getDb().all(sql`select asset_id from memory_event_asset where memory_event_id=${eventId}`)).toEqual([{ asset_id: shared }]);
});
it("a selected reader can view private originals but cannot edit their metadata, edit the owner's event or reshare into another event", async () => {
  const original = await photo("sample-exif-offset.jpg", "private"), eventId = randomUUID(), target = randomUUID();
  getDb().insert(memoryEvent).values([{ id: eventId, familyId: "family", title: "作者的指定成员事件", occurredAt: new Date(), visibility: "members", createdByUserId: "a" }, { id: target, familyId: "family", title: "读者的全家事件", occurredAt: new Date(), createdByUserId: "b" }]).run();
  getDb().insert(memoryEventReader).values({ id: randomUUID(), familyId: "family", memoryEventId: eventId, userId: "b" }).run();
  getDb().insert(memoryEventAsset).values({ id: randomUUID(), familyId: "family", memoryEventId: eventId, assetId: original }).run();
  const read = library.getLibraryAsset(b, original);
  expect(read.canWrite).toBe(false);
  expect(read.canDelete).toBe(false);
  const removed = await detailApi.DELETE(request("b", "DELETE", { confirmed: true }), { params: Promise.resolve({ id: original }) });
  expect(removed.status).toBe(403);
  const edited = await detailApi.PATCH(request("b", "PATCH", { revision: read.metadataRevision, capturedAt: "1980-01-01T00:00:00Z" }), { params: Promise.resolve({ id: original }) });
  expect(edited.status).toBe(403);
  expect(library.getLibraryAsset(a, original).metadataRevision).toBe(read.metadataRevision);
  const reshared = await libraryApi.POST(request("b", "POST", { operation: "memory", targetId: target, assetIds: [original] }));
  expect(reshared.status).toBe(403);
  expect(await reshared.json()).toEqual({ error: "asset_reshare_forbidden" });
  expect(getDb().all(sql`select id from memory_event_asset where memory_event_id=${target}`)).toEqual([]);
  const editedEvent = await libraryApi.POST(request("b", "POST", { operation: "memory", targetId: eventId, assetIds: [original] }));
  expect(editedEvent.status).toBe(403);
  expect(() => library.getLibraryAsset(c, original)).toThrow("not_found");
  // The owner can explicitly share an original into an already family-visible event.
  const ownerShared = await libraryApi.POST(request("a", "POST", { operation: "memory", targetId: target, assetIds: [original] }));
  expect(ownerShared.status).toBe(200);
  expect(library.getLibraryAsset(c, original).id).toBe(original);
});

it("name review and rename cannot bypass private event or original edit authority", async () => {
  const names = await import("@/lib/names/service");
  const event = getDb().select().from(memoryEvent).where(eq(memoryEvent.title, "私密事件不应被关联详情泄露")).get()!;
  expect(await names.getNameReview("family", "c", "memory_event", event.id)).toBeNull();
  expect(await names.renameTarget("family", "c", { kind: "memory_event", id: event.id, revision: event.titleRevision, title: "越权标题" })).toEqual({ ok: false, error: "not_found" });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, event.id)).get()?.title).toBe(event.title);
  const { asset } = await import("@/db/schema/asset");
  const original = getDb().select().from(asset).where(eq(asset.visibility, "private")).get()!;
  expect(library.getLibraryAsset(b, original.id).id).toBe(original.id);
  expect(await names.getNameReview("family", "b", "asset", original.id)).toBeNull();
  expect(await names.renameTarget("family", "b", { kind: "asset", id: original.id, revision: original.nameRevision, title: "越权原件名称" })).toEqual({ ok: false, error: "not_found" });
  expect(await names.renameTarget("family", "a", { kind: "asset", id: original.id, revision: original.nameRevision, title: "作者确认名称" })).toMatchObject({ ok: true });
});
