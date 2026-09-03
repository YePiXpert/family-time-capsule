import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  capsule,
  futureQuestion,
  capsuleReply,
  type FutureQuestionRow,
  type CapsuleReplyRow,
} from "@/db/schema/capsule";
import { person as personTable, family as familyTable } from "@/db/schema/family";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { isCapsuleUnlocked } from "@/lib/capsules/service";
import { ingestImage, ingestMedia } from "@/lib/assets/ingest";
import type { FamilyContext } from "@/lib/family/context";

/**
 * 胶囊对话服务（M5，PRD §17）：未来问题 + 开启后的回答。
 *
 * - 问题只能在胶囊 draft 阶段增删（封存即固化问题集）；
 * - 回答只能在解锁后提交；回答是增量行，封存的历史内容永不改变；
 * - 文字 ≤10000 字；可选挂一份录音/照片/视频原件（正常上传校验）。
 */

const MAX_QUESTION_CHARS = 500;
const MAX_REPLY_CHARS = 10_000;

export type CapsuleDialogueMutation =
  | { ok: true; questionId?: string; replyId?: string }
  | { ok: false; error: string };

async function loadCapsule(familyId: string, capsuleId: string) {
  return (
    getDb()
      .select()
      .from(capsule)
      .where(and(eq(capsule.id, capsuleId), eq(capsule.familyId, familyId)))
      .limit(1)
      .get()
  );
}

async function childBirthDateFor(familyId: string): Promise<string | null> {
  const row = getDb()
    .select({ birthDate: personTable.birthDate })
    .from(personTable)
    .where(and(eq(personTable.familyId, familyId), eq(personTable.isChild, true)))
    .limit(1)
    .get();
  return row?.birthDate ?? null;
}

// ---- 问题（draft 阶段） ----

export async function addFutureQuestion(
  context: FamilyContext,
  capsuleId: string,
  questionText: string,
): Promise<CapsuleDialogueMutation> {
  try {
    assertFamilyCapability(context.role, "capsule:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const trimmed = questionText.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: "invalid_question" };
  }
  const row = await loadCapsule(context.familyId, capsuleId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "draft") {
    return { ok: false, error: "sealed_immutable" };
  }
  const existing = getDb()
    .select({ id: futureQuestion.id })
    .from(futureQuestion)
    .where(eq(futureQuestion.capsuleId, capsuleId))
    .all();
  if (existing.length >= 50) {
    return { ok: false, error: "too_many_questions" };
  }
  const id = randomUUID();
  getDb()
    .insert(futureQuestion)
    .values({
      id,
      familyId: context.familyId,
      capsuleId,
      questionText: trimmed,
      createdByUserId: context.userId,
      createdAt: new Date(),
    })
    .run();
  return { ok: true, questionId: id };
}

export async function removeFutureQuestion(
  context: FamilyContext,
  questionId: string,
): Promise<CapsuleDialogueMutation> {
  try {
    assertFamilyCapability(context.role, "capsule:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const row = db
    .select()
    .from(futureQuestion)
    .where(
      and(
        eq(futureQuestion.id, questionId),
        eq(futureQuestion.familyId, context.familyId),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "not_found" };
  const capsuleRow = await loadCapsule(context.familyId, row.capsuleId);
  if (!capsuleRow) return { ok: false, error: "not_found" };
  if (capsuleRow.status !== "draft") {
    return { ok: false, error: "sealed_immutable" };
  }
  db.delete(futureQuestion).where(eq(futureQuestion.id, questionId)).run();
  return { ok: true };
}

// ---- 回答（解锁后） ----

export async function addCapsuleReply(
  context: FamilyContext,
  questionId: string,
  input: {
    text?: string | null;
    media?: {
      filename: string;
      declaredMime: string;
      buffer: Buffer;
      clientLastModifiedMs?: number | null;
    } | null;
  },
): Promise<CapsuleDialogueMutation> {
  try {
    assertFamilyCapability(context.role, "capsule:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const db = getDb();
  const question = db
    .select()
    .from(futureQuestion)
    .where(
      and(
        eq(futureQuestion.id, questionId),
        eq(futureQuestion.familyId, context.familyId),
      ),
    )
    .get();
  if (!question) return { ok: false, error: "not_found" };

  const capsuleRow = await loadCapsule(context.familyId, question.capsuleId);
  if (!capsuleRow) return { ok: false, error: "not_found" };

  const familyRow = db
    .select({ timezone: familyTable.timezone })
    .from(familyTable)
    .where(eq(familyTable.id, context.familyId))
    .get();
  const unlocked = isCapsuleUnlocked(
    capsuleRow,
    await childBirthDateFor(context.familyId),
    familyRow?.timezone ?? "Asia/Shanghai",
  );
  if (!unlocked) {
    return { ok: false, error: "capsule_locked" };
  }

  const text = input.text?.trim() ?? "";
  if (!text && !input.media) {
    return { ok: false, error: "empty_reply" };
  }
  if (text.length > MAX_REPLY_CHARS) {
    return { ok: false, error: "invalid_reply" };
  }

  let assetId: string | null = null;
  if (input.media) {
    const isAudio = input.media.declaredMime.startsWith("audio/");
    const isVideo = input.media.declaredMime.startsWith("video/");
    const isImage = input.media.declaredMime.startsWith("image/");
    if (!isAudio && !isVideo && !isImage) {
      return { ok: false, error: "unsupported_media" };
    }
    const stored = isImage
      ? await ingestImage({
          familyId: context.familyId,
          createdByUserId: context.userId,
          filename: input.media.filename,
          declaredMime: input.media.declaredMime,
          buffer: input.media.buffer,
          clientLastModifiedMs: input.media.clientLastModifiedMs ?? null,
        })
      : await ingestMedia({
          familyId: context.familyId,
          createdByUserId: context.userId,
          kind: isAudio ? "audio" : "video",
          filename: input.media.filename,
          declaredMime: input.media.declaredMime,
          buffer: input.media.buffer,
          clientLastModifiedMs: input.media.clientLastModifiedMs ?? null,
        });
    if (stored.status === "rejected") {
      return { ok: false, error: stored.error };
    }
    assetId = stored.status === "stored" ? stored.asset.id : stored.existing.id;
  }

  const replyCount = db
    .select({ id: capsuleReply.id })
    .from(capsuleReply)
    .where(eq(capsuleReply.questionId, questionId))
    .all().length;
  if (replyCount >= 100) {
    return { ok: false, error: "too_many_replies" };
  }

  const id = randomUUID();
  db.insert(capsuleReply)
    .values({
      id,
      familyId: context.familyId,
      questionId,
      capsuleId: question.capsuleId,
      authorPersonId: context.personId,
      text: text || null,
      assetId,
      createdAt: new Date(),
    })
    .run();
  return { ok: true, replyId: id };
}

// ---- 查询 ----

export type QuestionWithReplies = FutureQuestionRow & {
  replies: Array<CapsuleReplyRow & { authorName: string | null }>;
};

export async function getCapsuleDialogue(
  familyId: string,
  capsuleId: string,
): Promise<QuestionWithReplies[]> {
  const db = getDb();
  const questions = db
    .select()
    .from(futureQuestion)
    .where(
      and(
        eq(futureQuestion.familyId, familyId),
        eq(futureQuestion.capsuleId, capsuleId),
      ),
    )
    .orderBy(asc(futureQuestion.createdAt))
    .all();
  if (questions.length === 0) return [];
  const replies = db
    .select()
    .from(capsuleReply)
    .where(eq(capsuleReply.familyId, familyId))
    .all()
    .filter((r) => questions.some((q) => q.id === r.questionId));
  const people = db
    .select({ id: personTable.id, displayName: personTable.displayName })
    .from(personTable)
    .where(eq(personTable.familyId, familyId))
    .all();
  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  return questions.map((q) => ({
    ...q,
    replies: replies
      .filter((r) => r.questionId === q.id)
      .map((r) => ({ ...r, authorName: r.authorPersonId ? (nameById.get(r.authorPersonId) ?? null) : null })),
  }));
}

// ---- 导出/恢复辅助 ----

export function collectCapsuleDialogue(familyId: string): {
  questions: FutureQuestionRow[];
  replies: CapsuleReplyRow[];
} {
  const db = getDb();
  const questions = db
    .select()
    .from(futureQuestion)
    .where(eq(futureQuestion.familyId, familyId))
    .all();
  const replies = db
    .select()
    .from(capsuleReply)
    .where(eq(capsuleReply.familyId, familyId))
    .all();
  return { questions, replies };
}
