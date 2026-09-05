import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
const root = mkdtempSync(path.join(tmpdir(), "ftc-book-review-"));
process.env.DATA_DIR = root;
process.env.INITIAL_SETUP_TOKEN = "fictional-review";
process.env.AUTH_SECRET = "fictional-review-secret";
delete process.env.AI_API_KEY;
const { getDb, closeDatabase } = await import("@/db");
await (
  await import("@/lib/auth/setup")
).performSetup({
  token: "fictional-review",
  displayName: "虚构回顾管理员",
  email: "book-review@example.test",
  password: "fictional-review-password",
});
const { user, session } = await import("@/db/schema/auth"),
  { memoryEvent } = await import("@/db/schema/memory"),
  { contribution } = await import("@/db/schema/contribution"),
  { story, storyParagraph, storySource } = await import("@/db/schema/story");
const actor = getDb().select().from(user).get()!,
  familyService = await import("@/lib/family/service");
await familyService.completeOnboarding(actor.id, {
  familyName: "虚构回顾家庭",
  timezone: "America/New_York",
  childDisplayName: "小雨",
  childBirthDate: "2024-02-29",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
const binding = await familyService.getUserBinding(actor.id),
  context = {
    ...binding,
    userId: actor.id,
    userName: actor.name,
    familyId: binding.familyId!,
    familyTimezone: binding.familyTimezone!,
    childLaterUnlockAge: binding.childLaterUnlockAge!,
  };
const { createTextInboxItem, getInboxEntry } =
    await import("@/lib/inbox/service"),
  { confirmInboxEntry } = await import("@/lib/memories/service");
const ids: string[] = [];
for (let i = 0; i < 5; i++) {
  const note = await createTextInboxItem(
      context.familyId,
      `虚构第 ${i + 1} 封家书，原文保留。`,
    ),
    entry = await getInboxEntry(context.familyId, note.id),
    confirmed = await confirmInboxEntry(context.familyId, entry!, {
      title: `虚构第一周记忆 ${i + 1}`,
      occurredAt: new Date(`2024-03-0${i + 1}T04:30:00Z`),
    });
  if (!confirmed.ok) throw Error("confirm");
  ids.push(confirmed.eventId);
}
const privateId = randomUUID(),
  familyVoice = randomUUID();
getDb()
  .insert(contribution)
  .values([
    {
      id: privateId,
      memoryEventId: ids[0]!,
      authorPersonId: context.personId!,
      rawText: "私密家书绝不进入家庭回顾",
      visibility: "private",
    },
    {
      id: familyVoice,
      memoryEventId: ids[0]!,
      authorPersonId: context.personId!,
      rawText: "爸爸的虚构家庭来信",
      visibility: "family",
    },
  ])
  .run();
const storyId = randomUUID(),
  paragraphId = randomUUID();
getDb()
  .insert(story)
  .values({
    id: storyId,
    familyId: context.familyId,
    kind: "weekly",
    title: "已发布的虚构周记",
    status: "published",
    periodStart: new Date("2024-02-29T05:00:00Z"),
    periodEnd: new Date("2024-03-07T05:00:00Z"),
  })
  .run();
getDb()
  .insert(storyParagraph)
  .values({
    id: paragraphId,
    familyId: context.familyId,
    storyId,
    position: 0,
    kind: "narrative",
    text: "手写的虚构周记正文",
  })
  .run();
getDb()
  .insert(storySource)
  .values({
    id: randomUUID(),
    familyId: context.familyId,
    paragraphId,
    sourceType: "user_text",
    sourceId: null,
  })
  .run();
const review = await import("@/lib/books/projects/review"),
  books = await import("@/lib/books/projects/service"),
  collections = await import("@/lib/collections/service"),
  { bookReviewRange, earlyBookRanges } =
    await import("@/mobile/src/books/review-types");
const range = { startDate: "2024-02-29", endDate: "2024-03-06" };
const token = randomUUID();
getDb()
  .insert(session)
  .values({
    id: randomUUID(),
    userId: actor.id,
    token,
    expiresAt: new Date(Date.now() + 3600000),
  })
  .run();
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const api = await import("@/app/api/books/review/route");
afterAll(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
});
it("family calendar ranges distinguish leap months and real DST hours; review counts track occurredAt and live dates", () => {
  expect(bookReviewRange("2024-02")).toEqual({
    startDate: "2024-02-01",
    endDate: "2024-02-29",
  });
  expect(
    earlyBookRanges("2024-01-31").find((r) => r.label === "出生第一个月")
      ?.endDate,
  ).toBe("2024-02-28");
  const before = review.getBookReview(context, range);
  expect(before.total).toBe(5);
  expect(before.months).toEqual([
    { month: "2024-02", count: 1 },
    { month: "2024-03", count: 4 },
  ]);
  const march = review.getBookReview(context, bookReviewRange("2024-03"));
  const row = getDb().get<{ lo: number; hi: number }>(
    sql`select period_start lo,period_end hi from review_period where id=${march.periodId}`,
  )!;
  expect((row.hi - row.lo) / 3600).toBe(31 * 24 - 1);
  getDb()
    .update(memoryEvent)
    .set({ occurredAt: new Date("2024-02-28T20:00:00Z") })
    .where(eq(memoryEvent.id, ids[4]!))
    .run();
  expect(review.getBookReview(context, range).total).toBe(4);
  getDb()
    .update(memoryEvent)
    .set({ occurredAt: new Date("2024-03-05T04:30:00Z") })
    .where(eq(memoryEvent.id, ids[4]!))
    .run();
});
it("real highlight API reuses ReviewPeriod and resumes the same draft without overwriting edits; new sources only prompt", async () => {
  const response = await api.POST(
    new Request("http://localhost/api/books/review", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...range,
        operation: "highlight",
        id: ids[0],
        selected: true,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const overview = review.getBookReview(context, range);
  expect(overview.selectedCount).toBe(1);
  expect(
    getDb().get<{ n: number }>(
      sql`select count(*) n from review_period_event where review_period_id=${overview.periodId}`,
    )?.n,
  ).toBe(1);
  const created = review.createBookFromReview(context, range);
  let book = books.getBookProject(context, created.id);
  expect(
    book.sources.filter((s) => s.kind === "memory").map((s) => s.memoryEventId),
  ).toEqual([ids[0]]);
  book = books.saveBookProject(context, book.id, book.revision, {
    ...book,
    subtitle: "人工编辑不被覆盖",
  });
  expect(
    review.createBookFromReview(context, range, [
      { kind: "memory", id: ids[1] },
    ]),
  ).toEqual({ id: book.id, existing: true });
  expect(books.getBookProject(context, book.id).subtitle).toBe(
    "人工编辑不被覆盖",
  );
  expect(review.getBookReview(context, range).draft?.newMemoryCount).toBe(4);
  const copy = books.copyBookProject(context, book.id, book.revision);
  expect(copy.id).not.toBe(book.id);
  expect(copy.subtitle).toBe(book.subtitle);
  expect(copy.sources.map((s) => s.memoryEventId)).toEqual(
    book.sources.map((s) => s.memoryEventId),
  );
  expect(copy.blocks[0]?.id).not.toBe(book.blocks[0]?.id);
  const finished = books.setBookFinished(context, book.id, book.revision, true);
  const next = review.createBookFromReview(context, range);
  expect(next.id).not.toBe(book.id);
  expect(() =>
    books.setBookFinished(context, book.id, finished.revision, false),
  ).toThrow("draft_exists");
});
it("year drafts have twelve month chapters, empty months stay empty, and family letters exclude private sources atomically", () => {
  const voices = review.getBookReview(context, {
    ...range,
    kind: "contribution",
  });
  expect(voices.materials.map((s) => s.id)).toEqual([familyVoice]);
  expect(
    review
      .getBookReview(context, { ...range, kind: "story" })
      .materials.map((s) => s.id),
  ).toEqual([storyId]);
  const options = { ...bookReviewRange("2024"), template: "letters" as const };
  const before = getDb().get<{ n: number }>(
    sql`select count(*) n from book_project`,
  )!.n;
  expect(() =>
    review.createBookFromReview(context, options, [
      { kind: "contribution", id: familyVoice },
      { kind: "contribution", id: privateId },
    ]),
  ).toThrow("source_unavailable");
  expect(
    getDb().get<{ n: number }>(sql`select count(*) n from book_project`)!.n,
  ).toBe(before);
  const created = review.createBookFromReview(context, options, [
      { kind: "contribution", id: familyVoice },
      { kind: "story", id: storyId },
    ]),
    book = books.getBookProject(context, created.id);
  expect(book.chapters).toHaveLength(12);
  expect(book.blocks.some((b) => b.text.includes("爸爸的虚构家庭来信"))).toBe(
    true,
  );
  expect(JSON.stringify(book)).not.toContain("私密家书绝不");
  expect(
    book.blocks.filter((b) => b.chapterId === book.chapters[0]?.id),
  ).toHaveLength(0);
  expect(book.blocks.some((b) => b.text.includes("手写的虚构周记正文"))).toBe(
    true,
  );
});

it("stable cursor pages exclude sealed and soft-deleted memories, including counts and unauthorized material requests", async () => {
  const { capsule, capsuleEvent } = await import("@/db/schema/capsule");
  const row = getDb()
    .select()
    .from(memoryEvent)
    .where(eq(memoryEvent.id, ids[0]!))
    .get()!;
  const samples = Array.from({ length: 33 }, (_, i) => ({
    ...row,
    id: randomUUID(),
    title: `虚构同刻分页 ${i}`,
    occurredAt: new Date("2024-07-01T05:00:00Z"),
    deletedAt: i === 32 ? new Date() : null,
  }));
  getDb().insert(memoryEvent).values(samples).run();
  const capsuleId = randomUUID();
  getDb()
    .insert(capsule)
    .values({
      id: capsuleId,
      familyId: context.familyId,
      title: "未来才读的虚构记录",
      unlockType: "date",
      unlockValue: "2099-01-01",
      status: "sealed",
    })
    .run();
  getDb()
    .insert(capsuleEvent)
    .values({
      id: randomUUID(),
      familyId: context.familyId,
      capsuleId,
      memoryEventId: samples[0]!.id,
    })
    .run();
  const options = bookReviewRange("2024-07"),
    first = review.getBookReview(context, options),
    second = review.getBookReview(context, {
      ...options,
      cursor: first.nextCursor,
    });
  expect(first.total).toBe(31);
  expect(first.materials).toHaveLength(30);
  expect(second.materials).toHaveLength(1);
  expect(
    new Set([...first.materials, ...second.materials].map((r) => r.id)).size,
  ).toBe(31);
  expect(second.nextCursor).toBeNull();
  expect(() =>
    review.createBookFromReview(context, options, [
      { kind: "memory", id: samples[0]!.id },
    ]),
  ).toThrow("source_unavailable");
  const foreign = randomUUID(),
    foreignToken = randomUUID();
  getDb()
    .insert(user)
    .values({
      id: foreign,
      name: "另一虚构管理员",
      email: "foreign-review@example.test",
      role: "admin",
    })
    .run();
  await familyService.completeOnboarding(foreign, {
    familyName: "另一家庭",
    timezone: "Asia/Shanghai",
    childDisplayName: "小月",
    childBirthDate: "2024-01-31",
    selfDisplayName: "妈妈",
    selfRelationToChild: "妈妈",
  });
  getDb()
    .insert(session)
    .values({
      id: randomUUID(),
      userId: foreign,
      token: foreignToken,
      expiresAt: new Date(Date.now() + 3600000),
    })
    .run();
  const denied = await api.POST(
    new Request("http://localhost/api/books/review", {
      method: "POST",
      headers: {
        authorization: `Bearer ${foreignToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...options,
        operation: "draft",
        selection: [{ kind: "memory", id: samples[1]!.id }],
      }),
    }),
  );
  expect(denied.status).toBe(403);
});

it("five confirmed memories become a durable ordered album draft; date edits update its live source and review", () => {
  const originalCount = getDb().get<{n:number}>(sql`select count(*) n from memory_event`)!.n;
  const created = review.createAlbumFromReview(
    context,
    range,
    ids.map((id) => ({ kind: "memory", id })),
  );
  let album = collections.getCollection(context, created.id);
  expect(album.items).toHaveLength(5);
  album = collections.saveCollection(context, album.id, album.revision, {
    ...album,
    items: [...album.items].reverse(),
  });
  closeDatabase();
  expect(
    collections
      .getCollection(context, album.id)
      .items.map((i) => i.memoryEventId),
  ).toEqual([...ids].reverse());
  getDb()
    .update(memoryEvent)
    .set({ occurredAt: new Date("2025-01-01T05:01:00Z") })
    .where(eq(memoryEvent.id, ids[4]!))
    .run();
  expect(
    collections.getCollection(context, album.id).items[0]?.source?.occurredAt,
  ).toBe("2025-01-01T05:01:00.000Z");
  expect(review.getBookReview(context, range).total).toBe(4);
  expect(
    getDb().get<{ n: number }>(sql`select count(*) n from memory_event`)!.n,
  ).toBe(originalCount);
});

it("review draft keys, completed copies and highlights survive independent restore without creating a second unfinished book", async () => {
  const before=(await import("@/lib/books/projects/archive")).collectBookArchive(context.familyId);
  const current=review.getBookReview(context,range),backup=await(await import("@/lib/export/service")).buildFamilyExport(context.familyId),bytes=readFileSync(backup.filePath);
  closeDatabase();process.env.DATA_DIR=path.join(root,"restored-review");vi.resetModules();const restored=await import("@/db");
  try {
    await(await import("@/lib/auth/setup")).performSetup({token:"fictional-review",displayName:"恢复虚构管理员",email:"restored-review@example.test",password:"fictional-review-password"});
    const actor=restored.getDb().select().from((await import("@/db/schema/auth")).user).get()!;
    await(await import("@/lib/restore/service")).restoreFromZip(bytes,actor.id);
    expect((await import("@/lib/books/projects/archive")).collectBookArchive(context.familyId)).toEqual(before);
    const family=await import("@/lib/family/service");expect((await family.bindRestoredFamily(actor.id,context.personId!)).ok).toBe(true);
    const nextContext={...context,...await family.getUserBinding(actor.id),userId:actor.id,userName:actor.name,familyId:context.familyId,familyTimezone:context.familyTimezone,childLaterUnlockAge:context.childLaterUnlockAge};
    const nextReview=await import("@/lib/books/projects/review"),overview=nextReview.getBookReview(nextContext,range);
    expect(overview.selectedCount).toBe(current.selectedCount);expect(overview.draft?.id).toBe(current.draft?.id);expect(nextReview.createBookFromReview(nextContext,range)).toEqual({id:current.draft!.id,existing:true});
    const again=await(await import("@/lib/export/service")).buildFamilyExport(context.familyId);expect(readFileSync(again.filePath).length).toBeGreaterThan(0);
  } finally {restored.closeDatabase();process.env.DATA_DIR=root;}
});
