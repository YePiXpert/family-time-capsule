import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJobLease } from "@/lib/ai/jobs";
import type { AiWorkerQueue } from "@/jobs/runtime";
import type { MemoryAssistant } from "@/lib/ai/types";

/**
 * AI-21 每日限额：
 * - 计数与裁决在同一条条件 UPDATE 内原子完成，并发不会双双越界；
 * - 请求发出前预扣；超限抛 AiQuotaExceededError（retryAfterMs=到下一个
 *   UTC 日界），任务按可重试调度回 pending；
 * - 0/缺省 = 不限（既有部署行为不变）；音频时长未知按 0 秒计，不估算。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-ai-quota-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "ai-quota-setup-token";
process.env.AUTH_SECRET = "ai-quota-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { aiDailyUsage } = await import("@/db/schema/ai-job");
// Each scenario owns its usage ledger. Fixed-date fixtures may otherwise collide
// with the worker's real UTC day when the calendar reaches that fixture date.
beforeEach(() => { getDb().delete(aiDailyUsage).run(); });
const { eq } = await import("drizzle-orm");
const {
  consumeAiDailyQuota,
  loadAiDailyQuotaLimits,
  withDailyQuota,
  UNLIMITED_AI_DAILY_QUOTA,
} = await import("@/lib/ai/quota");
const { AiQuotaExceededError, AiConfigurationError } = await import("@/lib/ai/errors");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { runAiWorkerOnce } = await import("@/jobs/runtime");
const { AiJobRegistry } = await import("@/jobs/registry");

const now = new Date("2026-09-08T10:30:00.000Z");

/** 委托式替身：保留原型方法，只覆盖要打桩的能力（spread 会丢类方法）。 */
function stubAssistant(
  base: MemoryAssistant,
  overrides: Partial<{
    generateText: () => Promise<unknown>;
    transcribeAudio: () => Promise<unknown>;
  }>,
): MemoryAssistant {
  const assistant: MemoryAssistant = Object.create(base);
  assistant.generateText = (overrides.generateText ?? base.generateText.bind(base)) as never;
  assistant.transcribeAudio = (overrides.transcribeAudio ?? base.transcribeAudio.bind(base)) as never;
  return assistant;
}

describe("每日限额配置解析（AI-21）", () => {
  it("缺省/0 = 不限；非法值是配置错误并指向变量", () => {
    expect(loadAiDailyQuotaLimits({})).toEqual(UNLIMITED_AI_DAILY_QUOTA);
    expect(loadAiDailyQuotaLimits({ AI_DAILY_MAX_REQUESTS: "0" }).maxRequests).toBe(0);
    expect(loadAiDailyQuotaLimits({ AI_DAILY_MAX_IMAGES: "5" }).maxImages).toBe(5);
    expect(loadAiDailyQuotaLimits({ AI_DAILY_MAX_AUDIO_SECONDS: "3600" }).maxAudioSeconds).toBe(3600);
    for (const bad of ["x", "-1", "1.5", "99999999999"]) {
      try {
        loadAiDailyQuotaLimits({ AI_DAILY_MAX_REQUESTS: bad });
        throw new Error("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AiConfigurationError);
      }
    }
  });
});

describe("原子每日消费（consumeAiDailyQuota）", () => {
  it("不限额时照常计数且从不拒绝；计数按 UTC 日落库", () => {
    expect(
      consumeAiDailyQuota(
        { requests: 3, images: 2, audioSeconds: 90 },
        UNLIMITED_AI_DAILY_QUOTA,
        { now },
      ),
    ).toEqual({ ok: true });
    const row = getDb().select().from(aiDailyUsage).where(eq(aiDailyUsage.day, "2026-09-08")).get();
    expect(row).toMatchObject({ requests: 3, images: 2, audioSeconds: 90 });
  });

  it("限额在越界时原子拒绝并给出明细与到日界的 retryAfterMs", () => {
    // 独立日期，避免与其他用例的当日计数互相影响
    const day = new Date("2026-09-12T10:00:00.000Z");
    const limits = { maxRequests: 5, maxImages: 2, maxAudioSeconds: 100 };
    expect(
      consumeAiDailyQuota({ requests: 3, images: 1, audioSeconds: 40 }, limits, { now: day }).ok,
    ).toBe(true);
    // 恰好到界：3+2=5 ≤ 5
    expect(
      consumeAiDailyQuota({ requests: 2, images: 0, audioSeconds: 0 }, limits, { now: day }).ok,
    ).toBe(true);
    const over = consumeAiDailyQuota({ requests: 1, images: 0, audioSeconds: 0 }, limits, { now: day });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.exceeded).toEqual([{ resource: "requests", used: 5, limit: 5 }]);
      expect(over.retryAfterMs).toBeGreaterThan(0);
      expect(over.retryAfterMs).toBeLessThanOrEqual(24 * 3_600_000);
    }
    // 图片与音频是独立维度：1+1=2 恰好到界，再一张被拒
    expect(
      consumeAiDailyQuota({ requests: 0, images: 1, audioSeconds: 0 }, limits, { now: day }).ok,
    ).toBe(true);
    const imageOver = consumeAiDailyQuota({ requests: 0, images: 1, audioSeconds: 0 }, limits, { now: day });
    expect(imageOver.ok).toBe(false);
    if (!imageOver.ok) {
      expect(imageOver.exceeded).toEqual([{ resource: "images", used: 2, limit: 2 }]);
    }
  });

  it("UTC 日界翻转后新的一天重新计数", () => {
    const limits = { maxRequests: 5, maxImages: 0, maxAudioSeconds: 0 };
    const nextDay = new Date("2026-09-09T00:00:01.000Z");
    expect(
      consumeAiDailyQuota({ requests: 5, images: 0, audioSeconds: 0 }, limits, { now: nextDay }).ok,
    ).toBe(true);
    expect(
      consumeAiDailyQuota({ requests: 1, images: 0, audioSeconds: 0 }, limits, { now: nextDay }).ok,
    ).toBe(false);
    expect(
      getDb().select().from(aiDailyUsage).where(eq(aiDailyUsage.day, "2026-09-09")).get(),
    ).toMatchObject({ requests: 5 });
  });
});

describe("限额包装（withDailyQuota）", () => {
  it("每次提供方调用前预扣；超限在调用前抛出，绝不发出请求", async () => {
    const spy = vi.fn(() => Promise.resolve({ text: "ok" }));
    const assistant = withDailyQuota(
      stubAssistant(new DeterministicFakeMemoryAssistant(), { generateText: spy }),
      { maxRequests: 1, maxImages: 0, maxAudioSeconds: 0 },
      { now: new Date("2026-09-15T08:00:00.000Z") },
    );
    await assistant.generateText({ messages: [{ role: "user", content: "hi" }] } as never);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(
      assistant.generateText({ messages: [{ role: "user", content: "again" }] } as never),
    ).rejects.toBeInstanceOf(AiQuotaExceededError);
    expect(spy).toHaveBeenCalledTimes(1); // 超限的请求没有到达底层助手
  });

  it("音频时长只在已知时计入；未知按 0 秒且不拦请求数", async () => {
    const transcribe = vi.fn(() => Promise.resolve({ text: "t", segments: [] }));
    const assistant = withDailyQuota(
      stubAssistant(new DeterministicFakeMemoryAssistant(), { transcribeAudio: transcribe }),
      { maxRequests: 0, maxImages: 0, maxAudioSeconds: 10 },
      { now: new Date("2026-09-10T08:00:00.000Z") },
    );
    // 未知时长：不占用秒数 → 放行
    await assistant.transcribeAudio({
      audio: { bytes: new Uint8Array([1]), fileName: "a.mp3", mimeType: "audio/mpeg" },
    } as never);
    expect(transcribe).toHaveBeenCalledTimes(1);
    // 已知 30 秒 > 上限 10 → 调用前拒绝
    await expect(
      assistant.transcribeAudio({
        audio: { bytes: new Uint8Array([1]), fileName: "b.wav", mimeType: "audio/wav" },
        durationSeconds: 30,
      } as never),
    ).rejects.toBeInstanceOf(AiQuotaExceededError);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe("worker 全链路（runAiWorkerOnce + 限额）", () => {
  const lease = {
    jobId: "quota-job-1",
    familyId: "family-1",
    jobType: "test.quota.v1",
    entityType: "analysis_run",
    entityId: "run-1",
    requiredCapability: "text",
    providerId: "deterministic-fake",
    model: "deterministic-text-v1",
    providerExternal: false,
    consentVersion: null,
    triggerMode: "manual",
    contentVisibility: "family",
    requestedByUserId: "user-1",
    attemptNumber: 1,
    leaseGeneration: 1,
    leaseExpiresAt: new Date("2026-09-11T00:01:00.000Z"),
    workerId: "quota-worker",
  } as AiJobLease;

  function queue(): AiWorkerQueue {
    return {
      claim: vi.fn(() => lease),
      renew: vi.fn((current) => current),
      finalize: vi.fn(() => ({ ok: true as const, value: undefined })),
      fail: vi.fn(() => ({ ok: true as const })),
      heartbeat: vi.fn(),
    };
  }

  it("超限任务失败码 ai_quota_exceeded、可重试并带 retryAfterMs（请求未发出）", async () => {
    const provider = vi.fn(() => Promise.resolve({ text: "ok" }));
    const registry = new AiJobRegistry().register(lease.jobType, async ({ assistant }) => {
      // 第一次调用耗尽 requests=1，第二次调用应被限额拦下
      await assistant.generateText({ messages: [{ role: "user", content: "a" }] } as never);
      await assistant.generateText({ messages: [{ role: "user", content: "b" }] } as never);
      return { commit: () => undefined };
    });
    const workerQueue = queue();
    const result = await runAiWorkerOnce({
      workerId: lease.workerId,
      assistant: stubAssistant(new DeterministicFakeMemoryAssistant(), { generateText: provider }),
      registry,
      queue: workerQueue,
      quotaLimits: { maxRequests: 1, maxImages: 0, maxAudioSeconds: 0 },
    });
    expect(result).toEqual({ status: "failed", jobId: lease.jobId, errorCode: "ai_quota_exceeded" });
    expect(provider).toHaveBeenCalledTimes(1);
    const failCall = vi.mocked(workerQueue.fail).mock.calls[0]!;
    expect(failCall[1]).toBe("ai_quota_exceeded");
    expect(failCall[2]).toBe(true);
    expect(failCall[3].retryAfterMs).toBeGreaterThan(0);
  });

  it("未配置限额时不包装（provider 元数据原样透传）", async () => {
    const assistant = new DeterministicFakeMemoryAssistant();
    const registry = new AiJobRegistry().register(lease.jobType, async () => ({
      commit: () => undefined,
    }));
    const workerQueue = queue();
    const result = await runAiWorkerOnce({
      workerId: lease.workerId,
      assistant,
      registry,
      queue: workerQueue,
      quotaLimits: UNLIMITED_AI_DAILY_QUOTA,
    });
    expect(result.status).toBe("completed");
    expect(workerQueue.finalize).toHaveBeenCalledTimes(1);
  });
});
