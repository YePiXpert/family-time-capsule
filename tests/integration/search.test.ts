import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-search-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "search-setup-token";
process.env.AUTH_SECRET = "search-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { fact } = await import("@/db/schema/contribution");
const { memoryEventTag } = await import("@/db/schema/suggestion");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding, addPerson } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry, updateMemoryEvent } = await import("@/lib/memories/service");
const {
  createContribution,
  addFact,
  setFactStatus,
} = await import("@/lib/contributions/service");
const {
  rebuildSearchIndex,
  searchFamily,
} = await import("@/lib/search/service");

const setup = await performSetup({
  token: "search-setup-token",
  displayName: "爸爸",
  email: "dad-search@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "搜索测试家庭",
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
if (!binding.familyTimezone || binding.childLaterUnlockAge === null) {
  throw new Error("binding incomplete");
}

function contextOf(overrides: Partial<FamilyContext> = {}): FamilyContext {
  return {
    userId: adminId,
    userName: "爸爸",
    familyId,
    personId: binding.personId,
    role: binding.role,
    accountEnabled: true,
    isGuardian: binding.isGuardian,
    familyTimezone: binding.familyTimezone,
    childLaterUnlockAge: binding.childLaterUnlockAge,
    ...overrides,
  };
}
const adminContext = contextOf();

const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.isChild, true))
  .get();
if (!child) throw new Error("child missing");

const fixtures = path.join(__dirname, "..", "fixtures");

let ingestSerial = 0;
async function makeEvent(title: string): Promise<string> {
  ingestSerial += 1;
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminId,
    filename: `${title}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample.jpg")),
      Buffer.from([ingestSerial]),
    ]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("ingest failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const entry = (await getInboxEntry(familyId, item.id))!;
  const ev = await confirmInboxEntry(familyId, entry, { title });
  if (!ev.ok) throw new Error("confirm failed");
  return ev.eventId;
}

const mom = await addPerson(familyId, { displayName: "妈妈", relationToChild: "妈妈" });
if (!mom.ok) throw new Error("add mom failed");
const momPersonId = mom.personId;

const viewerId = randomUUID();
getDb()
  .insert(userTable)
  .values({
    id: viewerId,
    name: "访客",
    email: "viewer-search@example.com",
    emailVerified: false,
    role: "viewer",
    familyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();
const viewerContext = contextOf({
  userId: viewerId,
  userName: "访客",
  personId: null,
  role: "viewer",
  isGuardian: false,
});

describe("M4：FTS5 全文搜索", () => {
  it("中文 bigram / 英文 / 词组都能命中事件标题，空查询无结果", async () => {
    await makeEvent("海边的下午");
    await makeEvent("library story time");

    const zh = searchFamily(adminContext, { q: "海边" });
    expect(zh.events.some((e) => e.title === "海边的下午")).toBe(true);

    const zh3 = searchFamily(adminContext, { q: "的下午" });
    expect(zh3.events.some((e) => e.title === "海边的下午")).toBe(true);

    const en = searchFamily(adminContext, { q: "library" });
    expect(en.events.some((e) => e.title.includes("library"))).toBe(true);

    const phrase = searchFamily(adminContext, { q: "story time" });
    expect(phrase.events.some((e) => e.title.includes("story"))).toBe(true);

    const none = searchFamily(adminContext, { q: "" });
    expect(none.total).toBe(0);

    const miss = searchFamily(adminContext, { q: "完全不存在的词组" });
    expect(miss.total).toBe(0);
  });

  it("标题更新后索引随之更新；确认事实可被搜索", async () => {
    const eventId = await makeEvent("旧标题");
    await updateMemoryEvent(familyId, eventId, adminId, { title: "新标题第一次走路" });

    expect(
      searchFamily(adminContext, { q: "旧标题" }).events.length,
    ).toBe(0);
    expect(
      searchFamily(adminContext, { q: "第一次走路" }).events.some((e) => e.id === eventId),
    ).toBe(true);

    await addFact(familyId, eventId, "小满在客厅迈出了第一步。");
    const factHit = searchFamily(adminContext, { q: "迈出了第一步" });
    expect(factHit.facts.some((f) => f.eventId === eventId)).toBe(true);
  });

  it("可见性：private/child_later 讲述不向无关读者泄漏，作者/监护人可见", async () => {
    const eventId = await makeEvent("出生那几天");
    const priv = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: binding.personId!,
      recordedByUserId: adminId,
      rawText: "这是爸爸的私人备忘：存好脐带夹。",
      visibility: "private",
    });
    if (!priv.ok) throw new Error("private contribution failed");
    const later = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: momPersonId,
      recordedByUserId: adminId,
      rawText: "妈妈写给孩子十八岁看的悄悄话。",
      visibility: "child_later",
    });
    if (!later.ok) throw new Error("child_later contribution failed");
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: momPersonId,
      recordedByUserId: adminId,
      rawText: "妈妈当天的公开记录：母子平安。",
      visibility: "family",
    });

    // viewer（非作者、非监护人、未解锁）：只看到 family 可见讲述
    const viewerHits = searchFamily(viewerContext, { q: "悄悄话" });
    expect(viewerHits.contributions.length).toBe(0);
    const viewerHitsPrivate = searchFamily(viewerContext, { q: "私人备忘" });
    expect(viewerHitsPrivate.contributions.length).toBe(0);
    const viewerHitsFamily = searchFamily(viewerContext, { q: "母子平安" });
    expect(viewerHitsFamily.contributions.length).toBe(1);

    // 作者（爸爸，admin+guardian）本人能看到自己的 private
    const adminPrivate = searchFamily(adminContext, { q: "私人备忘" });
    expect(adminPrivate.contributions.length).toBe(1);
    // admin 是 guardian → child_later 可见
    const adminLater = searchFamily(adminContext, { q: "悄悄话" });
    expect(adminLater.contributions.length).toBe(1);
  });

  it("事实拒绝后从索引移除；rejected/ai_suggested 事实不可搜索", async () => {
    const eventId = await makeEvent("事实状态");
    const f = await addFact(familyId, eventId, "这条事实将被否决：独角兽出现了。");
    if (!f) throw new Error("addFact failed");
    expect(
      searchFamily(adminContext, { q: "独角兽" }).facts.length,
    ).toBe(1);

    await setFactStatus(familyId, f.id, "rejected");
    expect(
      searchFamily(adminContext, { q: "独角兽" }).facts.length,
    ).toBe(0);

    // AI 建议事实直接插入索引也不可见（只索引 user_confirmed）
    const aiFactId = randomUUID();
    getDb()
      .insert(fact)
      .values({
        id: aiFactId,
        memoryEventId: eventId,
        statement: "AI 建议的未确认事实：宝宝会飞。",
        status: "ai_suggested",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    rebuildSearchIndex();
    expect(
      searchFamily(adminContext, { q: "宝宝会飞" }).facts.length,
    ).toBe(0);
  });

  it("过滤器：参与人 / 标签 / 媒介 / 日期范围", async () => {
    const a = await makeEvent("公园野餐日");
    getDb()
      .insert(memoryEventTag)
      .values({
        id: randomUUID(),
        familyId,
        memoryEventId: a,
        tag: "户外",
        createdAt: new Date(),
      })
      .run();
    // 手动补索引标签不会出现在事件标题里；给标题重新索引一次确保可命中
    await updateMemoryEvent(familyId, a, adminId, { title: "公园野餐日" });

    await makeEvent("下雨天在家搭积木");

    // 两个事件都命中“公园/积木”各自的词——用共同词“日”不可靠，直接分别搜
    const byTag = searchFamily(adminContext, { q: "野餐", tag: "户外" });
    expect(byTag.events.length).toBe(1);
    expect(byTag.events[0].id).toBe(a);

    const byWrongTag = searchFamily(adminContext, { q: "野餐", tag: "不存在标签" });
    expect(byWrongTag.events.length).toBe(0);

    const byMedia = searchFamily(adminContext, { q: "积木", mediaType: "image" });
    expect(byMedia.events.length).toBe(1);

    const byMediaVideo = searchFamily(adminContext, { q: "积木", mediaType: "video" });
    expect(byMediaVideo.events.length).toBe(0);

    const byDate = searchFamily(adminContext, { q: "野餐", dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    expect(byDate.events.length).toBe(1);
    const byDateMiss = searchFamily(adminContext, { q: "野餐", dateFrom: "2020-01-01", dateTo: "2020-12-31" });
    expect(byDateMiss.events.length).toBe(0);
  });

  it("全量重建幂等且与增量索引等价；家庭隔离", async () => {
    const before = searchFamily(adminContext, { q: "野餐" });
    const counts = rebuildSearchIndex();
    expect(counts.events).toBeGreaterThan(0);
    const after = searchFamily(adminContext, { q: "野餐" });
    expect(after.events.map((e) => e.id).sort()).toEqual(
      before.events.map((e) => e.id).sort(),
    );

    // 家庭隔离：另一个家庭的上下文查不到
    const otherContext = contextOf({ familyId: "fam-other-family" });
    expect(searchFamily(otherContext, { q: "野餐" }).total).toBe(0);
  });

  it("单字中文查询走 LIKE 回退", async () => {
    await makeEvent("满月酒");
    const hit = searchFamily(adminContext, { q: "满" });
    expect(hit.events.some((e) => e.title === "满月酒")).toBe(true);
  });
});
