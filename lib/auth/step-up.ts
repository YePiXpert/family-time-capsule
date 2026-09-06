import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { session as sessionTable, user as userTable } from "@/db/schema/auth";

/**
 * step-up 认证（ID-10；白皮书 §12「高敏操作要求近期重新认证」）。
 *
 * 会话行记录 recent_auth_at；高敏操作（完整导出等）在服务里要求它在
 * 窗口内（默认 10 分钟），否则返回 step_up_required——UI 引导用户输入
 * 当前密码完成复核，而不是放宽检查。密码复核本身先验证凭据再落时间戳。
 */

export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

/**
 * 当前会话是否已满足近期认证（窗口内）。
 * 刚完成的登录本身就是密码证明：会话创建时间在窗口内同样满足；
 * 超过窗口的会话需要一次显式密码复核（recent_auth_at）。
 */
export function hasRecentAuth(
  sessionId: string,
  windowMs = RECENT_AUTH_WINDOW_MS,
): boolean {
  const row = getDb()
    .select({
      recentAuthAt: sessionTable.recentAuthAt,
      createdAt: sessionTable.createdAt,
      disabledAt: userTable.disabledAt,
    })
    .from(sessionTable)
    .innerJoin(userTable, eq(userTable.id, sessionTable.userId))
    .where(eq(sessionTable.id, sessionId))
    .limit(1)
    .all()[0];
  if (!row || row.disabledAt !== null) return false;
  const evidence = row.recentAuthAt ?? row.createdAt;
  if (!evidence) return false;
  return Date.now() - evidence.getTime() <= windowMs;
}

/** 密码复核成功后标记本会话为「近期已认证」；失败不落时间戳。 */
export async function markRecentAuth(
  sessionId: string,
  password: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const db = getDb();
  const target = db
    .select({ userId: sessionTable.userId })
    .from(sessionTable)
    .where(eq(sessionTable.id, sessionId))
    .limit(1)
    .all()[0];
  if (!target) return false;
  const { verifyCurrentPassword } = await import("@/lib/accounts/service");
  if (!(await verifyCurrentPassword(target.userId, password))) return false;
  const now = new Date();
  const updated = db
    .update(sessionTable)
    .set({ recentAuthAt: now, updatedAt: now })
    .where(eq(sessionTable.id, sessionId))
    .run();
  return updated.changes === 1;
}
