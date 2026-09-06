import "server-only";

import { and, asc, eq, isNull, ne, or, inArray} from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema/audit";
import { account as accountTable, session, user as userTable } from "@/db/schema/auth";
import { person } from "@/db/schema/family";
import {
  assertFamilyCapability,
  isFamilyRole,
  type FamilyRole,
  ADMIN_CLASS_ROLES,
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
          inArray(userTable.role, ADMIN_CLASS_ROLES),
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
  | "last_admin"
  | "owner_transfer_required"
  | "password_required";

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
            inArray(userTable.role, ADMIN_CLASS_ROLES),
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
      if (target.role === "owner") {
        // 禁用所有者会同时移除唯一移交路径;先完成所有权移交。
        return { ok: false, error: "owner_transfer_required" } as const;
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
              inArray(userTable.role, ADMIN_CLASS_ROLES),
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
          inArray(userTable.role, ADMIN_CLASS_ROLES),
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
  if (!isFamilyRole(nextRole) || nextRole === "owner") {
    // owner 只经 transferOwnership 原子交换产生,普通改角色不得授予。
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
            inArray(userTable.role, ADMIN_CLASS_ROLES),
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
      if (target.role === "owner") {
        // owner 的角色只能通过所有权移交变化;此处明确拒绝并给出指引。
        return { ok: false, error: "owner_transfer_required" } as const;
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
              inArray(userTable.role, ADMIN_CLASS_ROLES),
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

// ---------------------------------------------------------------- 所有权移交

export type TransferOwnershipInput = {
  context: FamilyContext;
  targetUserId: string;
  /** 近期重新认证：所有者的当前密码（Goal M2：转所有权要求重新认证）。 */
  currentPassword: string;
};

export type TransferOwnershipError =
  | "forbidden"
  | "not_found"
  | "invalid_target"
  | "password_required";

export type TransferOwnershipResult =
  | { ok: true }
  | { ok: false; error: TransferOwnershipError };

/**
 * 所有权移交（M2/ID-17 第一步）：
 * - 仅当前 owner 可发起（family:transfer 能力 + 事务内复核）；
 * - 必须重新验证当前密码（近期重新认证）；
 * - 目标必须是同一家庭、已启用、角色为 admin 的成员（接收人需要已具备管理经验）；
 * - 原子交换：目标 → owner，发起者 → admin；同事务写审计。
 * 密钥/数据不变；双方会话保留（角色即时生效于下一次请求的 principal 复核）。
 */
export async function transferOwnership(
  input: TransferOwnershipInput,
): Promise<TransferOwnershipResult> {
  const { context, targetUserId, currentPassword } = input;
  assertFamilyCapability(context.role, "family:transfer");
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return { ok: false, error: "password_required" };
  }
  // 近期重新认证必须在服务本体强制:任何调用路径都不能绕过密码复核。
  const passwordOk = await verifyCurrentPassword(context.userId, currentPassword);
  if (!passwordOk) {
    return { ok: false, error: "password_required" };
  }
  const db = getDb();
  return db.transaction((tx) => {
    // 发起者必须是本家庭、未禁用的 owner（上下文只是提示,事务内复核为准）。
    // 密码复核（近期重新认证）由 server action 在事务前完成,不在此重复。
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.familyId, context.familyId),
          eq(userTable.role, "owner"),
          isNull(userTable.disabledAt),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return { ok: false, error: "forbidden" } as const;

    // 目标校验：同家庭、启用、admin。
    const target = tx
      .select({ id: userTable.id, role: userTable.role })
      .from(userTable)
      .where(
        and(
          eq(userTable.id, targetUserId),
          eq(userTable.familyId, context.familyId),
          isNull(userTable.disabledAt),
        ),
      )
      .limit(1)
      .get();
    if (!target) return { ok: false, error: "not_found" } as const;
    if (target.role !== "admin" || targetUserId === context.userId) {
      return { ok: false, error: "invalid_target" } as const;
    }

    const now = new Date();
    const demoted = tx
      .update(userTable)
      .set({ role: "admin", updatedAt: now })
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.role, "owner"),
          isNull(userTable.disabledAt),
        ),
      )
      .run();
    const promoted = tx
      .update(userTable)
      .set({ role: "owner", updatedAt: now })
      .where(
        and(
          eq(userTable.id, targetUserId),
          eq(userTable.role, "admin"),
          isNull(userTable.disabledAt),
        ),
      )
      .run();
    if (demoted.changes !== 1 || promoted.changes !== 1) {
      throw new Error("ownership transfer raced; no changes applied");
    }
    tx.insert(auditLog)
      .values(
        requiredAuditValues(
          context.familyId,
          AUDIT_KINDS.ownershipTransferred,
          context.userId,
          { fromUserId: context.userId, toUserId: targetUserId },
          now,
        ),
      )
      .run();
    return { ok: true } as const;
  });
}

/** 供 server action 在调用 transferOwnership 前完成的密码复核。 */
export async function verifyCurrentPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const { verifyPassword } = await import("better-auth/crypto");
  const rows = getDb()
    .select({ password: accountTable.password })
    .from(accountTable)
    .where(eq(accountTable.userId, userId))
    .limit(1)
    .get();
  if (!rows?.password) return false;
  return verifyPassword({ hash: rows.password, password });
}

// ---------------------------------------------------------------- 会话管理

export type SessionDto = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  /** 请求当前携带的会话（better-auth context.sessionToken 比对）。 */
  isCurrent: boolean;
};

export type SessionServiceError = "forbidden";

export function listOwnSessions(
  context: FamilyContext,
  currentSessionId: string | null,
): SessionDto[] | { error: SessionServiceError } {
  const db = getDb();
  return db.transaction((tx) => {
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.familyId, context.familyId),
          isNull(userTable.disabledAt),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return { error: "forbidden" } as const;
    const rows = tx
      .select({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        token: session.token,
      })
      .from(session)
      .where(eq(session.userId, context.userId))
      .orderBy(asc(session.createdAt))
      .all();
    // 当前会话通过 cookie 内 token 的 SHA 哈希比对（session.token 存哈希）。
    let currentTokenHash: string | null = null;
    if (currentSessionId) {
      const current = rows.find((row) => row.id === currentSessionId);
      currentTokenHash = current?.token ?? null;
    }
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      isCurrent: currentTokenHash !== null && row.token === currentTokenHash,
    }));
  });
}

/** 撤销本人除当前会话外的全部会话（含原生设备 Bearer 会话）。 */
export function revokeOtherSessions(
  context: FamilyContext,
  currentSessionId: string | null,
): { ok: true } | { ok: false; error: SessionServiceError } {
  const db = getDb();
  return db.transaction((tx) => {
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(
        and(
          eq(userTable.id, context.userId),
          eq(userTable.familyId, context.familyId),
          isNull(userTable.disabledAt),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return { ok: false, error: "forbidden" } as const;
    if (currentSessionId) {
      tx.delete(session)
        .where(
          and(
            eq(session.userId, context.userId),
            ne(session.id, currentSessionId),
          ),
        )
        .run();
    } else {
      tx.delete(session).where(eq(session.userId, context.userId)).run();
    }
    tx.insert(auditLog)
      .values(
        requiredAuditValues(
          context.familyId,
          AUDIT_KINDS.sessionsRevoked,
          context.userId,
          { keptSessionId: currentSessionId ?? "none" },
        ),
      )
      .run();
    return { ok: true } as const;
  });
}
