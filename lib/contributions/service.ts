import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { person as personTable } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { contribution, fact } from "@/db/schema/contribution";

/**
 * Contribution 领域服务（Issue #012）。
 * 所有操作强制 family 作用域；作者必须是本家庭 Person（可以没有 User）。
 */

export type ContributionRow = typeof contribution.$inferSelect;
export type FactRow = typeof fact.$inferSelect;

export type Visibility = "private" | "parents" | "family" | "child_later";

export type CreateContributionInput = {
  memoryEventId: string;
  authorPersonId: string;
  rawText?: string;
  editedText?: string;
  visibility?: Visibility;
};

export type CreateResult =
  | { ok: true; contributionId: string }
  | { ok: false; error: "event_not_found" | "author_not_found" | "invalid" };

function validateText(text: string | undefined): boolean {
  if (text === undefined) return true;
  const trimmed = text.trim();
  return trimmed.length >= 1 && trimmed.length <= 5000;
}

async function eventBelongsToFamily(
  familyId: string,
  memoryEventId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: memoryEvent.id })
    .from(memoryEvent)
    .where(
      and(eq(memoryEvent.familyId, familyId), eq(memoryEvent.id, memoryEventId)),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function personBelongsToFamily(
  familyId: string,
  personId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(and(eq(personTable.familyId, familyId), eq(personTable.id, personId)))
    .limit(1);
  return Boolean(rows[0]);
}

/** 创建视角：author 是 Person（无 User 也可，如外婆） */
export async function createContribution(
  familyId: string,
  input: CreateContributionInput,
): Promise<CreateResult> {
  if (!validateText(input.rawText) || !validateText(input.editedText)) {
    return { ok: false, error: "invalid" };
  }
  if (!input.rawText?.trim() && !input.editedText?.trim()) {
    return { ok: false, error: "invalid" };
  }
  if (!(await eventBelongsToFamily(familyId, input.memoryEventId))) {
    return { ok: false, error: "event_not_found" };
  }
  if (!(await personBelongsToFamily(familyId, input.authorPersonId))) {
    return { ok: false, error: "author_not_found" };
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  await db.insert(contribution).values({
    id,
    memoryEventId: input.memoryEventId,
    authorPersonId: input.authorPersonId,
    rawText: input.rawText?.trim() || null,
    editedText: input.editedText?.trim() || null,
    visibility: input.visibility ?? "family",
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, contributionId: id };
}

/** 只改这一行的定稿文本——不同人的行天然互不影响 */
export async function updateContributionText(
  familyId: string,
  contributionId: string,
  editedText: string,
): Promise<ContributionRow | undefined> {
  const trimmed = editedText.trim();
  if (trimmed.length < 1 || trimmed.length > 5000) return undefined;
  const db = getDb();
  const rows = await db
    .update(contribution)
    .set({ editedText: trimmed, updatedAt: new Date() })
    .where(eq(contribution.id, contributionId))
    .returning();
  const row = rows[0];
  if (!row) return undefined;
  // family 校验放在取行之后（事件→family 传递可信）
  const owned = await eventBelongsToFamily(familyId, row.memoryEventId);
  return owned ? row : undefined;
}

export type ContributionWithAuthor = ContributionRow & {
  authorName: string;
  authorRelation: string | null;
};

export async function listContributions(
  familyId: string,
  memoryEventId: string,
): Promise<ContributionWithAuthor[]> {
  if (!(await eventBelongsToFamily(familyId, memoryEventId))) return [];
  const db = getDb();
  const rows = await db
    .select({
      contribution,
      authorName: personTable.displayName,
      authorRelation: personTable.relationToChild,
    })
    .from(contribution)
    .innerJoin(personTable, eq(contribution.authorPersonId, personTable.id))
    .where(eq(contribution.memoryEventId, memoryEventId))
    .orderBy(asc(contribution.createdAt));
  return rows.map((r) => ({
    ...r.contribution,
    authorName: r.authorName,
    authorRelation: r.authorRelation,
  }));
}

// ---------- Fact（P0：用户手工添加/确认） ----------

export async function addFact(
  familyId: string,
  memoryEventId: string,
  statement: string,
): Promise<FactRow | undefined> {
  const trimmed = statement.trim();
  if (trimmed.length < 1 || trimmed.length > 500) return undefined;
  if (!(await eventBelongsToFamily(familyId, memoryEventId))) return undefined;
  const db = getDb();
  const now = new Date();
  const rows = await db
    .insert(fact)
    .values({
      id: randomUUID(),
      memoryEventId,
      statement: trimmed,
      status: "user_confirmed",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0];
}

export async function setFactStatus(
  familyId: string,
  factId: string,
  status: "user_confirmed" | "rejected",
): Promise<FactRow | undefined> {
  const db = getDb();
  const rows = await db
    .update(fact)
    .set({ status, updatedAt: new Date() })
    .where(eq(fact.id, factId))
    .returning();
  const row = rows[0];
  if (!row) return undefined;
  const owned = await eventBelongsToFamily(familyId, row.memoryEventId);
  return owned ? row : undefined;
}

export async function listFacts(
  familyId: string,
  memoryEventId: string,
): Promise<FactRow[]> {
  if (!(await eventBelongsToFamily(familyId, memoryEventId))) return [];
  const db = getDb();
  return db
    .select()
    .from(fact)
    .where(eq(fact.memoryEventId, memoryEventId))
    .orderBy(asc(fact.createdAt));
}
