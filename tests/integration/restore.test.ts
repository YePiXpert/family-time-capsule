import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  people: Array<{ id: string; displayName: string; isChild: boolean }>;
  events: Array<{ id: string; title: string; occurredAt: string; assetIds: string[] }>;
  contributions: Array<{ id: string; authorPersonId: string; text: string }>;
  facts: Array<{ id: string; statement: string }>;
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
      inboxItem: (await import("@/db/schema/inbox")).inboxItem,
      inboxItemAsset: (await import("@/db/schema/inbox")).inboxItemAsset,
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
    });
    if (!onboarding.ok) throw new Error("onboarding A failed");
    const familyId = onboarding.familyId;
    await m.family.addPerson(familyId, { displayName: "妈妈", relationToChild: "妈妈" });
    const grandma = await m.family.addPerson(familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    if (!grandma.ok) throw new Error("addPerson failed");

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
      rawText: "外婆说：这孩子的手真小。",
      visibility: "child_later",
    });
    if (!contrib.ok) throw new Error("contribution failed");
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
      people: people.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        isChild: p.isChild,
      })),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        occurredAt: e.occurredAt.toISOString(),
        assetIds: [],
      })),
      contributions: [{ id: contrib.contributionId, authorPersonId: grandma.personId, text: "外婆说：这孩子的手真小。" }],
      facts: [{ id: "", statement: "2026-08-10 小满出生。" }],
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
    expect(report.contributions).toBe(1);
    expect(report.facts).toBe(1);
    expect(report.capsules).toBe(1);
    expect(report.inboxItems).toBe(snapshot.inboxItems.length);
    expect(report.inboxItemAssets).toBe(snapshot.inboxItemAssets.length);

    // 3) 家庭 / 成员
    const family = await m.family.getFamily(snapshot.familyId);
    expect(family?.name).toBe(snapshot.familyName);
    const peopleB = await m.family.listPeople(snapshot.familyId);
    expect(peopleB.map((p) => p.displayName).sort()).toEqual(
      snapshot.people.map((p) => p.displayName).sort(),
    );
    const childB = peopleB.find((p) => p.isChild);
    expect(childB?.birthDate).toBe("2026-08-10");

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
        return d ? { id: e.id, at: d.event.occurredAt.toISOString(), title: d.event.title } : null;
      }),
    );
    for (let i = 0; i < snapshot.events.length; i++) {
      expect(detailChecks[i]!.at).toBe(snapshot.events[i].occurredAt);
      expect(detailChecks[i]!.title).toBe(snapshot.events[i].title);
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
    expect(contribs[0].authorName).toBe("外婆");
    const facts = await m.contributions.listFacts(snapshot.familyId, e1Id);
    expect(facts.map((f) => f.statement)).toContain("2026-08-10 小满出生。");

    // 7) 封存胶囊：内容引用完整（导出/恢复不因 seal 丢失内容）
    const capDetail = await m.capsules.getCapsuleDetail(
      snapshot.familyId,
      snapshot.capsules[0].id,
      "2026-08-10",
      "Asia/Shanghai",
      { includeLocked: true },
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

  it("旧 exportVersion=1 归档缺少两份 inbox 文件 → 按空收件箱恢复", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ftc-restore-legacy-inbox-"));
    const { m, adminId } = await freshB(dir);
    const buf = await buildTamperedZip(async (zip) => {
      zip.remove("family-time-capsule-export/inbox-items.json");
      zip.remove("family-time-capsule-export/inbox-item-assets.json");
      const manifestFile = zip.file("family-time-capsule-export/manifest.json")!;
      const manifest = JSON.parse(await manifestFile.async("string"));
      manifest.fileCount -= 2;
      zip.file(
        "family-time-capsule-export/manifest.json",
        JSON.stringify(manifest),
      );
    });
    const report = await m.restoreSvc.restoreFromZip(buf, adminId);
    expect(report.inboxItems).toBe(0);
    expect(report.inboxItemAssets).toBe(0);
    expect(await m.db.getDb().select().from(m.schema.inboxItem)).toHaveLength(0);
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
});
