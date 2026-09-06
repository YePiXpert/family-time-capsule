import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  collection,
  collectionItem,
  guestReadGrant,
} from "@/db/schema/collection";
import { asset } from "@/db/schema/asset";
import { memoryEvent, memoryEventAsset } from "@/db/schema/memory";
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

/** 相册条目 = 记忆事件；资产经 memory_event_asset 归入范围。 */
export function listReadGrantEntries(grant: ResolvedReadGrant): ReadGrantEntryDto[] {
  const db = getDb();
  const events = db
    .select({
      eventId: memoryEvent.id,
      title: memoryEvent.title,
      caption: collectionItem.caption,
      position: collectionItem.position,
    })
    .from(collectionItem)
    .innerJoin(memoryEvent, eq(memoryEvent.id, collectionItem.memoryEventId))
    .where(
      and(
        eq(collectionItem.collectionId, grant.collectionId),
        eq(collectionItem.familyId, grant.familyId),
      ),
    )
    .orderBy(collectionItem.position)
    .all();
  return events.map((event) => ({
    eventId: event.eventId,
    title: event.title,
    caption: event.caption ?? "",
    assets: db
      .select({
        assetId: asset.id,
        mimeType: asset.mimeType,
        type: asset.type,
      })
      .from(memoryEventAsset)
      .innerJoin(asset, eq(asset.id, memoryEventAsset.assetId))
      .where(
        and(
          eq(memoryEventAsset.memoryEventId, event.eventId),
          eq(memoryEventAsset.familyId, grant.familyId),
        ),
      )
      .all(),
  }));
}

/** 访客媒体访问：资产必须属于授权相册里的记忆事件（范围隔离唯一裁决点）。 */
export function readGrantIncludesAsset(
  grant: ResolvedReadGrant,
  assetId: string,
): boolean {
  if (typeof assetId !== "string" || assetId.length === 0) return false;
  const row = getDb()
    .select({ assetId: memoryEventAsset.assetId })
    .from(collectionItem)
    .innerJoin(
      memoryEventAsset,
      eq(memoryEventAsset.memoryEventId, collectionItem.memoryEventId),
    )
    .where(
      and(
        eq(collectionItem.collectionId, grant.collectionId),
        eq(collectionItem.familyId, grant.familyId),
        eq(memoryEventAsset.assetId, assetId),
      ),
    )
    .limit(1)
    .all()[0];
  return row?.assetId === assetId;
}
