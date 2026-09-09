import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "ftc-simplified-works-"));
process.env.DATA_DIR = directory;
process.env.AUTH_SECRET = "simplification-fixture-secret-only";
process.env.INITIAL_SETUP_TOKEN = "simplification-setup";
const { getDb, closeDatabase } = await import("@/db");
const { performSetup } = await import("@/lib/auth/setup");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const { bookProject } = await import("@/db/schema/book");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { saveDraft, publishDraft } = await import("@/lib/drafts/service");
const { emptyDraftContent } = await import("@/lib/drafts/model");
const { createWork } = await import("@/lib/books/projects/create-work");
const books = await import("@/lib/books/projects/service");
const { getCollection } = await import("@/lib/collections/service");
const { POST } = await import("@/app/api/works/route");
expect((await performSetup({ token: "simplification-setup", displayName: "记录者", email: "works@fixture.invalid", password: "fictional-password" })).ok).toBe(true);
const actor = getDb().select().from(user).get()!;
await completeOnboarding(actor.id, { familyName: "测试家庭", timezone: "Asia/Shanghai", childDisplayName: "", childBirthDate: "", selfDisplayName: "记录者", selfRelationToChild: "家人" });
const binding = await getUserBinding(actor.id);
const context = { ...binding, userId: actor.id, userName: actor.name, familyId: binding.familyId!, familyTimezone: binding.familyTimezone!, childLaterUnlockAge: binding.childLaterUnlockAge! };
const draft = saveDraft(context, randomUUID(), 0, randomUUID(), { ...emptyDraftContent(), text: "今天在窗边一起读书", occurredAt: "2026-09-04T08:00:00Z" });
const memoryId = publishDraft(context, draft.id, draft.revision).memoryEventId!;
afterAll(() => { closeDatabase(); rmSync(directory, { recursive: true, force: true }); });

it("creates both works directly from saved memories, including an album-to-book path", () => {
  const album = createWork(context, { kind: "album", selection: [{ kind: "memory", id: memoryId }] });
  const detail = getCollection(context, album.id);
  expect(detail.items.map(item => item.memoryEventId)).toEqual([memoryId]);
  expect(detail.title).toBeTruthy();
  const book = createWork(context, { kind: "book", selection: [{ kind: "collection", id: album.id }] });
  const project = books.getBookProject(context, book.id);
  expect(project.blocks.some(block => block.text.includes("今天在窗边一起读书"))).toBe(true);
  expect(project.versions.some(version => version.revision === project.revision)).toBe(true);
  expect(project.sources.map(source => source.kind)).not.toContain("story");
  expect(getDb().select().from(memoryEvent).all()).toHaveLength(1);
});

it("rechecks every selection and rolls back a mixed unavailable batch", () => {
  const before = getDb().select().from(bookProject).all();
  expect(() => createWork(context, { kind: "book", selection: [{ kind: "memory", id: memoryId }, { kind: "memory", id: randomUUID() }] })).toThrow("source_unavailable");
  expect(() => createWork(context, { kind: "book", selection: [] })).toThrow("invalid_selection");
  expect(() => createWork(context, { kind: "book", selection: [{kind:"story",id:randomUUID()}] })).toThrow("invalid_selection");
  expect(getDb().select().from(bookProject).all()).toEqual(before);
});

it("restores a layout with an undo snapshot and rejects stale or newly unreadable restoration", () => {
  const { id } = createWork(context, { kind: "book", selection: [{ kind: "memory", id: memoryId }] });
  const initial = books.getBookProject(context, id);
  const changed = books.saveBookProject(context, id, initial.revision, { ...initial, title: "我亲手改的标题" });
  const restored = books.restoreBookVersion(context, id, changed.revision, initial.revision);
  expect(restored.title).toBe(initial.title);
  expect(books.getBookVersion(context, id, changed.revision).title).toBe("我亲手改的标题");
  expect(() => books.restoreBookVersion(context, id, changed.revision, initial.revision)).toThrow("revision_conflict");
  getDb().update(memoryEvent).set({ visibility: "private", createdByUserId: actor.id }).where(eq(memoryEvent.id, memoryId)).run();
  expect(() => books.restoreBookVersion(context, id, restored.revision, initial.revision)).toThrow("source_unavailable");
  expect(books.getBookProject(context, id).revision).toBe(restored.revision);
  getDb().update(memoryEvent).set({ visibility: "family" }).where(eq(memoryEvent.id, memoryId)).run();
});

it("does not copy a private memory title into the family-visible album name", () => {
  getDb().update(memoryEvent).set({ visibility: "private", title: "只给自己看的标题" }).where(eq(memoryEvent.id, memoryId)).run();
  try {
    const { id } = createWork(context, { kind: "album", selection: [{ kind: "memory", id: memoryId }] });
    expect(getCollection(context, id).title).toBe("家庭记忆 · 相册");
    expect(getCollection(context, id).items[0]?.source?.title).toBe("只给自己看的标题");
  } finally {
    getDb().update(memoryEvent).set({ visibility: "family", title: "一段家庭记忆" }).where(eq(memoryEvent.id, memoryId)).run();
  }
});

it("accepts native bearer creation and rejects a viewer or client-selected family", async () => {
  const token = randomUUID();
  getDb().insert(session).values({ id: randomUUID(), token, userId: actor.id, expiresAt: new Date(Date.now() + 60000) }).run();
  const request = (extra = {}) => new Request("http://localhost/api/works", {method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({kind:"album",selection:[{kind:"memory",id:memoryId}],...extra})});
  expect((await POST(request())).status).toBe(201);
  expect((await POST(request({familyId:"foreign"}))).status).toBe(400);
  getDb().insert(user).values({ ...actor, id: randomUUID(), email: "second-owner@fixture.invalid", name: "备用管理员", familyId: context.familyId, role: "admin" }).run();
  getDb().update(user).set({role:"viewer"}).where(eq(user.id,actor.id)).run();
  expect((await POST(request())).status).toBe(403);
});
