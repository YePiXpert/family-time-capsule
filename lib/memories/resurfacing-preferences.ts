import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { resurfacingPreference } from "@/db/schema/resurfacing";
import { user as userTable } from "@/db/schema/auth";
import type { FamilyContext } from "@/lib/family/context";

/**
 * 回顾屏蔽（§8 / FIND-9）：当前用户的自动回顾偏好。
 * 屏蔽 ≠ 删除 ≠ 无权：搜索与主动打开仍按原权限。
 */

export type ResurfacingBlockKind = "event" | "person" | "date_range" | "pause";

export type ResurfacingPreferenceDto = {
  id: string;
  kind: ResurfacingBlockKind;
  targetKey: string;
  dateFrom: string | null;
  dateTo: string | null;
  createdAt: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function liveUser(context: FamilyContext): boolean {
  const row = getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      sql`${userTable.id} = ${context.userId}
        and ${userTable.familyId} = ${context.familyId}
        and ${userTable.disabledAt} is null`,
    )
    .limit(1)
    .get();
  return Boolean(row);
}

export function listResurfacingPreferences(context: FamilyContext): ResurfacingPreferenceDto[] {
  return getDb()
    .select()
    .from(resurfacingPreference)
    .where(
      and(
        eq(resurfacingPreference.familyId, context.familyId),
        eq(resurfacingPreference.userId, context.userId),
      ),
    )
    .all()
    .map((row) => ({
      id: row.id,
      kind: row.kind as ResurfacingBlockKind,
      targetKey: row.targetKey,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      createdAt: row.createdAt.toISOString(),
    }));
}

export type AddBlockResult =
  | { ok: true; preference: ResurfacingPreferenceDto }
  | { ok: false; error: "invalid" | "forbidden" };

export function addResurfacingBlock(
  context: FamilyContext,
  input: { kind: ResurfacingBlockKind; eventId?: string; personId?: string; dateFrom?: string; dateTo?: string },
): AddBlockResult {
  if (!liveUser(context)) return { ok: false, error: "forbidden" };
  const db = getDb();
  let targetKey: string;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  switch (input.kind) {
    case "event": {
      if (!input.eventId || !/^[\w-]{1,128}$/u.test(input.eventId)) return { ok: false, error: "invalid" };
      const event = db.select({ id: sql<string>`id` }).from(sql`memory_event`).where(
        sql`id = ${input.eventId} and family_id = ${context.familyId} and deleted_at is null`,
      ).limit(1).get();
      if (!event) return { ok: false, error: "invalid" };
      targetKey = input.eventId;
      break;
    }
    case "person": {
      if (!input.personId || !/^[\w-]{1,128}$/u.test(input.personId)) return { ok: false, error: "invalid" };
      const person = db.select({ id: sql<string>`id` }).from(sql`person`).where(
        sql`id = ${input.personId} and family_id = ${context.familyId}`,
      ).limit(1).get();
      if (!person) return { ok: false, error: "invalid" };
      targetKey = input.personId;
      break;
    }
    case "date_range": {
      const from = input.dateFrom ?? "";
      const to = input.dateTo ?? from;
      const validDate = (value: string) => {
        if (!DATE.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };
      if (!validDate(from) || !validDate(to) || from > to) return { ok: false, error: "invalid" };
      dateFrom = from;
      dateTo = to;
      targetKey = `${from}..${to}`;
      break;
    }
    case "pause":
      targetKey = "pause";
      break;
  }
  const existing = db
    .select()
    .from(resurfacingPreference)
    .where(
      and(
        eq(resurfacingPreference.familyId, context.familyId),
        eq(resurfacingPreference.userId, context.userId),
        eq(resurfacingPreference.kind, input.kind),
        eq(resurfacingPreference.targetKey, targetKey),
      ),
    )
    .limit(1)
    .get();
  if (existing) {
    return {
      ok: true,
      preference: {
        id: existing.id,
        kind: existing.kind as ResurfacingBlockKind,
        targetKey: existing.targetKey,
        dateFrom: existing.dateFrom,
        dateTo: existing.dateTo,
        createdAt: existing.createdAt.toISOString(),
      },
    };
  }
  const row = db
    .insert(resurfacingPreference)
    .values({
      id: randomUUID(),
      familyId: context.familyId,
      userId: context.userId,
      kind: input.kind,
      targetKey,
      dateFrom,
      dateTo,
    })
    .returning()
    .get();
  return {
    ok: true,
    preference: {
      id: row.id,
      kind: row.kind as ResurfacingBlockKind,
      targetKey: row.targetKey,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export function removeResurfacingBlock(context: FamilyContext, preferenceId: string): boolean {
  if (!liveUser(context)) return false;
  const deleted = getDb()
    .delete(resurfacingPreference)
    .where(
      and(
        eq(resurfacingPreference.id, preferenceId),
        eq(resurfacingPreference.familyId, context.familyId),
        eq(resurfacingPreference.userId, context.userId),
      ),
    )
    .returning({ id: resurfacingPreference.id })
    .get();
  return Boolean(deleted);
}
