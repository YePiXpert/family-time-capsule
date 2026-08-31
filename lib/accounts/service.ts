import "server-only";

import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema/audit";
import { session, user as userTable } from "@/db/schema/auth";
import { person } from "@/db/schema/family";
import {
  assertFamilyCapability,
  isFamilyRole,
  type FamilyRole,
} from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";
import { AUDIT_KINDS, requiredAuditValues } from "@/lib/audit/service";

export type FamilyAccountDto = {
  id: string;
  name: string;
  email: string;
  role: FamilyRole;
  personId: string | null;
  personName: string | null;
  disabledAt: Date | null;
  isCurrentUser: boolean;
};

export class FamilyAccountAuthorizationError extends Error {
  constructor() {
    super("family account administration authorization changed");
    this.name = "FamilyAccountAuthorizationError";
  }
}

/**
 * Context is only a hint captured earlier in the request. Every account read
 * and mutation re-checks the actor inside the same SQLite transaction that
 * observes or changes the target account. A stale admin page therefore never
 * remains an authorization capability.
 */
export async function listFamilyAccounts(
  context: FamilyContext,
): Promise<FamilyAccountDto[]> {
  assertFamilyCapability(context.role, "account:manage");
  return getDb().transaction((tx) => {
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
    if (!actor) throw new FamilyAccountAuthorizationError();

    const rows = tx
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: userTable.role,
        personId: userTable.personId,
        personName: person.displayName,
        disabledAt: userTable.disabledAt,
      })
      .from(userTable)
      .leftJoin(
        person,
        and(
          eq(userTable.personId, person.id),
          eq(userTable.familyId, person.familyId),
        ),
      )
      .where(eq(userTable.familyId, context.familyId))
      .orderBy(asc(userTable.createdAt))
      .all();

    return rows.map((row) => {
      if (!isFamilyRole(row.role)) {
        throw new Error("family account has an invalid role");
      }
      return {
        ...row,
        role: row.role,
        isCurrentUser: row.id === context.userId,
      };
    });
  });
}

export type AccountMutationError =
  | "forbidden"
  | "not_found"
  | "invalid_role"
  | "already_disabled"
  | "already_enabled"
  | "cannot_disable_self"
  | "last_admin";

export type AccountMutationResult =
  | { ok: true }
  | { ok: false; error: AccountMutationError };

function isLastAdminConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("family must retain an enabled admin")
  );
}

export function disableFamilyAccount(
  context: FamilyContext,
  targetUserId: string,
): AccountMutationResult {
  assertFamilyCapability(context.role, "account:manage");
  const db = getDb();
  try {
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
      if (targetUserId === context.userId) {
        return { ok: false, error: "cannot_disable_self" } as const;
      }

      const target = tx
        .select({
          id: userTable.id,
          role: userTable.role,
          disabledAt: userTable.disabledAt,
        })
        .from(userTable)
        .where(
          and(
            eq(userTable.id, targetUserId),
            eq(userTable.familyId, context.familyId),
          ),
        )
        .get();
      if (!target) return { ok: false, error: "not_found" } as const;
      if (!isFamilyRole(target.role)) {
        return { ok: false, error: "invalid_role" } as const;
      }
      if (target.disabledAt !== null) {
        return { ok: false, error: "already_disabled" } as const;
      }
      if (target.role === "admin") {
        const replacement = tx
          .select({ id: userTable.id })
          .from(userTable)
          .where(
            and(
              eq(userTable.familyId, context.familyId),
              eq(userTable.role, "admin"),
              isNull(userTable.disabledAt),
              ne(userTable.id, targetUserId),
            ),
          )
          .limit(1)
          .get();
        if (!replacement) return { ok: false, error: "last_admin" } as const;
      }

      const now = new Date();
      const updated = tx
        .update(userTable)
        .set({
          disabledAt: now,
          disabledByUserId: context.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(userTable.id, targetUserId),
            eq(userTable.familyId, context.familyId),
            isNull(userTable.disabledAt),
          ),
        )
        .run();
      if (updated.changes !== 1) {
        return { ok: false, error: "not_found" } as const;
      }
      tx.delete(session).where(eq(session.userId, targetUserId)).run();
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            context.familyId,
            AUDIT_KINDS.accountDisabled,
            context.userId,
            { targetUserId },
            now,
          ),
        )
        .run();
      return { ok: true } as const;
    });
  } catch (error) {
    if (isLastAdminConstraintError(error)) {
      return { ok: false, error: "last_admin" };
    }
    throw error;
  }
}

export function enableFamilyAccount(
  context: FamilyContext,
  targetUserId: string,
): AccountMutationResult {
  assertFamilyCapability(context.role, "account:manage");
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
      .select({ id: userTable.id, disabledAt: userTable.disabledAt })
      .from(userTable)
      .where(
        and(
          eq(userTable.id, targetUserId),
          eq(userTable.familyId, context.familyId),
        ),
      )
      .get();
    if (!target) return { ok: false, error: "not_found" } as const;
    if (target.disabledAt === null) {
      return { ok: false, error: "already_enabled" } as const;
    }

    const now = new Date();
    const updated = tx
      .update(userTable)
      .set({ disabledAt: null, disabledByUserId: null, updatedAt: now })
      .where(
        and(
          eq(userTable.id, targetUserId),
          eq(userTable.familyId, context.familyId),
          eq(userTable.disabledAt, target.disabledAt),
        ),
      )
      .run();
    if (updated.changes !== 1) {
      return { ok: false, error: "not_found" } as const;
    }
    // A disabled account must never regain a session created by an old writer
    // that raced with the original disable. Recovery starts from a clean slate.
    tx.delete(session).where(eq(session.userId, targetUserId)).run();
    tx.insert(auditLog)
      .values(
        requiredAuditValues(
          context.familyId,
          AUDIT_KINDS.accountEnabled,
          context.userId,
          { targetUserId },
          now,
        ),
      )
      .run();
    return { ok: true } as const;
  });
}

export function changeFamilyAccountRole(
  context: FamilyContext,
  targetUserId: string,
  nextRole: unknown,
): AccountMutationResult {
  assertFamilyCapability(context.role, "account:manage");
  if (!isFamilyRole(nextRole)) {
    return { ok: false, error: "invalid_role" };
  }
  const db = getDb();
  try {
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
        .select({ role: userTable.role, disabledAt: userTable.disabledAt })
        .from(userTable)
        .where(
          and(
            eq(userTable.id, targetUserId),
            eq(userTable.familyId, context.familyId),
          ),
        )
        .get();
      if (!target) return { ok: false, error: "not_found" } as const;
      if (!isFamilyRole(target.role)) {
        return { ok: false, error: "invalid_role" } as const;
      }
      if (target.role === nextRole) return { ok: true } as const;

      if (
        target.role === "admin" &&
        target.disabledAt === null &&
        nextRole !== "admin"
      ) {
        const replacement = tx
          .select({ id: userTable.id })
          .from(userTable)
          .where(
            and(
              eq(userTable.familyId, context.familyId),
              eq(userTable.role, "admin"),
              isNull(userTable.disabledAt),
              ne(userTable.id, targetUserId),
            ),
          )
          .limit(1)
          .get();
        if (!replacement) return { ok: false, error: "last_admin" } as const;
      }

      const now = new Date();
      const updated = tx
        .update(userTable)
        .set({ role: nextRole, updatedAt: now })
        .where(
          and(
            eq(userTable.id, targetUserId),
            eq(userTable.familyId, context.familyId),
            eq(userTable.role, target.role),
          ),
        )
        .run();
      if (updated.changes !== 1) {
        return { ok: false, error: "not_found" } as const;
      }
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            context.familyId,
            AUDIT_KINDS.accountRoleChanged,
            context.userId,
            { targetUserId, from: target.role, to: nextRole },
            now,
          ),
        )
        .run();
      return { ok: true } as const;
    });
  } catch (error) {
    if (isLastAdminConstraintError(error)) {
      return { ok: false, error: "last_admin" };
    }
    throw error;
  }
}
