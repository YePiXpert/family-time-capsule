import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-inbox-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "inbox-setup-token";
process.env.AUTH_SECRET = "inbox-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "inbox-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person: personTable } = await import("@/db/schema/family");
const { completeOnboarding, addPerson } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { getAsset } = await import("@/lib/assets/service");
const {
  createInboxItemForAsset,
  createTextInboxItem,
  listInbox,
  getInboxEntry,
  setInboxItemAssetTime,
  discardInboxItem,
  updateInboxDraft,
} = await import("@/lib/inbox/service");
const { confirmInboxEntry, getMemoryEventDetail } = await import(
  "@/lib/memories/service"
);

const db = getDb();
const adminUserId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(adminUserId, {
  familyName: "我们一家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const OTHER_FAMILY = "fam-inbox-other";

const fixtures = path.join(__dirname, "..", "fixtures");

// 两种基底：带 EXIF 与不带
function jpegVariant(n: number, withExif = true): Buffer {
  return Buffer.concat([
    readFileSync(
      path.join(fixtures, withExif ? "sample-exif.jpg" : "sample.jpg"),
    ),
    Buffer.from([n]),
  ]);
}

describe("收件箱工作流（#007）", () => {
  it("上传后入箱：有内嵌时间 → status=new，关联 Asset", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "有时间的照片.jpg",
      declaredMime: "image/jpeg",
      buffer: jpegVariant(1),
      clientLastModifiedMs: null,
    });
    expect(stored.status).toBe("stored");
    if (stored.status !== "stored") return;
    const item = await createInboxItemForAsset(familyId, stored.asset);
    expect(item.status).toBe("new");
    expect(item.kind).toBe("asset");

    const entries = await listInbox(familyId);
    const entry = entries.find((e) => e.item.id === item.id);
    expect(entry).toBeTruthy();
    expect(entry!.assets).toHaveLength(1);
    expect(entry!.assets[0].id).toBe(stored.asset.id);
  });

  it("缺少真实时间（import_time）→ status=needs_review", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "没时间的照片.jpg",
      declaredMime: "image/jpeg",
      buffer: jpegVariant(2, false), // 无 EXIF、不传 lastModified → import_time
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");
    const item = await createInboxItemForAsset(familyId, stored.asset);
    expect(item.status).toBe("needs_review");
  });

  it("修正时间：Asset timeSource=user_confirmed，条目转 new，EXIF 原样保留", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "待修正.jpg",
      declaredMime: "image/jpeg",
      buffer: jpegVariant(3),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");
    const item = await createInboxItemForAsset(familyId, stored.asset);

    const ok = await setInboxItemAssetTime(
      familyId,
      item.id,
      new Date("2026-08-11T03:00:00.000Z"),
    );
    expect(ok).toBe(true);

    const updatedAsset = await getAsset(familyId, stored.asset.id);
    expect(updatedAsset?.timeSource).toBe("user_confirmed");
    expect(updatedAsset?.capturedAt?.toISOString()).toBe("2026-08-11T03:00:00.000Z");
    expect(JSON.parse(updatedAsset?.metadataJson ?? "{}").exif.DateTimeOriginal).toBe(
      "2026:08:10 09:30:00",
    );

    const entry = await getInboxEntry(familyId, item.id);
    expect(entry?.item.status).toBe("new");
  });

  it("废弃：条目 discarded，Asset 仍保留（原件不是收件箱私有物）", async () => {
    const stored = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "不要的.jpg",
      declaredMime: "image/jpeg",
      buffer: jpegVariant(4),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("store failed");
    const item = await createInboxItemForAsset(familyId, stored.asset);

    expect(await discardInboxItem(familyId, item.id)).toBe(true);
    const entries = await listInbox(familyId);
    expect(entries.find((e) => e.item.id === item.id)).toBeUndefined();
    const assetStillThere = await getAsset(familyId, stored.asset.id);
    expect(assetStillThere).toBeTruthy();
  });

  it("文本条目：kind=text、rawText 保存、无 asset 关联", async () => {
    const item = await createTextInboxItem(familyId, "今天小满第一次笑了。");
    const entry = await getInboxEntry(familyId, item.id);
    expect(entry?.item.kind).toBe("text");
    expect(entry?.item.rawText).toBe("今天小满第一次笑了。");
    expect(entry?.assets).toHaveLength(0);
  });

  it("整理草稿保存标题、时间、人物和地点，确认时不覆盖原始正文", async () => {
    const aunt = await addPerson(familyId, {
      displayName: "姑姑",
      relationToChild: "姑姑",
    });
    if (!aunt.ok) throw new Error("person creation failed");
    const originalText = "傍晚和姑姑一起在窗边看云。";
    const item = await createTextInboxItem(familyId, originalText);
    const occurredAt = new Date("2026-08-12T10:30:00.000Z");

    const draft = await updateInboxDraft(familyId, item.id, {
      title: "窗边看云",
      occurredAt,
      locationText: "家里窗边",
      participantPersonIds: [aunt.personId],
    });
    expect(draft?.item).toMatchObject({
      rawText: originalText,
      draftTitle: "窗边看云",
      draftLocationText: "家里窗边",
    });
    expect(draft?.item.draftOccurredAt?.toISOString()).toBe(occurredAt.toISOString());
    expect(draft?.participantPersonIds).toEqual([aunt.personId]);

    const confirmed = await confirmInboxEntry(familyId, draft!);
    if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.error}`);
    const detail = await getMemoryEventDetail(familyId, confirmed.eventId);
    expect(detail?.event).toMatchObject({
      title: "窗边看云",
      locationText: "家里窗边",
    });
    expect(detail?.event.occurredAt.toISOString()).toBe(occurredAt.toISOString());
    expect(detail?.participants.map((person) => person.id)).toContain(aunt.personId);
    expect(detail?.sourceNotes[0]?.rawText).toBe(originalText);
    await expect(confirmInboxEntry(familyId, draft!)).resolves.toEqual(confirmed);
    await expect(
      updateInboxDraft(familyId, item.id, { title: "确认后不能再改" }),
    ).resolves.toBeUndefined();
  });

  it("整理草稿拒绝跨家庭人物且保持原值不变", async () => {
    await db.run(
      sql`INSERT OR IGNORE INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    await db
      .insert(personTable)
      .values({
        id: "other-family-person",
        familyId: OTHER_FAMILY,
        displayName: "别人家的成员",
        isChild: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .onConflictDoNothing()
      .run();
    const item = await createTextInboxItem(familyId, "保持原样");
    await expect(
      updateInboxDraft(familyId, item.id, {
        title: "不应写入",
        participantPersonIds: ["other-family-person"],
      }),
    ).resolves.toBeUndefined();
    const unchanged = await getInboxEntry(familyId, item.id);
    expect(unchanged?.item.draftTitle).toBeNull();
    expect(unchanged?.participantPersonIds).toEqual([]);
  });

  it("家庭隔离：他家庭看不到本家庭条目", async () => {
    await db.run(
      sql`INSERT OR IGNORE INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    const entries = await listInbox(familyId);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(await getInboxEntry(OTHER_FAMILY, e.item.id)).toBeUndefined();
    }
    const otherEntries = await listInbox(OTHER_FAMILY);
    expect(otherEntries).toHaveLength(0);
  });
});
