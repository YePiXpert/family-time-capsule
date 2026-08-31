import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { indexContribution, indexFactIfConfirmed } from "@/lib/search/service";
import { auditLog } from "@/db/schema/audit";
import { user as userTable } from "@/db/schema/auth";
import { person as personTable } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { contribution, fact } from "@/db/schema/contribution";
import { factSource } from "@/db/schema/suggestion";
import { AUDIT_KINDS, requiredAuditValues } from "@/lib/audit/service";
import {
  hasFamilyCapability,
  isContributionVisibility,
  isFamilyRole,
} from "@/lib/authz/policy";

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
  recordedByUserId: string;
  rawText?: string;
  editedText?: string;
  visibility?: Visibility;
};

export type CreateResult =
  | { ok: true; contributionId: string }
  | {
      ok: false;
      error:
        | "event_not_found"
        | "author_not_found"
        | "author_not_allowed"
        | "forbidden"
        | "invalid";
    };

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
  if (
    input.visibility !== undefined &&
    !isContributionVisibility(input.visibility)
  ) {
    return { ok: false, error: "invalid" };
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  const result = db.transaction((tx) => {
    const actor = tx
      .select({
        name: userTable.name,
        role: userTable.role,
        personId: userTable.personId,
        boundPersonId: personTable.id,
        boundPersonFamilyId: personTable.familyId,
      })
      .from(userTable)
      .leftJoin(personTable, eq(userTable.personId, personTable.id))
      .where(
        and(
          eq(userTable.id, input.recordedByUserId),
          eq(userTable.familyId, familyId),
          isNull(userTable.disabledAt),
          or(
            isNull(userTable.personId),
            and(
              eq(personTable.id, userTable.personId),
              eq(personTable.familyId, familyId),
            ),
          ),
        ),
      )
      .limit(1)
      .get();
    if (
      !actor ||
      !isFamilyRole(actor.role) ||
      !hasFamilyCapability(actor.role, "contribution:create")
    ) {
      return { ok: false, error: "forbidden" } as const;
    }

    const event = tx
      .select({ id: memoryEvent.id })
      .from(memoryEvent)
      .where(
        and(
          eq(memoryEvent.id, input.memoryEventId),
          eq(memoryEvent.familyId, familyId),
        ),
      )
      .limit(1)
      .get();
    if (!event) return { ok: false, error: "event_not_found" } as const;

    const author = tx
      .select({ id: personTable.id, boundUserId: userTable.id })
      .from(personTable)
      .leftJoin(userTable, eq(userTable.personId, personTable.id))
      .where(
        and(
          eq(personTable.id, input.authorPersonId),
          eq(personTable.familyId, familyId),
        ),
      )
      .limit(1)
      .get();
    if (!author) return { ok: false, error: "author_not_found" } as const;

    const recordingOwnWords = actor.personId === author.id;
    const mayRecordOnBehalf =
      (actor.role === "admin" || actor.role === "editor") &&
      author.boundUserId === null;
    if (!recordingOwnWords && !mayRecordOnBehalf) {
      return { ok: false, error: "author_not_allowed" } as const;
    }

    tx.insert(contribution)
      .values({
        id,
        memoryEventId: input.memoryEventId,
        authorPersonId: input.authorPersonId,
        recordedByUserId: input.recordedByUserId,
        recordedByPersonId: actor.personId,
        recordedByNameSnapshot: actor.name,
        recordingMode: recordingOwnWords ? "self" : "on_behalf",
        rawText: input.rawText?.trim() || null,
        editedText: input.editedText?.trim() || null,
        visibility: input.visibility ?? "family",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (!recordingOwnWords) {
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            familyId,
            AUDIT_KINDS.contributionRecordedOnBehalf,
            input.recordedByUserId,
            { contributionId: id, authorPersonId: input.authorPersonId },
            now,
          ),
        )
        .run();
    }
    return { ok: true, contributionId: id } as const;
  });
  if (result.ok) {
    indexContribution({
      id,
      familyId,
      memoryEventId: input.memoryEventId,
      authorPersonId: input.authorPersonId,
      rawText: input.rawText ?? null,
      editedText: input.editedText ?? null,
      visibility: input.visibility ?? "family",
    });
  }
  return result;
}

/** 只改这一行的定稿文本——不同人的行天然互不影响；先校验归属再写入 */
export async function updateContributionText(
  familyId: string,
  contributionId: string,
  editedText: string,
): Promise<ContributionRow | undefined> {
  const trimmed = editedText.trim();
  if (trimmed.length < 1 || trimmed.length > 5000) return undefined;
  const db = getDb();
  // 先取行校验归属，再更新（防止跨家庭写入）
  const existing = await db
    .select()
    .from(contribution)
    .where(eq(contribution.id, contributionId))
    .limit(1);
  const row = existing[0];
  if (!row) return undefined;
  if (!(await eventBelongsToFamily(familyId, row.memoryEventId))) return undefined;
  const rows = await db
    .update(contribution)
    .set({ editedText: trimmed, updatedAt: new Date() })
    .where(eq(contribution.id, contributionId))
    .returning();
  if (rows[0]) {
    indexContribution({
      id: rows[0].id,
      familyId,
      memoryEventId: rows[0].memoryEventId,
      authorPersonId: rows[0].authorPersonId,
      rawText: rows[0].rawText,
      editedText: rows[0].editedText,
      visibility: rows[0].visibility,
    });
  }
  return rows[0];
}

/** Family-scoped lookup used before author-owned mutations. */
export async function getContributionForFamily(
  familyId: string,
  contributionId: string,
): Promise<ContributionRow | undefined> {
  const db = getDb();
  const rows = await db
    .select({ contribution })
    .from(contribution)
    .innerJoin(memoryEvent, eq(contribution.memoryEventId, memoryEvent.id))
    .where(
      and(
        eq(memoryEvent.familyId, familyId),
        eq(contribution.id, contributionId),
      ),
    )
    .limit(1);
  return rows[0]?.contribution;
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
  const factRow = db.transaction((tx) => {
    const rows = tx
      .insert(fact)
      .values({
        id: randomUUID(),
        memoryEventId,
        statement: trimmed,
        status: "user_confirmed",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    const row = rows[0];
    if (!row) return undefined;
    tx.insert(factSource)
      .values({
        id: randomUUID(),
        familyId,
        factId: row.id,
        sourceType: "user_text",
        sourceId: null,
        createdAt: now,
      })
      .run();
    return row;
  });
  if (factRow) {
    indexFactIfConfirmed({
      id: factRow.id,
      familyId,
      memoryEventId,
      statement: factRow.statement,
      status: factRow.status,
    });
  }
  return factRow;
}

export async function setFactStatus(
  familyId: string,
  factId: string,
  status: "user_confirmed" | "rejected",
): Promise<FactRow | undefined> {
  const db = getDb();
  // 先取行校验归属，再更新（防止跨家庭写入）
  const existing = await db.select().from(fact).where(eq(fact.id, factId)).limit(1);
  const row = existing[0];
  if (!row) return undefined;
  if (!(await eventBelongsToFamily(familyId, row.memoryEventId))) return undefined;
  const rows = await db
    .update(fact)
    .set({ status, updatedAt: new Date() })
    .where(eq(fact.id, factId))
    .returning();
  if (rows[0]) {
    indexFactIfConfirmed({
      id: rows[0].id,
      familyId,
      memoryEventId: rows[0].memoryEventId,
      statement: rows[0].statement,
      status: rows[0].status,
    });
  }
  return rows[0];
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
