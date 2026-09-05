import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, expect, it } from "vitest";
const root = mkdtempSync(path.join(tmpdir(), "ftc-book-projects-"));
process.env.DATA_DIR = root;
process.env.INITIAL_SETUP_TOKEN = "book-test-setup";
process.env.AUTH_SECRET = "book-test-secret";
const { getDb, closeDatabase } = await import("@/db");
const { performSetup } = await import("@/lib/auth/setup");
await performSetup({
  token: "book-test-setup",
  displayName: "虚构爸爸",
  email: "book-dad@example.test",
  password: "book-test-password",
});
const { user, session } = await import("@/db/schema/auth");
const { person, family } = await import("@/db/schema/family");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { contribution } = await import("@/db/schema/contribution");
const { completeOnboarding, getUserBinding } =
  await import("@/lib/family/service");
const actor = getDb().select().from(user).get()!;
await completeOnboarding(actor.id, {
  familyName: "虚构年册家庭",
  timezone: "America/New_York",
  childDisplayName: "小雨",
  childBirthDate: "2024-02-29",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
const binding = await getUserBinding(actor.id),
  context = {
    ...binding,
    userId: actor.id,
    userName: actor.name,
    familyId: binding.familyId!,
    familyTimezone: binding.familyTimezone!,
    childLaterUnlockAge: binding.childLaterUnlockAge!,
  };
const mom = randomUUID();
getDb()
  .insert(person)
  .values({
    id: mom,
    familyId: context.familyId,
    displayName: "虚构妈妈",
    isGuardian: true,
  })
  .run();
const { createTextInboxItem, getInboxEntry } =
  await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const books = await import("@/lib/books/projects/service");
const { addBookSelections } = await import("@/lib/books/projects/select");
const { POST } = await import("@/app/api/books/projects/route");
const { GET, PATCH } = await import("@/app/api/books/projects/[id]/route");
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
const events: string[] = [];
for (let i = 0; i < 4; i++) {
  const note = await createTextInboxItem(
      context.familyId,
      `虚构家庭原文 ${i}：春天，我们在窗边读了一封信。`,
    ),
    entry = await getInboxEntry(context.familyId, note.id);
  const confirmed = await confirmInboxEntry(context.familyId, entry!, {
    title: `家庭片段 ${i}`,
    occurredAt: new Date(`2024-03-0${i + 1}T05:30:00Z`),
  });
  if (!confirmed.ok) throw new Error("confirm");
  events.push(confirmed.eventId);
  const image = await ingestImage({
    familyId: context.familyId,
    createdByUserId: actor.id,
    filename: `fictional-book-${i}.jpg`,
    declaredMime: "image/jpeg",
    buffer: await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 120 + i * 20, g: 140, b: 110 },
      },
    })
      .jpeg()
      .toBuffer(),
  });
  if (image.status !== "stored") throw new Error("image");
  getDb()
    .insert(memoryEventAsset)
    .values({
      id: randomUUID(),
      familyId: context.familyId,
      memoryEventId: confirmed.eventId,
      assetId: image.asset.id,
    })
    .run();
}
const publicId = randomUUID(),
  privateId = randomUUID();
getDb()
  .insert(contribution)
  .values([
    {
      id: publicId,
      memoryEventId: events[0]!,
      authorPersonId: mom,
      rawText: "妈妈给全家的一封信。",
      visibility: "family",
    },
    {
      id: privateId,
      memoryEventId: events[0]!,
      authorPersonId: context.personId!,
      rawText: "爸爸不公开的私密原话。",
      visibility: "private",
    },
  ])
  .run();
afterAll(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
});
it("three actual templates build different editable content and retain manual text, image focus, order and saved revisions", async () => {
  const kinds: string[][] = [];
  for (const template of ["photos", "growth", "letters"] as const) {
    const id = books.createBookProject(
      context,
      `虚构${template}`,
      template,
      "family",
    );
    let doc = addBookSelections(context, id, 1, [
      { kind: "memory", id: events[0] },
    ]);
    kinds.push(doc.blocks.map((b) => b.kind));
    expect(JSON.stringify(doc)).not.toContain("爸爸不公开的私密原话");
    const first = doc.blocks[0]!;
    doc = books.saveBookProject(context, id, doc.revision, {
      ...doc,
      subtitle: "手工副标题",
      blocks: doc.blocks.map((b, i) =>
        i
          ? b
          : {
              ...b,
              text: "我保留的手工编辑",
              layout: {
                ...b.layout,
                fit: "cover",
                focus: [{ x: 0.2, y: 0.7 }, ...b.layout.focus.slice(1)],
              },
            },
      ),
    });
    books.saveBookVersion(context, id, doc.revision);
    const revision = doc.revision;
    const reopened = (await import("@/db")).openDatabaseConnection({
      databasePath: path.join(root, "db", "capsule.sqlite"),
      migrationsFolder: path.join(process.cwd(), "db", "migrations"),
      snapshotDirectory: path.join(root, "reopen-snapshots"),
    });
    expect(
      reopened.db
        .select()
        .from((await import("@/db/schema/book")).bookBlock)
        .where(eq((await import("@/db/schema/book")).bookBlock.id, first.id))
        .get()?.text,
    ).toBe("我保留的手工编辑");
    reopened.sqlite.close();
    doc = books.getBookProject(context, id);
    expect(doc.subtitle).toBe("手工副标题");
    expect(doc.blocks[0]?.text).toBe("我保留的手工编辑");
    expect(doc.blocks[0]?.layout.focus[0]).toEqual({ x: 0.2, y: 0.7 });
    doc = books.saveBookProject(context, id, doc.revision, {
      ...doc,
      blocks: [...doc.blocks].reverse(),
    });
    expect(doc.blocks.at(-1)?.id).toBe(first.id);
    expect(books.getBookVersion(context, id, revision).blocks[0]?.text).toBe(
      "我保留的手工编辑",
    );
  }
  expect(kinds).toEqual([["image"], ["date", "text", "image"], ["quote"]]);
});
it("family selection rejects private sources atomically; personal projects are isolated even from another administrator", async () => {
  const familyId = books.createBookProject(
    context,
    "家庭来信",
    "letters",
    "family",
  );
  expect(() =>
    addBookSelections(context, familyId, 1, [
      { kind: "contribution", id: publicId },
      { kind: "contribution", id: privateId },
    ]),
  ).toThrow("source_unavailable");
  expect(books.getBookProject(context, familyId).blocks).toHaveLength(0);
  expect(books.getBookProject(context, familyId).revision).toBe(1);
  const personalId = books.createBookProject(
    context,
    "私人来信",
    "letters",
    "personal",
  );
  const personal = addBookSelections(context, personalId, 1, [
    { kind: "contribution", id: privateId },
  ]);
  expect(personal.blocks[0]?.text).toBe("爸爸不公开的私密原话。");
  const otherUser = randomUUID();
  getDb()
    .insert(user)
    .values({
      id: otherUser,
      name: "虚构妈妈管理员",
      email: "mom-book@example.test",
      familyId: context.familyId,
      personId: mom,
      role: "admin",
    })
    .run();
  const ctx = {
    ...context,
    userId: otherUser,
    userName: "妈妈",
    personId: mom,
    isGuardian: true,
  };
  expect(() => books.getBookProject(ctx, personalId)).toThrow("not_found");
  expect(
    books.listBookProjects(ctx).entries.some((b) => b.id === personalId),
  ).toBe(false);
  const foreign = randomUUID();
  getDb().insert(family).values({ id: foreign, name: "另一虚构家庭" }).run();
  expect(() =>
    books.getBookProject({ ...context, familyId: foreign }, familyId),
  ).toThrow("forbidden");
});
it("API optimistic conflicts preserve stored state and source changes redact current and saved previews without overwriting manual edits", async () => {
  const response = await POST(
    new Request("http://localhost/api/books/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "可持续编辑年册",
        template: "letters",
        audience: "family",
      }),
    }),
  );
  expect(response.status).toBe(201);
  const { id } = await response.json();
  let doc = addBookSelections(context, id, 1, [
    { kind: "contribution", id: publicId },
  ]);
  doc = books.saveBookProject(context, id, doc.revision, {
    ...doc,
    blocks: doc.blocks.map((b) => ({ ...b, text: "人工整理后的妈妈来信" })),
  });
  books.saveBookVersion(context, id, doc.revision);
  const snapshotRevision = doc.revision;
  const stale = await PATCH(
    new Request(`http://localhost/api/books/projects/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        operation: "save",
        revision: 1,
        edit: { ...doc, title: "过期覆盖" },
      }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(stale.status).toBe(409);
  expect(books.getBookProject(context, id).title).toBe("可持续编辑年册");
  getDb()
    .update(contribution)
    .set({ rawText: "来源原文有新增", updatedAt: new Date() })
    .where(eq(contribution.id, publicId))
    .run();
  doc = books.getBookProject(context, id);
  expect(doc.warnings.some((w) => w.code === "source_changed")).toBe(true);
  expect(doc.blocks[0]?.text).toBe("人工整理后的妈妈来信");
  getDb()
    .update(contribution)
    .set({ visibility: "private" })
    .where(eq(contribution.id, publicId))
    .run();
  const preview = await GET(
    new Request(`http://localhost/api/books/projects/${id}`, { headers }),
    { params: Promise.resolve({ id }) },
  );
  expect(preview.status).toBe(200);
  const hidden = await preview.json();
  expect(hidden.blockedBlockIds).toHaveLength(1);
  expect(JSON.stringify(hidden)).not.toContain("人工整理后的妈妈来信");
  expect(
    JSON.stringify(books.getBookVersion(context, id, snapshotRevision)),
  ).not.toContain("人工整理后的妈妈来信");
  books.saveBookProject(context, id, hidden.revision, {
    ...hidden,
    subtitle: "来源受限时仍能整理作品信息",
  });
  getDb()
    .update(contribution)
    .set({ visibility: "family" })
    .where(eq(contribution.id, publicId))
    .run();
  expect(books.getBookProject(context, id).blocks[0]?.text).toBe(
    "人工整理后的妈妈来信",
  );
});
it("family publications deny private derivative-linked audio and sealed capsule images", async () => {
  const { asset } = await import("@/db/schema/asset"),
    { capsule, capsuleAsset } = await import("@/db/schema/capsule");
  const original = getDb()
    .select()
    .from(asset)
    .where(eq(asset.type, "image"))
    .get()!;
  const derivative = randomUUID();
  getDb()
    .insert(asset)
    .values({
      ...original,
      id: derivative,
      sha256: "d".repeat(64),
      originalAssetId: original.id,
      derivativeType: "preview",
    })
    .run();
  const { createBookSourceResolver } =
    await import("@/lib/books/projects/sources");
  getDb()
    .update(contribution)
    .set({ audioAssetId: derivative })
    .where(eq(contribution.id, privateId))
    .run();
  expect(
    createBookSourceResolver(context, "family")("asset", original.id).state
      .available,
  ).toBe(false);
  getDb()
    .update(contribution)
    .set({ audioAssetId: null })
    .where(eq(contribution.id, privateId))
    .run();
  const capsuleId = randomUUID();
  getDb()
    .insert(capsule)
    .values({
      id: capsuleId,
      familyId: context.familyId,
      title: "未到期虚构胶囊",
      unlockType: "date",
      unlockValue: "2099-01-01",
      status: "sealed",
    })
    .run();
  getDb()
    .insert(capsuleAsset)
    .values({
      id: randomUUID(),
      familyId: context.familyId,
      capsuleId,
      assetId: derivative,
    })
    .run();
  expect(
    createBookSourceResolver(context, "family")("asset", original.id).state
      .available,
  ).toBe(false);
  getDb().delete(capsule).where(eq(capsule.id, capsuleId)).run();
  getDb().delete(asset).where(eq(asset.id, derivative)).run();
});
it("historical source refs remain recoverable after permanent source removal", async () => {
  const sourceId = randomUUID();
  getDb()
    .insert(contribution)
    .values({
      id: sourceId,
      memoryEventId: events[2]!,
      authorPersonId: mom,
      rawText: "稍后彻底移除的虚构讲述",
      visibility: "family",
    })
    .run();
  const id = books.createBookProject(
    context,
    "历史来源墓碑",
    "letters",
    "family",
  );
  const doc = addBookSelections(context, id, 1, [
    { kind: "contribution", id: sourceId },
  ]);
  books.saveBookVersion(context, id, doc.revision);
  getDb().delete(contribution).where(eq(contribution.id, sourceId)).run();
  expect(
    books.getBookVersion(context, id, doc.revision).blockedBlockIds,
  ).toHaveLength(1);
  expect(
    books
      .getBookVersion(context, id, doc.revision)
      .sources.find((s) => s.kind === "contribution")?.contributionId,
  ).toBeNull();
});
it("complete archive restores editing, retained historical sources and tombstones in an independent directory; broken graphs fail before writes", async () => {
  const { vi } = await import("vitest"),
    { readFileSync } = await import("node:fs"),
    { spawnSync } = await import("node:child_process"),
    JSZip = (await import("jszip")).default;
  const { story, storyParagraph, storySource } =
    await import("@/db/schema/story");
  const storyId = randomUUID(),
    paragraphId = randomUUID();
  getDb()
    .insert(story)
    .values({
      id: storyId,
      familyId: context.familyId,
      title: "已发表虚构故事",
      kind: "monthly",
      status: "published",
      periodStart: new Date("2024-03-01"),
      periodEnd: new Date("2024-04-01"),
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
      text: "从真实原文整理的虚构故事。",
    })
    .run();
  getDb()
    .insert(storySource)
    .values({
      id: randomUUID(),
      familyId: context.familyId,
      paragraphId,
      sourceType: "contribution",
      sourceId: publicId,
    })
    .run();
  const id = books.createBookProject(context, "可恢复来源", "growth", "family");
  let doc = addBookSelections(context, id, 1, [
    { kind: "story", id: storyId },
    { kind: "memory", id: events[1] },
  ]);
  books.saveBookVersion(context, id, doc.revision);
  doc = books.saveBookProject(context, id, doc.revision, {
    ...doc,
    blocks: doc.blocks.filter(
      (b) =>
        !b.sourceIds.some(
          (s) => doc.sources.find((r) => r.id === s)?.storyId === storyId,
        ),
    ),
  });
  getDb()
    .update(story)
    .set({ deletedAt: new Date() })
    .where(eq(story.id, storyId))
    .run();
  getDb()
    .update(contribution)
    .set({ deletedAt: new Date() })
    .where(eq(contribution.id, publicId))
    .run();
  getDb()
    .update(memoryEvent)
    .set({ deletedAt: new Date() })
    .where(eq(memoryEvent.id, events[0]!))
    .run();
  const archive = await import("@/lib/books/projects/archive"),
    graph = archive.collectBookArchive(context.familyId);
  const backup = await (
    await import("@/lib/export/service")
  ).buildFamilyExport(context.familyId);
  const bytes = readFileSync(backup.filePath);
  closeDatabase();
  process.env.DATA_DIR = path.join(root, "independent-restore");
  vi.resetModules();
  const restoredDb = await import("@/db"),
    setup = await import("@/lib/auth/setup");
  try {
    await setup.performSetup({
      token: "book-test-setup",
      displayName: "恢复管理员",
      email: "restored@example.test",
      password: "book-test-password",
    });
    const authSchema = await import("@/db/schema/auth"),
      admin = restoredDb.getDb().select().from(authSchema.user).get()!,
      restore = await import("@/lib/restore/service");
    const broken = await JSZip.loadAsync(bytes),
      prefix = "family-time-capsule-export/";
    const refs = JSON.parse(
      await broken.file(`${prefix}book-source-refs.json`)!.async("string"),
    );
    refs[0].projectId = randomUUID();
    broken.file(`${prefix}book-source-refs.json`, JSON.stringify(refs));
    await expect(
      restore.restoreFromZip(
        await broken.generateAsync({ type: "nodebuffer" }),
        admin.id,
      ),
    ).rejects.toThrow("年册编辑与历史版本关系图无效");
    expect(
      restoredDb
        .getDb()
        .select()
        .from((await import("@/db/schema/family")).family)
        .all(),
    ).toHaveLength(0);
    const missing = await JSZip.loadAsync(bytes);
    missing.remove(`${prefix}book-revisions.json`);
    await expect(
      restore.restoreFromZip(
        await missing.generateAsync({ type: "nodebuffer" }),
        admin.id,
      ),
    ).rejects.toThrow("年册关系文件不完整");
    await restore.restoreFromZip(bytes, admin.id);
    expect(
      (await import("@/lib/books/projects/archive")).collectBookArchive(
        context.familyId,
      ),
    ).toEqual(graph);
    expect(
      restoredDb
        .getDb()
        .select()
        .from((await import("@/db/schema/contribution")).contribution)
        .where(
          eq(
            (await import("@/db/schema/contribution")).contribution.id,
            publicId,
          ),
        )
        .get()?.deletedAt,
    ).not.toBeNull();
    expect(
      restoredDb
        .getDb()
        .select()
        .from((await import("@/db/schema/story")).story)
        .where(eq((await import("@/db/schema/story")).story.id, storyId))
        .get()?.deletedAt,
    ).not.toBeNull();
    const familyService = await import("@/lib/family/service");
    expect(
      (await familyService.bindRestoredFamily(admin.id, context.personId!)).ok,
    ).toBe(true);
    const restoredContext = {
      ...context,
      ...(await familyService.getUserBinding(admin.id)),
      userId: admin.id,
      userName: admin.name,
      familyId: context.familyId,
      familyTimezone: context.familyTimezone,
      childLaterUnlockAge: context.childLaterUnlockAge,
    };
    expect(
      (await import("@/lib/books/projects/service")).getBookProject(
        restoredContext,
        id,
      ).blocks,
    ).toEqual(doc.blocks);
    const second = await (
        await import("@/lib/export/service")
      ).buildFamilyExport(context.familyId),
      zip = await JSZip.loadAsync(readFileSync(second.filePath)),
      first = await JSZip.loadAsync(bytes);
    for (const name of (await import("@/lib/books/projects/portable.mjs"))
      .BOOK_FILES)
      expect(
        JSON.parse(await zip.file(prefix + name)!.async("string")),
      ).toEqual(JSON.parse(await first.file(prefix + name)!.async("string")));
    expect(
      JSON.parse(
        await zip.file(prefix + "manifest.json")!.async("string"),
      ).assets.map((a: { assetId: string; sha256: string }) => [
        a.assetId,
        a.sha256,
      ]),
    ).toEqual(
      JSON.parse(
        await first.file(prefix + "manifest.json")!.async("string"),
      ).assets.map((a: { assetId: string; sha256: string }) => [
        a.assetId,
        a.sha256,
      ]),
    );
    const verified = spawnSync(
      process.execPath,
      ["scripts/verify-export.mjs", second.filePath],
      { encoding: "utf8" },
    );
    expect(verified.status, verified.stdout + verified.stderr).toBe(0);
  } finally {
    restoredDb.closeDatabase();
  }
});
