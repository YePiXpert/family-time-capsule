import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { eq, isNull } from "drizzle-orm";
import JSZip from "jszip";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import type { FamilyContext } from "@/lib/family/context";
const root = mkdtempSync(path.join(tmpdir(), "ftc-collections-roundtrip-"));
process.env.INITIAL_SETUP_TOKEN = "collections-token";
process.env.AUTH_SECRET = "collections-test-secret";
const closers: (() => void)[] = [];
afterAll(() => {
  for (const close of closers) close();
  rmSync(root, { recursive: true, force: true });
});
async function open(name: string) {
  process.env.DATA_DIR = path.join(root, name);
  vi.resetModules();
  const m = {
    db: await import("@/db"),
    auth: await import("@/lib/auth/setup"),
    family: await import("@/lib/family/service"),
    collections: await import("@/lib/collections/service"),
    archive: await import("@/lib/collections/archive"),
    export: await import("@/lib/export/service"),
    restore: await import("@/lib/restore/service"),
    schema: {
      ...(await import("@/db/schema/auth")),
      ...(await import("@/db/schema/family")),
      ...(await import("@/db/schema/asset")),
      ...(await import("@/db/schema/memory")),
      ...(await import("@/db/schema/collection")),
    },
  };
  closers.push(m.db.closeDatabase);
  if (
    !(
      await m.auth.performSetup({
        token: "collections-token",
        displayName: "虚构管理员",
        email: `${name}@example.test`,
        password: "collections-test-password",
      })
    ).ok
  )
    throw new Error("setup");
  const user = m.db.getDb().select().from(m.schema.user).get()!;
  return { ...m, user };
}
async function context(
  m: Awaited<ReturnType<typeof open>>,
): Promise<FamilyContext> {
  const b = await m.family.getUserBinding(m.user.id);
  return {
    userId: m.user.id,
    userName: m.user.name,
    familyId: b.familyId!,
    personId: b.personId,
    role: b.role,
    accountEnabled: true,
    isGuardian: b.isGuardian,
    familyTimezone: b.familyTimezone!,
    childLaterUnlockAge: b.childLaterUnlockAge!,
  };
}

it("five real originals → two collections → reorder/remove/trash/restore/reopen preserves all source bytes and event rows", async () => {
  const a = await open("a");
  const onboarding = await a.family.completeOnboarding(a.user.id, {
    familyName: "虚构家庭",
    timezone: "Asia/Shanghai",
    childDisplayName: "小雨",
    childBirthDate: "2026-01-01",
    selfDisplayName: "爸爸",
    selfRelationToChild: "爸爸",
  });
  expect(onboarding.ok).toBe(true);
  const ctx = await context(a),
    events: string[] = [];
  const ingest = await import("@/lib/assets/ingest"),
    inbox = await import("@/lib/inbox/service"),
    memories = await import("@/lib/memories/service");
  for (let i = 0; i < 5; i++) {
    const buffer = await sharp({
      create: {
        width: 80,
        height: 100,
        channels: 3,
        background: { r: 100 + i * 20, g: 120, b: 100 },
      },
    })
      .jpeg()
      .toBuffer();
    const stored = await ingest.ingestImage({
      familyId: ctx.familyId,
      createdByUserId: ctx.userId,
      filename: `fictional-${i}.jpg`,
      declaredMime: "image/jpeg",
      buffer,
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("ingest");
    const item = await inbox.createInboxItemForAsset(
        ctx.familyId,
        stored.asset,
      ),
      entry = await inbox.getInboxEntry(ctx.familyId, item.id);
    const result = await memories.confirmInboxEntry(ctx.familyId, entry!, {
      title: `出生第一周 ${i}`,
      occurredAt: new Date(`2026-01-0${i + 1}T08:00:00Z`),
    });
    if (!result.ok) throw new Error("confirm");
    events.push(result.eventId);
  }
  const before = a.db
    .getDb()
    .select()
    .from(a.schema.asset)
    .where(isNull(a.schema.asset.originalAssetId))
    .all();
  expect(before).toHaveLength(5);
  const first = a.collections.createCollection(ctx, "出生第一周", "chapter"),
    second = a.collections.createCollection(ctx, "初见相册");
  const section = { id: randomUUID(), title: "回到家" };
  for (const id of [first, second]) {
    const doc = a.collections.getCollection(ctx, id);
    a.collections.saveCollection(ctx, id, doc.revision, {
      ...doc,
      sections: id === first ? [section] : [],
      items: events.map((memoryEventId, i) => ({
        id: randomUUID(),
        memoryEventId,
        sectionId: id === first ? section.id : null,
        caption: `人工说明 ${i}`,
      })),
    });
  }
  let doc = a.collections.getCollection(ctx, first);
  const reversed = [...doc.items].reverse();
  doc = a.collections.saveCollection(ctx, first, doc.revision, {
    ...doc,
    items: reversed,
    title: "出生第一周 · 手工整理",
      coverAssetId: before[0]!.id,
  });
  const preserved = JSON.stringify(doc.items);
  expect(() =>
    a.collections.saveCollection(ctx, first, doc.revision - 1, {
      ...doc,
      title: "过期写入",
    }),
  ).toThrow("revision_conflict");
  expect(() =>
    a.collections.saveCollection(ctx, first, doc.revision, {
      ...doc,
      items: [
        ...doc.items,
        {
          id: randomUUID(),
          memoryEventId: "missing-event",
          sectionId: null,
          caption: "",
        },
      ],
    }),
  ).toThrow("source_unavailable");
  expect(JSON.stringify(a.collections.getCollection(ctx, first).items)).toBe(
    preserved,
  );
  expect(() =>
    a.collections.saveCollection(ctx, first, doc.revision, {
      ...doc,
      items: [...doc.items, { ...doc.items[0], id: randomUUID() }],
    }),
  ).toThrow("duplicate_source");
  expect(() =>
    a.collections.createCollection({ ...ctx, role: "viewer" }, "只读拒绝"),
  ).toThrow("forbidden");
  const other = randomUUID();
  a.db
    .getDb()
    .insert(a.schema.family)
    .values({ id: other, name: "其他虚构家庭" })
    .run();
  const foreign = a.collections.createCollection(ctx, "暂存");
  a.db
    .getDb()
    .update(a.schema.collection)
    .set({ familyId: other })
    .where(eq(a.schema.collection.id, foreign))
    .run();
  expect(() => a.collections.getCollection(ctx, foreign)).toThrow("not_found");
  const api = await import("@/app/api/collections/[id]/route");
  const token=randomUUID();
  a.db.getDb().insert(a.schema.session).values({id:randomUUID(),token,userId:ctx.userId,expiresAt:new Date(Date.now()+3600000)}).run();
  const apiHeaders={authorization:`Bearer ${token}`,"content-type":"application/json"};
  expect((await api.GET(new Request(`http://localhost/api/collections/${foreign}`,{headers:apiHeaders}),{params:Promise.resolve({id:foreign})})).status).toBe(404);
  const viewerId=randomUUID(), viewerToken=randomUUID();
  a.db.getDb().insert(a.schema.user).values({id:viewerId,name:"虚构只读家人",email:"viewer@example.test",role:"viewer",familyId:ctx.familyId}).run();
  a.db.getDb().insert(a.schema.session).values({id:randomUUID(),token:viewerToken,userId:viewerId,expiresAt:new Date(Date.now()+3600000)}).run();
  const viewerHeaders={...apiHeaders,authorization:`Bearer ${viewerToken}`};
  expect((await api.PATCH(new Request(`http://localhost/api/collections/${first}`,{method:"PATCH",headers:viewerHeaders,body:JSON.stringify({operation:"delete",revision:doc.revision})}),{params:Promise.resolve({id:first})})).status).toBe(403);


  a.db
    .getDb()
    .delete(a.schema.collection)
    .where(eq(a.schema.collection.id, foreign))
    .run();
  a.db
    .getDb()
    .delete(a.schema.family)
    .where(eq(a.schema.family.id, other))
    .run();
  const deleted = a.collections.setCollectionDeleted(
    ctx,
    first,
    doc.revision,
    true,
  );
  expect(
    a.collections.listCollections(ctx).entries.map((c) => c.id),
  ).not.toContain(first);
  doc = a.collections.setCollectionDeleted(ctx, first, deleted.revision, false);
  expect(doc.items.map((i) => i.memoryEventId)).toEqual([...events].reverse());
  const doc2 = a.collections.getCollection(ctx, second);
  a.collections.saveCollection(ctx, second, doc2.revision, {
    ...doc2,
    items: doc2.items.slice(1),
  });
  a.db.closeDatabase();
  expect(
    a.collections.getCollection(ctx, first).items.map((i) => i.caption),
  ).toEqual([
    "人工说明 4",
    "人工说明 3",
    "人工说明 2",
    "人工说明 1",
    "人工说明 0",
  ]);
  const after = a.db
    .getDb()
    .select()
    .from(a.schema.asset)
    .where(isNull(a.schema.asset.originalAssetId))
    .all();
  expect(after.map((a) => [a.id, a.sha256])).toEqual(
    before.map((a) => [a.id, a.sha256]),
  );
  expect(a.db.getDb().select().from(a.schema.memoryEvent).all()).toHaveLength(
    5,
  );
  const storage = (await import("@/lib/assets/storage")).getAssetStorage();
  for (const asset of after)
    expect(
      createHash("sha256")
        .update(readFileSync(storage.resolvePath(asset.storageKey)))
        .digest("hex"),
    ).toBe(asset.sha256);
  // Source deletion retains the durable collection relation but suppresses reading/counts.
  (await import("@/lib/trash/service")).trashMemoryEvent(ctx, events[0]!);
  expect(
    a.collections
      .getCollection(ctx, first)
      .items.find((i) => i.memoryEventId === events[0])?.source,
  ).toBeNull();
  expect(
    a.collections.listCollections(ctx).entries.find((c) => c.id === first)
      ?.count,
  ).toBe(4);
  expect(a.collections.getCollection(ctx,first).coverAssetId).toBeNull();
  expect(a.collections.listCollections(ctx).entries.find(c=>c.id===first)?.coverAssetId).toBeNull();
  const graph = a.archive.collectCollectionArchive(ctx.familyId),
    backup = await a.export.buildFamilyExport(ctx.familyId);
  const bytes = readFileSync(backup.filePath);
  a.db.closeDatabase();
  const b = await open("b");
  await b.restore.restoreFromZip(bytes, b.user.id);
  expect(b.archive.collectCollectionArchive(ctx.familyId)).toEqual(graph);
  expect(
    b.db
      .getDb()
      .select()
      .from(b.schema.memoryEvent)
      .where(eq(b.schema.memoryEvent.id, events[0]!))
      .get()?.deletedAt,
  ).not.toBeNull();
  expect((await b.family.bindRestoredFamily(b.user.id, ctx.personId!)).ok).toBe(
    true,
  );
  const bctx = await context(b);
  expect(
    b.collections
      .getCollection(bctx, first)
      .items.find((i) => i.memoryEventId === events[0])?.source,
  ).toBeNull();
  const secondExport = await b.export.buildFamilyExport(ctx.familyId);
  const verify = spawnSync(
    process.execPath,
    ["scripts/verify-export.mjs", secondExport.filePath],
    { encoding: "utf8" },
  );
  expect(verify.status, verify.stdout + verify.stderr).toBe(0);
  const zipA = await JSZip.loadAsync(bytes),
    zipB = await JSZip.loadAsync(readFileSync(secondExport.filePath));
  for (const name of [
    "collections.json",
    "collection-sections.json",
    "collection-items.json",
  ])
    expect(
      JSON.parse(
        await zipB.file(`family-time-capsule-export/${name}`)!.async("string"),
      ),
    ).toEqual(
      JSON.parse(
        await zipA.file(`family-time-capsule-export/${name}`)!.async("string"),
      ),
    );
  expect(
    JSON.parse(
      await zipB
        .file("family-time-capsule-export/manifest.json")!
        .async("string"),
    ).assets.map((v: { assetId: string; sha256: string }) => [
      v.assetId,
      v.sha256,
    ]),
  ).toEqual(
    JSON.parse(
      await zipA
        .file("family-time-capsule-export/manifest.json")!
        .async("string"),
    ).assets.map((v: { assetId: string; sha256: string }) => [
      v.assetId,
      v.sha256,
    ]),
  );
  b.db.closeDatabase();
  for (const mode of ["missing", "declared-missing", "dangling"]) {
    const broken = await JSZip.loadAsync(bytes),
      prefix = "family-time-capsule-export/";
    if (mode === "missing") broken.remove(`${prefix}collection-items.json`);
    if (mode === "declared-missing")
      for (const name of [
        "collections.json",
        "collection-sections.json",
        "collection-items.json",
      ])
        broken.remove(prefix + name);
    if (mode === "dangling") {
      const rows = JSON.parse(
        await broken.file(`${prefix}collection-items.json`)!.async("string"),
      );
      rows[0].memoryEventId = "missing";
      broken.file(`${prefix}collection-items.json`, JSON.stringify(rows));
    }
    const c = await open(mode);
    await expect(
      c.restore.restoreFromZip(
        await broken.generateAsync({ type: "nodebuffer" }),
        c.user.id,
      ),
    ).rejects.toThrow();
    expect(c.db.getDb().select().from(c.schema.family).all()).toEqual([]);
    const files = readdirSync(path.join(root, mode), { recursive: true }).map(
      String,
    );
    expect(
      files.filter((f) => f.startsWith("originals/") && !f.endsWith("/")),
    ).toEqual([]);
    c.db.closeDatabase();
  }
}, 60000);
