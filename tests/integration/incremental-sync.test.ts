import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
import type { MobileSyncProtocolPage } from "@/lib/mobile/sync-protocol";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-incremental-sync-"));
process.env.DATA_DIR = dir; process.env.AUTH_SECRET = "synthetic-incremental-sync";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const { syncChange, syncState } = await import("@/db/schema/sync");
const { readSyncStamp, rotateSyncGenerationInTransaction, pruneSyncChanges } = await import("@/lib/mobile/sync-state");
const { GET } = await import("@/app/api/mobile/v1/sync/route");
const { PATCH } = await import("@/app/api/mobile/v1/memories/[id]/route");
const { updateMemoryEventVisibility } = await import("@/lib/memories/service");
const { getInstanceId } = await import("@/lib/instance/service");
getDb().insert(family).values({ id: "family", name: "同步合成家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-sync2`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (id: string): FamilyContext => ({ userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
function event(visibility = "family") { const id = randomUUID(); getDb().insert(memoryEvent).values({ id, familyId: "family", title: visibility === "private" ? "PRIVATE_TITLE_NEVER_SYNC_TO_B" : "共同旧事", bodyText: "不进入变更账本的正文", occurredAt: new Date("2000-01-01T00:00:00Z"), occurredAtPrecision: "unknown", status: "confirmed", visibility, createdByUserId: "a" }).run(); return id; }
const request = (cursor: string | null = null, actor = "b", limit = 1) => GET(new Request(`http://localhost/api/mobile/v1/sync?protocol=2&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { authorization: `Bearer ${actor}-sync2` } }));
async function round(cursor: string | null = null, actor = "b") {
  const pages: MobileSyncProtocolPage[] = [];
  do { const response = await request(cursor, actor); expect(response.status, await response.clone().text()).toBe(200); const page = await response.json() as MobileSyncProtocolPage; pages.push(page); expect(page.people.length).toBeLessThanOrEqual(1); expect(page.events.length).toBeLessThanOrEqual(1); cursor = page.nextCursor; expect(pages.length).toBeLessThan(200); } while (cursor);
  expect(pages.at(-1)?.sync.checkpoint).toMatch(/^[a-f0-9]{48}$/u);
  return { pages, checkpoint: pages.at(-1)!.sync.checkpoint! };
}
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("snapshots page authorized metadata only and bind opaque cursors to the account", async () => {
  const own = event("private"), shared = event();
  const first = await (await request()).json() as MobileSyncProtocolPage;
  expect((await request(first.nextCursor!, "c")).status).toBe(409);
  expect((await request(`${first.nextCursor!.slice(0, -1)}z`)).status).toBe(409);
  const result = await round();
  expect(result.pages.flatMap(page => page.events.map(row => row.id))).toContain(shared);
  expect(JSON.stringify(result.pages)).not.toContain(own);
  expect(JSON.stringify(result.pages)).not.toContain("PRIVATE_TITLE_NEVER_SYNC_TO_B");
  const unchanged = await round(result.checkpoint);
  expect(unchanged.pages.flatMap(page => [...page.events, ...page.people, ...page.tombstones])).toEqual([]);
  expect(unchanged.pages.every(page => page.sync.mode === "delta")).toBe(true);
});
it("actual HTTP edits arrive incrementally and authorized tombstones remove deleted events", async () => {
  const shared = event(), own = event("private"); const baseline = await round();
  const update = await PATCH(new Request(`http://localhost/api/mobile/v1/memories/${shared}`, { method: "PATCH", headers: { authorization: "Bearer a-sync2", "content-type": "application/json" }, body: JSON.stringify({ title: "增量修改", expectedRevision: 0, mutationId: randomUUID() }) }), { params: Promise.resolve({ id: shared }) });
  expect(update.status).toBe(200);
  const changed = await round(baseline.checkpoint);
  expect(changed.pages.flatMap(page => page.events)).toMatchObject([{ id: shared, title: "增量修改", ageLabel: null }]);
  getDb().update(memoryEvent).set({ deletedAt: new Date() }).where(eq(memoryEvent.id, shared)).run();
  getDb().delete(memoryEvent).where(eq(memoryEvent.id, own)).run();
  const removed = await round(changed.checkpoint);
  expect(removed.pages.flatMap(page => page.tombstones)).toEqual([{ kind: "memory", id: shared }]);
  expect(JSON.stringify(removed.pages)).not.toContain(own);
  expect(removed.pages.some(page => page.sync.invalidateResources)).toBe(true);
});
it("failed business transactions cannot leave phantom changes, and no content enters the journal", () => {
  const id = event(); const before = readSyncStamp(ctx("a"));
  expect(() => getDb().transaction(tx => { tx.update(memoryEvent).set({ bodyText: "回滚原文不可见" }).where(eq(memoryEvent.id, id)).run(); throw new Error("abort"); })).toThrow("abort");
  expect(readSyncStamp(ctx("a"))).toEqual(before);
  expect(JSON.stringify(getDb().select().from(syncChange).all())).not.toContain("不进入变更账本的正文");
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, id)).get()?.bodyText).toBe("不进入变更账本的正文");
});
it("a concurrent process invalidates an in-progress fence and a reader withdrawal invalidates the checkpoint", async () => {
  const id = event(); const baseline = await round();
  const first = await (await request()).json() as MobileSyncProtocolPage;
  const concurrent = new Database(path.join(dir, "db/capsule.sqlite"));
  try { concurrent.prepare("update memory_event set title='另一进程更新' where id=?").run(id); } finally { concurrent.close(); }
  const interrupted = await request(first.nextCursor!); expect(interrupted.status).toBe(409); expect(await interrupted.json()).toMatchObject({ error: "sync_changed" });
  expect((await updateMemoryEventVisibility(ctx("a"), id, "private", [], 0, randomUUID())).ok).toBe(true);
  const revoked = await request(baseline.checkpoint); expect(revoked.status).toBe(409); expect(await revoked.json()).toMatchObject({ error: "sync_reset" });
  expect((await round()).pages.flatMap(page => page.events.map(row => row.id))).not.toContain(id);
});
it("data generation changes reject old cursors without changing installation identity", async () => {
  const baseline = await round(); const identity = await getInstanceId(); const previous = readSyncStamp(ctx("b")).generation;
  getDb().transaction(tx => rotateSyncGenerationInTransaction(tx));
  expect(readSyncStamp(ctx("b")).generation).not.toBe(previous); expect(await getInstanceId()).toBe(identity);
  expect((await request(baseline.checkpoint)).status).toBe(409);
  expect((await round()).pages[0]!.sync.generation).not.toBe(previous);
});
it("expired change history has a bounded cleanup and an explicit snapshot recovery", async () => {
  const baseline = await round(); event();
  getDb().update(syncChange).set({ createdAt: new Date(0) }).run();
  expect(pruneSyncChanges()).toBeGreaterThan(0);
  expect(getDb().select().from(syncState).get()!.floorSeq).toBeGreaterThan(0);
  expect((await request(baseline.checkpoint)).status).toBe(409);
  expect((await round()).checkpoint).toBeTruthy();
});

it("retention only deletes an expired prefix when timestamps are out of sequence", () => {
  // Earlier cases expired the preceding journal. Leave a fresh row before an
  // artificially older one, as can happen after a host clock correction.
  event(); event();
  const before = getDb().select().from(syncChange).all();
  const oldest = before[0]!, newest = before.at(-1)!;
  getDb().update(syncChange).set({ createdAt: new Date() }).where(eq(syncChange.seq,oldest.seq)).run();
  getDb().update(syncChange).set({ createdAt: new Date(0) }).where(eq(syncChange.seq,newest.seq)).run();
  expect(pruneSyncChanges()).toBe(0);
  expect(getDb().select().from(syncChange).all()).toHaveLength(before.length);
});
it("generation and journal changes roll back together with a failed restore transaction", () => {
  const previous = readSyncStamp(ctx("a"));
  expect(() => getDb().transaction(tx => { rotateSyncGenerationInTransaction(tx); event(); throw new Error("restore verification failed"); })).toThrow("restore verification failed");
  expect(readSyncStamp(ctx("a"))).toEqual(previous);
});
