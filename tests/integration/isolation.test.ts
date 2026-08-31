import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Issue #017：家庭隔离专项审计。
 * 两个家庭各自持有完整数据，尝试用 B 的作用域读取/修改 A 的每一类资源，
 * 全部必须被拒绝。覆盖：Asset / Inbox / MemoryEvent / Contribution / Fact /
 * Capsule / Export。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-iso-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "iso-setup-token";
process.env.AUTH_SECRET = "iso-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "iso-setup-token",
  displayName: "管理员A",
  email: "a@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { randomUUID } = await import("node:crypto");
const { user: userTable } = await import("@/db/schema/auth");
const { family: familyTable } = await import("@/db/schema/family");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, updateAssetCapturedAt } = await import("@/lib/assets/ingest");
const { getAsset, listAssets, findOriginalBySha256, sha256Of, storeDerivative } =
  await import("@/lib/assets/service");
const {
  createInboxItemForAsset,
  getInboxEntry,
  listInbox,
  setInboxItemAssetTime,
  discardInboxItem,
} = await import("@/lib/inbox/service");
const {
  confirmInboxEntry,
  mergeInboxEntries,
  getMemoryEventDetail,
  listMemoryEvents,
  getTimelinePage,
} = await import("@/lib/memories/service");
const {
  createContribution,
  listContributions,
  updateContributionText,
  addFact,
  listFacts,
  setFactStatus,
} = await import("@/lib/contributions/service");
const {
  createCapsule,
  getCapsuleDetail,
  listCapsules,
  sealCapsule,
  openCapsule,
  addCapsuleEvent,
} = await import("@/lib/capsules/service");
const { buildFamilyExport } = await import("@/lib/export/service");
const JSZip = (await import("jszip")).default;

const db = getDb();
const userA = (await db.select({ id: userTable.id }).from(userTable))[0].id;

// 家庭 A：正常 onboarding
const onboardingA = await completeOnboarding(userA, {
  familyName: "A家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸A",
  selfRelationToChild: "爸爸",
});
if (!onboardingA.ok) throw new Error("onboarding A failed");
const familyA = onboardingA.familyId;

// 家庭 B：直插库构造（唯一管理员限制下无法走 onboarding）
const familyB = randomUUID();
db.insert(familyTable)
  .values({
    id: familyB,
    name: "B家",
    timezone: "Asia/Shanghai",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();

const fixtures = path.join(__dirname, "..", "fixtures");
const EXIF = readFileSync(path.join(fixtures, "sample-exif.jpg"));

async function seed(familyId: string, n: number) {
  const stored = await ingestImage({
    familyId,
    createdByUserId: userA,
    filename: `照片${n}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([EXIF, Buffer.from([n, familyId.charCodeAt(6)])]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("seed store failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  return { asset: stored.asset, item };
}

const a = await seed(familyA, 1);
const b = await seed(familyB, 2);

describe("Asset 隔离", () => {
  it("getAsset / listAssets / findOriginalBySha256 / storeDerivative", async () => {
    expect(await getAsset(familyB, a.asset.id)).toBeUndefined();
    expect((await listAssets(familyB)).find((x) => x.id === a.asset.id)).toBeUndefined();
    // 同 sha 在 B 家庭查不到 A 的原件
    expect(await findOriginalBySha256(familyB, sha256Of(EXIF))).toBeUndefined();
    expect(
      await storeDerivative(familyB, a.asset.id, "thumbnail", {
        mimeType: "image/png",
        extension: "png",
        buffer: Buffer.from("x"),
      }),
    ).toBeUndefined();
    // updateAssetCapturedAt 越界无效
    const missed = await updateAssetCapturedAt(
      familyB,
      a.asset.id,
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(missed).toBeUndefined();
    expect((await getAsset(familyA, a.asset.id))?.capturedAt?.toISOString()).toBe(
      "2026-08-10T01:30:00.000Z",
    );
  });
});

describe("Inbox 隔离", () => {
  it("getInboxEntry / listInbox / setInboxItemAssetTime / discard", async () => {
    expect(await getInboxEntry(familyB, a.item.id)).toBeUndefined();
    expect((await listInbox(familyB)).find((e) => e.item.id === a.item.id)).toBeUndefined();
    expect(
      await setInboxItemAssetTime(familyB, a.item.id, new Date("2030-01-01T00:00:00Z")),
    ).toBe(false);
    expect(await discardInboxItem(familyB, a.item.id)).toBe(false);
    // A 的条目不受影响
    expect((await getInboxEntry(familyA, a.item.id))?.item.status).toBe("new");
  });
});

describe("MemoryEvent 隔离", () => {
  it("confirm / detail / timeline 全部拒绝跨家庭", async () => {
    const entryA = (await getInboxEntry(familyA, a.item.id))!;
    // B 用自己的条目结构 + A 的资产 ID 组装（伪造）也无法确认
    const forgedEntry = {
      item: b.item,
      assets: [a.asset], // A 的资产
    };
    const result = await confirmInboxEntry(familyB, forgedEntry as never, {
      title: "越界事件",
    });
    // 事件创建可能成功（用 B 的条目），但 A 的资产关系在 A 家庭内不可见
    if (result.ok) {
      const detail = (await getMemoryEventDetail(familyB, result.eventId))!;
      expect(detail.assets.find((x) => x.id === a.asset.id)).toBeUndefined();
    }
    const confirmed = await confirmInboxEntry(familyA, entryA, { title: "A的事件" });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    expect(await getMemoryEventDetail(familyB, confirmed.eventId)).toBeUndefined();
    expect((await listMemoryEvents(familyB)).find((e) => e.id === confirmed.eventId)).toBeUndefined();
    expect(
      (await getTimelinePage(familyB)).entries.find(
        (entry) => entry.event.id === confirmed.eventId,
      ),
    ).toBeUndefined();
    // merge 混入他家庭条目 → not_found
    expect(
      await mergeInboxEntries(familyB, [b.item.id, a.item.id], { title: "越界合并" }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("Contribution / Fact 隔离", () => {
  it("创建、读取、编辑全部按 family 校验", async () => {
    const entryA = (await getInboxEntry(familyA, a.item.id))!;
    const confirmed = await confirmInboxEntry(familyA, entryA, { title: "A的事件" });
    if (!confirmed.ok) throw new Error("confirm failed");
    // B 家庭没有该事件的 Person——先给 B 造一个 Person
    const { person: personTable } = await import("@/db/schema/family");
    const personB = randomUUID();
    db.insert(personTable)
      .values({
        id: personB,
        familyId: familyB,
        displayName: "B家爸爸",
        isChild: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const childB = randomUUID();
    db.insert(personTable)
      .values({
        id: childB,
        familyId: familyB,
        displayName: "B家孩子",
        isChild: true,
        birthDate: "2026-01-01",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    // B 对 A 的事件创建 contribution → event_not_found
    expect(
      await createContribution(familyB, {
        memoryEventId: confirmed.eventId,
        authorPersonId: personB,
        recordedByUserId: userA,
        rawText: "越界",
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    // A 正常创建
    const peopleA = await db
      .select()
      .from(personTable)
      .where(eq(personTable.familyId, familyA));
    const contribA = await createContribution(familyA, {
      memoryEventId: confirmed.eventId,
      authorPersonId: peopleA.find((p) => p.isChild)!.id,
      recordedByUserId: userA,
      rawText: "A家的讲述",
    });
    expect(contribA.ok).toBe(true);
    if (!contribA.ok) return;

    // B 读/改 A 的 contribution（写入必须被阻止，不只是返回 undefined）
    expect(await listContributions(familyB, confirmed.eventId)).toHaveLength(0);
    expect(
      await updateContributionText(familyB, contribA.contributionId, "篡改"),
    ).toBeUndefined();
    const afterTamper = await listContributions(familyA, confirmed.eventId);
    expect(
      afterTamper.find((c) => c.id === contribA.contributionId)?.editedText,
    ).toBeNull(); // A 的原文未被篡改

    // Fact
    const factA = await addFact(familyA, confirmed.eventId, "A家事实");
    expect(factA).toBeTruthy();
    expect(await listFacts(familyB, confirmed.eventId)).toHaveLength(0);
    expect(await setFactStatus(familyB, factA!.id, "rejected")).toBeUndefined();
    expect((await listFacts(familyA, confirmed.eventId))[0].status).toBe("user_confirmed");
  });
});

describe("Capsule 隔离", () => {
  it("详情/列表/封存/开启/添加内容全部拒绝", async () => {
    const created = await createCapsule(familyA, {
      title: "A家胶囊",
      unlockType: "date",
      unlockValue: "2027-01-01",
    });
    if (!created.ok) throw new Error("capsule failed");
    const events = await listMemoryEvents(familyA);

    expect(await getCapsuleDetail(familyB, created.capsuleId, null, "Asia/Shanghai")).toBeUndefined();
    expect((await listCapsules(familyB, null, "Asia/Shanghai"))).toHaveLength(0);
    expect(await sealCapsule(familyB, created.capsuleId)).toBeUndefined();
    expect(await openCapsule(familyB, created.capsuleId, null, "Asia/Shanghai")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await addCapsuleEvent(familyB, created.capsuleId, events[0].id)).toBe(false);
    // A 自己可以
    expect(await addCapsuleEvent(familyA, created.capsuleId, events[0].id)).toBe(true);
    expect(await sealCapsule(familyA, created.capsuleId)).toBeTruthy();
  });
});

describe("Export 隔离", () => {
  it("A 的导出不包含 B 的任何数据", async () => {
    const result = await buildFamilyExport(familyA);
    const zip = await JSZip.loadAsync(readFileSync(result.filePath));
    const root = "family-time-capsule-export";
    const manifest = JSON.parse(await zip.file(`${root}/manifest.json`)!.async("string"));
    expect(manifest.familyId).toBe(familyA);
    const familyJson = JSON.parse(await zip.file(`${root}/family.json`)!.async("string"));
    expect(familyJson.id).toBe(familyA);
    const people = JSON.parse(await zip.file(`${root}/people.json`)!.async("string"));
    for (const p of people) expect(p.id).not.toBe(b.asset.id); // trivially
    // B 的资产不在 manifest
    for (const entry of manifest.assets) {
      expect(entry.assetId).not.toBe(b.asset.id);
    }
    // B 的文件名不在任何导出内容里
    const allNames = Object.keys(zip.files).join("\n");
    expect(allNames).not.toContain(b.asset.id);
    const timeline = await zip.file(`${root}/timeline.md`)!.async("string");
    expect(timeline).toContain("A家");
    expect(timeline).not.toContain("B家");
  });
});
