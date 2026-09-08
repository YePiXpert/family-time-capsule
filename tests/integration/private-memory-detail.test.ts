import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const scheduling = vi.hoisted(() => ({ afterThumbnails: undefined as (() => void) | undefined, afterMobile: undefined as (() => void) | undefined }));
vi.mock("@/lib/assets/service", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/assets/service")>();
  return { ...actual, getThumbnailMap: async (...args: Parameters<typeof actual.getThumbnailMap>) => {
    const result = await actual.getThumbnailMap(...args);
    const callback = scheduling.afterThumbnails;
    scheduling.afterThumbnails = undefined;
    callback?.();
    return result;
  } };
});
vi.mock("@/lib/mobile/product", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/mobile/product")>();
  return { ...actual, getMobileMemory: async (...args: Parameters<typeof actual.getMobileMemory>) => {
    const result = await actual.getMobileMemory(...args);
    const callback = scheduling.afterMobile;
    scheduling.afterMobile = undefined;
    callback?.();
    return result;
  } };
});
const dir = mkdtempSync(path.join(tmpdir(), "ftc-private-detail-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-detail";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { contribution, fact } = await import("@/db/schema/contribution");
const { factSource } = await import("@/db/schema/suggestion");
const factService = await import("@/lib/contributions/service");
const search = await import("@/lib/search/service");
const { storeOriginal } = await import("@/lib/assets/service");
const detail = await import("@/lib/memories/service");
const reader = await import("@/lib/memories/read-access");
const api = await import("@/app/api/mobile/v1/memories/[id]/route");
const media = await import("@/app/api/media/[assetId]/route");
getDb().insert(family).values({ id: "family", name: "合成详情家庭", timezone: "UTC" }).run();
for (const id of ["a", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-detail`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (id: string): FamilyContext => ({ userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
const request = (id: string) => new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${id}-synthetic-detail` } });
function event() {
  const id = randomUUID();
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: "撤权前的事件标题", bodyText: "撤权后不得交付的正文", occurredAt: new Date(), status: "confirmed", visibility: "family", createdByUserId: "a" }).run();
  return id;
}
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("detail metadata follows the same private narration boundary as actual media HTTP", async () => {
  const id = event();
  const voice = await storeOriginal({ familyId: "family", createdByUserId: "a", type: "audio", originalFilename: "我的私人病情原声.wav", mimeType: "audio/wav", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.wav")), extension: "wav", timeSource: "import_time", visibility: "private" });
  if (voice.status !== "stored") throw new Error(voice.status);
  getDb().insert(memoryEventAsset).values({ id: randomUUID(), familyId: "family", memoryEventId: id, assetId: voice.asset.id }).run();
  getDb().insert(contribution).values({ id: randomUUID(), memoryEventId: id, authorPersonId: "person-a", audioAssetId: voice.asset.id, rawText: "我的私人讲述", visibility: "private" }).run();
  expect((await media.GET(request("c"), { params: Promise.resolve({ assetId: voice.asset.id }) })).status).toBe(404);
  expect((await detail.getVisibleMemoryEventDetail(ctx("a"), id))?.assets.map(a => a.id)).toEqual([voice.asset.id]);
  expect((await detail.getVisibleMemoryEventDetail(ctx("c"), id))?.assets).toEqual([]);
  const response = await api.GET(request("c"), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ assets: [], contributions: [] });
  // A separately visible narration does not authorize a second private reference's audio.
  getDb().insert(contribution).values({ id: randomUUID(), memoryEventId: id, authorPersonId: "person-c", audioAssetId: voice.asset.id, rawText: "可以读的另一段文字", visibility: "family" }).run();
  const content = reader.readMemoryContent(ctx("c"), id)!;
  expect(content.audioAssets).toEqual([]);
  expect(content.contributions).toMatchObject([{ rawText: "可以读的另一段文字", audioAssetId: null }]);
  const visibleText = await (await api.GET(request("c"), { params: Promise.resolve({ id }) })).json();
  expect(visibleText.contributions).toMatchObject([{ text: "可以读的另一段文字", audioPath: null }]);
});
it("mobile HTTP rechecks event withdrawal after the last asynchronous data lookup", async () => {
  const id = event();
  expect((await api.GET(request("c"), { params: Promise.resolve({ id }) })).status).toBe(200);
  // A second real SQLite connection models revocation while an aggregate read is awaiting I/O.
  scheduling.afterThumbnails = () => {
    const concurrent = new Database(path.join(dir, "db/capsule.sqlite"));
    try { concurrent.prepare("update memory_event set visibility='private' where id=?").run(id); }
    finally { concurrent.close(); }
  };
  const response = await api.GET(request("c"), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, id)).get()?.bodyText).toBe("撤权后不得交付的正文");
});
it("fact search and confirmation cannot disclose a withdrawn narration through a family event", async () => {
  const id = event(), voice = randomUUID(), factId = randomUUID();
  getDb().insert(contribution).values({ id: voice, memoryEventId: id, authorPersonId: "person-a", rawText: "合成暗号青苔风筝", visibility: "family" }).run();
  getDb().insert(fact).values({ id: factId, memoryEventId: id, statement: "合成暗号青苔风筝", status: "user_confirmed" }).run();
  getDb().insert(factSource).values({ id: randomUUID(), familyId: "family", factId, sourceType: "contribution", sourceId: voice, quote: "合成暗号青苔风筝" }).run();
  search.indexFactIfConfirmed({ id: factId, familyId: "family", memoryEventId: id, statement: "合成暗号青苔风筝", status: "user_confirmed" });
  expect(search.searchFamily(ctx("c"), { q: "青苔风筝" }).facts.map(f => f.id)).toContain(factId);
  const before = reader.readMemoryContent(ctx("c"), id)!;
  expect(before.sources.map(source => source.quote)).toContain("合成暗号青苔风筝");
  getDb().update(contribution).set({ visibility: "private" }).where(eq(contribution.id, voice)).run();
  expect(reader.isMemoryContentCurrent(ctx("c"), id, before.version)).toBe(false);
  expect(reader.readMemoryContent(ctx("c"), id)).toMatchObject({ facts: [], sources: [] });
  expect(reader.readMemoryContent(ctx("a"), id)?.facts.map(f => f.id)).toContain(factId);
  expect(search.searchFamily(ctx("c"), { q: "青苔风筝" }).facts).toEqual([]);
  expect(search.searchFamily(ctx("a"), { q: "青苔风筝" }).facts.map(f => f.id)).toContain(factId);
  getDb().update(fact).set({ status: "ai_suggested" }).where(eq(fact.id, factId)).run();
  expect(await factService.setFactStatus(ctx("c"), factId, "user_confirmed")).toBeUndefined();
  expect(getDb().select().from(fact).where(eq(fact.id, factId)).get()?.status).toBe("ai_suggested");
});
it("mobile route checks withdrawal after the service returns before constructing the HTTP body", async () => {
  const id = event();
  scheduling.afterMobile = () => {
    const concurrent = new Database(path.join(dir, "db/capsule.sqlite"));
    try { concurrent.prepare("update memory_event set visibility='private' where id=?").run(id); }
    finally { concurrent.close(); }
  };
  expect((await api.GET(request("c"), { params: Promise.resolve({ id }) })).status).toBe(404);
});
it("related memory cards cannot retain another event's withdrawn title or private media count", async () => {
  const id = event();
  const page = await detail.getTimelinePage(ctx("c"), { limit: 50 });
  expect(page.entries.map(entry => entry.event.id)).toContain(id);
  getDb().update(memoryEvent).set({ visibility: "private" }).where(eq(memoryEvent.id, id)).run();
  expect(reader.refreshMemoryCards(ctx("c"), page.entries).map(entry => entry.event.id)).not.toContain(id);
});
