import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  collection,
  guestReadGrant,
} from "@/db/schema/collection";
import { auditLog } from "@/db/schema/audit";
import { assertFamilyCapability } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";

/**
 * 访客限定阅读链接（ID-5）：无账号访客对「单一相册」的可撤销只读授权。
 * 与投递箱（contribution_request）的提交 scope 严格分离：令牌只进 read 路径，
 * 永远不能投稿、枚举家庭数据或读取相册之外的任何资产。
 */

export const READ_GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/u;
const MAX_GRANT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type ReadGrantDto = {
  id: string;
  title: string;
  collectionId: string;
  collectionTitle: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
};

export type CreateReadGrantResult =
  | { ok: true; grantId: string; token: string; expiresAt: Date | null }
  | { ok: false; error: "forbidden" | "collection_not_found" | "invalid_input" };

export async function createReadGrant(
  context: FamilyContext,
  input: { collectionId: string; expiresAt?: Date | null },
): Promise<CreateReadGrantResult> {
  assertFamilyCapability(context.role, "family:manage");
  const db = getDb();
  const collectionId = input.collectionId?.trim() || "";
  if (!collectionId) return { ok: false, error: "invalid_input" };
  const expiresAt =
    input.expiresAt instanceof Date && Number.isFinite(input.expiresAt.getTime())
      ? input.expiresAt
      : null;
  if (expiresAt) {
    const lifetime = expiresAt.getTime() - Date.now();
    if (lifetime <= 0 || lifetime > MAX_GRANT_LIFETIME_MS) {
      return { ok: false, error: "invalid_input" };
    }
  }
  const target = db
    .select({ id: collection.id, title: collection.title })
    .from(collection)
    .where(
      and(
        eq(collection.id, collectionId),
        eq(collection.familyId, context.familyId),
        isNull(collection.deletedAt),
      ),
    )
    .all()[0];
  if (!target) return { ok: false, error: "collection_not_found" };

  const token = randomBytes(32).toString("base64url");
  const grantId = randomUUID();
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(guestReadGrant)
      .values({
        id: grantId,
        familyId: context.familyId,
        collectionId,
        tokenHash: hashToken(token),
        title: target.title,
        createdByUserId: context.userId,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(auditLog)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        kind: "read_grant.created",
        actorUserId: context.userId,
        detailJson: JSON.stringify({
          grantId,
          collectionId,
          expiresAt: expiresAt?.toISOString() ?? null,
        }),
        createdAt: now,
      })
      .run();
  });
  return { ok: true, grantId, token, expiresAt };
}

export function revokeReadGrant(
  context: FamilyContext,
  grantId: string,
): { ok: true } | { ok: false; error: "forbidden" | "not_found" } {
  assertFamilyCapability(context.role, "family:manage");
  const db = getDb();
  const now = new Date();
  const updated = db
    .update(guestReadGrant)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(guestReadGrant.id, grantId),
        eq(guestReadGrant.familyId, context.familyId),
        isNull(guestReadGrant.revokedAt),
      ),
    )
    .run();
  if (updated.changes !== 1) return { ok: false, error: "not_found" };
  db.insert(auditLog)
    .values({
      id: randomUUID(),
      familyId: context.familyId,
      kind: "read_grant.revoked",
      actorUserId: context.userId,
      detailJson: JSON.stringify({ grantId }),
      createdAt: now,
    })
    .run();
  return { ok: true };
}

export function listReadGrants(familyId: string): ReadGrantDto[] {
  return getDb()
    .select({
      id: guestReadGrant.id,
      title: guestReadGrant.title,
      collectionId: guestReadGrant.collectionId,
      collectionTitle: collection.title,
      createdAt: guestReadGrant.createdAt,
      expiresAt: guestReadGrant.expiresAt,
      revokedAt: guestReadGrant.revokedAt,
      viewCount: guestReadGrant.viewCount,
      lastViewedAt: guestReadGrant.lastViewedAt,
    })
    .from(guestReadGrant)
    .leftJoin(collection, eq(collection.id, guestReadGrant.collectionId))
    .where(eq(guestReadGrant.familyId, familyId))
    .orderBy(desc(guestReadGrant.createdAt))
    .all()
    .map((row) => ({
      ...row,
      collectionTitle: row.collectionTitle ?? row.title,
    }));
}

export type ResolvedReadGrant = {
  grantId: string;
  familyId: string;
  collectionId: string;
  collectionTitle: string;
  collectionDescription: string;
};

/** 公开解析（/view/[token] 与访客媒体访问共用）；顺带留痕浏览计数。 */
export function resolveReadGrant(token: string): ResolvedReadGrant | null {
  if (!READ_GRANT_TOKEN_PATTERN.test(token)) return null;
  const db = getDb();
  const row = db
    .select({
      grantId: guestReadGrant.id,
      familyId: guestReadGrant.familyId,
      collectionId: guestReadGrant.collectionId,
      collectionTitle: collection.title,
      collectionDescription: collection.description,
      expiresAt: guestReadGrant.expiresAt,
      revokedAt: guestReadGrant.revokedAt,
      collectionDeletedAt: collection.deletedAt,
    })
    .from(guestReadGrant)
    .leftJoin(collection, eq(collection.id, guestReadGrant.collectionId))
    .where(eq(guestReadGrant.tokenHash, hashToken(token)))
    .all()[0];
  if (!row) return null;
  const now = new Date();
  if (row.revokedAt !== null) return null;
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  if (row.collectionDeletedAt !== null || row.collectionTitle === null) {
    return null;
  }
  db.update(guestReadGrant)
    .set({
      viewCount: sql`${guestReadGrant.viewCount} + 1`,
      lastViewedAt: now,
      updatedAt: now,
    })
    .where(eq(guestReadGrant.id, row.grantId))
    .run();
  return {
    grantId: row.grantId,
    familyId: row.familyId,
    collectionId: row.collectionId,
    collectionTitle: row.collectionTitle,
    collectionDescription: row.collectionDescription ?? "",
  };
}

export type ReadGrantEntryDto = {
  eventId: string;
  title: string;
  caption: string;
  assets: { assetId: string; mimeType: string; type: string }[];
};

/** Family-only original metadata follows the same scope and visibility as bytes. */
export function listReadGrantEntries(grant: ResolvedReadGrant): ReadGrantEntryDto[] {
  const rows = getDb().all<{ id: string; eventId: string | null; assetId: string | null; title: string; caption: string }>(sql`
    select ci.id,ci.memory_event_id eventId,ci.asset_id assetId,coalesce(e.title,a.display_name,'家人分享的资料') title,ci.caption
    from collection_item ci left join memory_event e on e.id=ci.memory_event_id and e.family_id=${grant.familyId} and e.deleted_at is null and e.status='confirmed'
    left join asset a on a.id=ci.asset_id and a.family_id=${grant.familyId}
    where ci.collection_id=${grant.collectionId} and ci.family_id=${grant.familyId} and (e.id is not null or a.id is not null)
      and exists(select 1 from guest_read_grant g join collection col on col.id=g.collection_id where g.id=${grant.grantId} and g.family_id=${grant.familyId} and col.family_id=${grant.familyId} and g.collection_id=${grant.collectionId} and g.revoked_at is null and (g.expires_at is null or g.expires_at>unixepoch()) and col.deleted_at is null) order by ci.position`);
  return rows.flatMap(row => {
    const assets = getDb().all<{ assetId: string; mimeType: string; type: string }>(sql`select a.id assetId,a.mime_type mimeType,a.type from asset a where a.family_id=${grant.familyId} and (a.id=${row.assetId} or a.id in (select asset_id from memory_event_asset where memory_event_id=${row.eventId} and family_id=${grant.familyId}))`)
      .filter(a => readGrantIncludesAsset(grant, a.assetId));
    return row.assetId && !assets.length ? [] : [{ eventId: row.eventId ?? row.id, title: row.title, caption: row.caption, assets }];
  });
}

/** Scope never widens when an original is also referenced by a private contribution. */
export function readGrantIncludesAsset(grant: ResolvedReadGrant, assetId: string): boolean {
  if (typeof assetId !== "string" || !assetId.length) return false;
  return Boolean(getDb().get(sql`
    with recursive ancestors(id,parent) as (
      select id,original_asset_id from asset where id=${assetId} and family_id=${grant.familyId}
      union select a.id,a.original_asset_id from asset a join ancestors p on a.id=p.parent where a.family_id=${grant.familyId}
    ), root(id) as (select id from ancestors where parent is null), tree(id) as (
      select id from root union select a.id from asset a join tree t on a.original_asset_id=t.id where a.family_id=${grant.familyId}
    )
    select 1 from root where
      exists(select 1 from guest_read_grant g join collection col on col.id=g.collection_id where g.id=${grant.grantId} and g.family_id=${grant.familyId} and g.collection_id=${grant.collectionId} and col.family_id=${grant.familyId} and g.revoked_at is null and (g.expires_at is null or g.expires_at>unixepoch()) and col.deleted_at is null)
      and exists(select 1 from collection_item ci left join memory_event e on e.id=ci.memory_event_id and e.family_id=${grant.familyId} and e.deleted_at is null and e.status='confirmed'
        where ci.collection_id=${grant.collectionId} and ci.family_id=${grant.familyId} and (ci.asset_id=root.id or (e.id is not null and exists(select 1 from memory_event_asset ma where ma.memory_event_id=e.id and ma.family_id=${grant.familyId} and ma.asset_id=root.id))))
      and not exists(select 1 from contribution c join memory_event e on e.id=c.memory_event_id where c.audio_asset_id in (select id from tree) and (coalesce(c.visibility,'')<>'family' or e.family_id<>${grant.familyId}))
  `));
}
