import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-contrib-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "contrib-setup-token";
process.env.AUTH_SECRET = "contrib-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "contrib-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { auditLog } = await import("@/db/schema/audit");
const { user: userTable } = await import("@/db/schema/auth");
const { addPerson, completeOnboarding, listPeople } = await import(
  "@/lib/family/service"
);
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const {
  createContribution,
  updateContributionText,
  listContributions,
  addFact,
  listFacts,
  setFactStatus,
} = await import("@/lib/contributions/service");

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
const OTHER_FAMILY = "fam-contrib-other";

const fixtures = path.join(__dirname, "..", "fixtures");

async function makeEvent(n: number): Promise<string> {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminUserId,
    filename: `事件${n}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.jpg")),
      Buffer.from([n]),
    ]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("store failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const entry = (await getInboxEntry(familyId, item.id))!;
  const result = await confirmInboxEntry(familyId, entry, { title: `事件${n}` });
  if (!result.ok) throw new Error("confirm failed");
  return result.eventId;
}

describe("多人视角（#012）", () => {
  it("爸爸、妈妈、外婆的 contribution 独立保存，按人展示", async () => {
    const eventId = await makeEvent(1);
    const people = await listPeople(familyId);
    const dad = people.find((p) => p.relationToChild === "爸爸")!;
    const mom = await addPerson(familyId, {
      displayName: "妈妈",
      relationToChild: "妈妈",
    });
    const grandma = await addPerson(familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    expect(mom.ok).toBe(true);
    expect(grandma.ok).toBe(true);

    // 爸爸登录，替妈妈与外婆记录（author 是 Person，不要求 User）
    const r1 = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: dad.id,
      recordedByUserId: adminUserId,
      rawText: "她攥着我手指的那一刻，我在产房外哭了。",
      visibility: "family",
    });
    if (!mom.ok || !grandma.ok) throw new Error("addPerson failed");
    const r2 = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: mom.personId,
      recordedByUserId: adminUserId,
      rawText: "生产很辛苦，但听到哭声就都值了。",
      visibility: "family",
    });
    const r3 = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: grandma.personId,
      recordedByUserId: adminUserId,
      rawText: "外婆说：这孩子的手真小。",
      visibility: "child_later",
    });
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) throw new Error("create failed");

    const list = await listContributions(familyId, eventId);
    expect(list).toHaveLength(3);
    const authors = list.map((c) => c.authorName).sort();
    expect(authors).toEqual(["外婆", "妈妈", "爸爸"]);
    // 外婆没有 User 也完整存在
    const waipo = list.find((c) => c.authorName === "外婆")!;
    expect(waipo.visibility).toBe("child_later");
    expect(list.find((c) => c.id === r1.contributionId)).toMatchObject({
      recordedByUserId: adminUserId,
      recordedByPersonId: dad.id,
      recordedByNameSnapshot: "爸爸",
      recordingMode: "self",
    });
    expect(waipo).toMatchObject({
      recordedByUserId: adminUserId,
      recordedByPersonId: dad.id,
      recordedByNameSnapshot: "爸爸",
      recordingMode: "on_behalf",
    });
    expect(
      db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.kind, "contribution.recorded_on_behalf"))
        .all().length,
    ).toBeGreaterThanOrEqual(2);

    expect(() =>
      db.run(sql`
        INSERT INTO contribution (
          id, memory_event_id, author_person_id,
          recorded_by_person_id, recorded_by_name_snapshot, recording_mode,
          raw_text, visibility, created_at, updated_at
        ) VALUES (
          ${randomUUID()}, ${eventId}, ${dad.id},
          NULL, '爸爸', 'self',
          '无有效录入人', 'family', 0, 0
        )
      `),
    ).toThrow();
  });

  it("编辑只影响自己的行：妈妈改定稿不覆盖爸爸文本", async () => {
    const eventId = await makeEvent(2);
    const people = await listPeople(familyId);
    const dad = people.find((p) => p.relationToChild === "爸爸")!;
    const mom = people.find((p) => p.relationToChild === "妈妈")!;

    const r1 = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: dad.id,
      recordedByUserId: adminUserId,
      rawText: "爸爸的原文",
    });
    const r2 = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: mom.id,
      recordedByUserId: adminUserId,
      rawText: "妈妈的原文",
    });
    if (!r1.ok || !r2.ok) throw new Error("create failed");

    // 妈妈编辑自己的
    const edited = await updateContributionText(
      familyId,
      r2.contributionId,
      "妈妈修改后的定稿",
    );
    expect(edited?.editedText).toBe("妈妈修改后的定稿");
    expect(edited?.rawText).toBe("妈妈的原文"); // 原稿保留

    // 爸爸的不受影响
    const list = await listContributions(familyId, eventId);
    const dadRow = list.find((c) => c.id === r1.contributionId)!;
    expect(dadRow.editedText).toBeNull();
    expect(dadRow.rawText).toBe("爸爸的原文");
  });

  it("非法输入与其他家庭隔离", async () => {
    const eventId = await makeEvent(3);
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${OTHER_FAMILY}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );

    // 空文本
    expect(
      await createContribution(familyId, {
        memoryEventId: eventId,
        authorPersonId: "x",
        recordedByUserId: adminUserId,
        rawText: "  ",
      }),
    ).toEqual({ ok: false, error: "invalid" });
    // 事件不属于本家庭
    expect(
      await createContribution(familyId, {
        memoryEventId: "not-my-event",
        authorPersonId: "x",
        recordedByUserId: adminUserId,
        rawText: "hello",
      }),
    ).toEqual({ ok: false, error: "event_not_found" });
    // 他家庭视角读取为空
    expect(await listContributions(OTHER_FAMILY, eventId)).toHaveLength(0);
  });

  it("管理员不能替已有账号的 Person 发言，但账号本人可以", async () => {
    const eventId = await makeEvent(5);
    const aunt = await addPerson(familyId, {
      displayName: "姑姑",
      relationToChild: "姑姑",
    });
    if (!aunt.ok) throw new Error("add aunt failed");
    const auntUserId = randomUUID();
    db.insert(userTable)
      .values({
        id: auntUserId,
        name: "姑姑",
        email: "aunt-contribution@example.com",
        emailVerified: false,
        role: "contributor",
        familyId,
        personId: aunt.personId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    await expect(
      createContribution(familyId, {
        memoryEventId: eventId,
        authorPersonId: aunt.personId,
        recordedByUserId: adminUserId,
        rawText: "管理员不能替她发表。",
      }),
    ).resolves.toEqual({ ok: false, error: "author_not_allowed" });

    const own = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: aunt.personId,
      recordedByUserId: auntUserId,
      rawText: "这是姑姑本人记录。",
    });
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(
      db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.kind, "contribution.recorded_on_behalf"),
            eq(auditLog.actorUserId, auntUserId),
          ),
        )
        .all(),
    ).toHaveLength(0);
  });
});

describe("Fact（P0 手工）", () => {
  it("添加、确认状态、否决", async () => {
    const eventId = await makeEvent(4);
    const f1 = await addFact(familyId, eventId, "小满在 2026-08-15 第一次笑出声。");
    expect(f1?.status).toBe("user_confirmed");
    expect(f1?.statement).toContain("第一次笑出声");

    const rejected = await setFactStatus(familyId, f1!.id, "rejected");
    expect(rejected?.status).toBe("rejected");

    // 其他家庭不能加 fact 到别人的事件
    expect(await addFact(OTHER_FAMILY, eventId, "x")).toBeUndefined();
    expect(await listFacts(OTHER_FAMILY, eventId)).toHaveLength(0);
  });
});
