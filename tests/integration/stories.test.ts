import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";
import type { MemoryAssistant } from "@/lib/ai/types";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-stories-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "stories-setup-token";
process.env.AUTH_SECRET = "stories-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const {
  createContribution,
  addFact,
} = await import("@/lib/contributions/service");
const {
  createStoryDraft,
  regenerateOrCreateStory,
  collectStoryMaterial,
  collectTranscriptMaterial,
  planDeterministicDraft,
  periodForKind,
  updateParagraphText,
  updateStoryTitle,
  deleteParagraph,
  addManualParagraph,
  publishStory,
  getStory,
  listStories,
  requestStoryGeneration,
} = await import("@/lib/stories/service");
const { searchFamily } = await import("@/lib/search/service");
const { buildFamilyExport } = await import("@/lib/export/service");
const { generateStoryHandler } = await import("@/lib/ai/handlers/generate-story");

const setup = await performSetup({
  token: "stories-setup-token",
  displayName: "爸爸",
  email: "dad-stories@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "故事测试家庭",
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

const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: { id: "test-provider", displayName: "Test", external: false },
  capabilities: {
    text: { available: true, model: "test-text-v1", reason: "configured" },
    vision: { available: false, model: null, reason: "not_configured" },
    transcription: { available: false, model: null, reason: "not_configured" },
    embeddings: { available: false, model: null, reason: "not_configured" },
  },
};

const fixtures = path.join(__dirname, "..", "fixtures");
const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.isChild, true))
  .get();
if (!child) throw new Error("child missing");

let ingestSerial = 0;
async function makeEventAt(title: string, occurredAt: Date): Promise<string> {
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
  const ev = await confirmInboxEntry(familyId, entry, {
    title,
    occurredAt,
  });
  if (!ev.ok) throw new Error("confirm failed");
  return ev.eventId;
}

const anchor = new Date("2026-08-12T00:00:00.000Z"); // 周期覆盖 8/10-8/16 的事件

describe("M4：Story 生命周期", () => {
  it("确定性草稿：确认事实为叙述段、family 讲述为逐字引文段；private 不入故事", async () => {
    const eventId = await makeEventAt(
      "出生那几天",
      new Date("2026-08-11T02:00:00.000Z"),
    );
    await addFact(familyId, eventId, "小满出生时体重六斤八两。");
    const pub = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "那天凌晨的产房外，我数着走廊的灯。",
      visibility: "family",
    });
    if (!pub.ok) throw new Error("public contribution failed");
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "这条私密内容绝不能进入故事。",
      visibility: "private",
    });

    const period = periodForKind("weekly", anchor);
    const material = collectStoryMaterial(familyId, period);
    const transcripts = collectTranscriptMaterial(familyId, period);
    const plans = planDeterministicDraft(material, transcripts);
    expect(plans.length).toBe(2); // 1 fact + 1 family contribution；private 被排除

    const created = createStoryDraft(context, { kind: "weekly", anchor }, plans);
    if (!created.ok) throw new Error("draft failed");
    const detail = await getStory(familyId, created.storyId);
    if (!detail) throw new Error("detail missing");
    expect(detail.story.status).toBe("draft");
    expect(detail.paragraphs.length).toBe(2);
    const narrative = detail.paragraphs.find((p) => p.kind === "narrative")!;
    expect(narrative.text).toBe("小满出生时体重六斤八两。");
    expect(narrative.sources[0].sourceType).toBe("fact");
    const quote = detail.paragraphs.find((p) => p.kind === "quote")!;
    expect(quote.text).toBe("那天凌晨的产房外，我数着走廊的灯。");
    expect(quote.sources[0].sourceType).toBe("contribution");
    expect(quote.sources[0].quote).toBe("那天凌晨的产房外，我数着走廊的灯。");

    // 全文里绝不能出现 private 讲述
    const allText = detail.paragraphs.map((p) => p.text).join("\n");
    expect(allText).not.toContain("绝不能进入故事");
  });

  it("Quote Lock：引文段不可编辑；叙述段与手写段禁止引号字符", async () => {
    const eventId = await makeEventAt(
      "满月",
      new Date("2026-09-12T02:00:00.000Z"),
    );
    await addFact(familyId, eventId, "满月当天全家到齐。");
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "满月酒上外婆抱着小满不肯撒手。",
      visibility: "family",
    });
    const sepAnchor = new Date("2026-09-15T00:00:00.000Z");
    const period = periodForKind("monthly", sepAnchor);
    const plans = planDeterministicDraft(
      collectStoryMaterial(familyId, period),
      collectTranscriptMaterial(familyId, period),
    );
    const created = createStoryDraft(context, { kind: "monthly", anchor: sepAnchor }, plans);
    if (!created.ok) throw new Error("draft failed");
    const detail = await getStory(familyId, created.storyId)!;

    const narrative = detail!.paragraphs.find((p) => p.kind === "narrative")!;
    const quote = detail!.paragraphs.find((p) => p.kind === "quote")!;

    expect(updateParagraphText(context, quote.id, "被篡改的引文")).toEqual({
      ok: false,
      error: "quote_paragraph_immutable",
    });
    expect(
      updateParagraphText(context, narrative.id, "叙述里混入「引号」"),
    ).toEqual({ ok: false, error: "quote_characters_not_allowed" });
    expect(
      addManualParagraph(context, created.storyId, "手写“引号”段落"),
    ).toEqual({ ok: false, error: "quote_characters_not_allowed" });

    const edited = updateParagraphText(
      context,
      narrative.id,
      "满月那天全家聚在一起庆祝。",
    );
    expect(edited).toEqual({ ok: true });

    // 编辑触发再生保护（editedAt 落库）
    const after = await getStory(familyId, created.storyId)!;
    expect(after!.story.editedAt).not.toBeNull();
    expect(after!.story.status).toBe("draft"); // 状态仍是 draft，editedAt 标记保护
  });

  it("再生保护：未编辑草稿被替换；已编辑草稿另立新稿", async () => {
    const eventId = await makeEventAt(
      "百日宴",
      new Date("2026-11-18T02:00:00.000Z"),
    );
    await addFact(familyId, eventId, "百日宴上小满穿了红色的小袄。");
    const yAnchor = new Date("2026-11-20T00:00:00.000Z");
    const build = () =>
      planDeterministicDraft(
        collectStoryMaterial(familyId, periodForKind("yearly", yAnchor)),
        collectTranscriptMaterial(familyId, periodForKind("yearly", yAnchor)),
      );

    const first = regenerateOrCreateStory(
      context,
      { kind: "yearly", anchor: yAnchor },
      build(),
    );
    if (!first.ok) throw new Error("first regen failed");
    expect(first.replacedDraft).toBe(false);

    // 未编辑 → 替换（仍然只有一份）
    const second = regenerateOrCreateStory(
      context,
      { kind: "yearly", anchor: yAnchor },
      build(),
    );
    if (!second.ok) throw new Error("second regen failed");
    expect(second.replacedDraft).toBe(true);
    const yearly = (await listStories(familyId)).filter(
      (s) => s.kind === "yearly",
    );
    expect(yearly.length).toBe(1);

    // 编辑后 → 再生不覆盖，另立新草稿
    await updateStoryTitle(context, second.storyId, "小满的第一年（家人手记）");
    const third = regenerateOrCreateStory(
      context,
      { kind: "yearly", anchor: yAnchor },
      build(),
    );
    if (!third.ok) throw new Error("third regen failed");
    expect(third.replacedDraft).toBe(false);
    const afterList = (await listStories(familyId)).filter(
      (s) => s.kind === "yearly",
    );
    expect(afterList.length).toBe(2);
    const editedOne = afterList.find((s) => s.title === "小满的第一年（家人手记）")!;
    expect(editedOne).toBeTruthy();
    expect(editedOne.editedAt).not.toBeNull();

    // 发布后 → 再生同样不覆盖
    expect(publishStory(context, second.storyId)).toEqual({ ok: true });
    const fourth = regenerateOrCreateStory(
      context,
      { kind: "yearly", anchor: yAnchor },
      build(),
    );
    if (!fourth.ok) throw new Error("fourth regen failed");
    const published = (await listStories(familyId)).filter(
      (s) => s.status === "published",
    );
    expect(published.length).toBe(1);
    expect(published[0].id).toBe(second.storyId);

    // 已发布不可再改
    const pubDetail = await getStory(familyId, second.storyId)!;
    expect(updateStoryTitle(context, second.storyId, "改标题")).toEqual({
      ok: false,
      error: "published_immutable",
    });
    expect(deleteParagraph(context, pubDetail!.paragraphs[0].id)).toEqual({
      ok: false,
      error: "published_immutable",
    });

    // 段落删除（未发布草稿；第四次再生成会替换仍未编辑的 third 草稿，故用 fourth）
    const draftDetail = await getStory(familyId, fourth.storyId)!;
    const before = draftDetail!.paragraphs.length;
    expect(deleteParagraph(context, draftDetail!.paragraphs[0].id)).toEqual({ ok: true });
    expect((await getStory(familyId, fourth.storyId))!.paragraphs.length).toBe(before - 1);
  });

  it("AI 生成：别名协议 + 引文锁；编造引文被拒后回退确定性草稿", async () => {
    const eventId = await makeEventAt(
      "冬至",
      new Date("2026-12-21T10:00:00.000Z"),
    );
    await addFact(familyId, eventId, "冬至全家一起包了饺子。");
    const c = await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "小满第一次学着擀饺子皮，弄得满脸是面粉。",
      visibility: "family",
    });
    if (!c.ok) throw new Error("contribution failed");

    const request = requestStoryGeneration(context, {
      kind: "weekly",
      anchor: new Date("2026-12-23T00:00:00.000Z"),
    }, { runtime: INTERNAL_RUNTIME });
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    const lease = {
      jobId: randomUUID(),
      familyId,
      jobType: "generate.story.v1" as const,
      entityType: "story" as const,
      entityId: `weekly@${new Date("2026-12-23T00:00:00.000Z").toISOString()}`,
      requiredCapability: "text" as const,
      providerId: "test-provider",
      model: "test-text-v1",
      providerExternal: false,
      consentVersion: null,
      triggerMode: "manual" as const,
      contentVisibility: "family" as const,
      requestedByUserId: adminId,
      attemptNumber: 1,
      leaseGeneration: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      workerId: "test-worker",
    };

    const assistant = {
      provider: INTERNAL_RUNTIME.provider,
      capabilities: INTERNAL_RUNTIME.capabilities,
      supports: (capability: string) => capability === "text",
      generateText: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          title: "饺子与面粉",
          paragraphs: [
            {
              kind: "narrative",
              text: "冬至那天全家聚在一起包饺子。",
              sources: [{ ref: "F1" }],
            },
            {
              kind: "quote",
              text: "小满第一次学着擀饺子皮，弄得满脸是面粉。",
              sources: [{ ref: "C1" }],
            },
            {
              kind: "quote",
              text: "这句引文根本不存在于任何讲述里。",
              sources: [{ ref: "C1" }],
            },
            {
              kind: "narrative",
              text: "引用了编造别名的段落。",
              sources: [{ ref: "F99" }],
            },
            {
              kind: "narrative",
              text: "叙述里混入「引号」的段落。",
              sources: [{ ref: "F1" }],
            },
          ],
        }),
        finishReason: "stop",
        provenance: {
          providerId: "test-provider",
          providerName: "Test",
          model: "test-text-v1",
        },
      }),
      analyzeImage: vi.fn().mockRejectedValue(new Error("not supported")),
      transcribeAudio: vi.fn().mockRejectedValue(new Error("not supported")),
      createEmbeddings: vi.fn().mockRejectedValue(new Error("not supported")),
    } as unknown as MemoryAssistant;

    await generateStoryHandler({
      lease,
      assistant,
      signal: new AbortController().signal,
    });

    const weekly = (await listStories(familyId)).filter(
      (s) => s.kind === "weekly" && s.periodStart.getTime() === periodForKind("weekly", new Date("2026-12-23T00:00:00.000Z")).start.getTime(),
    );
    // 第一周（8月）已有一份；这次是 12 月的另一周
    const target = weekly.find((s) => s.title === "饺子与面粉");
    expect(target).toBeTruthy();
    const detail = await getStory(familyId, target!.id)!;
    const texts = detail!.paragraphs.map((p) => p.text);
    expect(texts).toContain("冬至那天全家聚在一起包饺子。");
    expect(texts).toContain("小满第一次学着擀饺子皮，弄得满脸是面粉。");
    expect(texts).not.toContain("这句引文根本不存在于任何讲述里。");
    expect(texts).not.toContain("引用了编造别名的段落。");
    expect(texts).not.toContain("叙述里混入「引号」的段落。");
  });

  it("发布进入搜索索引；导出包含已编辑/已发布故事（不含纯草稿）", async () => {
    const eventId = await makeEventAt(
      "周岁",
      new Date("2027-08-10T02:00:00.000Z"),
    );
    await addFact(familyId, eventId, "小满周岁抓周抓住了画笔。");
    const yAnchor2 = new Date("2027-08-11T00:00:00.000Z");
    const plans = planDeterministicDraft(
      collectStoryMaterial(familyId, periodForKind("yearly", yAnchor2)),
      collectTranscriptMaterial(familyId, periodForKind("yearly", yAnchor2)),
    );
    const created = createStoryDraft(context, { kind: "yearly", anchor: yAnchor2 }, plans);
    if (!created.ok) throw new Error("draft failed");
    expect(publishStory(context, created.storyId)).toEqual({ ok: true });

    // 搜索命中已发布故事
    const hit = searchFamily(context, { q: "抓周" });
    expect(hit.stories.some((s) => s.id === created.storyId)).toBe(true);

    // 导出：published + edited 保留；纯 draft 排除
    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const stories = JSON.parse(
      await zip.file("family-time-capsule-export/stories.json")!.async("string"),
    );
    const paragraphs = JSON.parse(
      await zip.file("family-time-capsule-export/story-paragraphs.json")!.async("string"),
    );
    const sources = JSON.parse(
      await zip.file("family-time-capsule-export/story-sources.json")!.async("string"),
    );
    const published = stories.find(
      (s: { id: string }) => s.id === created.storyId,
    );
    expect(published).toBeTruthy();
    expect(published.status).toBe("published");
    expect(
      stories.every(
        (s: { status: string; editedAt: string | null }) =>
          s.status === "published" || s.editedAt !== null,
      ),
    ).toBe(true);
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(sources.length).toBeGreaterThan(0);

    // 导出文件计数 = assets + 15
    const manifest = JSON.parse(
      await zip.file("family-time-capsule-export/manifest.json")!.async("string"),
    );
    expect(manifest.fileCount).toBe(manifest.assets.length + 17);
  });
});
