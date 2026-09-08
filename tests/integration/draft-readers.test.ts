import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-draft-readers-"));
process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET = "synthetic-draft-reader-secret-only";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { emptyDraftContent, parseDraftContent } = await import("@/mobile/src/drafts/model");
const { GET: readers } = await import("@/app/api/mobile/v1/draft-readers/route");
const { PUT } = await import("@/app/api/mobile/v1/drafts/[id]/route");
const { POST: publish } = await import("@/app/api/mobile/v1/drafts/[id]/publish/route");
const { GET: readMemory } = await import("@/app/api/mobile/v1/memories/[id]/route");
afterAll(() => { closeDatabase(); rmSync(dataDir, { recursive: true, force: true }); });

it("R01/R02: ordinary author selects login accounts through HTTP without managing accounts or exposing private fields", async () => {
  const db = getDb();
  db.insert(family).values([{ id: "family", name: "合成家庭" }, { id: "foreign", name: "另一家庭" }]).run();
  db.insert(person).values([{ id: "person-b", familyId: "family", displayName: "妈妈" }, { id: "person-no-account", familyId: "family", displayName: "外公" }]).run();
  for (const [id, role, familyId, personId, disabledAt] of [
    ["user-a", "editor", "family", null, null],
    ["user-b", "viewer", "family", "person-b", null],
    ["user-c", "admin", "family", null, null],
    ["user-disabled", "viewer", "family", null, new Date()],
    ["user-left", "viewer", null, null, null],
    ["user-foreign", "viewer", "foreign", null, null],
  ] as const) {
    db.insert(user).values({ id, role, familyId, personId, disabledAt, name: id === "user-b" ? "妈妈" : id, email: `${id}@fixture.invalid` }).run();
    if (!disabledAt) db.insert(session).values({ id: randomUUID(), token: `token-${id}`, userId: id, expiresAt: new Date(Date.now() + 3600000) }).run();
  }
  const request = (actor: string, body?: unknown) => new Request("http://localhost/api/mobile/v1/drafts", {
    method: body ? "POST" : "GET", headers: { authorization: `Bearer token-${actor}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const available = await readers(request("user-a"));
  expect(available.status).toBe(200);
  expect(available.headers.get("cache-control")).toBe("private, no-store");
  const body = await available.json();
  expect(body.members).toEqual([{ id: "user-b", name: "妈妈" }, { id: "user-c", name: "user-c" }].sort((a, b) => a.name < b.name ? -1 : 1));
  for (const member of body.members) expect(Object.keys(member).sort()).toEqual(["id", "name"]);
  const content = parseDraftContent({ ...emptyDraftContent(), text: "一起散步", occurredAtPrecision: "unknown", visibility: "members", readerUserIds: ["user-b"], participantIds: ["person-b", "person-no-account"] });
  const route = { params: Promise.resolve({ id: "readers-draft" }) };
  const saved = await PUT(request("user-a", { content, mutationId: "mutation-a", expectedRevision: 0 }), route);
  const savedBody = await saved.json();
  expect(saved.status, JSON.stringify(savedBody)).toBe(200);
  expect(savedBody).toMatchObject({ readerUserIds: ["user-b"], participantIds: ["person-b", "person-no-account"] });
  const published = await publish(request("user-a", { expectedRevision: 1 }), route);
  expect(published.status).toBe(200);
  const event = await published.json();
  const eventRoute = { params: Promise.resolve({ id: event.memoryEventId }) };
  expect((await readMemory(request("user-b"), eventRoute)).status).toBe(200);
  expect((await readMemory(request("user-c"), eventRoute)).status).toBe(404);
  for (const invalid of ["person-b", "person-no-account", "user-disabled", "user-left", "user-foreign"]) {
    const invalidResponse = await PUT(request("user-a", { content: { ...content, readerUserIds: [invalid] }, mutationId: randomUUID(), expectedRevision: 0 }), { params: Promise.resolve({ id: randomUUID() }) });
    expect(invalidResponse.status, invalid).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: "invalid_reader" });
  }
  const queuedRoute = { params: Promise.resolve({ id: "later-disabled" }) };
  expect((await PUT(request("user-a", { content, mutationId: randomUUID(), expectedRevision: 0 }), queuedRoute)).status).toBe(200);
  db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, "user-b")).run();
  const revoked = await publish(request("user-a", { expectedRevision: 1 }), queuedRoute);
  expect(revoked.status).toBe(400);
  expect(await revoked.json()).toEqual({ error: "invalid_reader" });
  expect((await readMemory(request("user-b"), eventRoute)).status).toBe(401);
  // Author still has no account-management capability after using the reader list.
  expect(db.select({ role: user.role }).from(user).where(eq(user.id, "user-a")).get()).toEqual({ role: "editor" });
});
