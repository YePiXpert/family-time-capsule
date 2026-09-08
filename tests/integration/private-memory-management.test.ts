import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const acting = vi.hoisted(() => ({ id: "c" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz/context", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/authz/context")>(),
  // Only the framework session binding is substituted; actions/services use real SQLite.
  requireFamilyCapability: async () => ctx(acting.id),
}));
const dir = mkdtempSync(path.join(tmpdir(), "ftc-private-management-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-management";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventReader } = await import("@/db/schema/memory");
const { contribution, fact } = await import("@/db/schema/contribution");
const trash = await import("@/lib/trash/service");
const actions = await import("@/app/(protected)/(app)/memories/[id]/actions");
getDb().insert(family).values({ id: "family", name: "合成管理家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
}
function ctx(id: string): FamilyContext { return { userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 }; }
function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
function scenario(deleted = false) {
  const id = randomUUID(), factId = randomUUID(), contributionId = randomUUID();
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: `私人管理事件-${id}`, bodyText: "作者的独立正文", occurredAt: new Date(), visibility: "members", createdByUserId: "a", deletedAt: deleted ? new Date() : null }).run();
  getDb().insert(memoryEventReader).values({ id: randomUUID(), familyId: "family", memoryEventId: id, userId: "b" }).run();
  getDb().insert(fact).values({ id: factId, memoryEventId: id, statement: "作者待确认的事实", status: "ai_suggested" }).run();
  getDb().insert(contribution).values({ id: contributionId, memoryEventId: id, authorPersonId: "person-a", rawText: "作者私人讲述", visibility: "private", deletedAt: deleted ? new Date() : null }).run();
  return { id, factId, contributionId };
}
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("actual fact actions reject unselected admins and readers who do not own the memory", async () => {
  const s = scenario();
  for (const actor of ["c", "b"]) {
    acting.id = actor;
    const added = await actions.addFactAction(undefined, form({ memoryEventId: s.id, statement: "不能越权添加" }));
    expect(added.error).toBeTruthy();
    const confirmed = await actions.setFactStatusAction(undefined, form({ memoryEventId: "unrelated-display-id", factId: s.factId, status: "user_confirmed" }));
    expect(confirmed.error).toBeTruthy();
  }
  expect(getDb().select().from(fact).where(eq(fact.memoryEventId, s.id)).all()).toHaveLength(1);
  expect(getDb().select().from(fact).where(eq(fact.id, s.factId)).get()?.status).toBe("ai_suggested");
  acting.id = "a";
  expect(await actions.addFactAction(undefined, form({ memoryEventId: s.id, statement: "作者补充的事实" }))).toEqual({});
  expect(await actions.setFactStatusAction(undefined, form({ memoryEventId: s.id, factId: s.factId, status: "user_confirmed" }))).toEqual({});
});
it("trash listing does not disclose another author's event title or private narration", () => {
  const s = scenario(true);
  expect(trash.listTrash(ctx("c")).map(row => row.id)).not.toContain(s.id);
  expect(trash.listTrash(ctx("c")).map(row => row.id)).not.toContain(s.contributionId);
  expect(trash.listTrash(ctx("b")).map(row => row.id)).not.toContain(s.contributionId);
  expect(trash.listTrash(ctx("a")).map(row => row.id)).toEqual(expect.arrayContaining([s.id, s.contributionId]));
});
it("private memory and narration cannot be deleted by an unselected admin or a selected reader", () => {
  const s = scenario();
  for (const actor of ["c", "b"]) {
    expect(trash.trashMemoryEvent(ctx(actor), s.id).ok).toBe(false);
    expect(trash.trashContribution(ctx(actor), s.contributionId).ok).toBe(false);
  }
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, s.id)).get()?.deletedAt).toBeNull();
  expect(getDb().select().from(contribution).where(eq(contribution.id, s.contributionId)).get()?.deletedAt).toBeNull();
});
it("restoration and permanent deletion recheck the author and require a deleted object", () => {
  const s = scenario(true);
  for (const actor of ["c", "b"]) for (const [kind, id] of [["memory_event", s.id], ["contribution", s.contributionId]] as const) {
    expect(trash.restoreFromTrash(ctx(actor), kind, id).ok).toBe(false);
    expect(trash.purgeFromTrash(ctx(actor), kind, id).ok).toBe(false);
  }
  expect(trash.restoreFromTrash(ctx("a"), "memory_event", s.id).ok).toBe(true);
  expect(trash.restoreFromTrash(ctx("a"), "contribution", s.contributionId).ok).toBe(true);
  expect(trash.purgeFromTrash(ctx("a"), "memory_event", s.id).ok).toBe(false);
  expect(trash.purgeFromTrash(ctx("a"), "contribution", s.contributionId).ok).toBe(false);
  expect(trash.trashMemoryEvent(ctx("a"), s.id).ok).toBe(true);
  expect(trash.purgeFromTrash(ctx("a"), "memory_event", s.id).ok).toBe(true);
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, s.id)).get()).toBeUndefined();
});
it("a stale disabled manager cannot list or mutate family trash", () => {
  const s = scenario(true);
  getDb().update(user).set({ disabledAt: new Date() }).where(eq(user.id, "a")).run();
  try {
    expect(trash.listTrash(ctx("a"))).toEqual([]);
    expect(trash.restoreFromTrash(ctx("a"), "memory_event", s.id).ok).toBe(false);
    expect(trash.purgeFromTrash(ctx("a"), "memory_event", s.id).ok).toBe(false);
  } finally { getDb().update(user).set({ disabledAt: null }).where(eq(user.id, "a")).run(); }
});
it("applies management scope before the 100-row trash limit", () => {
  const own = scenario(true);
  getDb().update(memoryEvent).set({ deletedAt: new Date("2020-01-01") }).where(eq(memoryEvent.id, own.id)).run();
  getDb().update(contribution).set({ deletedAt: new Date("2020-01-01") }).where(eq(contribution.id, own.contributionId)).run();
  const ids = Array.from({ length: 101 }, () => randomUUID());
  getDb().insert(memoryEvent).values(ids.map(id => ({ id, familyId: "family", title: "其他账号的近期私人回收项", occurredAt: new Date(), visibility: "private", createdByUserId: "c", deletedAt: new Date() }))).run();
  getDb().insert(contribution).values(ids.map(id => ({ id: randomUUID(), memoryEventId: id, authorPersonId: "person-c", rawText: "其他账号的近期私人讲述", visibility: "private", deletedAt: new Date() }))).run();
  expect(trash.listTrash(ctx("a")).map(row => row.id)).toEqual(expect.arrayContaining([own.id, own.contributionId]));
});
it("purging a parent never bypasses another narrator's ownership", () => {
  for (const actor of ["c", "a"]) {
    const s = scenario();
    if (actor === "c") getDb().update(memoryEvent).set({ visibility: "family" }).where(eq(memoryEvent.id, s.id)).run();
    else getDb().update(contribution).set({ authorPersonId: "person-b", visibility: "family" }).where(eq(contribution.id, s.contributionId)).run();
    expect(trash.trashMemoryEvent(ctx(actor), s.id).ok).toBe(true);
    expect(trash.purgeFromTrash(ctx(actor), "memory_event", s.id)).toEqual({ ok: false, error: "other_authors_content" });
    expect(getDb().select().from(contribution).where(eq(contribution.id, s.contributionId)).get()).toBeDefined();
    expect(trash.restoreFromTrash(ctx(actor), "memory_event", s.id).ok).toBe(true);
  }
});
