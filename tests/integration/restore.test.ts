import fs, {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * RH-004：真正的 Restore 集成测试（真实文件系统，零 mock）。
 *
 * Phase A（DATA_DIR=A）：构建完整档案 → 导出 ZIP → 快照期望值 → 关闭并销毁 A。
 * Phase B（DATA_DIR=B）：全新空实例 → setup 管理员 → restoreFromZip → 逐项比对。
 * 每个阶段通过 vi.resetModules() 取得绑定新 DATA_DIR 的全新模块实例。
 */

const dirA = mkdtempSync(path.join(tmpdir(), "ftc-restore-a-"));
const dirB = mkdtempSync(path.join(tmpdir(), "ftc-restore-b-"));
process.env.INITIAL_SETUP_TOKEN = "restore-token";
process.env.AUTH_SECRET = "restore-secret";

afterAll(() => {
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

const fixtures = path.join(__dirname, "..", "fixtures");
const read = (name: string) => readFileSync(path.join(fixtures, name));
const LONG_PENDING_TEXT =
  "这是一条超过一百个字符、尚未确认的收件箱文字，用来证明灾难恢复不会截断原文，也不会只备份已经进入时间轴的内容。".repeat(
    3,
  );
const CONFIRMED_TEXT_BODY =
  "小满今天会翻身了。\n她先安静地试了几次，随后完整地翻到另一边。";

type Snapshot = {
  zipPath: string;
  familyId: string;
  familyName: string;
  familyUnlockAge: number;
  people: Array<{
    id: string;
    displayName: string;
    isChild: boolean;
    isGuardian: boolean;
    childLaterUnlockedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  events: Array<{
    id: string;
    title: string;
    occurredAt: string;
    milestoneType: string | null;
    isPinned: boolean;
    assetIds: string[];
  }>;
  contributions: Array<{
    id: string;
    memoryEventId: string;
    authorPersonId: string;
    recordedByPersonId: string | null;
    recordedByNameSnapshot: string | null;
    recordingMode: string;
    rawText: string | null;
    transcript: string | null;
    editedText: string | null;
    audioAssetId: string | null;
    visibility: string;
    createdAt: string;
    updatedAt: string;
  }>;
  facts: Array<{ id: string; statement: string }>;
  factSources: Array<{ id: string; factId: string; sourceType: string; sourceId: string | null }>;
  tags: Array<{ memoryEventId: string; tag: string }>;
  transcripts: Array<{
    id: string;
    familyId: string;
    assetId: string;
    language: string | null;
    provider: string;
    model: string;
    rawTranscript: string;
    editedTranscript: string | null;
    segmentsJson: string | null;
    status: string;
    sourceSha256: string;
    createdByJobId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  capsules: Array<{ id: string; title: string; status: string; eventIds: string[] }>;
  assets: Array<{ id: string; sha256: string; bytes: number; mimeType: string; fileBytes: string }>;
  inboxItems: Array<{
    id: string;
    familyId: string;
    kind: string;
    status: string;
    rawText: string | null;
    memoryEventId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  inboxItemAssets: Array<{
    id: string;
    inboxItemId: string;
    assetId: string;
    familyId: string;
    createdAt: string;
  }>;
  confirmedText: { eventId: string; itemId: string; body: string };
};

let snapshot: Snapshot;

/** 在指定 DATA_DIR 上取得一套全新模块（含 db/storage/auth 单例） */
async function freshModules() {
  vi.resetModules();
  return {
    db: await import("@/db"),
    setup: await import("@/lib/auth/setup"),
    family: await import("@/lib/family/service"),
    ingest: await import("@/lib/assets/ingest"),
    inbox: await import("@/lib/inbox/service"),
    memories: await import("@/lib/memories/service"),
    contributions: await import("@/lib/contributions/service"),
    capsules: await import("@/lib/capsules/service"),
    exportSvc: await import("@/lib/export/service"),
    restoreSvc: await import("@/lib/restore/service"),
    storage: await import("@/lib/assets/storage"),
    schema: {
      user: (await import("@/db/schema/auth")).user,
      family: (await import("@/db/schema/family")).family,
      person: (await import("@/db/schema/family")).person,
      contribution: (await import("@/db/schema/contribution")).contribution,
      factSource: (await import("@/db/schema/suggestion")).factSource,
      memoryEventTag: (await import("@/db/schema/suggestion")).memoryEventTag,
      inboxItem: (await import("@/db/schema/inbox")).inboxItem,
      inboxItemAsset: (await import("@/db/schema/inbox")).inboxItemAsset,
      assetTranscript: (await import("@/db/schema/transcript")).assetTranscript,
    },
  };
}

describe("RH-004 归档恢复（A → export → B restore）", () => {
  it("Phase A：构建完整档案并导出", async () => {
    process.env.DATA_DIR = dirA;
    const m = await freshModules();
    const ok = await m.setup.performSetup({
      token: "restore-token",
      displayName: "爸爸",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    if (!ok.ok) throw new Error("setup A failed");

    const db = m.db.getDb();
    const adminId = (await db.select({ id: m.schema.user.id }).from(m.schema.user))[0].id;
    const onboarding = await m.family.completeOnboarding(adminId, {
      familyName: "我们一家",
      timezone: "Asia/Shanghai",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "爸爸",
      selfRelationToChild: "爸爸",
      selfIsGuardian: true,
    });
    if (!onboarding.ok) throw new Error("onboarding A failed");
    const familyId = onboarding.familyId;
    await m.family.addPerson(familyId, { displayName: "妈妈", relationToChild: "妈妈" });
    const grandma = await m.family.addPerson(familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    if (!grandma.ok) throw new Error("addPerson failed");
    const { eq } = await import("drizzle-orm");
    const policyPeople = await m.family.listPeople(familyId);
    const dad = policyPeople.find((p) => p.displayName === "爸爸")!;
    const child = policyPeople.find((p) => p.isChild)!;
    const manualUnlockAt = new Date("2035-02-28T16:00:00.000Z");
    await db
      .update(m.schema.family)
      .set({ childLaterUnlockAge: 21 })
      .where(eq(m.schema.family.id, familyId));
    await db
      .update(m.schema.person)
      .set({ childLaterUnlockedAt: manualUnlockAt })
      .where(eq(m.schema.person.id, child.id));

    // 素材：照片 + 音频 + 视频
    const photo = await m.ingest.ingestImage({
      familyId,
      createdByUserId: adminId,
      filename: "出生照片.jpg",
      declaredMime: "image/jpeg",
      buffer: read("sample-exif.jpg"),
      clientLastModifiedMs: null,
    });
    const audio = await m.ingest.ingestMedia({
      familyId,
      createdByUserId: adminId,
      kind: "audio",
      filename: "外婆哼的歌.wav",
      declaredMime: "audio/wav",
      buffer: read("sample.wav"),
      clientLastModifiedMs: null,
    });
    const video = await m.ingest.ingestMedia({
      familyId,
      createdByUserId: adminId,
      kind: "video",
      filename: "翻身.MOV",
      declaredMime: "video/quicktime",
      buffer: read("sample.mov"),
      clientLastModifiedMs: null,
    });
    if (photo.status !== "stored" || audio.status !== "stored" || video.status !== "stored") {
      throw new Error("ingest A failed");
    }

    const confirm = async (assetId: string, title: string) => {
      const item = await m.inbox.createInboxItemForAsset(familyId, { id: assetId } as never);
      const entry = await m.inbox.getInboxEntry(familyId, item.id);
      if (!entry) throw new Error("inbox entry missing");
      const result = await m.memories.confirmInboxEntry(familyId, entry, { title });
      if (!result.ok) throw new Error("confirm failed");
      return result.eventId;
    };
    // 3+ 事件（照片事件 ×2 + 合并的 A/V 事件 + 文字事件）
    const e1 = await confirm(photo.asset.id, "出生后的第一天");
    await m.memories.updateMemoryEvent(familyId, e1, adminId, {
      milestoneType: "first_time",
      isPinned: true,
    });
    const avItem = await m.inbox.createInboxItemForAsset(familyId, { id: audio.asset.id } as never);
    const vItem = await m.inbox.createInboxItemForAsset(familyId, { id: video.asset.id } as never);
    const merged = await m.memories.mergeInboxEntries(familyId, [avItem.id, vItem.id], {
      title: "声音与影像",
    });
    if (!merged.ok) throw new Error("merge failed");
    const textItem = await m.inbox.createTextInboxItem(familyId, CONFIRMED_TEXT_BODY);
    const textEntry = await m.inbox.getInboxEntry(familyId, textItem.id);
    const e3 = await m.memories.confirmInboxEntry(familyId, textEntry!, {
      title: "第一次翻身",
    });
    if (!e3.ok) throw new Error("text confirm failed");

    const pendingTextItem = await m.inbox.createTextInboxItem(
      familyId,
      LONG_PENDING_TEXT,
    );
    const pendingAssetItem = await m.inbox.createInboxItemForAsset(
      familyId,
      photo.asset,
    );
    const needsReviewItem = await m.inbox.createInboxItemForAsset(
      familyId,
      audio.asset,
    );
    const discardedItem = await m.inbox.createTextInboxItem(
      familyId,
      "这条待整理文字后来被丢弃。",
    );
    await m.inbox.discardInboxItem(familyId, discardedItem.id);
    expect(pendingTextItem.status).toBe("new");
    expect(LONG_PENDING_TEXT.length).toBeGreaterThan(100);
    expect(pendingAssetItem.status).toBe("new");
    expect(needsReviewItem.status).toBe("needs_review");

    // 讲述 + 事实
    const contrib = await m.contributions.createContribution(familyId, {
      memoryEventId: e1,
      authorPersonId: grandma.personId,
      recordedByUserId: adminId,
      rawText: "外婆说：这孩子的手真小。",
      visibility: "child_later",
    });
    if (!contrib.ok) throw new Error("contribution failed");
    await db
      .update(m.schema.contribution)
      .set({
        audioAssetId: audio.asset.id,
        transcript: "外婆的歌声转写：这孩子的手真小。",
      })
      .where(eq(m.schema.contribution.id, contrib.contributionId));
    const privateContrib = await m.contributions.createContribution(familyId, {
      memoryEventId: e1,
      authorPersonId: dad.id,
      recordedByUserId: adminId,
      rawText: "爸爸的私人备忘，只进入完整灾难备份。",
      visibility: "private",
    });
    if (!privateContrib.ok) throw new Error("private contribution failed");
    await m.contributions.addFact(familyId, e1, "2026-08-10 小满出生。");

    // 封存胶囊（未到期）
    const cap = await m.capsules.createCapsule(familyId, {
      title: "写给一岁的你",
      unlockType: "date",
      unlockValue: "2027-08-10",
    });
    if (!cap.ok) throw new Error("capsule failed");
    await m.capsules.addCapsuleEvent(familyId, cap.capsuleId, e1);
    const sealed = await m.capsules.sealCapsule(familyId, cap.capsuleId);
    if (!sealed) throw new Error("seal failed");

    // 导出
    const exported = await m.exportSvc.buildFamilyExport(familyId);

    // 快照期望值（独立于实现读取）
    const people = await m.family.listPeople(familyId);
    const events = await m.memories.listMemoryEvents(familyId);
    const contributionRows = await db.select().from(m.schema.contribution);
    const factRows = await db.select().from((await import("@/db/schema/contribution")).fact);
    const factSourceRows = await db.select().from(m.schema.factSource);
    const tagRows = await db.select().from(m.schema.memoryEventTag);
    const storage = m.storage.getAssetStorage();
    const assets = [photo.asset, audio.asset, video.asset].map((a) => ({
      id: a.id,
      sha256: a.sha256,
      bytes: a.bytes,
      mimeType: a.mimeType,
      fileBytes: storage.read(a.storageKey).toString("base64"),
    }));
    const inboxItems = (await db.select().from(m.schema.inboxItem))
      .map((item) => ({
        id: item.id,
        familyId: item.familyId,
        kind: item.kind,
        status: item.status,
        rawText: item.rawText,
        memoryEventId: item.memoryEventId,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const inboxItemAssets = (await db.select().from(m.schema.inboxItemAsset))
      .map((link) => ({
        id: link.id,
        inboxItemId: link.inboxItemId,
        assetId: link.assetId,
        familyId: link.familyId,
        createdAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    snapshot = {
      zipPath: exported.filePath,
      familyId,
      familyName: "我们一家",
      familyUnlockAge: 21,
      people: people.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        isChild: p.isChild,
        isGuardian: p.isGuardian,
        childLaterUnlockedAt: p.childLaterUnlockedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        occurredAt: e.occurredAt.toISOString(),
        milestoneType: e.milestoneType,
        isPinned: e.isPinned,
        assetIds: [],
      })),
      contributions: contributionRows
        .map((row) => ({
          id: row.id,
          memoryEventId: row.memoryEventId,
          authorPersonId: row.authorPersonId,
          recordedByPersonId: row.recordedByPersonId,
          recordedByNameSnapshot: row.recordedByNameSnapshot,
          recordingMode: row.recordingMode,
          rawText: row.rawText,
          transcript: row.transcript,
          editedText: row.editedText,
          audioAssetId: row.audioAssetId,
          visibility: row.visibility,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      facts: factRows.map((f) => ({ id: f.id, statement: f.statement })),
      factSources: factSourceRows.map((s) => ({
        id: s.id,
        factId: s.factId,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
      })),
      tags: tagRows.map((t) => ({ memoryEventId: t.memoryEventId, tag: t.tag })),
      transcripts: [],
      capsules: [
        { id: cap.capsuleId, title: "写给一岁的你", status: "sealed", eventIds: [e1] },
      ],
      assets,
      inboxItems,
      inboxItemAssets,
      confirmedText: {
        eventId: e3.eventId,
        itemId: textItem.id,
        body: CONFIRMED_TEXT_BODY,
      },
    };
    expect(snapshot.events.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.people.length).toBeGreaterThanOrEqual(4);
    expect(new Set(snapshot.inboxItems.map((item) => item.status))).toEqual(
      new Set(["new", "needs_review", "confirmed", "discarded"]),
    );

    // 关闭 A（模拟灾难：原始数据丢失由 rmSync 表达——dir 由 afterAll 清理）
    m.db.closeDatabase();
  }, 120_000);

  it("Phase B：空实例 setup → restore → 全量比对（sha256/occurredAt/关系/胶囊）", async () => {
    process.env.DATA_DIR = dirB;
    const m = await freshModules();

    // 1) 全新实例：先创建管理员（认证数据不来自备份）
    const setup = await m.setup.performSetup({
      token: "restore-token",
      displayName: "新管理员",
      email: "b@example.com",
      password: "b-long-enough-password",
    });
    if (!setup.ok) throw new Error("setup B failed");
    const db = m.db.getDb();
    const adminId = (await db.select({ id: m.schema.user.id }).from(m.schema.user))[0].id;

    // 2) 恢复
    const report = await m.restoreSvc.restoreFromZipFile(snapshot.zipPath, adminId);
    expect(report.familyId).toBe(snapshot.familyId);
    expect(report.people).toBe(snapshot.people.length);
    expect(report.assets).toBe(snapshot.assets.length);
    expect(report.events).toBe(snapshot.events.length);
    expect(report.contributions).toBe(snapshot.contributions.length);
    expect(report.facts).toBe(snapshot.facts.length);
    expect(report.factSources).toBe(snapshot.factSources.length);
    expect(report.tags).toBe(snapshot.tags.length);
    expect(report.transcripts).toBe(0);
    expect(report.capsules).toBe(1);
    expect(report.inboxItems).toBe(snapshot.inboxItems.length);
    expect(report.inboxItemAssets).toBe(snapshot.inboxItemAssets.length);

    // 3) 家庭 / 成员
    const family = await m.family.getFamily(snapshot.familyId);
    expect(family?.name).toBe(snapshot.familyName);
    expect(family?.childLaterUnlockAge).toBe(snapshot.familyUnlockAge);
    const peopleB = await m.family.listPeople(snapshot.familyId);
    expect(peopleB.map((p) => p.displayName).sort()).toEqual(
      snapshot.people.map((p) => p.displayName).sort(),
    );
    const childB = peopleB.find((p) => p.isChild);
    expect(childB?.birthDate).toBe("2026-08-10");
    expect(
      peopleB
        .map((p) => ({
          id: p.id,
          displayName: p.displayName,
          isChild: p.isChild,
          isGuardian: p.isGuardian,
          childLaterUnlockedAt: p.childLaterUnlockedAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([...snapshot.people].sort((a, b) => a.id.localeCompare(b.id)));

    // 4) Asset：sha256(source) === sha256(restored)；字节逐一一致
    const storage = m.storage.getAssetStorage();
    for (const a of snapshot.assets) {
      const row = await (await import("@/lib/assets/service")).getAsset(
        snapshot.familyId,
        a.id,
      );
      expect(row, `asset ${a.id}`).toBeTruthy();
      expect(row!.sha256).toBe(a.sha256);
      expect(row!.bytes).toBe(a.bytes);
      expect(row!.mimeType).toBe(a.mimeType);
      expect(storage.read(row!.storageKey).toString("base64")).toBe(a.fileBytes);
    }

    const restoredInboxItems = (await db.select().from(m.schema.inboxItem))
      .map((item) => ({
        id: item.id,
        familyId: item.familyId,
        kind: item.kind,
        status: item.status,
        rawText: item.rawText,
        memoryEventId: item.memoryEventId,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const restoredInboxItemAssets = (await db.select().from(m.schema.inboxItemAsset))
      .map((link) => ({
        id: link.id,
        inboxItemId: link.inboxItemId,
        assetId: link.assetId,
        familyId: link.familyId,
        createdAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredInboxItems).toEqual(snapshot.inboxItems);
    expect(restoredInboxItemAssets).toEqual(snapshot.inboxItemAssets);

    // 5) 事件：occurredAt 逐一一致（时间轴不漂移）
    const detailChecks = await Promise.all(
      snapshot.events.map(async (e) => {
        const d = await m.memories.getMemoryEventDetail(snapshot.familyId, e.id);
        return d
          ? {
              id: e.id,
              at: d.event.occurredAt.toISOString(),
              title: d.event.title,
              milestoneType: d.event.milestoneType,
              isPinned: d.event.isPinned,
            }
          : null;
      }),
    );
    for (let i = 0; i < snapshot.events.length; i++) {
      expect(detailChecks[i]!.at).toBe(snapshot.events[i].occurredAt);
      expect(detailChecks[i]!.title).toBe(snapshot.events[i].title);
      expect(detailChecks[i]!.milestoneType).toBe(snapshot.events[i].milestoneType);
      expect(detailChecks[i]!.isPinned).toBe(snapshot.events[i].isPinned);
    }
    // 合并事件的素材关系恢复（2 份 A/V）
    const avDetail = await m.memories.getMemoryEventDetail(
      snapshot.familyId,
      detailChecks.find((d) => d!.title === "声音与影像")!.id,
    );
    expect(avDetail!.assets).toHaveLength(2);
    expect(avDetail!.assets.map((x) => x.type).sort()).toEqual(["audio", "video"]);

    const textDetail = await m.memories.getMemoryEventDetail(
      snapshot.familyId,
      snapshot.confirmedText.eventId,
    );
    expect(textDetail!.sourceNotes).toEqual([
      expect.objectContaining({
        id: snapshot.confirmedText.itemId,
        rawText: snapshot.confirmedText.body,
      }),
    ]);
    expect(
      await m.contributions.listContributions(
        snapshot.familyId,
        snapshot.confirmedText.eventId,
      ),
    ).toHaveLength(0);

    // 6) 讲述 / 事实
    const e1Id = snapshot.capsules[0].eventIds[0];
    const contribs = await m.contributions.listContributions(snapshot.familyId, e1Id);
    expect(contribs.map((c) => c.rawText)).toContain("外婆说：这孩子的手真小。");
    expect(contribs.map((c) => c.authorName)).toContain("外婆");
    const restoredDbContributionRows = await db
      .select()
      .from(m.schema.contribution);
    const restoredContributionRows = restoredDbContributionRows
      .map((row) => ({
        id: row.id,
        memoryEventId: row.memoryEventId,
        authorPersonId: row.authorPersonId,
        recordedByPersonId: row.recordedByPersonId,
        recordedByNameSnapshot: row.recordedByNameSnapshot,
        recordingMode: row.recordingMode,
        rawText: row.rawText,
        transcript: row.transcript,
        editedText: row.editedText,
        audioAssetId: row.audioAssetId,
        visibility: row.visibility,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredContributionRows).toEqual(snapshot.contributions);
    const restoredTranscriptRows = (await db.select().from(m.schema.assetTranscript))
      .map((row) => ({
        id: row.id,
        familyId: row.familyId,
        assetId: row.assetId,
        language: row.language,
        provider: row.provider,
        model: row.model,
        rawTranscript: row.rawTranscript,
        editedTranscript: row.editedTranscript,
        segmentsJson: row.segmentsJson,
        status: row.status,
        sourceSha256: row.sourceSha256,
        createdByJobId: row.createdByJobId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredTranscriptRows).toEqual(snapshot.transcripts);
    expect(
      restoredDbContributionRows.every((row) => row.recordedByUserId === null),
    ).toBe(true);
    expect(restoredContributionRows.map((row) => row.visibility).sort()).toEqual([
      "child_later",
      "private",
    ]);
    const facts = await m.contributions.listFacts(snapshot.familyId, e1Id);
    expect(facts.map((f) => f.statement)).toContain("2026-08-10 小满出生。");

    const restoredFactSources = (await db.select().from(m.schema.factSource))
      .map((s) => ({
        id: s.id,
        factId: s.factId,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredFactSources).toEqual(
      [...snapshot.factSources].sort((a, b) => a.id.localeCompare(b.id)),
    );

    const restoredTags = (await db.select().from(m.schema.memoryEventTag))
      .map((t) => ({ memoryEventId: t.memoryEventId, tag: t.tag }))
      .sort((a, b) => `${a.memoryEventId}-${a.tag}`.localeCompare(`${b.memoryEventId}-${b.tag}`));
    expect(restoredTags).toEqual(
      [...snapshot.tags].sort((a, b) =>
        `${a.memoryEventId}-${a.tag}`.localeCompare(`${b.memoryEventId}-${b.tag}`),
      ),
    );

    // 7) 封存胶囊：内容引用完整（导出/恢复不因 seal 丢失内容）
    const capDetail = await m.capsules.getCompleteCapsuleDetailForDisasterExport(
      snapshot.familyId,
      snapshot.capsules[0].id,
      "2026-08-10",
      "Asia/Shanghai",
    );
    expect(capDetail!.capsule.status).toBe("sealed");
    expect(capDetail!.events).toHaveLength(1);

    // 7.5) 恢复审计（v0.1.3）
    const auditList = await m.db.getDb().all(
      (await import("drizzle-orm")).sql`SELECT kind, actor_user_id, detail_json FROM audit_log`,
    );
    const restoreAudit = (auditList as Array<{ kind: string; detail_json: string }>).find(
      (r) => r.kind === "restore.completed",
    );
    expect(restoreAudit).toBeTruthy();
    const auditDetail = JSON.parse(restoreAudit!.detail_json);
    expect(auditDetail.events).toBe(snapshot.events.length);
    expect(auditDetail.inboxItems).toBe(snapshot.inboxItems.length);
    expect(auditDetail.inboxItemAssets).toBe(snapshot.inboxItemAssets.length);
    expect(auditDetail.transcripts).toBe(snapshot.transcripts.length);
    expect(auditDetail.zipBytes).toBeGreaterThan(0);

    // 8) 恢复后绑定流程：管理员绑定到「爸爸」
    const dadB = peopleB.find((p) => p.relationToChild === "爸爸")!;
    const bind = await m.family.bindRestoredFamily(adminId, dadB.id);
    expect(bind).toEqual({ ok: true, familyId: snapshot.familyId });
    const binding = await m.family.getUserBinding(adminId);
    expect(binding.familyId).toBe(snapshot.familyId);
    expect(binding.personId).toBe(dadB.id);

    m.db.closeDatabase();
  }, 120_000);
});

describe("RH-004/RH-010 恶意与非法输入", () => {
  async function buildTamperedZip(
    mutate: (zip: import("jszip")) => Promise<void>,
  ): Promise<Buffer> {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(snapshot.zipPath));
    await mutate(zip);
    return zip.generateAsync({ type: "nodebuffer" });
  }

  function mutateZipEntryHeaders(
    zipBuffer: Buffer,
    entryName: string,
    mutate: (header: {
      buffer: Buffer;
      flagsOffset: number;
      methodOffset: number;
      nameOffset: number;
    }) => void,
  ): Buffer {
    const output = Buffer.from(zipBuffer);
    const expectedName = Buffer.from(entryName);
    let matches = 0;

    for (let offset = 0; offset <= output.byteLength - 4; offset += 1) {
      const signature = output.readUInt32LE(offset);
      const isLocal = signature === 0x04034b50;
      const isCentral = signature === 0x02014b50;
      if (!isLocal && !isCentral) continue;

      const fixedSize = isLocal ? 30 : 46;
      const nameLengthOffset = offset + (isLocal ? 26 : 28);
      if (nameLengthOffset + 2 > output.byteLength) continue;
      const nameLength = output.readUInt16LE(nameLengthOffset);
      const nameOffset = offset + fixedSize;
      if (nameOffset + nameLength > output.byteLength) continue;
      if (!output.subarray(nameOffset, nameOffset + nameLength).equals(expectedName)) {
        continue;
      }

      mutate({
        buffer: output,
        flagsOffset: offset + (isLocal ? 6 : 8),
        methodOffset: offset + (isLocal ? 8 : 10),
        nameOffset,
      });
      matches += 1;
    }

    if (matches !== 2) {
      throw new Error(`expected two ZIP headers for ${entryName}, found ${matches}`);
    }
    return output;
  }

  async function freshB(dir: string) {
    process.env.DATA_DIR = dir;
    const m = await freshModules();
    const ok = await m.setup.performSetup({
      token: "restore-token",
      displayName: "op",
      email: `op-${Date.now()}@example.com`,
      password: "op-long-enough-password",
    });
    if (!ok.ok) throw new Error("setup failed");
    const adminId = (await m.db.getDb().select({ id: m.schema.user.id }).from(m.schema.user))[0].id;
    return { m, adminId };
  }

  it("策略/可见性/音频/来源档案异常 → 预验拒绝且 filesWritten=0", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-policy-preflight-"));
    const { m, adminId } = await freshB(dir);
    const putOriginal = vi.spyOn(m.storage.getAssetStorage(), "putOriginalStream");

    const cases: Array<{
      code: string;
      mutate: (zip: import("jszip")) => Promise<void>;
    }> = [
      {
        code: "bad_policy",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/family.json")!;
          const json = JSON.parse(await file.async("string"));
          json.childLaterUnlockAge = 18.5;
          zip.file("family-time-capsule-export/family.json", JSON.stringify(json));
        },
      },
      {
        code: "bad_policy",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/people.json")!;
          const json = JSON.parse(await file.async("string"));
          json.find((p: { isChild: boolean }) => p.isChild).isGuardian = true;
          zip.file("family-time-capsule-export/people.json", JSON.stringify(json));
        },
      },
      {
        code: "bad_policy",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/people.json")!;
          const json = JSON.parse(await file.async("string"));
          json.find((p: { isChild: boolean }) => p.isChild).childLaterUnlockedAt =
            "not-an-instant";
          zip.file("family-time-capsule-export/people.json", JSON.stringify(json));
        },
      },
      {
        code: "bad_policy",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/people.json")!;
          const json = JSON.parse(await file.async("string"));
          json.find((p: { isChild: boolean }) => p.isChild).childLaterUnlockedAt =
            "1969-12-31T23:59:59.000Z";
          zip.file("family-time-capsule-export/people.json", JSON.stringify(json));
        },
      },
      {
        code: "bad_visibility",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/contributions.json")!;
          const json = JSON.parse(await file.async("string"));
          json[0].visibility = "public";
          zip.file(
            "family-time-capsule-export/contributions.json",
            JSON.stringify(json),
          );
        },
      },
      {
        code: "bad_audio_ref",
        mutate: async (zip) => {
          const manifestFile = zip.file(
            "family-time-capsule-export/manifest.json",
          )!;
          const manifest = JSON.parse(await manifestFile.async("string"));
          const imageId = manifest.assets.find(
            (a: { type: string }) => a.type === "image",
          ).assetId;
          const file = zip.file("family-time-capsule-export/contributions.json")!;
          const json = JSON.parse(await file.async("string"));
          json[0].audioAssetId = imageId;
          zip.file(
            "family-time-capsule-export/contributions.json",
            JSON.stringify(json),
          );
        },
      },
      {
        code: "bad_provenance",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/contributions.json")!;
          const json = JSON.parse(await file.async("string"));
          json[0].recordingMode = "self";
          json[0].recordedByPersonId = null;
          zip.file(
            "family-time-capsule-export/contributions.json",
            JSON.stringify(json),
          );
        },
      },
      {
        code: "bad_provenance",
        mutate: async (zip) => {
          const file = zip.file("family-time-capsule-export/contributions.json")!;
          const json = JSON.parse(await file.async("string"));
          json[0].recordedByUserId = "destroyed-instance-user";
          zip.file(
            "family-time-capsule-export/contributions.json",
            JSON.stringify(json),
          );
        },
      },
    ];

    for (const testCase of cases) {
      putOriginal.mockClear();
      const buf = await buildTamperedZip(testCase.mutate);
      await expect(
        m.restoreSvc.restoreFromZip(buf, adminId),
      ).rejects.toMatchObject({ code: testCase.code });
      expect(putOriginal, testCase.code).not.toHaveBeenCalled();
      expect(
        await m.db.getDb().select().from(m.schema.family),
        testCase.code,
      ).toHaveLength(0);
      expect(existsSync(path.join(dir, "originals", snapshot.familyId))).toBe(
        false,
      );
    }

    putOriginal.mockRestore();
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("哈希不符 → 拒绝且数据库保持为空", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-tamper-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      const names = Object.keys(zip.files).filter((n) =>
        n.match(/originals\/(images|audio|video)\/[0-9a-f-]+\./),
      );
      const f = zip.file(names[0])!;
      const data = await f.async("nodebuffer");
      zip.file(names[0], Buffer.concat([data, Buffer.from("X")]));
    });
    await expect(m.restoreSvc.restoreFromZip(buf, adminId)).rejects.toMatchObject({
      code: "hash_mismatch",
    });
    // 无半恢复状态
    const families = await m.db.getDb().select().from((await import("@/db/schema/family")).family);
    expect(families).toHaveLength(0);
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("restoreFromZipFile 使用文件句柄读取，不整包 readFileSync", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-file-stream-"));
    const { m, adminId } = await freshB(dir);
    const readFileSpy = vi.spyOn(fs, "readFileSync");

    const report = await m.restoreSvc.restoreFromZipFile(snapshot.zipPath, adminId);

    const archiveReads = readFileSpy.mock.calls.filter(([target]) =>
      typeof target === "string"
        ? path.resolve(target) === path.resolve(snapshot.zipPath)
        : false,
    );
    expect(archiveReads).toHaveLength(0);
    expect(report.assets).toBe(snapshot.assets.length);
    expect(report.filesWritten).toBe(snapshot.assets.length);

    readFileSpy.mockRestore();
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("文件路径恢复遇到哈希不符或坏 ZIP 均不留下半恢复文件", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-file-rollback-"));
    const { m, adminId } = await freshB(dir);
    const archivePath = path.join(dir, "tampered.zip");
    const tampered = await buildTamperedZip(async (zip) => {
      const assetName = Object.keys(zip.files).find((name) =>
        /originals\/(images|audio|video)\/[0-9a-f-]+\./.test(name),
      )!;
      const bytes = await zip.file(assetName)!.async("nodebuffer");
      zip.file(assetName, Buffer.concat([bytes, Buffer.from("corrupt")]));
    });
    writeFileSync(archivePath, tampered);

    await expect(
      m.restoreSvc.restoreFromZipFile(archivePath, adminId),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(await m.db.getDb().select().from(m.schema.family)).toHaveLength(0);
    expect(existsSync(path.join(dir, "originals", snapshot.familyId))).toBe(false);

    writeFileSync(archivePath, "this is not a zip archive");
    await expect(
      m.restoreSvc.restoreFromZipFile(archivePath, adminId),
    ).rejects.toMatchObject({ code: "bad_zip" });
    expect(await m.db.getDb().select().from(m.schema.family)).toHaveLength(0);
    expect(existsSync(path.join(dir, "originals", snapshot.familyId))).toBe(false);

    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("重复、加密与不支持压缩方法的 ZIP 条目在写文件前拒绝", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-zip-metadata-"));
    const { m, adminId } = await freshB(dir);
    const root = "family-time-capsule-export";
    const putOriginal = vi.spyOn(m.storage.getAssetStorage(), "putOriginalStream");

    const duplicateSource = await buildTamperedZip(async (zip) => {
      zip.file(`${root}/duplicate-a.txt`, "a");
      zip.file(`${root}/duplicate-b.txt`, "b");
    });
    const duplicate = mutateZipEntryHeaders(
      duplicateSource,
      `${root}/duplicate-b.txt`,
      ({ buffer, nameOffset }) => {
        Buffer.from(`${root}/duplicate-a.txt`).copy(buffer, nameOffset);
      },
    );

    const encryptedSource = await buildTamperedZip(async (zip) => {
      zip.file(`${root}/encrypted.bin`, "encrypted metadata probe");
    });
    const encrypted = mutateZipEntryHeaders(
      encryptedSource,
      `${root}/encrypted.bin`,
      ({ buffer, flagsOffset }) => {
        buffer.writeUInt16LE(buffer.readUInt16LE(flagsOffset) | 0x1, flagsOffset);
      },
    );

    const compressionSource = await buildTamperedZip(async (zip) => {
      zip.file(`${root}/unsupported.bin`, "compression metadata probe");
    });
    const unsupportedCompression = mutateZipEntryHeaders(
      compressionSource,
      `${root}/unsupported.bin`,
      ({ buffer, methodOffset }) => buffer.writeUInt16LE(99, methodOffset),
    );

    for (const zipBuffer of [duplicate, encrypted, unsupportedCompression]) {
      await expect(
        m.restoreSvc.restoreFromZip(zipBuffer, adminId),
      ).rejects.toMatchObject({ code: "bad_zip" });
    }
    expect(putOriginal).not.toHaveBeenCalled();
    expect(await m.db.getDb().select().from(m.schema.family)).toHaveLength(0);
    expect(existsSync(path.join(dir, "originals", snapshot.familyId))).toBe(false);

    putOriginal.mockRestore();
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("不支持的 exportVersion → 拒绝", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-ver-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      const f = zip.file("family-time-capsule-export/manifest.json")!;
      const manifest = JSON.parse(await f.async("string"));
      manifest.exportVersion = 99;
      zip.file("family-time-capsule-export/manifest.json", JSON.stringify(manifest));
    });
    await expect(m.restoreSvc.restoreFromZip(buf, adminId)).rejects.toMatchObject({
      code: "unsupported_version",
    });
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("旧 exportVersion=1 增量字段缺失 → 按安全默认值兼容恢复", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-legacy-inbox-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      zip.remove("family-time-capsule-export/inbox-items.json");
      zip.remove("family-time-capsule-export/inbox-item-assets.json");
      zip.remove("family-time-capsule-export/fact-sources.json");
      zip.remove("family-time-capsule-export/transcripts.json");
      for (const name of [
        "import-sessions.json",
        "import-session-default-participants.json",
        "import-session-items.json",
        "contribution-requests.json",
        "contribution-request-submissions.json",
        "contribution-portal-submissions.json",
        "review-periods.json",
        "review-period-events.json",
      ]) zip.remove(`family-time-capsule-export/${name}`);
      const manifestFile = zip.file("family-time-capsule-export/manifest.json")!;
      const manifest = JSON.parse(await manifestFile.async("string"));
      manifest.fileCount -= 12;
      zip.file(
        "family-time-capsule-export/manifest.json",
        JSON.stringify(manifest),
      );
      const familyFile = zip.file("family-time-capsule-export/family.json")!;
      const familyJson = JSON.parse(await familyFile.async("string"));
      delete familyJson.childLaterUnlockAge;
      delete familyJson.weekStartsOn;
      delete familyJson.reviewReminderWeekday;
      delete familyJson.reviewReminderLocalTime;
      delete familyJson.remindPendingInbox;
      delete familyJson.remindPendingRequests;
      delete familyJson.remindUpcomingCapsules;
      zip.file(
        "family-time-capsule-export/family.json",
        JSON.stringify(familyJson),
      );
      const peopleFile = zip.file("family-time-capsule-export/people.json")!;
      const peopleJson = JSON.parse(await peopleFile.async("string"));
      for (const person of peopleJson) {
        delete person.isGuardian;
        delete person.childLaterUnlockedAt;
        delete person.updatedAt;
      }
      zip.file(
        "family-time-capsule-export/people.json",
        JSON.stringify(peopleJson),
      );
      const contributionsFile = zip.file(
        "family-time-capsule-export/contributions.json",
      )!;
      const contributionsJson = JSON.parse(
        await contributionsFile.async("string"),
      );
      for (const contribution of contributionsJson) {
        delete contribution.recordedByPersonId;
        delete contribution.recordedByNameSnapshot;
        delete contribution.recordingMode;
        delete contribution.transcript;
        delete contribution.updatedAt;
      }
      zip.file(
        "family-time-capsule-export/contributions.json",
        JSON.stringify(contributionsJson),
      );
    });
    const report = await m.restoreSvc.restoreFromZip(buf, adminId);
    expect(report.inboxItems).toBe(0);
    expect(report.inboxItemAssets).toBe(0);
    expect(report.factSources).toBe(0);
    expect(report.tags).toBe(0);
    expect(report.transcripts).toBe(0);
    expect(await m.db.getDb().select().from(m.schema.inboxItem)).toHaveLength(0);
    expect((await m.family.getFamily(snapshot.familyId))?.childLaterUnlockAge).toBe(
      18,
    );
    expect(await m.family.getFamily(snapshot.familyId)).toMatchObject({
      weekStartsOn: 1,
      reviewReminderWeekday: 0,
      reviewReminderLocalTime: "19:30",
      remindPendingInbox: true,
      remindPendingRequests: true,
      remindUpcomingCapsules: true,
    });
    expect(
      (await m.family.listPeople(snapshot.familyId)).every(
        (person) => !person.isGuardian && person.childLaterUnlockedAt === null,
      ),
    ).toBe(true);
    expect(
      (await m.db.getDb().select().from(m.schema.contribution)).every(
        (contribution) =>
          contribution.recordingMode === "legacy" &&
          contribution.recordedByPersonId === null &&
          contribution.recordedByNameSnapshot === null &&
          contribution.transcript === null,
      ),
    ).toBe(true);
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("新归档只缺一份 inbox 文件 → 拒绝部分关系图", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-partial-inbox-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      zip.remove("family-time-capsule-export/inbox-item-assets.json");
    });
    await expect(m.restoreSvc.restoreFromZip(buf, adminId)).rejects.toMatchObject({
      code: "missing_json",
    });
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("1.1 关系图只缺一份文件 → 写原件前拒绝", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-partial-v11-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      zip.remove("family-time-capsule-export/review-period-events.json");
    });
    await expect(m.restoreSvc.restoreFromZip(buf, adminId)).rejects.toMatchObject({
      code: "missing_json",
    });
    expect(existsSync(path.join(dir, "originals", snapshot.familyId))).toBe(false);
    expect(await m.db.getDb().select().from(m.schema.family)).toHaveLength(0);
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("事务内行数复核失败 → 数据库回滚且已写原件清理", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-verify-rollback-"));
    const { m, adminId } = await freshB(dir);
    const db = m.db.getDb();

    // 模拟底层静默漏写非 Inbox 事件素材关系；若未复核所有关系表，这会留下一个
    // 实际已恢复但调用方收到失败的半成功实例。
    db.$client.exec(`
      CREATE TRIGGER ignore_restored_memory_event_asset
      BEFORE INSERT ON memory_event_asset
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    await expect(
      m.restoreSvc.restoreFromZipFile(snapshot.zipPath, adminId),
    ).rejects.toMatchObject({ code: "post_verify_failed" });

    const familyTable = (await import("@/db/schema/family")).family;
    const assetTable = (await import("@/db/schema/asset")).asset;
    expect(await db.select().from(familyTable)).toHaveLength(0);
    expect(await db.select().from(assetTable)).toHaveLength(0);
    expect(existsSync(path.join(dir, "originals", snapshot.familyId))).toBe(false);

    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("路径穿越条目 → 拒绝（unsafe_entry）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-trav-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      zip.file("family-time-capsule-export/../../../evil.txt", "pwned");
    });
    await expect(m.restoreSvc.restoreFromZip(buf, adminId)).rejects.toMatchObject({
      code: "unsafe_entry",
    });
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("malformed manifest（assets 非数组）→ 拒绝", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-mm-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      const f = zip.file("family-time-capsule-export/manifest.json")!;
      const manifest = JSON.parse(await f.async("string"));
      manifest.assets = "not-an-array";
      zip.file("family-time-capsule-export/manifest.json", JSON.stringify(manifest));
    });
    await expect(m.restoreSvc.restoreFromZip(buf, adminId)).rejects.toMatchObject({
      code: "bad_manifest",
    });
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("解压限额（单文件 / 条目数）→ 拒绝且不留文件", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-bomb-"));
    const { m, adminId } = await freshB(dir);
    const zipBuffer = readFileSync(snapshot.zipPath);
    // 单文件解压上限压到 10 字节：任何真实原件都超限
    await expect(
      m.restoreSvc.restoreFromZip(zipBuffer, adminId, {
        limits: {
          maxEntries: 200_000,
          maxSingleFileBytes: 10,
          maxTotalUncompressedBytes: 25 * 1024 * 1024 * 1024,
        },
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });
    // 条目数上限 1：必超
    await expect(
      m.restoreSvc.restoreFromZip(zipBuffer, adminId, {
        limits: {
          maxEntries: 1,
          maxSingleFileBytes: 2 * 1024 * 1024 * 1024,
          maxTotalUncompressedBytes: 25 * 1024 * 1024 * 1024,
        },
      }),
    ).rejects.toMatchObject({ code: "too_many_entries" });
    const families = await m.db.getDb().select().from((await import("@/db/schema/family")).family);
    expect(families).toHaveLength(0);
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("目标非空（已有 Family）→ 明确拒绝 merge", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-nonempty-"));
    const { m, adminId } = await freshB(dir);
    // 先做一次成功恢复 → 家庭已存在
    await m.restoreSvc.restoreFromZipFile(snapshot.zipPath, adminId);
    // 第二次恢复 → 拒绝
    await expect(
      m.restoreSvc.restoreFromZipFile(snapshot.zipPath, adminId),
    ).rejects.toMatchObject({ code: "target_not_empty" });
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("operator 不存在 → 拒绝", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-op-"));
    const { m } = await freshB(dir);
    await expect(
      m.restoreSvc.restoreFromZip(readFileSync(snapshot.zipPath), "no-such-user"),
    ).rejects.toMatchObject({ code: "bad_operator" });
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("operator 必须是 enabled admin；干净实例的 unbound setup admin 可用", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-operator-policy-"));
    const { m, adminId } = await freshB(dir);
    const db = m.db.getDb();
    const now = new Date();
    await db.insert(m.schema.user).values([
      {
        id: "viewer-operator",
        name: "viewer",
        email: "viewer-operator@example.com",
        emailVerified: false,
        role: "viewer",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "disabled-admin-operator",
        name: "disabled admin",
        email: "disabled-admin-operator@example.com",
        emailVerified: false,
        role: "admin",
        disabledAt: now,
        disabledByUserId: adminId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const putOriginal = vi.spyOn(m.storage.getAssetStorage(), "putOriginalStream");

    for (const operatorId of ["viewer-operator", "disabled-admin-operator"]) {
      await expect(
        m.restoreSvc.restoreFromZip(readFileSync(snapshot.zipPath), operatorId),
      ).rejects.toMatchObject({ code: "bad_operator" });
    }
    expect(putOriginal).not.toHaveBeenCalled();

    // The normal successful Phase B above proves this exact clean-instance
    // setup admin shape is accepted; assert its binding state explicitly here.
    const setupAdmin = await db
      .select()
      .from(m.schema.user)
      .where((await import("drizzle-orm")).eq(m.schema.user.id, adminId));
    expect(setupAdmin[0]).toMatchObject({
      role: "admin",
      familyId: null,
      personId: null,
      disabledAt: null,
    });

    putOriginal.mockRestore();
    m.db.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });
});
