import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { memoryEvent, memoryEventReader } from "@/db/schema/memory";
import {
  canManageEventVisibility,
  canViewMemoryEvent,
  isEventVisibility,
  type EventVisibility,
} from "./policy";
import { principalFromFamilyContext, type LiveFamilyPrincipal } from "./principal";
import type { FamilyContext } from "@/lib/family/context";

/**
 * 正式 1.0 §5：记忆事件对象级读者的服务端裁决。
 *
 * 与 contribution-access 相同的原则：策略输入绝不来自客户端；所有可变
 * 主体字段（家庭、角色、停用状态）都在查询时与库内实时值比对，过期
 * 快照不能延续权限。管理员/owner 不是旁路。
 */

export type EventAccessSnapshot = Readonly<{
  principal: Pick<LiveFamilyPrincipal, "userId" | "familyId" | "role" | "accountEnabled">;
  evaluatedAt: Date;
}>;

export function createEventAccessSnapshot(
  context: FamilyContext,
  evaluatedAt = new Date(),
): EventAccessSnapshot {
  const principal = principalFromFamilyContext(context);
  return {
    principal: {
      userId: principal.userId,
      familyId: principal.familyId,
      role: principal.role,
      accountEnabled: principal.accountEnabled,
    },
    evaluatedAt,
  };
}

/**
 * SQL 谓词：外层查询已绑定 memory_event（或经别名引用），追加对象级
 * 可见性过滤。作者缺失（created_by_user_id IS NULL）且非 family 时
 * fail closed。
 */
export function eventVisibilityCondition(
  snapshot: EventAccessSnapshot,
  eventReference: SQL | string = sql`memory_event`,
): SQL {
  const p = snapshot.principal;
  const table = typeof eventReference === "string" ? sql.raw(eventReference) : eventReference;
  return sql`(
    ${table}.visibility = 'family'
    or ${table}.created_by_user_id = ${p.userId}
    or (
      ${table}.visibility = 'members'
      and exists (
        select 1 from memory_event_reader er
        inner join user reader_user on reader_user.id = er.user_id
        where er.memory_event_id = ${table}.id
          and er.family_id = ${p.familyId}
          and er.user_id = ${p.userId}
          and reader_user.family_id = ${p.familyId}
          and reader_user.disabled_at is null
      )
    )
  ) and exists (
    select 1 from user live_event_user
    where live_event_user.id = ${p.userId}
      and live_event_user.family_id = ${p.familyId}
      and live_event_user.role = ${p.role}
      and live_event_user.disabled_at is null
  )`;
}

export type VisibleEventAuthorizationRow = Readonly<{
  id: string;
  visibility: EventVisibility;
  createdByUserId: string | null;
}>;

/**
 * 单事件实时裁决：principal 家庭/角色/停用状态与库内实时值比对后，
 * 按 canViewMemoryEvent 判定。用于详情页、API 与写路径守卫。
 */
export function getVisibleMemoryEventInTransaction(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  snapshot: EventAccessSnapshot,
  eventId: string,
  options: { includeDeleted?: boolean } = {},
): VisibleEventAuthorizationRow | undefined {
  const live = tx
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      sql`${userTable.id} = ${snapshot.principal.userId}
        and ${userTable.familyId} = ${snapshot.principal.familyId}
        and ${userTable.role} = ${snapshot.principal.role}
        and ${userTable.disabledAt} is null`,
    )
    .limit(1)
    .get();
  if (!live) return undefined;
  const row = tx
    .select({
      id: memoryEvent.id,
      visibility: memoryEvent.visibility,
      createdByUserId: memoryEvent.createdByUserId,
    })
    .from(memoryEvent)
    .where(
      sql`${memoryEvent.id} = ${eventId}
        and ${memoryEvent.familyId} = ${snapshot.principal.familyId}
        and ${options.includeDeleted ? sql`1` : sql`${memoryEvent.deletedAt} is null`}`,
    )
    .limit(1)
    .get();
  if (!row || !isEventVisibility(row.visibility)) return undefined;
  const readers = new Set(
    tx
      .select({ userId: memoryEventReader.userId })
      .from(memoryEventReader)
      .where(eq(memoryEventReader.memoryEventId, eventId))
      .all()
      .map((entry) => entry.userId),
  );
  if (
    !canViewMemoryEvent(row.visibility, row.createdByUserId, readers, {
      role: snapshot.principal.role,
      userId: snapshot.principal.userId,
      accountEnabled: snapshot.principal.accountEnabled,
    })
  ) {
    return undefined;
  }
  return { id: row.id, visibility: row.visibility, createdByUserId: row.createdByUserId };
}

/** 读者/可见性管理守卫（仅作者；family 事件沿用 event:write）。 */
export function canManageEventVisibilityInTransaction(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  snapshot: EventAccessSnapshot,
  eventId: string,
  options: { includeDeleted?: boolean } = {},
): boolean {
  const row = getVisibleMemoryEventInTransaction(tx, snapshot, eventId, options);
  if (!row) return false;
  return canManageEventVisibility(row.visibility, row.createdByUserId, {
    role: snapshot.principal.role,
    userId: snapshot.principal.userId,
    accountEnabled: snapshot.principal.accountEnabled,
  });
}

export async function listEventReaderUserIds(
  familyId: string,
  eventId: string,
): Promise<string[]> {
  return (
    await getDb()
      .select({ userId: memoryEventReader.userId })
      .from(memoryEventReader)
      .where(
        sql`${memoryEventReader.memoryEventId} = ${eventId}
          and ${memoryEventReader.familyId} = ${familyId}`,
      )
  ).map((row) => row.userId);
}
