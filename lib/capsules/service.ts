import "server-only";

import { randomUUID } from "node:crypto";
import { isNull, and, asc, desc, eq, inArray } from "drizzle-orm";
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
import {
  getVisibleContributionInTransaction,
  listVisibleContributionsByIds,
  type ContributionAccessSnapshot,
  type VisibleContributionDto,
} from "@/lib/authz/contribution-access";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { isLiveFamilyPrincipal } from "@/lib/authz/principal";

/**
 * 时间胶囊领域服务（Issue #013）。
 * 解锁判定：date=家庭时区当日零点起；age=孩子满 N 周岁。
 * seal 只影响普通 UI 展示；显式灾难导出旁路永远拿得到全部内容。
 */

export type CapsuleRow = typeof capsule.$inferSelect;
export type UnlockType = "date" | "age";

export type CapsuleDetail = {
  capsule: CapsuleRow;
  events: MemoryEventRow[];
  assets: AssetRow[];
  contributions: VisibleContributionDto[];
  unlocked: boolean;
};

export type CompleteCapsuleDetail = Omit<CapsuleDetail, "contributions"> & {
  contributions: (ContributionRow & { authorName: string })[];
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
  snapshot: ContributionAccessSnapshot,
  capsuleId: string,
  contributionId: string,
): Promise<boolean> {
  if (!hasFamilyCapability(snapshot.principal.role, "capsule:write")) {
    return false;
  }
  const familyId = snapshot.principal.familyId;
  const db = getDb();
  return db.transaction(
    (tx) => {
      const visible = getVisibleContributionInTransaction(
        tx,
        snapshot,
        contributionId,
      );
      if (!visible) return false;

      const cap = tx
        .select({ id: capsule.id })
        .from(capsule)
        .where(
          and(
            eq(capsule.id, capsuleId),
            eq(capsule.familyId, familyId),
            eq(capsule.status, "draft"),
          ),
        )
        .limit(1)
        .get();
      if (!cap) return false;

      tx.insert(capsuleContribution)
        .values({
          id: randomUUID(),
          capsuleId,
          contributionId: visible.id,
          familyId,
          createdAt: new Date(),
        })
        .run();
      return true;
    },
    { behavior: "immediate" },
  );
}

export type CapsuleListItem = CapsuleRow & { unlocked: boolean; itemCount: number };

export async function listCapsules(
  snapshot: ContributionAccessSnapshot,
  childBirthDate: string | null,
): Promise<CapsuleListItem[]> {
  if (!(await isLiveFamilyPrincipal(snapshot.principal))) return [];
  const familyId = snapshot.principal.familyId;
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
  const visibleContributions = await listVisibleContributionsByIds(
    snapshot,
    [...new Set(contributionLinks.map((link) => link.contributionId))],
  );
  const visibleContributionIds = new Set(
    visibleContributions.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    unlocked: isCapsuleUnlocked(
      row,
      childBirthDate,
      snapshot.principal.familyTimezone,
      snapshot.evaluatedAt,
    ),
    itemCount:
      eventLinks.filter((l) => l.capsuleId === row.id).length +
      assetLinks.filter((l) => l.capsuleId === row.id).length +
      contributionLinks.filter(
        (l) =>
          l.capsuleId === row.id &&
          visibleContributionIds.has(l.contributionId),
      ).length,
  }));
}

async function getCapsuleLinks(familyId: string, capsuleId: string) {
  const db = getDb();
  return Promise.all([
    db
      .select({ memoryEventId: capsuleEvent.memoryEventId })
      .from(capsuleEvent)
      .where(
        and(
          eq(capsuleEvent.capsuleId, capsuleId),
          eq(capsuleEvent.familyId, familyId),
        ),
      ),
    db
      .select({ assetId: capsuleAsset.assetId })
      .from(capsuleAsset)
      .where(
        and(
          eq(capsuleAsset.capsuleId, capsuleId),
          eq(capsuleAsset.familyId, familyId),
        ),
      ),
    db
      .select({ contributionId: capsuleContribution.contributionId })
      .from(capsuleContribution)
      .where(
        and(
          eq(capsuleContribution.capsuleId, capsuleId),
          eq(capsuleContribution.familyId, familyId),
        ),
      ),
  ]);
}

async function getLinkedEventsAndAssets(
  familyId: string,
  eventIds: readonly string[],
  assetIds: readonly string[],
) {
  const db = getDb();
  const [events, assets] = await Promise.all([
    eventIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(memoryEventTable)
          .where(
            and(
              eq(memoryEventTable.familyId, familyId),
              inArray(memoryEventTable.id, [...eventIds]),
            ),
          )
          .orderBy(asc(memoryEventTable.createdAt)),
    assetIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(assetTable)
          .where(
            and(
              eq(assetTable.familyId, familyId),
              inArray(assetTable.id, [...assetIds]),
            ),
          )
          .orderBy(asc(assetTable.createdAt)),
  ]);
  return { events, assets };
}

/**
 * Ordinary capsule detail. A Contribution is returned only when both the
 * capsule is open/draft and the live principal can currently see that row.
 */
async function getVisibleCapsuleDetail(
  snapshot: ContributionAccessSnapshot,
  capsuleId: string,
  childBirthDate: string | null,
): Promise<CapsuleDetail | undefined> {
  if (!(await isLiveFamilyPrincipal(snapshot.principal))) return undefined;
  const familyId = snapshot.principal.familyId;
  const row = await familyScope(familyId, capsuleId);
  if (!row) return undefined;
  const unlocked = isCapsuleUnlocked(
    row,
    childBirthDate,
    snapshot.principal.familyTimezone,
    snapshot.evaluatedAt,
  );
  if (row.status !== "draft" && !unlocked) {
    return { capsule: row, events: [], assets: [], contributions: [], unlocked };
  }

  const [eventLinks, assetLinks, contributionLinks] = await getCapsuleLinks(
    familyId,
    capsuleId,
  );
  const { events, assets } = await getLinkedEventsAndAssets(
    familyId,
    eventLinks.map((link) => link.memoryEventId),
    assetLinks.map((link) => link.assetId),
  );
  const contributions = await listVisibleContributionsByIds(
    snapshot,
    contributionLinks.map((link) => link.contributionId),
  );
  return { capsule: row, events, assets, contributions, unlocked };
}

/**
 * The only unfiltered capsule reader. Callers must independently enforce the
 * admin disaster-export capability; normal pages/actions never use it.
 */
export async function getCompleteCapsuleDetailForDisasterExport(
  familyId: string,
  capsuleId: string,
  childBirthDate: string | null,
  familyTimezone: string,
  now = new Date(),
): Promise<CompleteCapsuleDetail | undefined> {
  const row = await familyScope(familyId, capsuleId);
  if (!row) return undefined;
  const unlocked = isCapsuleUnlocked(
    row,
    childBirthDate,
    familyTimezone,
    now,
  );
  const [eventLinks, assetLinks, contributionLinks] = await getCapsuleLinks(
    familyId,
    capsuleId,
  );
  const { events, assets } = await getLinkedEventsAndAssets(
    familyId,
    eventLinks.map((link) => link.memoryEventId),
    assetLinks.map((link) => link.assetId),
  );
  const contributionIds = contributionLinks.map((link) => link.contributionId);
  const db = getDb();
  const contributions =
    contributionIds.length === 0
      ? []
      : (
          await db
            .select({
              contribution: contributionTable,
              authorName: personTable.displayName,
            })
            .from(contributionTable)
            .innerJoin(
              memoryEventTable,
              eq(contributionTable.memoryEventId, memoryEventTable.id),
            )
            .innerJoin(
              personTable,
              and(
                eq(contributionTable.authorPersonId, personTable.id),
                eq(personTable.familyId, memoryEventTable.familyId),
              ),
            )
            .where(
              and(
                eq(memoryEventTable.familyId, familyId),
                inArray(contributionTable.id, contributionIds),
                isNull(contributionTable.deletedAt),
              ),
            )
            .orderBy(asc(contributionTable.createdAt))
        ).map(({ contribution: contributionRow, authorName }) => ({
          ...contributionRow,
          authorName,
        }));

  return { capsule: row, events, assets, contributions, unlocked };
}

export function getCapsuleDetail(
  snapshot: ContributionAccessSnapshot,
  capsuleId: string,
  childBirthDate: string | null,
): Promise<CapsuleDetail | undefined> {
  return getVisibleCapsuleDetail(snapshot, capsuleId, childBirthDate);
}
