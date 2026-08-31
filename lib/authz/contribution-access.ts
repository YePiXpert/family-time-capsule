import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { asset } from "@/db/schema/asset";
import { user as userTable } from "@/db/schema/auth";
import { contribution } from "@/db/schema/contribution";
import { family, person } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import {
  canEditContribution,
  isContributionVisibility,
  type ContributionVisibility,
} from "./policy";
import {
  familyLocalDate,
  principalFromFamilyContext,
  type LiveFamilyPrincipal,
} from "./principal";
import type { FamilyContext } from "@/lib/family/context";

const authorPerson = alias(person, "contribution_author");
const eventChild = alias(person, "contribution_event_child");
const viewerPerson = alias(person, "contribution_viewer_person");
const viewerFamily = alias(family, "contribution_viewer_family");
const viewerUser = alias(userTable, "contribution_viewer_user");

export type ContributionAccessSnapshot = Readonly<{
  principal: LiveFamilyPrincipal;
  evaluatedAt: Date;
  familyLocalDate: string;
}>;

export type VisibleContributionDto = Readonly<{
  id: string;
  memoryEventId: string;
  authorPersonId: string;
  authorName: string;
  authorRelation: string | null;
  rawText: string | null;
  transcript: string | null;
  editedText: string | null;
  audioAssetId: string | null;
  visibility: ContributionVisibility;
  createdAt: Date;
  updatedAt: Date;
  canEdit: boolean;
}>;

type AppTransactionCallback = Parameters<
  ReturnType<typeof getDb>["transaction"]
>[0];
export type ContributionAccessTransaction = Parameters<AppTransactionCallback>[0];

export type VisibleContributionAuthorizationRow = Readonly<{
  id: string;
  memoryEventId: string;
  authorPersonId: string;
  visibility: ContributionVisibility;
}>;

export function createContributionAccessSnapshot(
  context: FamilyContext,
  evaluatedAt = new Date(),
): ContributionAccessSnapshot {
  const principal = principalFromFamilyContext(context);
  return {
    principal,
    evaluatedAt,
    familyLocalDate: familyLocalDate(evaluatedAt, principal.familyTimezone),
  };
}

function visibilityPredicate(snapshot: ContributionAccessSnapshot): SQL {
  const principal = snapshot.principal;
  const samePrincipalPerson =
    principal.personId === null
      ? isNull(viewerUser.personId)
      : eq(viewerUser.personId, principal.personId);
  const sameGuardianState =
    principal.personId === null
      ? isNull(viewerPerson.id)
      : and(
          eq(viewerPerson.id, principal.personId),
          eq(viewerPerson.isGuardian, principal.isGuardian),
        );
  const isAuthor = and(
    isNotNull(viewerUser.personId),
    eq(contribution.authorPersonId, viewerUser.personId),
  );
  const guardianAccess = and(
    isNotNull(viewerPerson.id),
    eq(viewerPerson.isGuardian, true),
    inArray(contribution.visibility, ["parents", "child_later"]),
  );
  const childLaterUnlocked = and(
    eq(contribution.visibility, "child_later"),
    or(
      and(
        isNotNull(eventChild.childLaterUnlockedAt),
        lte(eventChild.childLaterUnlockedAt, snapshot.evaluatedAt),
      ),
      and(
        isNotNull(eventChild.birthDate),
        sql`date(${eventChild.birthDate}, printf('+%d years', ${viewerFamily.childLaterUnlockAge}), 'floor') <= ${snapshot.familyLocalDate}`,
      ),
    ),
  );
  return and(
    inArray(contribution.visibility, [
      "private",
      "parents",
      "family",
      "child_later",
    ]),
    eq(viewerUser.id, principal.userId),
    eq(viewerUser.familyId, principal.familyId),
    eq(viewerUser.role, principal.role),
    isNull(viewerUser.disabledAt),
    samePrincipalPerson,
    sameGuardianState,
    eq(viewerFamily.id, principal.familyId),
    eq(viewerFamily.timezone, principal.familyTimezone),
    eq(viewerFamily.childLaterUnlockAge, principal.childLaterUnlockAge),
    or(
      eq(contribution.visibility, "family"),
      isAuthor,
      guardianAccess,
      childLaterUnlocked,
    ),
  )!;
}

/**
 * Single-row live authorization for callers that must keep the policy check
 * and a related mutation in one SQLite transaction. No policy inputs are
 * accepted from the client, and every mutable principal/child/family field is
 * compared with its live database value.
 */
export function getVisibleContributionInTransaction(
  tx: ContributionAccessTransaction,
  snapshot: ContributionAccessSnapshot,
  contributionId: string,
): VisibleContributionAuthorizationRow | undefined {
  const row = tx
    .select({
      id: contribution.id,
      memoryEventId: contribution.memoryEventId,
      authorPersonId: contribution.authorPersonId,
      visibility: contribution.visibility,
    })
    .from(contribution)
    .innerJoin(memoryEvent, eq(contribution.memoryEventId, memoryEvent.id))
    .innerJoin(
      authorPerson,
      and(
        eq(contribution.authorPersonId, authorPerson.id),
        eq(authorPerson.familyId, memoryEvent.familyId),
      ),
    )
    .innerJoin(
      eventChild,
      and(
        eq(memoryEvent.childPersonId, eventChild.id),
        eq(eventChild.familyId, memoryEvent.familyId),
      ),
    )
    .innerJoin(viewerUser, eq(viewerUser.id, snapshot.principal.userId))
    .innerJoin(viewerFamily, eq(viewerFamily.id, viewerUser.familyId))
    .leftJoin(
      viewerPerson,
      and(
        eq(viewerUser.personId, viewerPerson.id),
        eq(viewerPerson.familyId, viewerUser.familyId),
      ),
    )
    .where(
      and(
        eq(contribution.id, contributionId),
        eq(memoryEvent.familyId, snapshot.principal.familyId),
        visibilityPredicate(snapshot),
      ),
    )
    .limit(1)
    .get();
  if (!row || !isContributionVisibility(row.visibility)) return undefined;
  return { ...row, visibility: row.visibility };
}

async function queryVisibleContributions(
  snapshot: ContributionAccessSnapshot,
  options: { memoryEventId?: string; contributionIds?: readonly string[] },
): Promise<VisibleContributionDto[]> {
  if (options.contributionIds?.length === 0) return [];
  const conditions: SQL[] = [
    eq(memoryEvent.familyId, snapshot.principal.familyId),
    visibilityPredicate(snapshot),
  ];
  if (options.memoryEventId) {
    conditions.push(eq(memoryEvent.id, options.memoryEventId));
  }
  if (options.contributionIds) {
    conditions.push(inArray(contribution.id, [...options.contributionIds]));
  }
  const rows = await getDb()
    .select({
      row: contribution,
      authorName: authorPerson.displayName,
      authorRelation: authorPerson.relationToChild,
    })
    .from(contribution)
    .innerJoin(memoryEvent, eq(contribution.memoryEventId, memoryEvent.id))
    .innerJoin(
      authorPerson,
      and(
        eq(contribution.authorPersonId, authorPerson.id),
        eq(authorPerson.familyId, memoryEvent.familyId),
      ),
    )
    .innerJoin(
      eventChild,
      and(
        eq(memoryEvent.childPersonId, eventChild.id),
        eq(eventChild.familyId, memoryEvent.familyId),
      ),
    )
    .innerJoin(viewerUser, eq(viewerUser.id, snapshot.principal.userId))
    .innerJoin(viewerFamily, eq(viewerFamily.id, viewerUser.familyId))
    .leftJoin(
      viewerPerson,
      and(
        eq(viewerUser.personId, viewerPerson.id),
        eq(viewerPerson.familyId, viewerUser.familyId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(contribution.createdAt));

  return rows.map(({ row, authorName, authorRelation }) => {
    if (!isContributionVisibility(row.visibility)) {
      throw new Error("invalid Contribution visibility");
    }
    return {
      ...row,
      visibility: row.visibility,
      authorName,
      authorRelation,
      canEdit: canEditContribution({
        role: snapshot.principal.role,
        userPersonId: snapshot.principal.personId,
        authorPersonId: row.authorPersonId,
        isGuardian: snapshot.principal.isGuardian,
        childLaterUnlocked: false,
        accountEnabled: snapshot.principal.accountEnabled,
      }),
    };
  });
}

export function listVisibleContributionsForEvent(
  snapshot: ContributionAccessSnapshot,
  memoryEventId: string,
): Promise<VisibleContributionDto[]> {
  return queryVisibleContributions(snapshot, { memoryEventId });
}

export function listVisibleContributionsForFamily(
  snapshot: ContributionAccessSnapshot,
): Promise<VisibleContributionDto[]> {
  return queryVisibleContributions(snapshot, {});
}

export function listVisibleContributionsByIds(
  snapshot: ContributionAccessSnapshot,
  contributionIds: readonly string[],
): Promise<VisibleContributionDto[]> {
  return queryVisibleContributions(snapshot, { contributionIds });
}

export type UpdateVisibleContributionResult =
  | { ok: true; memoryEventId: string }
  | { ok: false; error: "invalid" | "forbidden_or_not_found" };

/**
 * Author-owned edit with the same live visibility predicate as reads. The
 * principal, family policy and row ownership are all re-read inside the write
 * transaction so a stale rendered form cannot outlive a role/guardian/account
 * change.
 */
export function updateVisibleContributionText(
  snapshot: ContributionAccessSnapshot,
  contributionId: string,
  editedText: string,
): UpdateVisibleContributionResult {
  const trimmed = editedText.trim();
  if (trimmed.length < 1 || trimmed.length > 5000) {
    return { ok: false, error: "invalid" };
  }

  return getDb().transaction(
    (tx) => {
      const row = getVisibleContributionInTransaction(
        tx,
        snapshot,
        contributionId,
      );

      if (
        !row ||
        !canEditContribution({
          role: snapshot.principal.role,
          userPersonId: snapshot.principal.personId,
          authorPersonId: row.authorPersonId,
          isGuardian: snapshot.principal.isGuardian,
          childLaterUnlocked: false,
          accountEnabled: snapshot.principal.accountEnabled,
        })
      ) {
        return { ok: false, error: "forbidden_or_not_found" } as const;
      }

      const updated = tx
        .update(contribution)
        .set({ editedText: trimmed, updatedAt: new Date() })
        .where(
          and(
            eq(contribution.id, row.id),
            eq(contribution.authorPersonId, row.authorPersonId),
          ),
        )
        .returning({ id: contribution.id })
        .get();
      if (!updated) {
        return { ok: false, error: "forbidden_or_not_found" } as const;
      }
      return { ok: true, memoryEventId: row.memoryEventId } as const;
    },
    { behavior: "immediate" },
  );
}

/**
 * Contribution audio is sensitive. If any Contribution reference to an asset
 * is hidden, the bytes (and derivatives) fail closed even if another archive
 * relationship also points at the same file.
 */
export async function canReadContributionAsset(
  snapshot: ContributionAccessSnapshot,
  assetId: string,
): Promise<boolean> {
  const principal = snapshot.principal;
  return getDb().transaction((tx) => {
    const liveActor = tx
      .select({ id: viewerUser.id })
      .from(viewerUser)
      .innerJoin(viewerFamily, eq(viewerFamily.id, viewerUser.familyId))
      .leftJoin(
        viewerPerson,
        and(
          eq(viewerUser.personId, viewerPerson.id),
          eq(viewerPerson.familyId, viewerUser.familyId),
        ),
      )
      .where(
        and(
          eq(viewerUser.id, principal.userId),
          eq(viewerUser.familyId, principal.familyId),
          eq(viewerUser.role, principal.role),
          isNull(viewerUser.disabledAt),
          eq(viewerFamily.timezone, principal.familyTimezone),
          eq(
            viewerFamily.childLaterUnlockAge,
            principal.childLaterUnlockAge,
          ),
          principal.personId === null
            ? and(isNull(viewerUser.personId), isNull(viewerPerson.id))
            : and(
                eq(viewerUser.personId, principal.personId),
                eq(viewerPerson.id, principal.personId),
                eq(viewerPerson.isGuardian, principal.isGuardian),
              ),
        ),
      )
      .limit(1)
      .get();
    if (!liveActor) return false;

    // Walk both directions so a historical derivative->derivative chain is
    // treated as one family too. Path guards make corrupt cycles fail closed.
    const familyAssets = tx.all<{ id: string }>(sql`
      WITH RECURSIVE
      ancestors(id, original_asset_id, path) AS (
        SELECT ${asset.id}, ${asset.originalAssetId}, ',' || ${asset.id} || ','
        FROM ${asset}
        WHERE ${asset.id} = ${assetId}
          AND ${asset.familyId} = ${principal.familyId}
        UNION ALL
        SELECT parent.${sql.identifier("id")},
               parent.${sql.identifier("original_asset_id")},
               ancestors.path || parent.${sql.identifier("id")} || ','
        FROM ${asset} parent
        JOIN ancestors
          ON parent.${sql.identifier("id")} = ancestors.original_asset_id
        WHERE parent.${sql.identifier("family_id")} = ${principal.familyId}
          AND instr(ancestors.path, ',' || parent.${sql.identifier("id")} || ',') = 0
      ),
      root(root_id) AS (
        SELECT id FROM ancestors WHERE original_asset_id IS NULL LIMIT 1
      ),
      descendants(id, path) AS (
        SELECT root_id, ',' || root_id || ',' FROM root
        UNION ALL
        SELECT child.${sql.identifier("id")},
               descendants.path || child.${sql.identifier("id")} || ','
        FROM ${asset} child
        JOIN descendants
          ON child.${sql.identifier("original_asset_id")} = descendants.id
        WHERE child.${sql.identifier("family_id")} = ${principal.familyId}
          AND instr(descendants.path, ',' || child.${sql.identifier("id")} || ',') = 0
      )
      SELECT id FROM descendants
    `);
    if (familyAssets.length === 0) return false;

    const familyAssetIds = familyAssets.map((row) => row.id);
    const hiddenReference = tx
      .select({ id: contribution.id })
      .from(contribution)
      .innerJoin(memoryEvent, eq(contribution.memoryEventId, memoryEvent.id))
      .leftJoin(
        eventChild,
        and(
          eq(memoryEvent.childPersonId, eventChild.id),
          eq(eventChild.familyId, memoryEvent.familyId),
        ),
      )
      .innerJoin(viewerUser, eq(viewerUser.id, principal.userId))
      .innerJoin(viewerFamily, eq(viewerFamily.id, viewerUser.familyId))
      .leftJoin(
        viewerPerson,
        and(
          eq(viewerUser.personId, viewerPerson.id),
          eq(viewerPerson.familyId, viewerUser.familyId),
        ),
      )
      .where(
        and(
          // One JSON parameter avoids SQLite's host-variable ceiling even if
          // a corrupt/historical derivative tree contains thousands of rows.
          sql`${contribution.audioAssetId} in (
            select value from json_each(${JSON.stringify(familyAssetIds)})
          )`,
          or(
            ne(memoryEvent.familyId, principal.familyId),
            isNull(eventChild.id),
            // SQL NOT NULL is still NULL. Coalesce makes corrupted/missing
            // policy joins and unbound principals fail closed instead of
            // accidentally treating an unknown result as visible.
            not(sql`coalesce(${visibilityPredicate(snapshot)}, 0)`),
          ),
        ),
      )
      .limit(1)
      .get();

    return !hiddenReference;
  });
}
