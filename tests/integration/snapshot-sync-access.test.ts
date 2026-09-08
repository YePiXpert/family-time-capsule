import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const scheduling = vi.hoisted(() => ({ afterPage: undefined as (() => void) | undefined }));
vi.mock("@/lib/mobile/sync", async original => {
  const actual = await original<typeof import("@/lib/mobile/sync")>();
  return { ...actual, getMobileSyncPage: async (...args: Parameters<typeof actual.getMobileSyncPage>) => {
    const page = await actual.getMobileSyncPage(...args); const callback = scheduling.afterPage; scheduling.afterPage = undefined; callback?.(); return page;
  } };
});
const dir = mkdtempSync(path.join(tmpdir(), "ftc-snapshot-access-"));
process.env.DATA_DIR = dir; process.env.AUTH_SECRET = "synthetic-sync-access";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const { GET } = await import("@/app/api/mobile/v1/sync/route");
getDb().insert(family).values({ id: "family", name: "合成同步家庭", timezone: "UTC" }).run();
for (const id of ["a", "b"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "家人", birthDate: "1980-01-01" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "家人", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-sync`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
function event() { const id = randomUUID(); getDb().insert(memoryEvent).values({ id, familyId: "family", title: "PRIVATE_SYNC_TITLE", bodyText: "private words", occurredAt: new Date("2000-01-01T00:00:00Z"), occurredAtPrecision: "unknown", childPersonId: "person-a", status: "confirmed", visibility: "family", createdByUserId: "a" }).run(); return id; }
const request = () => GET(new Request("http://localhost/api/mobile/v1/sync", { headers: { authorization: "Bearer b-sync" } }));
const concurrent = (sql: string, id: string) => { const db = new Database(path.join(dir, "db/capsule.sqlite")); try { db.prepare(sql).run(id); } finally { db.close(); } };
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("unknown-time synchronization never turns an internal anchor into a person's age", async () => {
  const id = event(); const response = await request(); expect(response.status).toBe(200);
  expect((await response.json()).events.find((row: { id: string }) => row.id === id)).toMatchObject({ occurredAtPrecision: "unknown", ageDays: null, ageLabel: null });
});
it("revocation after the snapshot service returns cannot leak an old timeline title", async () => {
  const id = event(); scheduling.afterPage = () => concurrent("update memory_event set visibility='private' where id=?", id);
  const body = await (await request()).json();
  expect(body.events?.some((row: { id: string }) => row.id === id) ?? false).toBe(false);
});
it("account disablement at final snapshot handoff rejects family and person metadata too", async () => {
  scheduling.afterPage = () => concurrent("update user set disabled_at=unixepoch() where id=?", "b");
  try { const response = await request(); expect([401, 403]).toContain(response.status); expect(await response.text()).not.toContain("合成同步家庭"); }
  finally { getDb().update(user).set({ disabledAt: null }).where(eq(user.id, "b")).run(); }
});
