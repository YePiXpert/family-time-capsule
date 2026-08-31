import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";
import type { MemoryAssistant } from "@/lib/ai/types";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-inbox-suggestions-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "inbox-suggestions-setup-token";
process.env.AUTH_SECRET = "inbox-suggestions-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { aiSuggestion } = await import("@/db/schema/suggestion");
const { clusterSuggestion } = await import("@/db/schema/clusters");
const { asset: assetTable } = await import("@/db/schema/asset");
const { inboxItemAsset } = await import("@/db/schema/inbox");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const {
  createInboxItemForAsset,
  getInboxEntry,
} = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const {
  claimNextAiJob,
  enqueueAiJob,
  finalizeAiJob,
} = await import("@/lib/ai/jobs");
const {
  requestInboxSuggestionsBatch,
  resolveInboxSuggestion,
} = await import("@/lib/suggestions/service");
const {
  scanInboxClusters,
  listPendingClusterSuggestions,
  resolveClusterSuggestion,
} = await import("@/lib/clusters/service");
const { suggestInboxItemHandler } = await import(
  "@/lib/ai/handlers/suggest-inbox-item"
);

const setup = await performSetup({
  token: "inbox-suggestions-setup-token",
  displayName: "爸爸",
  email: "dad-inbox-suggestions@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "收件箱建议测试家庭",
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
if (!binding.familyId || !binding.familyTimezone || binding.childLaterUnlockAge === null) {
  throw new Error("binding incomplete");
}

const adminContext: FamilyContext = {
  userId: adminId,
  userName: "爸爸",
  familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone,
  childLaterUnlockAge: binding.childLaterUnlockAge,
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

function jpegVariant(n: number): Buffer {
  return Buffer.concat([
    readFileSync(path.join(fixtures, "sample-exif.jpg")),
    Buffer.from([n]),
  ]);
}

function makeAssistant(payload: unknown): MemoryAssistant {
  return {
    provider: INTERNAL_RUNTIME.provider,
    capabilities: INTERNAL_RUNTIME.capabilities,
    supports: (capability: string) => capability === "text",
    generateText: vi.fn().mockResolvedValue({
      text: JSON.stringify(payload),
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
  };
}

async function makePhotoInboxItem(n: number, filename: string) {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminId,
    filename,
    declaredMime: "image/jpeg",
    buffer: jpegVariant(n),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("ingest failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  return { item, assetId: stored.asset.id };
}

async function runInboxSuggestionJob(
  inboxItemId: string,
  assetId: string,
  payload: unknown,
): Promise<void> {
  const assistant = makeAssistant(payload);
  const queued = enqueueAiJob(
    {
      familyId,
      requestedByUserId: adminId,
      jobType: "suggest.inbox_item.v1",
      entityType: "inbox_item",
      entityId: inboxItemId,
      requiredCapability: "text",
      triggerMode: "manual",
      sources: [{ kind: "asset", id: assetId }],
    },
    { runtime: INTERNAL_RUNTIME },
  );
  if (!queued.ok) throw new Error(`enqueue failed: ${queued.error}`);
  const lease = claimNextAiJob("inbox-suggestions-worker", {
    runtime: INTERNAL_RUNTIME,
    leaseMs: 5_000,
  });
  if (!lease || lease.jobId !== queued.jobId) throw new Error("job not claimed");
  const result = await suggestInboxItemHandler({
    lease,
    assistant: assistant as unknown as MemoryAssistant,
    signal: new AbortController().signal,
  });
  const finalized = finalizeAiJob(
    lease,
    (tx, context) => result.commit(tx, context),
    { runtime: INTERNAL_RUNTIME },
  );
  if (!finalized.ok) throw new Error(`finalize failed: ${finalized.error}`);
}

describe("M3-E：收件箱 occurred_at 建议", () => {
  it("生成带精度的时间建议；接受绝不改写素材拍摄时间", async () => {
    const { item, assetId } = await makePhotoInboxItem(101, "海边下午.jpg");
    await runInboxSuggestionJob(item.id, assetId, {
      title: "海边的下午",
      occurredAt: "2026-08-20T06:30:00.000Z",
      timePrecision: "date_only",
      personNames: [],
      tags: ["海边"],
    });

    const pending = getDb()
      .select()
      .from(aiSuggestion)
      .where(
        eq(aiSuggestion.entityId, item.id),
      )
      .all()
      .filter((s) => s.status === "pending");
    const occurred = pending.find((s) => s.suggestionType === "occurred_at");
    expect(occurred).toBeTruthy();
    expect(JSON.parse(occurred!.valueJson)).toEqual({
      occurredAt: "2026-08-20T06:30:00.000Z",
      precision: "date_only",
    });

    const linkedAssetId = getDb()
      .select({ assetId: inboxItemAsset.assetId })
      .from(inboxItemAsset)
      .where(eq(inboxItemAsset.inboxItemId, item.id))
      .get()!.assetId;
    const assetBefore = getDb()
      .select()
      .from(assetTable)
      .where(eq(assetTable.id, linkedAssetId))
      .get()!;

    const accepted = await resolveInboxSuggestion(
      familyId,
      adminId,
      occurred!.id,
      "accept",
    );
    expect(accepted).toEqual({ ok: true });

    // 关键不变量：素材拍摄/导入时间不受 AI 建议影响
    const assetAfter = getDb()
      .select()
      .from(assetTable)
      .where(eq(assetTable.id, assetBefore.id))
      .get()!;
    expect(assetAfter.capturedAt?.toISOString()).toBe(
      assetBefore.capturedAt?.toISOString(),
    );
    expect(assetAfter.importedAt.toISOString()).toBe(
      assetBefore.importedAt.toISOString(),
    );
    expect(assetAfter.timeSource).toBe(assetBefore.timeSource);

    const row = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.id, occurred!.id))
      .get()!;
    expect(row.status).toBe("accepted");
  });

  it("非法精度归一为 approximate，非法时间直接拒绝", async () => {
    const { item, assetId } = await makePhotoInboxItem(102, "无精度.jpg");
    await runInboxSuggestionJob(item.id, assetId, {
      title: null,
      occurredAt: "2026-08-21T02:00:00.000Z",
      timePrecision: "whenever",
      personNames: [],
      tags: [],
    });
    const occurred = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.entityId, item.id))
      .all()
      .find((s) => s.suggestionType === "occurred_at" && s.status === "pending");
    expect(JSON.parse(occurred!.valueJson).precision).toBe("approximate");

    const bad = await resolveInboxSuggestion(
      familyId,
      adminId,
      randomUUID(),
      "accept",
    );
    expect(bad).toEqual({ ok: false, error: "not_found" });
  });

  it("reject 留下墓碑，永不采用", async () => {
    const { item, assetId } = await makePhotoInboxItem(103, "拒绝时间.jpg");
    await runInboxSuggestionJob(item.id, assetId, {
      title: null,
      occurredAt: "2026-01-01T00:00:00.000Z",
      timePrecision: "exact",
      personNames: [],
      tags: [],
    });
    const occurred = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.entityId, item.id))
      .all()
      .find((s) => s.suggestionType === "occurred_at" && s.status === "pending");
    expect(
      await resolveInboxSuggestion(familyId, adminId, occurred!.id, "reject"),
    ).toEqual({ ok: true });
    const row = getDb()
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.id, occurred!.id))
      .get()!;
    expect(row.status).toBe("rejected");
  });

  it("批量请求跳过已有 pending 建议的条目", async () => {
    const first = await requestInboxSuggestionsBatch(adminContext, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(first.requested).toBeGreaterThan(0);

    // 101/102 仍有 pending 建议 → 跳过；103 的唯一建议已被 reject
    // （没有 pending 了）→ 允许重新请求
    const again = await requestInboxSuggestionsBatch(adminContext, {
      runtime: INTERNAL_RUNTIME,
    });
    expect(again.requested).toBe(1);
    expect(again.skipped).toBe(2);
  });
});

describe("M3-F：本地分簇建议", () => {
  it("时间/画面相近的照片成簇；接受走合并；忽略不执行", async () => {
    const a = await makePhotoInboxItem(201, "连续拍摄A.jpg");
    const b = await makePhotoInboxItem(202, "连续拍摄A.jpg");

    const scan = await scanInboxClusters(adminContext);
    expect(scan.created).toBeGreaterThan(0);

    const pending = await listPendingClusterSuggestions(familyId);
    expect(pending.length).toBeGreaterThan(0);
    const kinds = new Set(pending.map((p) => p.kind));
    // 同一张图的两个副本：画面必然相似；EXIF 时间相同 → 时间也相近
    expect(kinds.has("similar_media")).toBe(true);

    const similar = pending.find((p) => p.kind === "similar_media")!;
    expect(similar.reasonText).toContain("感知哈希");
    // 成员必须包含刚导入的两条（此前测试留下的同图条目也在同一连通分量里）
    const memberIds = JSON.parse(similar.inboxItemIdsJson) as string[];
    expect(memberIds).toContain(a.item.id);
    expect(memberIds).toContain(b.item.id);

    // 接受 → 走既有 mergeInboxEntries，创建一个事件，成员素材全部进入
    const accepted = await resolveClusterSuggestion(
      adminContext,
      similar.id,
      "accept",
      "同一个瞬间",
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || !accepted.eventId) throw new Error("accept failed");
    const links = getDb()
      .select({ assetId: memoryEventAsset.assetId })
      .from(memoryEventAsset)
      .where(eq(memoryEventAsset.memoryEventId, accepted.eventId))
      .all();
    const linkedAssetIds = links.map((l) => l.assetId);
    expect(linkedAssetIds).toContain(a.assetId);
    expect(linkedAssetIds).toContain(b.assetId);
    const event = getDb()
      .select()
      .from(memoryEvent)
      .where(eq(memoryEvent.id, accepted.eventId))
      .get()!;
    expect(event.title).toBe("同一个瞬间");

    // 已处理的建议不能重复接受
    const repeat = await resolveClusterSuggestion(adminContext, similar.id, "accept");
    expect(repeat).toEqual({ ok: false, error: "already_resolved" });

    // 剩余簇：成员已被合并 → 下次扫描清理
    const rescan = await scanInboxClusters(adminContext);
    expect(rescan.refreshed).toBeGreaterThan(0);
    expect((await listPendingClusterSuggestions(familyId)).length).toBe(0);
  });

  it("dismiss 保持非破坏性：不创建任何事件", async () => {
    const before = getDb()
      .select({ id: memoryEvent.id })
      .from(memoryEvent)
      .where(eq(memoryEvent.familyId, familyId))
      .all().length;

    const c = await makePhotoInboxItem(203, "独立瞬间C.jpg");
    const d = await makePhotoInboxItem(204, "独立瞬间D.jpg");
    await scanInboxClusters(adminContext);
    const pending = await listPendingClusterSuggestions(familyId);
    expect(pending.length).toBeGreaterThan(0);

    const target = pending.find((p) => {
      const ids = JSON.parse(p.inboxItemIdsJson) as string[];
      return ids.includes(c.item.id) && ids.includes(d.item.id);
    });
    expect(target).toBeTruthy();

    const dismissed = await resolveClusterSuggestion(
      adminContext,
      target!.id,
      "dismiss",
    );
    expect(dismissed).toEqual({ ok: true });

    const after = getDb()
      .select({ id: memoryEvent.id })
      .from(memoryEvent)
      .where(eq(memoryEvent.familyId, familyId))
      .all().length;
    expect(after).toBe(before);

    const row = getDb()
      .select()
      .from(clusterSuggestion)
      .where(eq(clusterSuggestion.id, target!.id))
      .get()!;
    expect(row.status).toBe("dismissed");
  });

  it("确认收件箱后陈旧分簇被清理", async () => {
    const e = await makePhotoInboxItem(205, "清理E.jpg");
    await scanInboxClusters(adminContext);
    const entry = await getInboxEntry(familyId, e.item.id);
    if (!entry) throw new Error("entry missing");
    const confirmed = await confirmInboxEntry(familyId, entry, {
      title: "已确认的E",
    });
    if (!confirmed.ok) throw new Error("confirm failed");

    const rescan = await scanInboxClusters(adminContext);
    const pending = await listPendingClusterSuggestions(familyId);
    // E 已离开收件箱 → 涉及 E 的 pending 建议必须被清理，且不得复活
    for (const p of pending) {
      const ids = JSON.parse(p.inboxItemIdsJson) as string[];
      expect(ids.includes(e.item.id)).toBe(false);
    }
    expect(rescan.refreshed).toBeGreaterThan(0);
  });
});
