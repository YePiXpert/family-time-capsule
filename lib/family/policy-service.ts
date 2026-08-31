import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema/audit";
import { user as userTable } from "@/db/schema/auth";
import { family, person } from "@/db/schema/family";
import { assertFamilyCapability } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";
import { AUDIT_KINDS, requiredAuditValues } from "@/lib/audit/service";

export type FamilyPolicyResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "invalid_age"
        | "child_cannot_be_guardian"
        | "not_child"
        | "already_unlocked";
    };

export function setPersonGuardian(
  context: FamilyContext,
  personId: string,
  isGuardian: boolean,
): FamilyPolicyResult {
  assertFamilyCapability(context.role, "family:manage");
  const db = getDb();
  return db.transaction((tx) => {
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .leftJoin(person, eq(userTable.personId, person.id))
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.familyId, context.familyId),
          eq(userTable.role, "admin"),
          isNull(userTable.disabledAt),
          or(
            isNull(userTable.personId),
            and(
              eq(person.id, userTable.personId),
              eq(person.familyId, context.familyId),
            ),
          ),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return { ok: false, error: "forbidden" } as const;

    const target = tx
      .select({ id: person.id, isChild: person.isChild, old: person.isGuardian })
      .from(person)
      .where(and(eq(person.id, personId), eq(person.familyId, context.familyId)))
      .get();
    if (!target) return { ok: false, error: "not_found" } as const;
    if (target.isChild && isGuardian) {
      return { ok: false, error: "child_cannot_be_guardian" } as const;
    }
    if (target.old === isGuardian) return { ok: true } as const;
    const now = new Date();
    tx.update(person)
      .set({ isGuardian, updatedAt: now })
      .where(and(eq(person.id, personId), eq(person.familyId, context.familyId)))
      .run();
    tx.insert(auditLog)
      .values(
        requiredAuditValues(
          context.familyId,
          AUDIT_KINDS.guardianChanged,
          context.userId,
          { personId, from: target.old, to: isGuardian },
          now,
        ),
      )
      .run();
    return { ok: true } as const;
  });
}

export function setChildLaterUnlockAge(
  context: FamilyContext,
  unlockAge: number,
): FamilyPolicyResult {
  assertFamilyCapability(context.role, "family:manage");
  if (!Number.isInteger(unlockAge) || unlockAge < 1 || unlockAge > 100) {
    return { ok: false, error: "invalid_age" };
  }
  const db = getDb();
  return db.transaction((tx) => {
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .leftJoin(person, eq(userTable.personId, person.id))
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.familyId, context.familyId),
          eq(userTable.role, "admin"),
          isNull(userTable.disabledAt),
          or(
            isNull(userTable.personId),
            and(
              eq(person.id, userTable.personId),
              eq(person.familyId, context.familyId),
            ),
          ),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return { ok: false, error: "forbidden" } as const;

    const row = tx
      .select({ old: family.childLaterUnlockAge })
      .from(family)
      .where(eq(family.id, context.familyId))
      .get();
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.old === unlockAge) return { ok: true } as const;
    const now = new Date();
    tx.update(family)
      .set({ childLaterUnlockAge: unlockAge, updatedAt: now })
      .where(eq(family.id, context.familyId))
      .run();
    tx.insert(auditLog)
      .values(
        requiredAuditValues(
          context.familyId,
          AUDIT_KINDS.childLaterPolicyChanged,
          context.userId,
          { from: row.old, to: unlockAge },
          now,
        ),
      )
      .run();
    return { ok: true } as const;
  });
}

export function manuallyUnlockChildLater(
  context: FamilyContext,
  childPersonId: string,
): FamilyPolicyResult {
  assertFamilyCapability(context.role, "family:manage");
  const db = getDb();
  return db.transaction((tx) => {
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .leftJoin(person, eq(userTable.personId, person.id))
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.familyId, context.familyId),
          eq(userTable.role, "admin"),
          isNull(userTable.disabledAt),
          or(
            isNull(userTable.personId),
            and(
              eq(person.id, userTable.personId),
              eq(person.familyId, context.familyId),
            ),
          ),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return { ok: false, error: "forbidden" } as const;

    const child = tx
      .select({
        id: person.id,
        isChild: person.isChild,
        unlockedAt: person.childLaterUnlockedAt,
      })
      .from(person)
      .where(
        and(eq(person.id, childPersonId), eq(person.familyId, context.familyId)),
      )
      .get();
    if (!child) return { ok: false, error: "not_found" } as const;
    if (!child.isChild) return { ok: false, error: "not_child" } as const;
    if (child.unlockedAt !== null) {
      return { ok: false, error: "already_unlocked" } as const;
    }
    const now = new Date();
    tx.update(person)
      .set({ childLaterUnlockedAt: now, updatedAt: now })
      .where(
        and(eq(person.id, childPersonId), eq(person.familyId, context.familyId)),
      )
      .run();
    tx.insert(auditLog)
      .values(
        requiredAuditValues(
          context.familyId,
          AUDIT_KINDS.childLaterManuallyUnlocked,
          context.userId,
          { childPersonId, unlockedAt: now.toISOString() },
          now,
        ),
      )
      .run();
    return { ok: true } as const;
  });
}
