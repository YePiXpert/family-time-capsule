import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-oral-history-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "oral-history-setup-token";
process.env.AUTH_SECRET = "oral-history-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { capsule } = await import("@/db/schema/capsule");
const { inboxItem } = await import("@/db/schema/inbox");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const {
  createContributionRequest,
  closeContributionRequest,
  listContributionRequests,
  resolveGuestRequest,
  submitGuestText,
  submitGuestMedia,
  PROMPT_LIBRARY,
} = await import("@/lib/oral-history/service");
const {
  addFutureQuestion,
  removeFutureQuestion,
  addCapsuleReply,
  getCapsuleDialogue,
} = await import("@/lib/capsules/dialogue");
const { sealCapsule, openCapsule } = await import("@/lib/capsules/service");
const { buildFamilyExport } = await import("@/lib/export/service");

const setup = await performSetup({
  token: "oral-history-setup-token",
  displayName: "爸爸",
  email: "dad-oral@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "口述史测试家庭",
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

const OTHER_FAMILY = "fam-oral-other";

describe("M5-A：匿名讲述链接", () => {
  it("内置问题库覆盖十个主题", () => {
    expect(PROMPT_LIBRARY.length).toBe(10);
    expect(PROMPT_LIBRARY.map((t) => t.key)).toEqual(
      expect.arrayContaining([
        "childhood",
        "parents",
        "school",
        "work",
        "city",
        "hometown",
        "festival",
        "becoming_parent",
        "family_change",
        "hopes",
      ]),
    );
    for (const topic of PROMPT_LIBRARY) {
      expect(topic.questions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("创建链接 → 访客提交文字进入收件箱 → 家人可查统计", async () => {
    const created = createContributionRequest(context, {
      recipientLabel: "外婆",
      promptText: "你小时候最快乐的一个下午是什么样的？",
      topicKey: "childhood",
    });
    if (!created.ok) throw new Error("create failed");
    expect(created.token.length).toBeGreaterThanOrEqual(40);

    // token 不入库（只有哈希）
    const rows = getDb()
      .select()
      .from((await import("@/db/schema/oral-history")).contributionRequest)
      .all();
    expect(rows.some((r) => (r.tokenHash ?? "").includes(created.token))).toBe(false);

    // 访客凭 token 解析成功
    const resolved = resolveGuestRequest(created.token);
    expect(resolved.ok && resolved.request.recipientLabel).toBe("外婆");

    // 访客提交文字 → 收件箱出现新条目
    const submitted = await submitGuestText(
      created.token,
      "那年夏天在外婆家的院子里，我们躺在竹床上数星星。",
    );
    expect(submitted.ok).toBe(true);
    const items = getDb()
      .select()
      .from(inboxItem)
      .where(eq(inboxItem.familyId, familyId))
      .all();
    expect(
      items.some((i) => i.rawText?.includes("躺在竹床上数星星")),
    ).toBe(true);

    // 家人侧统计
    const stats = listContributionRequests(context);
    const target = stats.find((r) => r.id === created.requestId);
    expect(target?.submissionCount).toBe(1);
    expect(target?.pendingCount).toBe(1);
  });

  it("限流：每小时 5 条", async () => {
    const created = createContributionRequest(context, {
      recipientLabel: "爷爷",
      promptText: "讲讲你的第一份工作。",
      topicKey: "work",
    });
    if (!created.ok) throw new Error("create failed");
    for (let i = 0; i < 5; i++) {
      expect(
        (await submitGuestText(created.token, `第 ${i + 1} 条讲述内容。`)).ok,
      ).toBe(true);
    }
    const limited = await submitGuestText(created.token, "第六条应被限流。");
    expect(limited).toEqual({ ok: false, error: "rate_limited" });
  });

  it("并发提交也只能有 5 条通过，限流键不保存 bearer token", async () => {
    const created = createContributionRequest(context, {
      recipientLabel: "舅舅",
      promptText: "讲讲小时候最热闹的一天。",
      topicKey: "childhood",
    });
    if (!created.ok) throw new Error("create failed");
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        submitGuestText(created.token, `并发讲述 ${index + 1}`),
      ),
    );
    expect(attempts.filter((result) => result.ok)).toHaveLength(5);
    expect(attempts.filter((result) => !result.ok)).toHaveLength(15);

    const limiterRows = getDb()
      .select()
      .from((await import("@/db/schema/auth")).rateLimit)
      .all();
    expect(limiterRows.some((row) => row.key.includes(created.token))).toBe(false);
  });

  it("过期与关闭后 token 失效；错误 token 不可用", async () => {
    // 构造一个已过期的链接（now 参数取过去时刻）
    const expired = createContributionRequest(
      context,
      { recipientLabel: "姨妈", promptText: "讲讲老家的事？", ttlDays: 1 },
      new Date(Date.now() - 2 * 86_400_000),
    );
    if (!expired.ok) throw new Error("expired create failed");
    expect(resolveGuestRequest(expired.token)).toEqual({ ok: false, error: "expired" });

    const created = createContributionRequest(context, {
      recipientLabel: "姑妈",
      promptText: "老家过年吃什么？",
      ttlDays: 1,
    });
    if (!created.ok) throw new Error("create failed");

    // 手动改 expiresAt 为过去 → 过期
    getDb()
      .update((await import("@/db/schema/oral-history")).contributionRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        eq(
          (await import("@/db/schema/oral-history")).contributionRequest.id,
          created.requestId,
        ),
      )
      .run();
    expect(resolveGuestRequest(created.token)).toEqual({ ok: false, error: "expired" });
    expect((await submitGuestText(created.token, "过期的提交")).ok).toBe(false);

    // 恢复有效期，然后关闭
    getDb()
      .update((await import("@/db/schema/oral-history")).contributionRequest)
      .set({ expiresAt: new Date(Date.now() + 86_400_000) })
      .where(
        eq(
          (await import("@/db/schema/oral-history")).contributionRequest.id,
          created.requestId,
        ),
      )
      .run();
    expect(closeContributionRequest(context, created.requestId)).toEqual({ ok: true });
    expect(resolveGuestRequest(created.token)).toEqual({ ok: false, error: "closed" });

    // 错误 token
    expect(resolveGuestRequest("not-a-real-token-at-all-1234567890")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("访客媒体提交走上传校验，进入收件箱", async () => {
    const created = createContributionRequest(context, {
      recipientLabel: "舅舅",
      promptText: "发一张老照片过来吧。",
    });
    if (!created.ok) throw new Error("create failed");
    const fixtures = path.join(__dirname, "..", "fixtures");
    const submitted = await submitGuestMedia(created.token, {
      filename: "老照片.jpg",
      declaredMime: "image/jpeg",
      buffer: readFileSync(path.join(fixtures, "sample.jpg")),
    });
    expect(submitted.ok).toBe(true);

    // 不支持的类型被拒
    const rejected = await submitGuestMedia(created.token, {
      filename: "文档.pdf",
      declaredMime: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
    expect(rejected.ok).toBe(false);
  });
});

describe("M5-B：胶囊对话", () => {
  async function makeCapsule(title: string, unlockType: "date" | "age", unlockValue: string) {
    const id = (await import("node:crypto")).randomUUID();
    const now = new Date();
    getDb()
      .insert(capsule)
      .values({
        id,
        familyId,
        title,
        unlockType,
        unlockValue,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  it("draft 加问题 → 封存固化 → 解锁前不可答 → 开启后可答且历史不变", async () => {
    // A：远期解锁，验证「解锁前不可答」；B：已到期，验证开启与回答
    const capsuleA = await makeCapsule("写给三十岁", "date", "2056-08-15");
    const qA = await addFutureQuestion(context, capsuleA, "三十岁的你过得怎么样？");
    if (!qA.ok) throw new Error("question A failed");
    expect(await sealCapsule(context.familyId, capsuleA)).toBeTruthy();
    const lockedDialogue = await getCapsuleDialogue(familyId, capsuleA);
    const lockedReply = await addCapsuleReply(context, lockedDialogue[0].id, {
      text: "提前回答",
    });
    expect(lockedReply.ok ? null : lockedReply.error).toBe("capsule_locked");

    const capsuleId = await makeCapsule("写给十八岁", "date", "2026-08-15");
    const q1 = await addFutureQuestion(context, capsuleId, "十八岁的你，最看重什么？");
    const q2 = await addFutureQuestion(context, capsuleId, "你会怎么描述我们的家？");
    if (!q1.ok || !q2.ok) throw new Error("add question failed");

    // 封存
    expect(await sealCapsule(context.familyId, capsuleId)).toBeTruthy();

    // 封存后不可增删问题
    const lateQuestion = await addFutureQuestion(
      context,
      capsuleId,
      "封存后还想加的问题？",
    );
    expect(lateQuestion.ok ? null : lateQuestion.error).toBe("sealed_immutable");
    const before = await getCapsuleDialogue(familyId, capsuleId);
    const lateRemove = await removeFutureQuestion(context, before[0].id);
    expect(lateRemove.ok ? null : lateRemove.error).toBe("sealed_immutable");

    // capsule B 已到期：封存且到期的胶囊本身即解锁，可直接开启
    // （「解锁前不可答」已由 capsule A 验证）
    const childBirth = getDb()
      .select({ birthDate: person.birthDate })
      .from(person)
      .where(eq(person.isChild, true))
      .get()?.birthDate ?? null;
    const opened = await openCapsule(
      context.familyId,
      capsuleId,
      childBirth,
      "Asia/Shanghai",
    );
    expect(opened.ok).toBe(true);

    // 开启后可回答（文字）
    const reply1 = await addCapsuleReply(context, before[0].id, {
      text: "现在最看重的是家人都在。",
    });
    expect(reply1.ok).toBe(true);

    // 回答带媒体
    const fixtures = path.join(__dirname, "..", "fixtures");
    const reply2 = await addCapsuleReply(context, before[1].id, {
      text: null,
      media: {
        filename: "回答录音.wav",
        declaredMime: "audio/wav",
        buffer: readFileSync(path.join(fixtures, "sample.wav")),
      },
    });
    expect(reply2.ok).toBe(true);

    // 问答完整
    const dialogue = await getCapsuleDialogue(familyId, capsuleId);
    expect(dialogue.length).toBe(2);
    expect(dialogue[0].replies[0].text).toBe("现在最看重的是家人都在。");
    expect(dialogue[0].replies[0].authorName).toBe("爸爸");
    expect(dialogue[1].replies[0].assetId).toBeTruthy();
    expect(dialogue[1].replies[0].text).toBeNull();

    // 空回答被拒
    const emptyReply = await addCapsuleReply(context, before[0].id, { text: "  " });
    expect(emptyReply.ok ? null : emptyReply.error).toBe("empty_reply");

    // 家庭隔离
    const otherContext: FamilyContext = {
      ...context,
      familyId: OTHER_FAMILY,
    };
    const foreignReply = await addCapsuleReply(otherContext, before[0].id, {
      text: "别家的回答",
    });
    expect(foreignReply.ok ? null : foreignReply.error).toBe("not_found");
  });

  it("对话随导出携带（capsule-questions / capsule-replies）", async () => {
    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const questions = JSON.parse(
      await zip.file("family-time-capsule-export/capsule-questions.json")!.async("string"),
    );
    const replies = JSON.parse(
      await zip.file("family-time-capsule-export/capsule-replies.json")!.async("string"),
    );
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(replies.length).toBeGreaterThanOrEqual(2);
    expect(
      questions.some((q: { questionText: string }) => q.questionText.includes("十八岁")),
    ).toBe(true);
    expect(
      replies.some((r: { text: string | null }) => r.text === "现在最看重的是家人都在。"),
    ).toBe(true);
  });
});
