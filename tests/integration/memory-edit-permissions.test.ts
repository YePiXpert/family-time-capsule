import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-memory-edit-permissions-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-memory-edit-permissions";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventReader } = await import("@/db/schema/memory");
const service = await import("@/lib/memories/service");
const api = await import("@/app/api/mobile/v1/memories/[id]/route");
getDb().insert(family).values({ id: "family", name: "合成编辑家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-edit`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (id: string): FamilyContext => ({ userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
function event() {
  const id = randomUUID();
  getDb().insert(memoryEvent).values({ id, familyId: "family", title: "原来的标题", bodyText: "保存的原话", occurredAt: new Date("1980-06-04T10:00:00Z"), status: "confirmed", visibility: "family", createdByUserId: "a" }).run();
  return id;
}
function patch(actor: string, id: string, body: unknown) {
  return api.PATCH(new Request(`http://localhost/api/mobile/v1/memories/${id}`, { method: "PATCH", headers: { authorization: `Bearer ${actor}-synthetic-edit`, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
it("an editor disabled while an edit is awaiting validation cannot commit", async () => {
  const id = event();
  const pending = service.updateMemoryEvent("family", id, "c", { title: "不应写入的标题" });
  getDb().update(user).set({ disabledAt: new Date() }).where(eq(user.id, "c")).run();
  try {
    expect((await pending).ok).toBe(false);
    expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, id)).get()?.title).toBe("原来的标题");
  } finally { getDb().update(user).set({ disabledAt: null }).where(eq(user.id, "c")).run(); }
});
it("a reader context never grants ownership to edit a restricted event", async () => {
  const id = event();
  getDb().update(memoryEvent).set({ visibility: "members" }).where(eq(memoryEvent.id, id)).run();
  getDb().insert(memoryEventReader).values({ id: randomUUID(), familyId: "family", memoryEventId: id, userId: "b" }).run();
  expect((await service.updateMemoryEvent("family", id, "b", { title: "读者不能改写" }, { role: "admin", accountEnabled: true })).ok).toBe(false);
});
it("private originals cannot be assigned as another author's family event cover", async () => {
  const id = event();
  const { storeOriginal } = await import("@/lib/assets/service");
  const photo = await storeOriginal({ familyId: "family", createdByUserId: "a", type: "image", originalFilename: "私人原件.png", mimeType: "image/png", extension: "png", buffer: readFileSync(path.join(__dirname, "../fixtures/sample.png")), timeSource: "import_time", visibility: "private" });
  if (photo.status !== "stored") throw new Error(photo.status);
  expect((await service.updateMemoryEvent("family", id, "c", { coverAssetId: photo.asset.id })).ok).toBe(false);
});
it("mobile edits carry expected revision and do not overwrite a newer edit", async () => {
  const id = event();
  expect((await patch("a", id, { title: "第一份已保存的修改", expectedRevision: 0, mutationId: randomUUID() })).status).toBe(200);
  expect((await patch("a", id, { title: "不能覆盖的旧输入", expectedRevision: 0, mutationId: randomUUID() })).status).toBe(409);
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, id)).get()?.title).toBe("第一份已保存的修改");
});
it("mobile unknown-date edits retain the unknown precision through HTTP and reopening", async () => {
  const id = event();
  const response = await patch("a", id, { occurredAtPrecision: "unknown", expectedRevision: 0, mutationId: randomUUID() });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ occurredAtPrecision: "unknown", ageLabel: null });
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.occurredAtPrecision).toBe("unknown");
});
it("lost responses retry once, reused keys with different edits conflict, and revocation wins over receipts", async () => {
  const id = event();
  const mutationId = randomUUID();
  const input = { bodyText: "仅修改正文也更新版本", expectedRevision: 0, mutationId };
  expect((await patch("a", id, input)).status).toBe(200);
  const reopened = new Database(path.join(dir, "db/capsule.sqlite"));
  try { expect(reopened.prepare("select result_revision from memory_mutation where mutation_id = ?").get(mutationId)).toEqual({ result_revision: 1 }); }
  finally { reopened.close(); }
  expect((await patch("a", id, input)).status).toBe(200);
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, id)).get()?.titleRevision).toBe(1);
  expect((await patch("a", id, { ...input, bodyText: "相同键不能写新正文" })).status).toBe(409);
  expect((await patch("a", id, { locationText: "过期地点", expectedRevision: 0, mutationId: randomUUID() })).status).toBe(409);
  getDb().update(memoryEvent).set({ deletedAt: new Date() }).where(eq(memoryEvent.id, id)).run();
  expect((await patch("a", id, input)).status).toBe(404);
  expect(getDb().select().from(memoryEvent).where(eq(memoryEvent.id, id)).get()?.bodyText).toBe(input.bodyText);
});
it.each([
  ["exact", "1991-08-04T09:36:12", "1991-08-04T09:36:12.000Z"],
  ["approximate", "1991-08-04T09:36", "1991-08-04T09:36:00.000Z"],
  ["date_only", "1991-08-04", "1991-08-04T00:00:00.000Z"],
  ["month", "1991-08", "1991-08-01T00:00:00.000Z"],
  ["year", "1991", "1991-01-01T00:00:00.000Z"],
])("mobile %s dates use the actual precision input and survive reopening", async (precision, wall, anchor) => {
  const id = event();
  const response = await patch("a", id, { occurredAtPrecision: precision, occurredAtWall: wall, expectedRevision: 0, mutationId: randomUUID() });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ occurredAtPrecision: precision, occurredAt: anchor });
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.occurredAt.toISOString()).toBe(anchor);
});
it("unknown sorting anchors cannot become factual dates by relabelling and malformed wall dates are rejected", async () => {
  const id = event();
  getDb().update(memoryEvent).set({ occurredAtPrecision: "unknown" }).where(eq(memoryEvent.id, id)).run();
  expect((await patch("a", id, { occurredAtPrecision: "exact", expectedRevision: 0, mutationId: randomUUID() })).status).toBe(400);
  expect((await patch("a", id, { occurredAtPrecision: "month", occurredAtWall: "1991-13", expectedRevision: 0, mutationId: randomUUID() })).status).toBe(400);
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.occurredAtPrecision).toBe("unknown");
});
it.each([["year", "month"], ["year", "date_only"], ["month", "exact"], ["date_only", "exact"]])("%s cannot be relabelled as %s without a real input", async (before, after) => {
  const id = event();
  getDb().update(memoryEvent).set({ occurredAtPrecision: before }).where(eq(memoryEvent.id, id)).run();
  expect((await patch("a", id, { occurredAtPrecision: after, expectedRevision: 0, mutationId: randomUUID() })).status).toBe(400);
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.occurredAtPrecision).toBe(before);
});
it("mobile editing cannot bypass revisions or idempotency by omitting fields", async () => {
  const id = event();
  for (const input of [{ title: "绕过版本" }, { title: "绕过版本", mutationId: randomUUID() }, { title: "绕过幂等", expectedRevision: 0 }]) {
    expect((await patch("a", id, input)).status).toBe(400);
  }
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.titleRevision).toBe(0);
});
it("a family editor may keep an existing shared cover but cannot reshare a different read-only original", async () => {
  const { storeOriginal } = await import("@/lib/assets/service");
  const { saveDraft, publishDraft } = await import("@/lib/drafts/service");
  const { emptyDraftContent } = await import("@/lib/drafts/model");
  const create = async () => {
    const photo = await storeOriginal({ familyId: "family", createdByUserId: "a", type: "image", originalFilename: `${randomUUID()}.png`, mimeType: "image/png", extension: "png", buffer: Buffer.concat([readFileSync(path.join(__dirname, "../fixtures/sample.png")), Buffer.from(randomUUID())]), timeSource: "import_time", visibility: "private" });
    if (photo.status !== "stored") throw new Error(photo.status);
    const draftId = randomUUID(); const itemId = randomUUID();
    const saved = saveDraft(ctx("a"), draftId, 0, randomUUID(), { ...emptyDraftContent(), title: "作者显式全家发布", text: "原始正文", visibility: "family", occurredAtPrecision: "unknown", items: [{ id: itemId, assetId: photo.asset.id, localCaptureRef: null, caption: "" }], coverItemId: itemId });
    const published = publishDraft(ctx("a"), draftId, saved.revision);
    return { id: published.memoryEventId!, assetId: photo.asset.id };
  };
  const first = await create(); const second = await create();
  expect((await service.updateMemoryEvent("family", first.id, "b", { bodyText: "家人补充正文", coverAssetId: first.assetId, expectedTitleRevision: 0, mutationId: randomUUID() })).ok).toBe(true);
  expect((await service.updateMemoryEvent("family", first.id, "b", { coverAssetId: second.assetId, expectedTitleRevision: 1, mutationId: randomUUID() })).ok).toBe(false);
});
it("Chinese body text within the editor limit passes the bounded HTTP request reader", async () => {
  const id = event();
  const bodyText = "旧事正文".repeat(6000);
  const response = await patch("a", id, { bodyText, expectedRevision: 0, mutationId: randomUUID() });
  expect(response.status).toBe(200);
  expect(service.getVisibleMemoryEventDetail(ctx("a"), id)?.event.bodyText).toBe(bodyText);
});
