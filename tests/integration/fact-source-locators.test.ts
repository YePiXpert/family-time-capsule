import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AiJobRuntimeIdentity } from "@/lib/ai/jobs";
import type { MemoryAssistant } from "@/lib/ai/types";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-fact-locators-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "fact-locators-setup-token";
process.env.AUTH_SECRET = "fact-locators-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const { fact } = await import("@/db/schema/contribution");
const { factSource } = await import("@/db/schema/suggestion");
const { asset: assetTable } = await import("@/db/schema/asset");
const { assetTranscript } = await import("@/db/schema/transcript");
const { assetAnalysis } = await import("@/db/schema/analysis");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const assetStorageModule = await import("@/lib/assets/storage");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { setFactStatus } = await import("@/lib/contributions/service");
const { buildFamilyExport } = await import("@/lib/export/service");
const { suggestEventMetadataHandler } = await import(
  "@/lib/ai/handlers/suggest-event-metadata"
);

const setup = await performSetup({
  token: "fact-locators-setup-token",
  displayName: "爸爸",
  email: "dad-locators@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "定位测试家庭",
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
if (!binding.familyTimezone || binding.childLaterUnlockAge === null) {
  throw new Error("binding incomplete");
}

const INTERNAL_RUNTIME: AiJobRuntimeIdentity = {
  provider: { id: "test-provider", displayName: "Test", external: false },
  capabilities: {
    text: { available: true, model: "test-text-v1", reason: "configured" },
    vision: { available: false, model: null, reason: "not_configured" },
    transcription: { available: false, model: null, reason: "not_configured" },
    embeddings: { available: false, model: null, reason: "not_configured" },
  },
};

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

function makeLease(entityId: string) {
  return {
    jobId: randomUUID(),
    familyId,
    jobType: "suggest.event_metadata.v1" as const,
    entityType: "memory_event" as const,
    entityId,
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
}

const child = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.isChild, true))
  .get();
if (!child) throw new Error("child missing");

let assetSerial = 0;
function insertAsset(opts: {
  type: "audio" | "image";
  mimeType: string;
  filename: string;
  extension: string;
}): { id: string; sha256: string } {
  assetSerial += 1;
  const now = new Date();
  const id = randomUUID();
  const data = Buffer.from(`locator fixture ${assetSerial}`);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const { getAssetStorage } = assetStorageModule;
  const put = getAssetStorage().putOriginal(
    familyId,
    id,
    opts.extension,
    data,
    now,
  );
  getDb()
    .insert(assetTable)
    .values({
      id,
      familyId,
      type: opts.type,
      originalFilename: opts.filename,
      mimeType: opts.mimeType,
      bytes: data.byteLength,
      sha256,
      storageKey: put.storageKey,
      capturedAt: now,
      importedAt: now,
      timeSource: "file_metadata",
      width: null,
      height: null,
      durationMs: null,
      createdByUserId: adminId,
      originalAssetId: null,
      derivativeType: null,
      createdAt: now,
    })
    .run();
  return { id, sha256 };
}

function makeEvent(title: string): string {
  const id = randomUUID();
  const now = new Date("2026-08-20T00:00:00.000Z");
  getDb()
    .insert(memoryEvent)
    .values({
      id,
      familyId,
      childPersonId: child!.id,
      title,
      occurredAt: now,
      occurredAtPrecision: "exact",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function linkAsset(eventId: string, assetId: string): void {
  getDb()
    .insert(memoryEventAsset)
    .values({
      id: randomUUID(),
      memoryEventId: eventId,
      assetId,
      familyId,
      createdAt: new Date(),
    })
    .run();
}

async function runHandler(eventId: string, payload: unknown) {
  const lease = makeLease(eventId);
  const result = await suggestEventMetadataHandler({
    lease,
    assistant: makeAssistant(payload) as unknown as MemoryAssistant,
    signal: new AbortController().signal,
  });
  getDb().transaction((tx) =>
    result.commit(tx, {
      jobId: lease.jobId,
      familyId,
      entityType: "memory_event",
      entityId: eventId,
      requestedByUserId: adminId,
      attemptNumber: 1,
    }),
  );
}

describe("M3-D：精确 FactSource locator", () => {
  it("转录引文绑定 segment 时间；OCR 引文落 asset_analysis；伪造引用整条丢弃", async () => {
    const eventId = makeEvent("一段记忆");
    const audioAsset = insertAsset({
      type: "audio",
      mimeType: "audio/wav",
      filename: "讲述.wav",
      extension: "wav",
    });
    const imageAsset = insertAsset({
      type: "image",
      mimeType: "image/jpeg",
      filename: "黑板.jpg",
      extension: "jpg",
    });
    const audioAssetId = audioAsset.id;
    const imageAssetId = imageAsset.id;
    linkAsset(eventId, audioAssetId);
    linkAsset(eventId, imageAssetId);

    const now = new Date();
    const transcriptId = randomUUID();
    getDb()
      .insert(assetTranscript)
      .values({
        id: transcriptId,
        familyId,
        assetId: audioAssetId,
        language: "zh",
        provider: "test",
        model: "stt-v1",
        rawTranscript: "我那天下午抱着她进门。她当时睡得很沉。",
        editedTranscript: null,
        segmentsJson: JSON.stringify([
          { startSeconds: 31, endSeconds: 37, text: "我那天下午抱着她进门" },
          { startSeconds: 38, endSeconds: 45, text: "她当时睡得很沉" },
        ]),
        status: "machine",
        sourceSha256: audioAsset.sha256,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    getDb()
      .insert(assetAnalysis)
      .values({
        id: randomUUID(),
        familyId,
        assetId: imageAssetId,
        description: "一块写满日期的小黑板。",
        ocrText: "2026年8月20日 小满第一次叫妈妈",
        provider: "test",
        model: "vision-v1",
        sourceSha256: imageAsset.sha256,
        analyzedVia: "original",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 从实际 prompt 中发现黑板.jpg 的别名（A#），避免依赖 DB 返回顺序
    const probeLease = makeLease(eventId);
    const probeAssistant = makeAssistant({
      title: null,
      locationText: null,
      tags: [],
      personNames: [],
      facts: [],
    });
    await suggestEventMetadataHandler({
      lease: probeLease,
      assistant: probeAssistant as unknown as MemoryAssistant,
      signal: new AbortController().signal,
    });
    const probePrompt = (probeAssistant.generateText as ReturnType<typeof vi.fn>).mock
      .calls[0][0].messages[0].content as string;
    const imageAliasMatch = probePrompt.match(/\[(A\d+)\] 素材 黑板\.jpg/);
    if (!imageAliasMatch) throw new Error("image alias not found in prompt");
    const imageAlias = imageAliasMatch[1];

    await runHandler(eventId, {
      title: null,
      locationText: null,
      tags: [],
      personNames: [],
      facts: [
        {
          statement: "小满第一次叫妈妈发生在 2026 年 8 月 20 日。",
          sources: [{ ref: imageAlias, quote: "小满第一次叫妈妈" }],
        },
        {
          statement: "外婆说她是下午抱着孩子进门的。",
          sources: [
            // 模型自报的时间毫秒必须被服务端 segment 推导值覆盖
            { ref: "T1", quote: "我那天下午抱着她进门", startMs: 999_999, endMs: 999_999 },
          ],
        },
        {
          statement: "引用了编造别名的事实必须整条丢弃。",
          sources: [{ ref: "T9", quote: "随便什么" }],
        },
        {
          statement: "引文不存在于来源的事实必须整条丢弃。",
          sources: [{ ref: "T1", quote: "这句话不在转录里" }],
        },
        {
          statement: "没有任何来源的事实必须整条丢弃。",
          sources: [],
        },
      ],
    });

    const facts = getDb()
      .select()
      .from(fact)
      .where(eq(fact.memoryEventId, eventId))
      .all();
    expect(facts.map((f) => f.statement)).toEqual([
      "小满第一次叫妈妈发生在 2026 年 8 月 20 日。",
      "外婆说她是下午抱着孩子进门的。",
    ]);

    const sourcesFor = (factId: string) =>
      getDb().select().from(factSource).where(eq(factSource.factId, factId)).all();

    // OCR 事实 → asset_analysis，sourceId 指向 durable 的素材 id
    const ocrSources = sourcesFor(facts[0].id);
    expect(ocrSources).toHaveLength(1);
    expect(ocrSources[0].sourceType).toBe("asset_analysis");
    expect(ocrSources[0].sourceId).toBe(imageAssetId);
    expect(ocrSources[0].quote).toBe("小满第一次叫妈妈");

    // 转录事实 → 时间 locator 由 segment 推导（31s–37s），模型自报毫秒被忽略
    const transcriptSources = sourcesFor(facts[1].id);
    expect(transcriptSources).toHaveLength(1);
    expect(transcriptSources[0].sourceType).toBe("transcript");
    expect(transcriptSources[0].sourceId).toBe(transcriptId);
    expect(transcriptSources[0].quote).toBe("我那天下午抱着她进门");
    expect(transcriptSources[0].startMs).toBe(31_000);
    expect(transcriptSources[0].endMs).toBe(37_000);
  });

  it("无别名可引时（无转录/无讲述）prompt 不暴露内部 ID，事实全被丢弃", async () => {
    const eventId = makeEvent("无来源事件");
    const lease = makeLease(eventId);
    const assistant = makeAssistant({
      title: null,
      locationText: null,
      tags: [],
      personNames: [],
      facts: [
        {
          statement: "试图注入内部 ID 的事实。",
          sources: [{ ref: "asset:0192-abc", quote: "x" }],
        },
      ],
    });
    await suggestEventMetadataHandler({
      lease,
      assistant: assistant as unknown as MemoryAssistant,
      signal: new AbortController().signal,
    });

    const prompt = (assistant.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .messages[0].content as string;
    // prompt 只出现别名，绝不出现内部 UUID
    expect(prompt).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );

    const facts = getDb()
      .select()
      .from(fact)
      .where(eq(fact.memoryEventId, eventId))
      .all();
    expect(facts).toHaveLength(0);
  });

  it("确认后 STT 重跑不改写已确认事实的来源 locator", async () => {
    const eventId = makeEvent("重跑保护");
    const assetId = insertAsset({
      type: "audio",
      mimeType: "audio/wav",
      filename: "长录音.wav",
      extension: "wav",
    }).id;
    linkAsset(eventId, assetId);

    const now = new Date();
    const transcriptId = randomUUID();
    getDb()
      .insert(assetTranscript)
      .values({
        id: transcriptId,
        familyId,
        assetId,
        language: "zh",
        provider: "test",
        model: "stt-v1",
        rawTranscript: "那年冬天我们去了北方看雪。",
        editedTranscript: null,
        segmentsJson: JSON.stringify([
          { startSeconds: 10, endSeconds: 15, text: "那年冬天我们去了北方看雪" },
        ]),
        status: "machine",
        sourceSha256: getDb().select({ sha256: assetTable.sha256 }).from(assetTable).where(eq(assetTable.id, assetId)).get()!.sha256,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const factId = randomUUID();
    getDb()
      .insert(fact)
      .values({
        id: factId,
        memoryEventId: eventId,
        statement: "孩子一岁那年冬天全家去北方看了雪。",
        status: "ai_suggested",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    getDb()
      .insert(factSource)
      .values({
        id: randomUUID(),
        familyId,
        factId,
        sourceType: "transcript",
        sourceId: transcriptId,
        quote: "那年冬天我们去了北方看雪",
        startMs: 10_000,
        endMs: 15_000,
        createdAt: now,
      })
      .run();

    // 用户确认事实
    const confirmed = await setFactStatus(familyId, factId, "user_confirmed");
    expect(confirmed).toBeTruthy();

    // STT 重跑：raw/segments 全变（edited 保留）
    getDb()
      .update(assetTranscript)
      .set({
        rawTranscript: "（重新识别的完全不同文本）",
        segmentsJson: JSON.stringify([
          { startSeconds: 0, endSeconds: 5, text: "重新识别" },
        ]),
        updatedAt: new Date(),
      })
      .where(eq(assetTranscript.id, transcriptId))
      .run();

    const after = getDb()
      .select()
      .from(factSource)
      .where(eq(factSource.factId, factId))
      .all();
    expect(after).toHaveLength(1);
    expect(after[0].quote).toBe("那年冬天我们去了北方看雪");
    expect(after[0].startMs).toBe(10_000);
    expect(after[0].endMs).toBe(15_000);

    const factRow = getDb().select().from(fact).where(eq(fact.id, factId)).get()!;
    expect(factRow.status).toBe("user_confirmed");
  });

  it("quote / 时间 locator 随导出完整携带", async () => {
    const eventId = makeEvent("往返测试");
    const assetId = insertAsset({
      type: "audio",
      mimeType: "audio/wav",
      filename: "往返.wav",
      extension: "wav",
    }).id;
    const now = new Date();
    const transcriptId = randomUUID();
    getDb()
      .insert(assetTranscript)
      .values({
        id: transcriptId,
        familyId,
        assetId,
        language: "zh",
        provider: "test",
        model: "stt-v1",
        rawTranscript: "原始转录文本",
        editedTranscript: "用户修订后的转录",
        segmentsJson: null,
        status: "user_edited",
        sourceSha256: getDb().select({ sha256: assetTable.sha256 }).from(assetTable).where(eq(assetTable.id, assetId)).get()!.sha256,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const factId = randomUUID();
    getDb()
      .insert(fact)
      .values({
        id: factId,
        memoryEventId: eventId,
        statement: "带 locator 的确认事实。",
        status: "user_confirmed",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    getDb()
      .insert(factSource)
      .values({
        id: randomUUID(),
        familyId,
        factId,
        sourceType: "transcript",
        sourceId: transcriptId,
        quote: "用户修订后的转录",
        startMs: 5_000,
        endMs: 9_000,
        createdAt: now,
      })
      .run();

    const exported = await buildFamilyExport(familyId);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const factSources = JSON.parse(
      await zip.file("family-time-capsule-export/fact-sources.json")!.async("string"),
    ) as Array<{
      factId: string;
      quote: string | null;
      startMs: number | null;
      endMs: number | null;
    }>;
    const exportedSource = factSources.find((s) => s.factId === factId);
    expect(exportedSource).toMatchObject({
      quote: "用户修订后的转录",
      startMs: 5_000,
      endMs: 9_000,
    });
  });
});
