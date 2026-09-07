import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { AiConfigurationError, AiQuotaExceededError } from "./errors";
import type {
  AnalyzeImageInput,
  AnalyzeImageResult,
  CreateEmbeddingsInput,
  CreateEmbeddingsResult,
  GenerateTextInput,
  GenerateTextResult,
  MemoryAssistant,
  TranscribeAudioInput,
  TranscribeAudioResult,
} from "./types";

/**
 * AI 每日限额（正式 1.0 §9 / AI-21）。
 *
 * - 限额是部署级成本护栏：AI_DAILY_MAX_REQUESTS / _IMAGES / _AUDIO_SECONDS，
 *   0（缺省）= 不限，不改变既有部署行为；
 * - 计数与裁决在同一条条件 UPDATE 内完成（SQLite 原子），并发 worker
 *   不会双双越过限额；请求发出前预扣，失败的请求也计入（提供方可能已计费，
 *   保守计数更安全）；
 * - 日界为 UTC 整日；额度耗尽抛 AiQuotaExceededError（retryAfterMs 指向
 *   下一个 UTC 日），任务按可重试调度回 pending，而不是伪装提供方错误；
 * - 音频时长只在调用方已知时计入（durationSeconds）；未知就按 0 秒计，
 *   显示层如实呈现未知，绝不估算编造。
 */

export type AiDailyQuotaLimits = Readonly<{
  maxRequests: number;
  maxImages: number;
  maxAudioSeconds: number;
}>;

export const UNLIMITED_AI_DAILY_QUOTA: AiDailyQuotaLimits = Object.freeze({
  maxRequests: 0,
  maxImages: 0,
  maxAudioSeconds: 0,
});

export const DEFAULT_AI_DAILY_MAX_REQUESTS = 0;
export const DEFAULT_AI_DAILY_MAX_IMAGES = 0;
export const DEFAULT_AI_DAILY_MAX_AUDIO_SECONDS = 0;

export type AiDailyQuotaResource = "requests" | "images" | "audio_seconds";

export type AiDailyQuotaExceeded = Readonly<{
  resource: AiDailyQuotaResource;
  used: number;
  limit: number;
}>;

function parseLimit(
  env: Record<string, string | undefined>,
  variable: string,
  fallback: number,
  maximum: number,
): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/u.test(raw)) {
    throw new AiConfigurationError(`${variable} must be a base-10 integer.`, variable);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new AiConfigurationError(`${variable} must be between 0 and ${maximum}.`, variable);
  }
  return value;
}

/** 0 = 不限。缺省全部不限，保持既有部署行为。 */
export function loadAiDailyQuotaLimits(
  env: Record<string, string | undefined> = process.env,
): AiDailyQuotaLimits {
  return Object.freeze({
    maxRequests: parseLimit(env, "AI_DAILY_MAX_REQUESTS", DEFAULT_AI_DAILY_MAX_REQUESTS, 10_000_000),
    maxImages: parseLimit(env, "AI_DAILY_MAX_IMAGES", DEFAULT_AI_DAILY_MAX_IMAGES, 1_000_000),
    maxAudioSeconds: parseLimit(
      env,
      "AI_DAILY_MAX_AUDIO_SECONDS",
      DEFAULT_AI_DAILY_MAX_AUDIO_SECONDS,
      10 * 24 * 3_600,
    ),
  });
}

export type AiDailyQuotaAmounts = Readonly<{
  requests: number;
  images: number;
  audioSeconds: number;
}>;

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function msUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, next - now.getTime());
}

type QuotaDatabase = Pick<ReturnType<typeof getDb>, "run" | "get">;

export type ConsumeAiDailyQuotaResult =
  | { ok: true }
  | { ok: false; exceeded: readonly AiDailyQuotaExceeded[]; retryAfterMs: number };

/**
 * 原子消费每日额度：先确保当日行存在，再用单条条件 UPDATE 递增。
 * UPDATE 未命中（changes=0）说明有任一活跃限额会越界——读回当日用量
 * 组装明细。不限的资源不参与条件，仍照常计数。
 */
export function consumeAiDailyQuota(
  amounts: AiDailyQuotaAmounts,
  limits: AiDailyQuotaLimits,
  options: { db?: QuotaDatabase; now?: Date } = {},
): ConsumeAiDailyQuotaResult {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const day = utcDayKey(now);
  const requests = Math.max(0, Math.floor(amounts.requests));
  const images = Math.max(0, Math.floor(amounts.images));
  const audioSeconds = Math.max(0, Math.floor(amounts.audioSeconds));

  db.run(sql`
    insert into ai_daily_usage (day, requests, images, audio_seconds, updated_at)
    values (${day}, 0, 0, 0, ${Math.floor(now.getTime() / 1000)})
    on conflict (day) do nothing
  `);
  const result = db.run(sql`
    update ai_daily_usage set
      requests = requests + ${requests},
      images = images + ${images},
      audio_seconds = audio_seconds + ${audioSeconds},
      updated_at = ${Math.floor(now.getTime() / 1000)}
    where day = ${day}
      and (${limits.maxRequests} <= 0 or requests + ${requests} <= ${limits.maxRequests})
      and (${limits.maxImages} <= 0 or images + ${images} <= ${limits.maxImages})
      and (${limits.maxAudioSeconds} <= 0 or audio_seconds + ${audioSeconds} <= ${limits.maxAudioSeconds})
  `);
  if (result.changes === 1) return { ok: true };

  const row = db.get<{
    requests: number;
    images: number;
    audio_seconds: number;
  }>(sql`select requests, images, audio_seconds from ai_daily_usage where day = ${day}`);
  const used = row ?? { requests: 0, images: 0, audio_seconds: 0 };
  const exceeded: AiDailyQuotaExceeded[] = [];
  if (limits.maxRequests > 0 && used.requests + requests > limits.maxRequests) {
    exceeded.push({ resource: "requests", used: used.requests, limit: limits.maxRequests });
  }
  if (limits.maxImages > 0 && used.images + images > limits.maxImages) {
    exceeded.push({ resource: "images", used: used.images, limit: limits.maxImages });
  }
  if (
    limits.maxAudioSeconds > 0 &&
    used.audio_seconds + audioSeconds > limits.maxAudioSeconds
  ) {
    exceeded.push({
      resource: "audio_seconds",
      used: used.audio_seconds,
      limit: limits.maxAudioSeconds,
    });
  }
  if (exceeded.length === 0) {
    // UPDATE 未命中但没有活跃限额越界（并发窗口内的竞态）——按成功对待，
    // 计数行已由上面的 insert 建好，下一次消费会正常裁决。
    return { ok: true };
  }
  return { ok: false, exceeded, retryAfterMs: msUntilNextUtcDay(now) };
}

function quotaError(
  exceeded: readonly AiDailyQuotaExceeded[],
  retryAfterMs: number,
): AiQuotaExceededError {
  const labels: Record<AiDailyQuotaResource, string> = {
    requests: "请求数",
    images: "图片数",
    audio_seconds: "音频时长（秒）",
  };
  const detail = exceeded
    .map((item) => `${labels[item.resource]} ${item.used}/${item.limit}`)
    .join("、");
  return new AiQuotaExceededError({
    message: `今日 AI 限额已用尽（${detail}）；将在下一个 UTC 日界自动恢复重试。`,
    retryAfterMs,
    exceeded,
  });
}

export type QuotaCountingDatabase = Pick<QuotaDatabase, "run" | "get">;

/**
 * 给 MemoryAssistant 套上每日限额：每次提供方调用前先原子预扣额度，
 * 超限直接抛 AiQuotaExceededError（请求不发出）。provider/capabilities
 * 原样透传，任务路由与披露信息不受影响。
 */
export function withDailyQuota(
  assistant: MemoryAssistant,
  limits: AiDailyQuotaLimits,
  options: { db?: QuotaCountingDatabase; now?: Date } = {},
): MemoryAssistant {
  const consume = (amounts: AiDailyQuotaAmounts): void => {
    const result = consumeAiDailyQuota(amounts, limits, options);
    if (!result.ok) throw quotaError(result.exceeded, result.retryAfterMs);
  };
  return {
    provider: assistant.provider,
    capabilities: assistant.capabilities,
    supports: (capability) => assistant.supports(capability),
    generateText: async (input: GenerateTextInput): Promise<GenerateTextResult> => {
      consume({ requests: 1, images: 0, audioSeconds: 0 });
      return assistant.generateText(input);
    },
    analyzeImage: async (input: AnalyzeImageInput): Promise<AnalyzeImageResult> => {
      consume({ requests: 1, images: 1, audioSeconds: 0 });
      return assistant.analyzeImage(input);
    },
    transcribeAudio: async (
      input: TranscribeAudioInput,
    ): Promise<TranscribeAudioResult> => {
      const duration =
        typeof input.durationSeconds === "number" &&
        Number.isFinite(input.durationSeconds) &&
        input.durationSeconds > 0
          ? input.durationSeconds
          : 0;
      consume({ requests: 1, images: 0, audioSeconds: duration });
      return assistant.transcribeAudio(input);
    },
    createEmbeddings: async (
      input: CreateEmbeddingsInput,
    ): Promise<CreateEmbeddingsResult> => {
      consume({ requests: 1, images: 0, audioSeconds: 0 });
      return assistant.createEmbeddings(input);
    },
  };
}
