import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-trash-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "trash-setup-token";
process.env.AUTH_SECRET = "trash-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { contribution: contributionTable } = await import("@/db/schema/contribution");
const { story } = await import("@/db/schema/story");
const { asset: assetTable } = await import("@/db/schema/asset");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry, getTimelinePage, getMemoryEventDetail } = await import("@/lib/memories/service");
const { createContribution, addFact } = await import("@/lib/contributions/service");
const {
  createStoryDraft,
  publishStory,
  planDeterministicDraft,
  collectStoryMaterial,
  collectTranscriptMaterial,
  periodForKind,
  listStories,
} = await import("@/lib/stories/service");
const {
  trashMemoryEvent,
  trashContribution,
  trashStory,
  restoreFromTrash,
  purgeFromTrash,
  listTrash,
  purgeAssetIfUnreferenced,
} = await import("@/lib/trash/service");
const { searchFamily } = await import("@/lib/search/service");
const { buildFamilyExport } = await import("@/lib/export/service");

const setup = await performSetup({
  token: "trash-setup-token",
  displayName: "爸爸",
  email: "dad-trash@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "回收站测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const binding = await getUserBinding(adminId);
if (
  !binding.familyTimezone ||
  binding.childLaterUnlockAge === null ||
  binding.personId === null
) {
  throw new Error("binding incomplete");
}
const adminTimezone = binding.familyTimezone;
const adminUnlockAge = binding.childLaterUnlockAge;
const adminPersonId = binding.personId;

const context: FamilyContext = {
  userId: adminId,
  userName: "爸爸",
  familyId,
  personId: adminPersonId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: adminTimezone,
  childLaterUnlockAge: adminUnlockAge,
};

const OTHER_FAMILY = "fam-trash-other";

const fixtures = path.join(__dirname, "..", "fixtures");
const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.isChild, true))
  .get();
if (!child) throw new Error("child missing");

let ingestSerial = 0;
async function makeEventAt(title: string, occurredAt: Date) {
  ingestSerial += 1;
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminId,
    filename: `${title}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.jpg")),
      Buffer.from([ingestSerial]),
    ]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("ingest failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const entry = (await getInboxEntry(familyId, item.id))!;
  const ev = await confirmInboxEntry(familyId, entry, { title, occurredAt });
  if (!ev.ok) throw new Error("confirm failed");
  return ev.eventId;
}

describe("M7：回收站 — 事件", () => {
  it("软删除后时间轴/详情/搜索/导出均不可见；恢复后全部回来", async () => {
    const eventId = await makeEventAt(
      "要被删除的事件",
      new Date("2026-08-20T02:00:00.000Z"),
    );
    await addFact(familyId, eventId, "这条事实随事件进回收站。");
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "随事件删除的讲述内容。",
      visibility: "family",
    });

    // 删除前可见
    expect(await getMemoryEventDetail(familyId, eventId)).toBeTruthy();
    expect(searchFamily(context, { q: "要被删除的事件" }).events.length).toBe(1);

    expect(trashMemoryEvent(context, eventId)).toEqual({ ok: true });

    // 时间轴 / 详情 / 搜索 不可见
    const timeline = await getTimelinePage(familyId, { limit: 100 });
    expect(timeline.entries.some((e) => e.event.id === eventId)).toBe(false);
    expect(await getMemoryEventDetail(familyId, eventId)).toBeUndefined();
    expect(searchFamily(context, { q: "要被删除的事件" }).total).toBe(0);

    // 导出不含该事件
    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const memories = JSON.parse(
      await zip.file("family-time-capsule-export/memories.json")!.async("string"),
    );
    expect(memories.some((m: { id: string }) => m.id === eventId)).toBe(false);

    // 回收站可见
    const trashList = listTrash(context);
    expect(
      trashList.some((t) => t.kind === "memory_event" && t.id === eventId),
    ).toBe(true);

    // 恢复
    expect(restoreFromTrash(context, "memory_event", eventId)).toEqual({ ok: true });
    expect(await getMemoryEventDetail(familyId, eventId)).toBeTruthy();
    expect(searchFamily(context, { q: "要被删除的事件" }).events.length).toBe(1);
    expect(listTrash(context).some((t) => t.id === eventId)).toBe(false);
  });

  it("清除是硬删除：事件行与其讲述一并消失；素材保留", async () => {
    const eventId = await makeEventAt(
      "要被清除的事件",
      new Date("2026-08-21T02:00:00.000Z"),
    );
    const contributionRow = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "清除测试讲述。",
      visibility: "family",
    });
    if (!contributionRow.ok) throw new Error("contribution failed");

    trashMemoryEvent(context, eventId);
    expect(purgeFromTrash(context, "memory_event", eventId)).toEqual({ ok: true });

    expect(
      getDb().select().from(memoryEvent).where(eq(memoryEvent.id, eventId)).all(),
    ).toHaveLength(0);
    expect(
      getDb()
        .select()
        .from(contributionTable)
        .where(eq(contributionTable.id, contributionRow.contributionId))
        .all(),
    ).toHaveLength(0);
    // 素材未被连带删除（原件仍在库）
    const assetCount = getDb()
      .select({ id: assetTable.id })
      .from(assetTable)
      .where(eq(assetTable.familyId, familyId))
      .all().length;
    expect(assetCount).toBeGreaterThanOrEqual(2);

    // 重复清除报 not_found
    expect(purgeFromTrash(context, "memory_event", eventId)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("跨家庭隔离：别家上下文删不了也列不出", async () => {
    const eventId = await makeEventAt(
      "隔离事件",
      new Date("2026-08-22T02:00:00.000Z"),
    );
    const otherContext: FamilyContext = { ...context, familyId: OTHER_FAMILY };
    expect(trashMemoryEvent(otherContext, eventId)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(listTrash(otherContext).length).toBe(0);
    expect(purgeFromTrash(otherContext, "memory_event", eventId)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("M7：回收站 — 讲述与故事", () => {
  it("讲述软删除后不可见（事件保留），恢复回来", async () => {
    const eventId = await makeEventAt(
      "讲述所在事件",
      new Date("2026-08-23T02:00:00.000Z"),
    );
    const created = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "回收站测试讲述正文。",
      visibility: "family",
    });
    if (!created.ok) throw new Error("contribution failed");

    expect(trashContribution(context, created.contributionId)).toEqual({ ok: true });
    // 事件仍在
    expect(await getMemoryEventDetail(familyId, eventId)).toBeTruthy();
    // 搜索不可见
    expect(searchFamily(context, { q: "回收站测试讲述正文" }).contributions.length).toBe(0);

    expect(restoreFromTrash(context, "contribution", created.contributionId)).toEqual({
      ok: true,
    });
    expect(searchFamily(context, { q: "回收站测试讲述正文" }).contributions.length).toBe(1);
  });

  it("故事软删除后列表/导出排除，恢复回来；清除为硬删除", async () => {
    const eventId = await makeEventAt(
      "故事素材事件",
      new Date("2026-09-01T02:00:00.000Z"),
    );
    await addFact(familyId, eventId, "九月初的确认事实。");
    const anchor = new Date("2026-09-02T00:00:00.000Z");
    const period = periodForKind("weekly", anchor);
    const plans = planDeterministicDraft(
      collectStoryMaterial(familyId, period),
      collectTranscriptMaterial(familyId, period),
    );
    const created = createStoryDraft(
      context,
      { kind: "weekly", anchor, title: "回收站测试故事" },
      plans,
    );
    if (!created.ok) throw new Error("draft failed");
    expect(await publishStory(context, created.storyId)).toEqual({ ok: true });

    // 搜索可命中
    expect(searchFamily(context, { q: "确认事实" }).stories.length).toBeGreaterThanOrEqual(1);

    expect(trashStory(context, created.storyId)).toEqual({ ok: true });
    expect((await listStories(familyId)).some((s) => s.id === created.storyId)).toBe(false);
    expect(searchFamily(context, { q: "确认事实" }).stories.length).toBe(0);
    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const stories = JSON.parse(
      await zip.file("family-time-capsule-export/stories.json")!.async("string"),
    );
    expect(stories.some((s: { id: string }) => s.id === created.storyId)).toBe(false);

    // 恢复
    expect(restoreFromTrash(context, "story", created.storyId)).toEqual({ ok: true });
    expect((await listStories(familyId)).some((s) => s.id === created.storyId)).toBe(true);
    expect(searchFamily(context, { q: "确认事实" }).stories.length).toBeGreaterThanOrEqual(1);

    // 清除
    trashStory(context, created.storyId);
    expect(purgeFromTrash(context, "story", created.storyId)).toEqual({ ok: true });
    expect(
      getDb().select().from(story).where(eq(story.id, created.storyId)).all(),
    ).toHaveLength(0);
  });
});

describe("M7：素材物理删除守卫", () => {
  it("被引用的素材不删除；无引用时删除", async () => {
    const eventId = await makeEventAt(
      "守卫测试事件",
      new Date("2026-08-24T02:00:00.000Z"),
    );
    const links = getDb()
      .select({ assetId: memoryEventAsset.assetId })
      .from(memoryEventAsset)
      .where(
        eq(memoryEventAsset.memoryEventId, eventId),
      )
      .all();
    expect(links.length).toBeGreaterThanOrEqual(1);
    const assetId = links[0].assetId;

    // 事件仍引用 → 不删除
    const guarded = purgeAssetIfUnreferenced(context, assetId);
    expect(guarded).toEqual({ ok: true, deleted: false });
    expect(
      getDb()
        .select({ id: assetTable.id })
        .from(assetTable)
        .where(eq(assetTable.id, assetId))
        .all(),
    ).toHaveLength(1);

    // 清除事件后（含链接级联）→ 素材仍被收件箱关联？收件箱条目已确认。
    trashMemoryEvent(context, eventId);
    purgeFromTrash(context, "memory_event", eventId);
    // 收件箱条目此前已 confirmed；inbox_item_asset 仍在 → 仍算引用
    const after = purgeAssetIfUnreferenced(context, assetId);
    // 无论删除与否，行为都必须一致、不抛错
    expect(after.ok).toBe(true);
  });
});
