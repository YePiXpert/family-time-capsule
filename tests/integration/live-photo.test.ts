import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * RH-002：Live Photo 安全摄取基础。
 * P0.1 不做 Apple Live Photo 自动识别：HEIC/JPEG（静帧）+ MOV（动帧）
 * 是两个独立 Asset，可同时上传、独立保存、独立 SHA-256、进 Inbox、
 * 由用户合并为同一个 MemoryEvent。绝不自动删除任何一方。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-live-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "live-token";
process.env.AUTH_SECRET = "live-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "live-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { sha256Of } = await import("@/lib/assets/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const {
  createInboxItemForAsset,
  getInboxEntry,
  listInbox,
} = await import("@/lib/inbox/service");
const {
  mergeInboxEntries,
  getMemoryEventDetail,
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

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "..", "fixtures", name));

describe("Live Photo（静帧 + 动帧）安全摄取", () => {
  it("HEIC 静帧 + MOV 动帧：同时上传、独立原件、独立 SHA-256、都进 Inbox", async () => {
    // 同一“瞬间”的两个文件（Apple 导出时常见组合）
    const still = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "IMG_2048.HEIC",
      declaredMime: "image/heic",
      buffer: fixture("sample.heic"),
      clientLastModifiedMs: new Date("2026-08-15T05:00:00Z").getTime(),
    });
    expect(still.status).toBe("stored");
    if (still.status !== "stored") return;

    const motion = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "IMG_2048.MOV",
      declaredMime: "video/quicktime",
      buffer: fixture("sample.mov"),
      clientLastModifiedMs: new Date("2026-08-15T05:00:00Z").getTime(),
    });
    expect(motion.status).toBe("stored");
    if (motion.status !== "stored") return;

    const stillItem = await createInboxItemForAsset(familyId, still.asset);
    const motionItem = await createInboxItemForAsset(familyId, motion.asset);

    // 两个独立收件箱条目
    const inbox = await listInbox(familyId);
    expect(inbox.map((e) => e.item.id)).toContain(stillItem.id);
    expect(inbox.map((e) => e.item.id)).toContain(motionItem.id);

    // 独立 SHA-256、独立文件
    expect(still.asset.sha256).not.toBe(motion.asset.sha256);
    const storage = getAssetStorage();
    expect(storage.exists(still.asset.storageKey)).toBe(true);
    expect(storage.exists(motion.asset.storageKey)).toBe(true);
    expect(still.asset.storageKey).not.toBe(motion.asset.storageKey);

    // 用户合并为一个 MemoryEvent
    const merged = await mergeInboxEntries(
      familyId,
      [stillItem.id, motionItem.id],
      { title: "窗边的那个下午" },
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const detail = (await getMemoryEventDetail(familyId, merged.eventId))!;
    expect(detail.assets).toHaveLength(2);
    const types = detail.assets.map((a) => a.type).sort();
    expect(types).toEqual(["image", "video"]);
    // 封面默认选图片（静帧）
    expect(detail.event.coverAssetId).toBe(still.asset.id);

    // 合并后两个原件都完好、未被复制或删除
    const { getAsset } = await import("@/lib/assets/service");
    const stillRow = await getAsset(familyId, still.asset.id);
    const motionRow = await getAsset(familyId, motion.asset.id);
    expect(stillRow?.sha256).toBe(sha256Of(fixture("sample.heic")));
    expect(motionRow?.sha256).toBe(sha256Of(fixture("sample.mov")));
    expect(storage.read(stillRow!.storageKey).equals(fixture("sample.heic"))).toBe(true);
    expect(storage.read(motionRow!.storageKey).equals(fixture("sample.mov"))).toBe(true);
  });

  it("JPEG 静帧 + MOV 组合同样可合并（Android/导出场景）", async () => {
    const still = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "photo_2026.jpg",
      declaredMime: "image/jpeg",
      buffer: Buffer.concat([fixture("sample.jpg"), Buffer.from([0xa1])]),
      clientLastModifiedMs: null,
    });
    const motion = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "photo_2026.mov",
      declaredMime: "video/quicktime",
      buffer: Buffer.concat([fixture("sample.mov"), Buffer.from([0xa1])]),
      clientLastModifiedMs: null,
    });
    if (still.status !== "stored" || motion.status !== "stored") {
      throw new Error("ingest failed");
    }
    const s = await createInboxItemForAsset(familyId, still.asset);
    const m = await createInboxItemForAsset(familyId, motion.asset);
    const merged = await mergeInboxEntries(familyId, [s.id, m.id], {
      title: "动起来的瞬间",
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const detail = (await getMemoryEventDetail(familyId, merged.eventId))!;
    expect(detail.assets).toHaveLength(2);
  });

  it("废弃其中一个条目不影响另一个（绝不自动删除）", async () => {
    const { discardInboxItem } = await import("@/lib/inbox/service");
    const still = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "keep-me.HEIC",
      declaredMime: "image/heic",
      buffer: Buffer.concat([fixture("sample.heic"), Buffer.from([0xb2])]),
      clientLastModifiedMs: null,
    });
    const motion = await ingestMedia({
      familyId,
      createdByUserId: adminUserId,
      kind: "video",
      filename: "drop-me.MOV",
      declaredMime: "video/quicktime",
      buffer: Buffer.concat([fixture("sample.mov"), Buffer.from([0xb3])]),
      clientLastModifiedMs: null,
    });
    if (still.status !== "stored" || motion.status !== "stored") {
      throw new Error("ingest failed");
    }
    const s = await createInboxItemForAsset(familyId, still.asset);
    const m = await createInboxItemForAsset(familyId, motion.asset);

    // 用户明确废弃 MOV 条目
    expect(await discardInboxItem(familyId, m.id)).toBe(true);
    // 另一条目仍在（无时间素材为 needs_review，属预期）
    const entry = await getInboxEntry(familyId, s.id);
    expect(entry?.item.status).toBe("needs_review");
    // 被废弃的 MOV「原件」依然保留（收件箱废弃不删文件）
    const storage = getAssetStorage();
    expect(storage.exists(motion.asset.storageKey)).toBe(true);
  });
});

it("persists explicit pair roles through private draft HTTP, publication and portable archive", async () => {
  const { randomUUID } = await import("node:crypto");
  const { eq } = await import("drizzle-orm");
  const { getUserBinding } = await import("@/lib/family/service");
  const { session } = await import("@/db/schema/auth");
  const { emptyDraftContent } = await import("@/lib/drafts/model");
  const { saveDraft, getDraft, publishDraft } = await import("@/lib/drafts/service");
  const { memoryEventAsset } = await import("@/db/schema/memory");
  const { buildDisasterExport } = await import("@/lib/export/service");
  const { PUT } = await import("@/app/api/mobile/v1/drafts/[id]/route");
  const binding = await getUserBinding(adminUserId);
  const ctx = { userId: adminUserId, userName: "爸爸", familyId, personId: binding.personId, role: binding.role, accountEnabled: true as const, isGuardian: false, familyTimezone: "Asia/Shanghai", childLaterUnlockAge: 18 };
  const originals = db.select().from((await import("@/db/schema/asset")).asset).all();
  const still = originals.find(a => a.type === "image" && !a.originalAssetId)!, motion = originals.find(a => a.type === "video" && !a.originalAssetId)!;
  const group = randomUUID(), id = randomUUID();
  const content = { ...emptyDraftContent(), text: "Live Photo 的完整一刻", occurredAtPrecision: "unknown", visibility: "private", items: [still, motion].map((a, n) => ({ id: randomUUID(), assetId: a.id, localCaptureRef: null, caption: "", livePhotoGroupId: group, livePhotoRole: n === 0 ? "image" : "video" })) };
  const token = randomUUID();
  db.insert(session).values({ id: randomUUID(), token, userId: adminUserId, expiresAt: new Date(Date.now() + 3600000) }).run();
  const response = await PUT(new Request(`http://localhost/api/mobile/v1/drafts/${id}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, mutationId: randomUUID(), content }) }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  expect((await response.json()).items).toEqual(content.items);
  expect(getDraft(ctx, id).items).toEqual(content.items);
  expect(() => saveDraft(ctx, randomUUID(), 0, randomUUID(), { ...content, items: [content.items[0]] })).toThrow("invalid_draft");
  expect(() => saveDraft(ctx, randomUUID(), 0, randomUUID(), { ...content, items: content.items.map(i => ({ ...i, id: randomUUID(), livePhotoRole: i.livePhotoRole === "image" ? "video" : "image" })) })).toThrow("invalid_live_photo");
  const pending = saveDraft(ctx, randomUUID(), 0, randomUUID(), { ...content, items: content.items.map((i,n) => ({ ...i, id: randomUUID(), ...(n === 1 ? { assetId: null, localCaptureRef: "pending-motion" } : {}) })) });
  expect(() => publishDraft(ctx, pending.id, pending.revision)).toThrow("originals_pending");
  const published = publishDraft(ctx, id, 1);
  const links = db.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, published.memoryEventId!)).all();
  expect(links.map(l => ({ assetId: l.assetId, livePhotoGroupId: l.livePhotoGroupId, livePhotoRole: l.livePhotoRole }))).toEqual(content.items.map(({ assetId, livePhotoGroupId, livePhotoRole }) => ({ assetId, livePhotoGroupId, livePhotoRole })));
  // Old clients keep pairing metadata when they edit captions, and cannot remove one side.
  const editing = saveDraft(ctx, randomUUID(), 0, randomUUID(), { ...content, items: content.items.map(i => ({ ...i, id: randomUUID() })) });
  const legacyItems = editing.items.map(({ id, assetId, localCaptureRef, caption }) => ({ id, assetId, localCaptureRef, caption }));
  const legacySaved = saveDraft(ctx, editing.id, editing.revision, randomUUID(), { ...editing, items: legacyItems });
  expect(legacySaved.items.map(i => i.livePhotoRole)).toEqual(["image", "video"]);
  expect(() => saveDraft(ctx, editing.id, legacySaved.revision, randomUUID(), { ...legacySaved, items: legacyItems.slice(0,1) })).toThrow("invalid_live_photo");
  const { submitDraftForReview } = await import("@/lib/drafts/service");
  const { confirmInboxEntry } = await import("@/lib/memories/service");
  const extra = await ingestImage({ familyId, createdByUserId: adminUserId, filename: "before-live.jpg", declaredMime: "image/jpeg", buffer: Buffer.concat([fixture("sample.jpg"), Buffer.from("before-live")]), clientLastModifiedMs: null });
  if (extra.status !== "stored") throw new Error(extra.status);
  const offered = () => {
    const row = saveDraft(ctx, randomUUID(), 0, randomUUID(), { ...content, visibility: "family", items: [{ id: randomUUID(), assetId: extra.asset.id, localCaptureRef: null, caption: "首张" }, ...content.items.map(i => ({ ...i, id: randomUUID() }))] });
    return submitDraftForReview(ctx, row.id, row.revision);
  };
  const review = offered();
  const confirmed = await confirmInboxEntry(familyId, (await getInboxEntry(familyId, review.id))!);
  expect(confirmed.ok).toBe(true);
  if (!confirmed.ok) throw new Error(confirmed.error);
  expect((await getMemoryEventDetail(familyId, confirmed.eventId))?.livePhotos).toEqual([{ groupId: expect.any(String), imageAssetId: still.id, videoAssetId: motion.id }]);
  expect((await getMemoryEventDetail(familyId, confirmed.eventId))?.assets.map(a => a.id)).toEqual([extra.asset.id, still.id, motion.id]);
  const mergeA = offered(), mergeB = offered();
  const merged = await mergeInboxEntries(familyId, [mergeA.id, mergeB.id], { title: "两次提交的同一组" });
  expect(merged.ok).toBe(true);
  if (!merged.ok) throw new Error(merged.error);
  const mergedDetail = (await getMemoryEventDetail(familyId, merged.eventId))!;
  expect(mergedDetail.livePhotos).toHaveLength(2);
  expect(new Set(mergedDetail.livePhotos.map(p => p.groupId)).size).toBe(2);
  // Merged events may legitimately exceed the per-draft 200-item limit.
  const largerDraftIds = [];
  for (let batch = 0; batch < 2; batch++) {
    const items = [];
    for (let n = 0; n < 101; n++) {
      const result = await ingestImage({ familyId, createdByUserId: adminUserId, filename: `large-event-${batch}-${n}.jpg`, declaredMime: "image/jpeg", buffer: Buffer.concat([fixture("sample.jpg"), Buffer.from(`large-event-${batch}-${n}`)]), clientLastModifiedMs: null });
      if (result.status !== "stored") throw new Error(result.status);
      items.push({ id: randomUUID(), assetId: result.asset.id, localCaptureRef: null, caption: "原始顺序" });
    }
    const row = saveDraft(ctx, randomUUID(), 0, randomUUID(), { ...emptyDraftContent(), occurredAtPrecision: "unknown", items });
    largerDraftIds.push(submitDraftForReview(ctx, row.id, row.revision).id);
  }
  const larger = await mergeInboxEntries(familyId, largerDraftIds, { title: "202份素材的共同记忆" });
  if (!larger.ok) throw new Error(larger.error);
  const { default: JSZip } = await import("jszip");
  const backup = await buildDisasterExport(familyId, { actorUserId: adminUserId });
  const zip = await JSZip.loadAsync(readFileSync(backup.filePath));
  const memories = JSON.parse(await zip.file("family-time-capsule-export/memories.json")!.async("string"));
  expect(memories.find((m: { id: string }) => m.id === published.memoryEventId).assetReferences).toEqual(content.items.map(({ assetId, livePhotoGroupId, livePhotoRole, caption }) => ({ assetId, livePhotoGroupId, livePhotoRole, caption })));
  const { execFileSync } = await import("node:child_process");
  expect(execFileSync(process.execPath, ["scripts/verify-export.mjs", backup.filePath], { cwd: process.cwd(), encoding: "utf8" })).toContain("校验通过");
  const exportMemory = memories.find((m: { id: string }) => m.id === published.memoryEventId);
  exportMemory.assetReferences[0].memoryEventId = larger.eventId;
  exportMemory.assetReferences[0].id = "spoofed-reference-id";
  zip.file("family-time-capsule-export/memories.json", JSON.stringify(memories));
  const bytes = await zip.generateAsync({ type: "nodebuffer" }), restoreDir = mkdtempSync(path.join(tmpdir(), "ftc-live-restore-"));
  (await import("@/db")).closeDatabase();
  process.env.DATA_DIR = restoreDir; vi.resetModules();
  const target = await import("@/db");
  try {
    await (await import("@/lib/auth/setup")).performSetup({ token: "live-token", displayName: "恢复测试维护者", email: "restore@example.invalid", password: "synthetic-restore-password" });
    const { sql } = await import("drizzle-orm");
    const operator = target.getDb().get<{ id: string }>(sql`select id from user`)!;
    await (await import("@/lib/restore/service")).restoreFromZip(bytes, operator.id);
    const restored = target.getDb().all(sql`select asset_id, live_photo_group_id, live_photo_role from memory_event_asset where memory_event_id=${published.memoryEventId} order by sort_order`);
    expect(restored).toEqual(content.items.map(i => ({ asset_id: i.assetId, live_photo_group_id: i.livePhotoGroupId, live_photo_role: i.livePhotoRole })));
    expect(target.getDb().all(sql`pragma foreign_key_check`)).toEqual([]);
    expect(target.getDb().get(sql`select count(*) n from memory_event_asset where memory_event_id=${larger.eventId}`)).toEqual({ n: 202 });
    expect(target.getDb().get(sql`select count(*) n from memory_event_asset where id='spoofed-reference-id'`)).toEqual({ n: 0 });
    expect(target.getDb().all(sql`select live_photo_role from draft_item where draft_id=${pending.id} order by sort_order`)).toEqual([{ live_photo_role: "image" }, { live_photo_role: "video" }]);
  } finally { target.closeDatabase(); process.env.DATA_DIR = dataDir; vi.resetModules(); rmSync(restoreDir, { recursive: true, force: true }); }

});
