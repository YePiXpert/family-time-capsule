import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema/audit";
import { user as userTable } from "@/db/schema/auth";

/**
 * 操作审计（v0.1.3）：导出/恢复等高价值动作留痕。
 * 记录是 best-effort——审计失败绝不阻断主操作。
 */

export type AuditEntry = {
  id: string;
  kind: string;
  actorUserId: string | null;
  actorName: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
};

export const AUDIT_KINDS = {
  exportCreated: "export.created",
  restoreCompleted: "restore.completed",
  accountDisabled: "account.disabled",
  accountEnabled: "account.enabled",
  accountRoleChanged: "account.role_changed",
  contributionRecordedOnBehalf: "contribution.recorded_on_behalf",
  guardianChanged: "person.guardian_changed",
  childLaterPolicyChanged: "child_later.policy_changed",
  childLaterManuallyUnlocked: "child_later.manually_unlocked",
  aiConsentEnabled: "ai.consent_enabled",
  aiConsentRevoked: "ai.consent_revoked",
  aiJobCancelled: "ai.job_cancelled",
  aiJobRetried: "ai.job_retried",
} as const;

/** Values for security-critical mutations that write audit in the same tx. */
export function requiredAuditValues(
  familyId: string,
  kind: string,
  actorUserId: string,
  detail: Record<string, unknown>,
  createdAt = new Date(),
) {
  return {
    id: randomUUID(),
    familyId,
    kind,
    actorUserId,
    detailJson: JSON.stringify(detail),
    createdAt,
  };
}

export async function recordAudit(
  familyId: string,
  kind: string,
  actorUserId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(auditLog).values({
      id: randomUUID(),
      familyId,
      kind,
      actorUserId,
      detailJson: JSON.stringify(detail),
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[audit] record failed:", err);
  }
}

export async function listRecentAudit(
  familyId: string,
  limit = 10,
): Promise<AuditEntry[]> {
  const db = getDb();
  const rows = await db
    .select({ entry: auditLog, actorName: userTable.name })
    .from(auditLog)
    .leftJoin(userTable, eq(auditLog.actorUserId, userTable.id))
    .where(eq(auditLog.familyId, familyId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.entry.id,
    kind: r.entry.kind,
    actorUserId: r.entry.actorUserId,
    actorName: r.actorName ?? null,
    detail: JSON.parse(r.entry.detailJson) as Record<string, unknown>,
    createdAt: r.entry.createdAt,
  }));
}
