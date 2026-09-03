import "server-only";

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contributionRequest,
  contributionRequestSubmission,
  type ContributionRequestRow,
} from "@/db/schema/oral-history";
import { inboxItem } from "@/db/schema/inbox";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { createTextInboxItem, createInboxItemForAsset } from "@/lib/inbox/service";
import { ingestImage, ingestMedia } from "@/lib/assets/ingest";
import type { FamilyContext } from "@/lib/family/context";
import { consumeSecurityRateLimit } from "@/lib/security/rate-limit";

/**
 * 口述史收集服务（M5）：家人创建匿名讲述链接，访客凭 token 提交
 * 文字/录音/照片/视频；提交进入收件箱审核，绝不直接发布。
 *
 * 威胁模型（SECURITY）：
 * - token 256-bit 随机、只存 SHA-256；枚举不可行；
 * - 过期（expiresAt）与撤销（closedAt）都在 token 解析时强制；
 * - 访客页只显示 recipientLabel + promptText，不暴露家庭名、人物、
 *   时间轴或任何媒体；
 * - 提交限流：每链接每小时最多 5 条（防滥用刷屏），文本/媒体大小
 *   沿用上传校验（UploadValidationFailure）。
 */

/** 256-bit token → base64url（43 字符，URL 安全） */
export function generateRequestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRequestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const DEFAULT_REQUEST_TTL_DAYS = 30;
export const MAX_OPEN_REQUESTS_PER_FAMILY = 20;
const SUBMISSIONS_PER_HOUR = 5;
const MAX_SUBMISSION_TEXT_CHARS = 10_000;

// ---- 内置问题库（PRD §16：童年/父母/学校/工作/城市/故乡/节日/成为父母/家庭变化/对孩子的期待） ----

export type PromptTopic = {
  key: string;
  label: string;
  questions: string[];
};

export const PROMPT_LIBRARY: readonly PromptTopic[] = [
  {
    key: "childhood",
    label: "童年",
    questions: [
      "你的童年最快乐的一个下午是什么样的？",
      "小时候家里最常吃的一道菜是什么？",
      "你小时候最害怕什么，后来呢？",
    ],
  },
  {
    key: "parents",
    label: "父母",
    questions: [
      "你的父母是怎么认识的？",
      "你最记得爸爸妈妈说过的哪句话？",
      "你的父母对你最严格的一件事是什么？",
    ],
  },
  {
    key: "school",
    label: "学校",
    questions: [
      "上学时你最喜欢哪门课，为什么？",
      "学生时代最好的朋友现在还有联系吗？",
      "有没有一位老师改变了你？",
    ],
  },
  {
    key: "work",
    label: "工作",
    questions: [
      "你的第一份工作是什么？当时一天挣多少钱？",
      "工作里最自豪的一件事是什么？",
      "如果能重新选，你会做同样的职业吗？",
    ],
  },
  {
    key: "city",
    label: "城市",
    questions: [
      "你搬到这座城市的第一天是什么样的？",
      "这座城市这些年变化最大的地方是哪里？",
      "你最喜欢城市的哪个角落？",
    ],
  },
  {
    key: "hometown",
    label: "故乡",
    questions: [
      "故乡的老屋现在还在吗？",
      "离家那天你在想什么？",
      "故乡的方言里最好听的一个词是什么？",
    ],
  },
  {
    key: "festival",
    label: "节日",
    questions: [
      "小时候过年你家必做的准备是什么？",
      "哪个节日的味道你到现在还记得？",
      "家里过节有什么别人家没有的规矩？",
    ],
  },
  {
    key: "becoming_parent",
    label: "成为父母",
    questions: [
      "第一次抱起孩子的那一刻你在想什么？",
      "成为父母后你放弃过什么，得到过什么？",
      "孩子出生那天天气怎么样？",
    ],
  },
  {
    key: "family_change",
    label: "家庭变化",
    questions: [
      "这些年我们家最大的变化是什么？",
      "家里哪件老物件的故事最值得留下来？",
      "你希望咱们家永远不变的是什么？",
    ],
  },
  {
    key: "hopes",
    label: "对孩子的期待",
    questions: [
      "你想对孩子十八岁的自己说什么？",
      "你希望孩子长大后的世界里有什么？",
      "如果孩子遇到难关，你想让他记住哪句话？",
    ],
  },
] as const;

export function findTopic(key: string): PromptTopic | undefined {
  return PROMPT_LIBRARY.find((t) => t.key === key);
}

// ---- 家人侧：创建 / 关闭 / 列出 ----

export type CreateRequestResult =
  | { ok: true; requestId: string; token: string; expiresAt: Date }
  | { ok: false; error: string };

export function createContributionRequest(
  context: FamilyContext,
  input: {
    recipientLabel: string;
    promptText: string;
    topicKey?: string | null;
    ttlDays?: number;
  },
  now: Date = new Date(),
): CreateRequestResult {
  try {
    assertFamilyCapability(context.role, "contribution:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const label = input.recipientLabel.trim();
  if (label.length < 1 || label.length > 50) {
    return { ok: false, error: "invalid_label" };
  }
  const prompt = input.promptText.trim();
  if (prompt.length < 1 || prompt.length > 500) {
    return { ok: false, error: "invalid_prompt" };
  }
  if (input.topicKey != null && !findTopic(input.topicKey)) {
    return { ok: false, error: "invalid_topic" };
  }
  const ttlDays = Math.min(Math.max(input.ttlDays ?? DEFAULT_REQUEST_TTL_DAYS, 1), 365);

  const db = getDb();
  const openCount = db
    .select({ value: sql<number>`count(*)` })
    .from(contributionRequest)
    .where(
      and(
        eq(contributionRequest.familyId, context.familyId),
        eq(contributionRequest.status, "open"),
      ),
    )
    .get();
  if (Number(openCount?.value ?? 0) >= MAX_OPEN_REQUESTS_PER_FAMILY) {
    return { ok: false, error: "too_many_open" };
  }

  const token = generateRequestToken();
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
  const id = randomUUID();
  db.insert(contributionRequest)
    .values({
      id,
      familyId: context.familyId,
      tokenHash: hashRequestToken(token),
      recipientLabel: label,
      promptText: prompt,
      topicKey: input.topicKey ?? null,
      status: "open",
      expiresAt,
      closedAt: null,
      closedByUserId: null,
      createdByUserId: context.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { ok: true, requestId: id, token, expiresAt };
}

export function closeContributionRequest(
  context: FamilyContext,
  requestId: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; error: string } {
  try {
    assertFamilyCapability(context.role, "contribution:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const row = db
    .select()
    .from(contributionRequest)
    .where(
      and(
        eq(contributionRequest.id, requestId),
        eq(contributionRequest.familyId, context.familyId),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "closed") return { ok: true };
  db.update(contributionRequest)
    .set({ status: "closed", closedAt: now, closedByUserId: context.userId, updatedAt: now })
    .where(eq(contributionRequest.id, requestId))
    .run();
  return { ok: true };
}

export type RequestWithStats = ContributionRequestRow & {
  submissionCount: number;
  pendingCount: number;
};

export function listContributionRequests(
  context: FamilyContext,
): RequestWithStats[] {
  try {
    assertFamilyCapability(context.role, "contribution:create");
  } catch {
    return [];
  }
  const db = getDb();
  const rows = db
    .select()
    .from(contributionRequest)
    .where(eq(contributionRequest.familyId, context.familyId))
    .orderBy(desc(contributionRequest.createdAt))
    .limit(100)
    .all();
  if (rows.length === 0) return [];
  const stats = db
    .select({
      requestId: contributionRequestSubmission.requestId,
      total: sql<number>`count(*)`,
      pending: sql<number>`sum(case when ${inboxItem.status} in ('new','needs_review','processing') then 1 else 0 end)`,
    })
    .from(contributionRequestSubmission)
    .leftJoin(inboxItem, eq(inboxItem.id, contributionRequestSubmission.inboxItemId))
    .where(
      inArray(
        contributionRequestSubmission.requestId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(contributionRequestSubmission.requestId)
    .all();
  const statByRequest = new Map(stats.map((s) => [s.requestId, s]));
  return rows.map((row) => ({
    ...row,
    submissionCount: Number(statByRequest.get(row.id)?.total ?? 0),
    pendingCount: Number(statByRequest.get(row.id)?.pending ?? 0),
  }));
}

// ---- 访客侧：解析 token / 提交 ----

export type ResolvedGuestRequest =
  | { ok: true; request: ContributionRequestRow }
  | { ok: false; error: "not_found" | "closed" | "expired" };

/** 仅凭 token 解析链接（无任何会话/家庭信息暴露）。 */
export function resolveGuestRequest(
  token: string,
  now: Date = new Date(),
): ResolvedGuestRequest {
  if (typeof token !== "string" || token.length < 20 || token.length > 128) {
    return { ok: false, error: "not_found" };
  }
  const row = getDb()
    .select()
    .from(contributionRequest)
    .where(eq(contributionRequest.tokenHash, hashRequestToken(token)))
    .limit(1)
    .get();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "closed") return { ok: false, error: "closed" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "expired" };
  }
  return { ok: true, request: row };
}

function consumeSubmissionLimit(requestId: string, now: Date): boolean {
  return consumeSecurityRateLimit({
    scope: "guest-submit",
    subject: requestId,
    limit: SUBMISSIONS_PER_HOUR,
    windowMs: 60 * 60 * 1000,
    now,
  }).allowed;
}

export type GuestSubmissionResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

export async function submitGuestText(
  token: string,
  text: string,
  now: Date = new Date(),
): Promise<GuestSubmissionResult> {
  const resolved = resolveGuestRequest(token, now);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (!consumeSubmissionLimit(resolved.request.id, now)) {
    return { ok: false, error: "rate_limited" };
  }
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_SUBMISSION_TEXT_CHARS) {
    return { ok: false, error: "invalid_text" };
  }
  const item = await createTextInboxItem(resolved.request.familyId, trimmed);
  return recordSubmission(resolved.request, item.id, now);
}

export async function submitGuestMedia(
  token: string,
  input: {
    filename: string;
    declaredMime: string;
    buffer: Buffer;
    clientLastModifiedMs?: number | null;
  },
  now: Date = new Date(),
): Promise<GuestSubmissionResult> {
  const resolved = resolveGuestRequest(token, now);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (!consumeSubmissionLimit(resolved.request.id, now)) {
    return { ok: false, error: "rate_limited" };
  }

  const isAudio = input.declaredMime.startsWith("audio/");
  const isVideo = input.declaredMime.startsWith("video/");
  const isImage = input.declaredMime.startsWith("image/");

  let stored:
    | { status: "stored"; asset: { id: string } }
    | { status: "duplicate"; existing: { id: string } }
    | { status: "rejected"; error: string };

  if (isAudio || isVideo) {
    stored = await ingestMedia({
      familyId: resolved.request.familyId,
      // 媒体 createdByUserId 指向创建链接的家人（访客没有账号）；
      // 原始提交者身份由 request.recipientLabel 在收件箱中展示
      createdByUserId: resolved.request.createdByUserId,
      kind: isAudio ? "audio" : "video",
      filename: input.filename,
      declaredMime: input.declaredMime,
      buffer: input.buffer,
      clientLastModifiedMs: input.clientLastModifiedMs ?? null,
    });
  } else if (isImage) {
    stored = await ingestImage({
      familyId: resolved.request.familyId,
      createdByUserId: resolved.request.createdByUserId,
      filename: input.filename,
      declaredMime: input.declaredMime,
      buffer: input.buffer,
      clientLastModifiedMs: input.clientLastModifiedMs ?? null,
    });
  } else {
    return { ok: false, error: "unsupported_media" };
  }

  if (stored.status === "rejected") {
    return { ok: false, error: stored.error };
  }
  const asset = stored.status === "stored" ? stored.asset : stored.existing;
  const item = await createInboxItemForAsset(resolved.request.familyId, asset as never);
  return recordSubmission(resolved.request, item.id, now);
}

function recordSubmission(
  request: ContributionRequestRow,
  inboxItemId: string,
  now: Date,
): GuestSubmissionResult {
  const id = randomUUID();
  getDb()
    .insert(contributionRequestSubmission)
    .values({
      id,
      familyId: request.familyId,
      requestId: request.id,
      inboxItemId,
      createdAt: now,
    })
    .run();
  return { ok: true, submissionId: id };
}
