import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { person as personTable } from "@/db/schema/family";
import { contribution as contributionTable } from "@/db/schema/contribution";
import { memoryEvent as memoryEventTable } from "@/db/schema/memory";
import {
  capsule,
  capsuleAsset,
  capsuleContribution,
  capsuleEvent,
} from "@/db/schema/capsule";
import { calendarDiff } from "@/lib/memories/age";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import { isValidDateString } from "@/lib/family/service";
import type { AssetRow } from "@/lib/assets/service";
import type { MemoryEventRow } from "@/lib/memories/service";
import type { ContributionRow } from "@/lib/contributions/service";

/**
 * 时间胶囊领域服务（Issue #013）。
 * 解锁判定：date=家庭时区当日零点起；age=孩子满 N 周岁。
 * seal 只影响普通 UI 展示；导出（includeLocked=true）永远拿得到全部内容。
 */

export type CapsuleRow = typeof capsule.$inferSelect;
export type UnlockType = "date" | "age";

export type CapsuleDetail = {
  capsule: CapsuleRow;
  events: MemoryEventRow[];
  assets: AssetRow[];
  contributions: (ContributionRow & { authorName: string })[];
  unlocked: boolean;
};

export function isValidUnlockValue(
  type: UnlockType,
  value: string,
): boolean {
  if (type === "date") {
    // 严格日历日校验（new Date 会把 2/30 自动进位成 3/2）
    return isValidDateString(value);
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100;
}

/** 解锁时刻（date 型）：家庭时区当日零点 */
export function dateUnlockInstant(
  unlockValue: string,
  familyTimezone: string,
): Date {
  return zonedWallTimeToUtc(`${unlockValue}T00:00:00`, familyTimezone);
}

export function isCapsuleUnlocked(
  row: Pick<CapsuleRow, "unlockType" | "unlockValue" | "status">,
  childBirthDate: string | null,
  familyTimezone: string,
  now: Date = new Date(),
): boolean {
  if (row.status === "opened") return true;
  if (row.status !== "sealed") return false;
  if (row.unlockType === "date") {
    return now.getTime() >= dateUnlockInstant(row.unlockValue, familyTimezone).getTime();
  }
  if (row.unlockType === "age") {
    if (!childBirthDate) return false;
    const { years } = calendarDiff(childBirthDate, now);
    return years >= Number(row.unlockValue);
  }
  return false;
}

async function familyScope(
  familyId: string,
  capsuleId: string,
): Promise<CapsuleRow | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(capsule)
    .where(and(eq(capsule.familyId, familyId), eq(capsule.id, capsuleId)))
    .limit(1);
  return rows[0];
}

export async function createCapsule(
  familyId: string,
  input: { title: string; unlockType: UnlockType; unlockValue: string },
): Promise<{ ok: true; capsuleId: string } | { ok: false; error: "invalid" }> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 100) return { ok: false, error: "invalid" };
  if (
    (input.unlockType !== "date" && input.unlockType !== "age") ||
    !isValidUnlockValue(input.unlockType, input.unlockValue)
  ) {
    return { ok: false, error: "invalid" };
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  await db.insert(capsule).values({
    id,
    familyId,
    title,
    unlockType: input.unlockType,
    unlockValue: input.unlockValue,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, capsuleId: id };
}

export async function sealCapsule(
  familyId: string,
  capsuleId: string,
): Promise<CapsuleRow | undefined> {
  const row = await familyScope(familyId, capsuleId);
  if (!row || row.status !== "draft") return undefined;
  const db = getDb();
  const now = new Date();
  const rows = await db
    .update(capsule)
    .set({ status: "sealed", sealedAt: now, updatedAt: now })
    .where(eq(capsule.id, capsuleId))
    .returning();
  return rows[0];
}

/** 只有真正达到解锁条件才能开启 */
export async function openCapsule(
  familyId: string,
  capsuleId: string,
  childBirthDate: string | null,
  familyTimezone: string,
): Promise<{ ok: true; row: CapsuleRow } | { ok: false; error: "not_unlocked" | "not_found" }> {
  const row = await familyScope(familyId, capsuleId);
  if (!row) return { ok: false, error: "not_found" };
  if (!isCapsuleUnlocked(row, childBirthDate, familyTimezone)) {
    return { ok: false, error: "not_unlocked" };
  }
  const db = getDb();
  const now = new Date();
  const rows = await db
    .update(capsule)
    .set({ status: "opened", openedAt: now, updatedAt: now })
    .where(eq(capsule.id, capsuleId))
    .returning();
  return { ok: true, row: rows[0] };
}

export async function addCapsuleEvent(
  familyId: string,
  capsuleId: string,
  memoryEventId: string,
): Promise<boolean> {
  const cap = await familyScope(familyId, capsuleId);
  if (!cap || cap.status !== "draft") return false;
  const db = getDb();
  const ev = await db
    .select({ id: memoryEventTable.id })
    .from(memoryEventTable)
    .where(
      and(
        eq(memoryEventTable.familyId, familyId),
        eq(memoryEventTable.id, memoryEventId),
      ),
    )
    .limit(1);
  if (!ev[0]) return false;
  await db.insert(capsuleEvent).values({
    id: randomUUID(),
    capsuleId,
    memoryEventId,
    familyId,
    createdAt: new Date(),
  });
  return true;
}

export async function addCapsuleAsset(
  familyId: string,
  capsuleId: string,
  assetId: string,
): Promise<boolean> {
  const cap = await familyScope(familyId, capsuleId);
  if (!cap || cap.status !== "draft") return false;
  const db = getDb();
  const a = await db
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(and(eq(assetTable.familyId, familyId), eq(assetTable.id, assetId)))
    .limit(1);
  if (!a[0]) return false;
  await db.insert(capsuleAsset).values({
    id: randomUUID(),
    capsuleId,
    assetId,
    familyId,
    createdAt: new Date(),
  });
  return true;
}

export async function addCapsuleContribution(
  familyId: string,
  capsuleId: string,
  contributionId: string,
): Promise<boolean> {
  const cap = await familyScope(familyId, capsuleId);
  if (!cap || cap.status !== "draft") return false;
  const db = getDb();
  const c = await db
    .select({ id: contributionTable.id })
    .from(contributionTable)
    .where(
      and(
        eq(contributionTable.id, contributionId),
        eq(memoryEventTable.familyId, familyId),
      ),
    )
    .innerJoin(memoryEventTable, eq(contributionTable.memoryEventId, memoryEventTable.id))
    .limit(1);
  if (!c[0]) return false;
  await db.insert(capsuleContribution).values({
    id: randomUUID(),
    capsuleId,
    contributionId,
    familyId,
    createdAt: new Date(),
  });
  return true;
}

export type CapsuleListItem = CapsuleRow & { unlocked: boolean; itemCount: number };

export async function listCapsules(
  familyId: string,
  childBirthDate: string | null,
  familyTimezone: string,
): Promise<CapsuleListItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(capsule)
    .where(eq(capsule.familyId, familyId))
    .orderBy(desc(capsule.createdAt));
  const [eventLinks, assetLinks, contributionLinks] = await Promise.all([
    db.select().from(capsuleEvent).where(eq(capsuleEvent.familyId, familyId)),
    db.select().from(capsuleAsset).where(eq(capsuleAsset.familyId, familyId)),
    db.select().from(capsuleContribution).where(eq(capsuleContribution.familyId, familyId)),
  ]);
  return rows.map((row) => ({
    ...row,
    unlocked: isCapsuleUnlocked(row, childBirthDate, familyTimezone),
    itemCount:
      eventLinks.filter((l) => l.capsuleId === row.id).length +
      assetLinks.filter((l) => l.capsuleId === row.id).length +
      contributionLinks.filter((l) => l.capsuleId === row.id).length,
  }));
}

/**
 * 胶囊详情。seal 后（且未解锁）普通调用只返回元信息与空内容；
 * includeLocked=true 仅供管理员导出/备份（#014）——封存不是物理加密。
 */
export async function getCapsuleDetail(
  familyId: string,
  capsuleId: string,
  childBirthDate: string | null,
  familyTimezone: string,
  opts: { includeLocked?: boolean } = {},
): Promise<CapsuleDetail | undefined> {
  const row = await familyScope(familyId, capsuleId);
  if (!row) return undefined;
  const unlocked = isCapsuleUnlocked(row, childBirthDate, familyTimezone);
  const canSeeContents =
    row.status === "draft" || unlocked || opts.includeLocked === true;

  const db = getDb();
  if (!canSeeContents) {
    return { capsule: row, events: [], assets: [], contributions: [], unlocked };
  }
  const [eventLinks, assetLinks, contributionLinks] = await Promise.all([
    db
      .select({ memoryEventId: capsuleEvent.memoryEventId })
      .from(capsuleEvent)
      .where(eq(capsuleEvent.capsuleId, capsuleId)),
    db
      .select({ assetId: capsuleAsset.assetId })
      .from(capsuleAsset)
      .where(eq(capsuleAsset.capsuleId, capsuleId)),
    db
      .select({ contributionId: capsuleContribution.contributionId })
      .from(capsuleContribution)
      .where(eq(capsuleContribution.capsuleId, capsuleId)),
  ]);

  const events =
    eventLinks.length > 0
      ? (await db
          .select()
          .from(memoryEventTable)
          .where(eq(memoryEventTable.familyId, familyId)))
          .filter((e) => eventLinks.some((l) => l.memoryEventId === e.id))
      : [];
  const assets =
    assetLinks.length > 0
      ? (await db.select().from(assetTable).where(eq(assetTable.familyId, familyId)))
          .filter((a) => assetLinks.some((l) => l.assetId === a.id))
      : [];
  const contributions =
    contributionLinks.length > 0
      ? (
          await db
            .select({
              contribution: contributionTable,
              authorName: personTable.displayName,
            })
            .from(contributionTable)
            .innerJoin(
              personTable,
              eq(contributionTable.authorPersonId, personTable.id),
            )
            .innerJoin(
              memoryEventTable,
              eq(contributionTable.memoryEventId, memoryEventTable.id),
            )
            .where(eq(memoryEventTable.familyId, familyId))
        )
          .filter((c) =>
            contributionLinks.some((l) => l.contributionId === c.contribution.id),
          )
          .map((c) => ({ ...c.contribution, authorName: c.authorName }))
      : [];

  return { capsule: row, events, assets, contributions, unlocked };
}
