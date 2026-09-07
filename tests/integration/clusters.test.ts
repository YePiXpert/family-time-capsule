import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "@/lib/family/context";
import type { HashedItem } from "@/lib/clusters/service";
/**
 * FIND-5 相似照片候选（GLM-D）：
 * - 「字节完全相同（SHA-256 一致）」与「画面看起来很相似」分开表述，
 *   UI/理由绝不混叫“重复照片”；
 * - 依据可解释：感知哈希距离、拍摄时间、尺寸、同一导入批次；
 * - 清晰度只是提示（细节最多），不自动选择、不删除；
 * - 接受时可只合并勾选的成员；全部保留 = 什么都不改。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-clusters-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "clusters-setup-token";
process.env.AUTH_SECRET = "clusters-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "clusters-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry, listInbox } = await import("@/lib/inbox/service");
const {
  scanInboxClusters,
  listPendingClusterSuggestions,
  resolveClusterSuggestion,
  describeSimilarGroup,
  computeImageFocusScore,
  addClusterMembersToCollection,
} = await import("@/lib/clusters/service");
const { clusterFeatureCache } = await import("@/db/schema/clusters");
const { createCollection, getCollection } = await import(
  "@/lib/collections/service"
);
const { and, eq } = await import("drizzle-orm");
const { importSession, importSessionItem } = await import("@/db/schema/import");
const { getUserBinding } = await import("@/lib/family/service");

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
const binding = await getUserBinding(adminUserId);
const adminUserRow = db.select().from(userTable).get()!;
const context = {
  userId: adminUserId,
  userName: adminUserRow.name,
  familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: false,
  familyTimezone: "Asia/Shanghai",
  childLaterUnlockAge: 18,
} as FamilyContext;

const fixtures = path.join(__dirname, "..", "fixtures");

async function ingestVariant(name: string, suffix: Buffer) {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminUserId,
    filename: name,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([readFileSync(path.join(fixtures, "sample.jpg")), suffix]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error(`store failed for ${name}`);
  const item = await createInboxItemForAsset(familyId, stored.asset);
  return { asset: stored.asset, item };
}

function hashed(asset: HashedItem["asset"], hash: string, focusScore: number | null = null): HashedItem {
  return { entry: {} as HashedItem["entry"], asset, hash, focusScore };
}

describe("相似与字节级重复分开（8.3）", () => {
  it("SHA 一致 → 字节完全相同；SHA 不同 → 画面看起来很相似，绝不叫重复照片", () => {
    const base = {
      id: "a", familyId, type: "image", originalFilename: "a.jpg", displayName: null,
      nameSource: "legacy_unknown", nameRevision: 0, participantIdsJson: "[]", metadataRevision: 0,
      mimeType: "image/jpeg", bytes: 10, sha256: "same", storageKey: "k",
      capturedAt: new Date(), importedAt: new Date(), timeSource: "import_time",
      width: 100, height: 80, durationMs: null, metadataJson: null,
      createdByUserId: adminUserId, originalAssetId: null, derivativeType: null,
      createdAt: new Date(),
    } as HashedItem["asset"];
    const sameBytes = { ...base, id: "b", originalFilename: "b.jpg" };
    const similarPixels = { ...base, id: "c", sha256: "different", originalFilename: "c.jpg" };

    const exact = describeSimilarGroup([hashed(base, "0000000000000000", 1), hashed(sameBytes, "0000000000000000", 1)]);
    expect(exact).toContain("字节完全相同（SHA-256 一致）");
    expect(exact).not.toContain("看起来很相似");

    const similar = describeSimilarGroup([hashed(base, "0000000000000000", 1), hashed(similarPixels, "0000000000000001", 1)]);
    expect(similar).toContain("画面看起来很相似");
    expect(similar).toContain("感知哈希距离");
    expect(similar).not.toContain("字节完全相同");
    expect(similar).not.toContain("重复");
  });

  it("清晰度只是“细节最多”的提示，附在可解释理由里", () => {
    const base = {
      id: "a", familyId, type: "image", originalFilename: "清晰的一张.jpg", displayName: null,
      nameSource: "legacy_unknown", nameRevision: 0, participantIdsJson: "[]", metadataRevision: 0,
      mimeType: "image/jpeg", bytes: 10, sha256: "x1", storageKey: "k",
      capturedAt: new Date(), importedAt: new Date(), timeSource: "import_time",
      width: 100, height: 80, durationMs: null, metadataJson: null,
      createdByUserId: adminUserId, originalAssetId: null, derivativeType: null,
      createdAt: new Date(),
    } as HashedItem["asset"];
    const soft = { ...base, id: "b", originalFilename: "模糊的一张.jpg", sha256: "x2" };
    const text = describeSimilarGroup([
      hashed(base, "0000000000000000", 42),
      hashed(soft, "0000000000000001", 5),
    ]);
    expect(text).toContain("「清晰的一张.jpg」细节最多");
  });

  it("焦点分数：清晰图高于模糊图", async () => {
    const sharp = (await import("sharp")).default;
    const original = readFileSync(path.join(fixtures, "sample.jpg"));
    const blurred = await sharp(original).blur(12).jpeg().toBuffer();
    const focusedScore = await computeImageFocusScore(original);
    const blurredScore = await computeImageFocusScore(blurred);
    expect(focusedScore).not.toBeNull();
    expect(blurredScore).not.toBeNull();
    expect(focusedScore!).toBeGreaterThan(blurredScore!);
  });
});

describe("收件箱相似候选：扫描、可解释依据、按勾选合并（8.2/8.5）", () => {
  it("相似组带出哈希距离/时间/尺寸/批次依据；只合并勾选成员；全部保留不改任何东西", async () => {
    // A 与 B 像素相同（SHA 不同）；C 是完全不同的画面
    const a = await ingestVariant("相似A.jpg", Buffer.from([1]));
    const b = await ingestVariant("相似B.jpg", Buffer.from([2]));
    const c = await ingestVariant("无关.jpg", Buffer.from([3]));
    void c;

    // A、B 标记为同一导入批次
    const sessionId = randomUUID();
    db.insert(importSession).values({
      id: sessionId, familyId, createdByUserId: adminUserId, source: "web",
      status: "completed", totalCount: 2, completedCount: 2, failedCount: 0,
      intakeRevision: 0,
    }).run();
    for (const [order, member] of [a, b].entries()) {
      db.insert(importSessionItem).values({
        id: randomUUID(), familyId, importSessionId: sessionId,
        captureId: randomUUID(), filename: member.asset.originalFilename,
        declaredMime: "image/jpeg", totalBytes: member.asset.bytes,
        assetId: member.asset.id, inboxItemId: member.item.id,
        status: "completed", sortOrder: order,
      }).run();
    }

    const scan = await scanInboxClusters(context);
    expect(scan.created).toBeGreaterThan(0);
    const suggestions = await listPendingClusterSuggestions(familyId);
    const similar = suggestions.find((row) => row.kind === "similar_media");
    expect(similar).toBeTruthy();
    expect(similar!.reasonText).toContain("画面看起来很相似");
    expect(similar!.reasonText).toContain("感知哈希距离");
    expect(similar!.reasonText).toContain("尺寸与方向相同");
    expect(similar!.reasonText).toContain("同一导入批次");
    expect(similar!.reasonText).not.toContain("重复");

    // 只合并 A：单个成员不够 → 拒绝
    const tooFew = await resolveClusterSuggestion(context, similar!.id, "accept", undefined, [a.item.id]);
    expect(tooFew).toEqual({ ok: false, error: "too_few_members" });

    // 合并 A+B；C 仍在收件箱
    const accepted = await resolveClusterSuggestion(context, similar!.id, "accept", "公园连拍", [a.item.id, b.item.id]);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const remaining = await listInbox(familyId, ["new", "needs_review", "processing"]);
    expect(remaining.some((entry) => entry.item.id === c.item.id)).toBe(true);
    expect(remaining.some((entry) => entry.item.id === a.item.id)).toBe(false);

    // 时间相近组：全部保留 = dismiss，条目原样留在收件箱
    const proximity = (await listPendingClusterSuggestions(familyId)).find((row) => row.kind === "time_proximity");
    if (proximity) {
      const before = await listInbox(familyId, ["new", "needs_review", "processing"]);
      const kept = await resolveClusterSuggestion(context, proximity.id, "dismiss");
      expect(kept.ok).toBe(true);
      const after = await listInbox(familyId, ["new", "needs_review", "processing"]);
      expect(after.map((entry) => entry.item.id).sort()).toEqual(before.map((entry) => entry.item.id).sort());
    }

    // 已合并的成员不再处于待整理状态（listInbox 只返回开放条目，上面已断言）
    const mergedEntry = await getInboxEntry(familyId, a.item.id);
    expect(["new", "needs_review", "processing"]).not.toContain(mergedEntry?.item.status);
  });
});

describe("相似特征持久缓存（FIND-5：来源哈希/算法版本/失效）", () => {
  it("首次扫描把 dHash 与清晰度按 SHA+算法版本落库；旧算法行与孤儿行被清理", async () => {
    const p = await ingestVariant("缓存P.jpg", Buffer.from([4]));
    const q = await ingestVariant("缓存Q.jpg", Buffer.from([5]));
    // 预埋：一行旧算法版本（真实 SHA）、一行孤儿 SHA
    db.insert(clusterFeatureCache).values([
      { sha256: "ftc-orphan-sha-not-in-asset", algorithm: "dhash-9x8+focus-64-v0", dhash: "0000000000000000", focusScore: 1, createdAt: new Date() },
      { sha256: p.asset.sha256, algorithm: "dhash-9x8+focus-64-v0", dhash: "0000000000000000", focusScore: 1, createdAt: new Date() },
    ]).run();

    await scanInboxClusters(context);

    const rows = db.select().from(clusterFeatureCache).all();
    expect(rows.some((row) => row.sha256 === "ftc-orphan-sha-not-in-asset")).toBe(false);
    expect(rows.every((row) => row.algorithm === "dhash-9x8+focus-64-v1")).toBe(true);
    const pRow = rows.find((row) => row.sha256 === p.asset.sha256);
    expect(pRow).toBeTruthy();
    expect(pRow!.dhash).toMatch(/^[0-9a-f]{16}$/u);
    expect(typeof pRow!.focusScore).toBe("number");
    // 同一画面的两张变体位串一致（同版本算法确定性；字节不同 SHA 不同）
    const qRow = rows.find((row) => row.sha256 === q.asset.sha256);
    expect(qRow!.dhash).toBe(pRow!.dhash);
  });

  it("缓存命中即权威（不再读原件重算）；损坏位串按未命中重算修复", async () => {
    // 纯噪声图：与 sample.jpg 系列画面完全不同（位串距离远大于阈值）
    const sharp = (await import("sharp")).default;
    const pixels = Buffer.alloc(96 * 72 * 3);
    let seed = 42;
    for (let i = 0; i < pixels.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      pixels[i] = (seed >>> 16) & 0xff;
    }
    const noise = await sharp(pixels, { raw: { width: 96, height: 72, channels: 3 } }).jpeg().toBuffer();
    const storedNoise = await ingestImage({
      familyId,
      createdByUserId: adminUserId,
      filename: "噪声.jpg",
      declaredMime: "image/jpeg",
      buffer: noise,
      clientLastModifiedMs: null,
    });
    if (storedNoise.status !== "stored") throw new Error("store failed for 噪声.jpg");
    const noiseItem = await createInboxItemForAsset(familyId, storedNoise.asset);
    const r = await ingestVariant("缓存R.jpg", Buffer.from([6]));

    await scanInboxClusters(context);
    const similarIds = async () =>
      (await listPendingClusterSuggestions(familyId))
        .filter((row) => row.kind === "similar_media")
        .map((row) => JSON.parse(row.inboxItemIdsJson) as string[]);
    // 初始：噪声图与照片变体不该成组
    expect(
      (await similarIds()).some((ids) => ids.includes(noiseItem.id) && ids.includes(r.item.id)),
    ).toBe(false);

    // 篡改缓存：噪声图的位串 := R 的位串。若重扫读原件重算，篡改无效；
    // 缓存命中即权威时，二者距离 0 → 成组出现。
    const rRow = db
      .select()
      .from(clusterFeatureCache)
      .where(and(eq(clusterFeatureCache.sha256, r.asset.sha256), eq(clusterFeatureCache.algorithm, "dhash-9x8+focus-64-v1")))
      .get()!;
    db.update(clusterFeatureCache)
      .set({ dhash: rRow.dhash })
      .where(and(eq(clusterFeatureCache.sha256, storedNoise.asset.sha256), eq(clusterFeatureCache.algorithm, "dhash-9x8+focus-64-v1")))
      .run();
    await scanInboxClusters(context);
    expect(
      (await similarIds()).some((ids) => ids.includes(noiseItem.id) && ids.includes(r.item.id)),
    ).toBe(true);

    // 损坏位串（非法 hex）→ 当作未命中 → 读原件重算覆写为合法位串
    db.update(clusterFeatureCache)
      .set({ dhash: "zz-not-hex" })
      .where(and(eq(clusterFeatureCache.sha256, r.asset.sha256), eq(clusterFeatureCache.algorithm, "dhash-9x8+focus-64-v1")))
      .run();
    await scanInboxClusters(context);
    const repaired = db
      .select()
      .from(clusterFeatureCache)
      .where(and(eq(clusterFeatureCache.sha256, r.asset.sha256), eq(clusterFeatureCache.algorithm, "dhash-9x8+focus-64-v1")))
      .get()!;
    expect(repaired.dhash).toMatch(/^[0-9a-f]{16}$/u);
    expect(repaired.dhash).toBe(rRow.dhash);
  });
});

describe("相似候选内嵌加入相册（FIND-5）", () => {
  it("勾选成员的原件加入新建/已有相册；建议保持待处理；错误路径如实拒绝", async () => {
    const s1 = await ingestVariant("相册S.jpg", Buffer.from([7]));
    const s2 = await ingestVariant("相册T.jpg", Buffer.from([8]));
    await scanInboxClusters(context);
    const suggestion = (await listPendingClusterSuggestions(familyId)).find(
      (row) =>
        row.kind === "similar_media" &&
        (JSON.parse(row.inboxItemIdsJson) as string[]).includes(s1.item.id) &&
        (JSON.parse(row.inboxItemIdsJson) as string[]).includes(s2.item.id),
    );
    expect(suggestion).toBeTruthy();

    // 新建相册并只加勾选的两个成员（相册只引用原件，不复制不移动）
    const created = await addClusterMembersToCollection(context, suggestion!.id, {
      newCollectionTitle: "连拍精选",
      selectedIds: [s1.item.id, s2.item.id],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detail = getCollection(context, created.collectionId);
    expect(detail.items.map((item) => item.assetId ?? "").sort())
      .toEqual([s1.asset.id, s2.asset.id].sort());

    // 加入相册不是终结动作：建议保持待处理，收件箱条目仍在
    expect(
      (await listPendingClusterSuggestions(familyId)).some((row) => row.id === suggestion!.id),
    ).toBe(true);
    expect(
      (await listInbox(familyId, ["new", "needs_review", "processing"]))
        .some((entry) => entry.item.id === s1.item.id),
    ).toBe(true);

    // 加入已有相册；不勾选 = 全部成员
    const albumId = createCollection(context, "已有相册");
    const again = await addClusterMembersToCollection(context, suggestion!.id, {
      collectionId: albumId,
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(getCollection(context, again.collectionId).items.length).toBeGreaterThanOrEqual(2);
    }

    // 错误路径：没有相册选择、建议不存在、相册不存在
    expect((await addClusterMembersToCollection(context, suggestion!.id, {})).ok).toBe(false);
    expect((await addClusterMembersToCollection(context, randomUUID(), { newCollectionTitle: "x" })).ok).toBe(false);
    expect((await addClusterMembersToCollection(context, suggestion!.id, { collectionId: randomUUID() })).ok).toBe(false);
  });
});
