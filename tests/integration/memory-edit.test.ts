import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

/**
 * RH-003：MemoryEvent 编辑。
 * 关键语义：改 occurredAt 只影响事件（时间轴重排 + 年龄重算），
 * 绝不联动修改 Asset.capturedAt / importedAt；所有 mutation 先做所有权校验。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-edit-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "edit-token";
process.env.AUTH_SECRET = "edit-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "edit-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { addPerson, completeOnboarding, listPeople } = await import(
  "@/lib/family/service"
);
const { ingestImage } = await import("@/lib/assets/ingest");
const { getAsset } = await import("@/lib/assets/service");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const {
  confirmInboxEntry,
  updateMemoryEvent,
  getMemoryEventDetail,
  listMemoryEvents,
  listEventRevisions,
} = await import("@/lib/memories/service");

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
const OTHER_FAMILY = "fam-edit-other";

const fixtures = path.join(__dirname, "..", "fixtures");
let n = 0;

async function makeEvent(title: string): Promise<{ eventId: string; assetId: string }> {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminUserId,
    filename: `${title}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.jpg")),
      Buffer.from([++n]),
    ]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("store failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const entry = (await getInboxEntry(familyId, item.id))!;
  const result = await confirmInboxEntry(familyId, entry, { title });
  if (!result.ok) throw new Error("confirm failed");
  return { eventId: result.eventId, assetId: stored.asset.id };
}

describe("事件编辑（RH-003）", () => {
  it("8/10 事件改为 8/11：occurredAt 更新、时间轴跟随、年龄重算、编辑者记录", async () => {
    const { eventId, assetId } = await makeEvent("出生后的第一天");
    const before = (await getMemoryEventDetail(familyId, eventId))!;
    // EXIF 8/10 09:30 上海 → 01:30Z；孩子 8/10 生 → ageDays 0
    expect(before.event.occurredAt.toISOString()).toBe("2026-08-10T01:30:00.000Z");
    expect(before.event.ageDays).toBe(0);
    expect(before.event.lastEditedByUserId).toBeNull();

    const result = await updateMemoryEvent(familyId, eventId, adminUserId, {
      occurredAt: new Date("2026-08-11T01:30:00.000Z"),
      title: "出生后的第一天（已核对）",
      locationText: "北京 · 妇产医院",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = (await getMemoryEventDetail(familyId, eventId))!;
    expect(after.event.occurredAt.toISOString()).toBe("2026-08-11T01:30:00.000Z");
    expect(after.event.title).toBe("出生后的第一天（已核对）");
    expect(after.event.locationText).toBe("北京 · 妇产医院");
    // 年龄快照重算：8/11 对 8/10 生日 → 1 天
    expect(after.event.ageDays).toBe(1);
    expect(after.event.lastEditedByUserId).toBe(adminUserId);

    // 时间轴按新时间排列（升序列表里位于 8/10 之后创建的事件之前/之后可验证）
    const list = await listMemoryEvents(familyId);
    const row = list.find((e) => e.id === eventId)!;
    expect(row.occurredAt.toISOString()).toBe("2026-08-11T01:30:00.000Z");

    // 素材时间不受事件编辑影响
    const asset = (await getAsset(familyId, assetId))!;
    expect(asset.capturedAt?.toISOString()).toBe("2026-08-10T01:30:00.000Z");
    expect(asset.importedAt.getTime()).toBeGreaterThan(0);
    expect(asset.timeSource).toBe("embedded_metadata");
  });

  it("参与人替换：外部的 Person 被拒（bad_person），本家庭成员可替换", async () => {
    const grandma = await addPerson(familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    if (!grandma.ok) throw new Error("addPerson failed");
    const { eventId } = await makeEvent("外婆来帮忙");

    // 外家庭 Person → 拒绝
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    await db.run(
      sql`INSERT INTO person (id, family_id, display_name, is_child, created_at, updated_at) VALUES ('foreign-person-1', ${OTHER_FAMILY}, '陌生人', 0, 0, 0)`,
    );
    const foreignId = "foreign-person-1";

    const bad = await updateMemoryEvent(familyId, eventId, adminUserId, {
      participantPersonIds: [foreignId],
    });
    expect(bad).toEqual({ ok: false, error: "bad_person" });

    // 本家庭成员（外婆 + 爸爸）→ 成功，且孩子自动保留
    const people = await listPeople(familyId);
    const dad = people.find((p) => p.relationToChild === "爸爸")!;
    const child = people.find((p) => p.isChild)!;
    const ok = await updateMemoryEvent(familyId, eventId, adminUserId, {
      participantPersonIds: [grandma.personId, dad.id],
    });
    expect(ok.ok).toBe(true);
    const detail = (await getMemoryEventDetail(familyId, eventId))!;
    const ids = detail.participants.map((p) => p.id).sort();
    expect(ids).toEqual([child.id, dad.id, grandma.personId].sort());
  });

  it("childPersonId 只能换成同家庭的孩子 Person", async () => {
    const { eventId } = await makeEvent("第二个孩子的事件");
    const bad = await updateMemoryEvent(familyId, eventId, adminUserId, {
      childPersonId: "not-a-child",
    });
    expect(bad).toEqual({ ok: false, error: "bad_person" });

    // 正常换到（唯一）孩子本人——无变化也允许
    const people = await listPeople(familyId);
    const child = people.find((p) => p.isChild)!;
    const ok = await updateMemoryEvent(familyId, eventId, adminUserId, {
      childPersonId: child.id,
    });
    expect(ok.ok).toBe(true);
  });

  it("封面：外家庭 Asset 拒绝（bad_cover）；本家庭可设/可清空", async () => {
    const a = await makeEvent("封面测试");
    const bad = await updateMemoryEvent(familyId, a.eventId, adminUserId, {
      coverAssetId: "00000000-0000-0000-0000-000000000000",
    });
    expect(bad).toEqual({ ok: false, error: "bad_cover" });

    const ok = await updateMemoryEvent(familyId, a.eventId, adminUserId, {
      coverAssetId: a.assetId,
    });
    expect(ok.ok).toBe(true);
    const cleared = await updateMemoryEvent(familyId, a.eventId, adminUserId, {
      coverAssetId: null,
    });
    expect(cleared.ok).toBe(true);
  });

  it("IDOR：外家庭编辑本家庭事件 → not_found，事件未被改动", async () => {
    const { eventId } = await makeEvent("越界尝试");
    const before = (await getMemoryEventDetail(familyId, eventId))!;
    const denied = await updateMemoryEvent(
      OTHER_FAMILY,
      eventId,
      adminUserId,
      { title: "篡改标题", occurredAt: new Date("2030-01-01T00:00:00Z") },
    );
    expect(denied).toEqual({ ok: false, error: "not_found" });
    const after = (await getMemoryEventDetail(familyId, eventId))!;
    expect(after.event.title).toBe(before.event.title);
    expect(after.event.occurredAt.getTime()).toBe(before.event.occurredAt.getTime());
    expect(after.event.lastEditedByUserId).toBeNull();
  });

  it("非法输入：空标题拒绝；occurredAtPrecision 枚举透传", async () => {
    const { eventId } = await makeEvent("精度测试");
    const bad = await updateMemoryEvent(familyId, eventId, adminUserId, {
      title: "   ",
    });
    expect(bad).toEqual({ ok: false, error: "invalid" });

    const ok = await updateMemoryEvent(familyId, eventId, adminUserId, {
      occurredAtPrecision: "date_only",
    });
    expect(ok.ok).toBe(true);
    const detail = (await getMemoryEventDetail(familyId, eventId))!;
    expect(detail.event.occurredAtPrecision).toBe("date_only");
  });

  it("编辑历史（v0.1.3）：每次编辑写入编辑前快照，按新→旧排列", async () => {
    const { eventId } = await makeEvent("会被改两次的事");
    // 初始无历史
    expect(await listEventRevisions(familyId, eventId)).toHaveLength(0);

    // 第一次编辑：标题 + 时间
    await updateMemoryEvent(familyId, eventId, adminUserId, {
      title: "第一次修改后",
      occurredAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    // 第二次编辑：地点
    await updateMemoryEvent(familyId, eventId, adminUserId, {
      locationText: "北京 · 公园",
    });

    const revisions = await listEventRevisions(familyId, eventId);
    expect(revisions).toHaveLength(2);
    // 新→旧：第一条的快照是「第一次修改后」（第二次编辑前的状态）
    expect(revisions[0].snapshot.title).toBe("第一次修改后");
    expect(revisions[0].snapshot.locationText).toBeNull();
    expect(revisions[0].snapshot.occurredAt).toBe("2026-08-12T00:00:00.000Z");
    // 第二条是最初状态
    expect(revisions[1].snapshot.title).toBe("会被改两次的事");
    expect(revisions[1].snapshot.occurredAt).toBe("2026-08-10T01:30:00.000Z");
    // 编辑者记录正确
    expect(revisions[0].editedByUserId).toBe(adminUserId);
    expect(revisions[0].editorName).toBe("爸爸");
    // 参与人快照包含孩子
    const people = await listPeople(familyId);
    const child = people.find((p) => p.isChild)!;
    expect(revisions[1].snapshot.participantPersonIds).toContain(child.id);
  });

  it("编辑历史跨家庭隔离", async () => {
    const { eventId } = await makeEvent("别人看不到的历史");
    await updateMemoryEvent(familyId, eventId, adminUserId, { title: "改一下" });
    expect(await listEventRevisions(OTHER_FAMILY, eventId)).toHaveLength(0);
  });
});
