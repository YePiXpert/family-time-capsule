import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { user } from "@/db/schema/auth";
import { family, person } from "@/db/schema/family";
import { syncChange, syncCursor, syncScope, syncState } from "@/db/schema/sync";
import type { FamilyContext } from "@/lib/family/context";
import { familyLocalDate } from "@/lib/authz/principal";

type Tx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
export type SyncStamp = { generation: string; revision: number; permissionRevision: number; permissionStamp: string; globalSeq: number; floorSeq: number };
export class SyncReadError extends Error {
  constructor(readonly code: "forbidden" | "sync_reset" | "sync_changed", readonly current?: SyncStamp) { super(code); }
}
export function readSyncStamp(context: FamilyContext): SyncStamp {
  return getDb().transaction(tx => {
    const account = tx.select().from(user).where(eq(user.id, context.userId)).get();
    const group = tx.select().from(family).where(eq(family.id, context.familyId)).get();
    const bound = account?.personId ? tx.select().from(person).where(and(eq(person.id, account.personId), eq(person.familyId, context.familyId))).get() : undefined;
    if (!account || account.disabledAt || account.familyId !== context.familyId || account.role !== context.role ||
      account.personId !== context.personId || (account.personId !== null && !bound) || !context.accountEnabled ||
      Boolean(bound?.isGuardian) !== context.isGuardian || !group || group.timezone !== context.familyTimezone || group.childLaterUnlockAge !== context.childLaterUnlockAge) throw new SyncReadError("forbidden");
    const state = tx.select().from(syncState).where(eq(syncState.id, "instance")).get();
    const scope = tx.select().from(syncScope).where(eq(syncScope.familyId, context.familyId)).get();
    if (!state || !scope) throw new Error("synchronization state is unavailable");
    const permissionStamp = createHash("sha256").update(JSON.stringify([state.generation, context.userId, context.familyId, scope.permissionRevision, familyLocalDate(new Date(), group.timezone)])).digest("hex");
    return { generation: state.generation, revision: scope.revision, permissionRevision: scope.permissionRevision, permissionStamp, globalSeq: state.lastSeq, floorSeq: state.floorSeq };
  });
}
export function assertSyncStamp(context: FamilyContext, previous: SyncStamp): SyncStamp {
  const current = readSyncStamp(context);
  if (current.generation !== previous.generation || current.permissionStamp !== previous.permissionStamp) throw new SyncReadError("sync_reset", current);
  if (current.revision !== previous.revision) throw new SyncReadError("sync_changed", current);
  return current;
}
export const MOBILE_SYNC_STAMP = Symbol("mobile sync response snapshot");
export type StampedSyncPage = { [MOBILE_SYNC_STAMP]?: SyncStamp };
export function assertSyncPageCurrent(context: FamilyContext, page: StampedSyncPage) {
  const stamp = page[MOBILE_SYNC_STAMP];
  if (!stamp) throw new SyncReadError("sync_reset", readSyncStamp(context));
  assertSyncStamp(context, stamp);
}

export type SyncCursorState = {
  version: 2; generation: string; permissionStamp: string;
  mode: "snapshot" | "delta" | "checkpoint"; phase: "people" | "events";
  fence: number; revision: number; from: number; afterSeq: number; afterId: string | null;
};
export function loadSyncCursor(context: FamilyContext, id: string, current: SyncStamp): SyncCursorState {
  if (!/^[a-f0-9]{48}$/u.test(id)) throw new SyncReadError("sync_reset", current);
  const row = getDb().select().from(syncCursor).where(and(eq(syncCursor.id, id), eq(syncCursor.userId, context.userId), eq(syncCursor.familyId, context.familyId))).get();
  if (!row || row.expiresAt.getTime() <= Date.now()) throw new SyncReadError("sync_reset", current);
  let state: SyncCursorState;
  try { state = JSON.parse(row.stateJson) as SyncCursorState; } catch { throw new SyncReadError("sync_reset", current); }
  if (!state || typeof state !== "object" || state.version !== 2 || !["snapshot", "delta", "checkpoint"].includes(state.mode) || !["people", "events"].includes(state.phase) ||
    [state.fence, state.revision, state.from, state.afterSeq].some(value => !Number.isSafeInteger(value) || value < 0) ||
    !(state.afterId === null || (typeof state.afterId === "string" && state.afterId.length <= 128)) ||
    state.afterSeq < state.from || state.afterSeq > state.fence || state.from > state.fence ||
    state.generation !== current.generation || state.permissionStamp !== current.permissionStamp || state.fence < current.floorSeq || (state.mode === "delta" && state.from < current.floorSeq) || state.fence > current.globalSeq) throw new SyncReadError("sync_reset", current);
  if (state.mode !== "checkpoint" && state.revision !== current.revision) throw new SyncReadError("sync_changed", current);
  return state;
}
export function saveSyncCursor(context: FamilyContext, state: SyncCursorState): string {
  const id = randomBytes(24).toString("hex"), now = new Date();
  getDb().insert(syncCursor).values({ id, userId: context.userId, familyId: context.familyId, stateJson: JSON.stringify(state), createdAt: now, expiresAt: new Date(now.getTime() + 7 * 86400000) }).run();
  // Bound retained handles per account; expiry always has an explicit snapshot recovery path.
  getDb().run(sql`delete from sync_cursor where id in (select id from sync_cursor where user_id=${context.userId} order by created_at desc,rowid desc limit -1 offset 1024)`);
  getDb().run(sql`delete from sync_cursor where id in (select id from sync_cursor where expires_at < ${Math.floor(now.getTime()/1000)} order by expires_at limit 256)`);
  return id;
}
/** Restore changes data identity while preserving the stable installation identity. */
export function rotateSyncGenerationInTransaction(tx: Tx) {
  tx.update(syncState).set({ generation: randomBytes(16).toString("hex"), floorSeq: sql`${syncState.lastSeq}` }).where(eq(syncState.id, "instance")).run();
  tx.delete(syncCursor).run();
}
/** Bounded retention. Cursors behind the retained prefix must rebuild an authorized snapshot. */
export function pruneSyncChanges(now = new Date()): number {
  return getDb().transaction(tx => {
    const rows = tx.select({ seq: syncChange.seq, createdAt: syncChange.createdAt }).from(syncChange).orderBy(syncChange.seq).limit(1000).all();
    let through: number | undefined;
    for (const row of rows) {
      if (row.createdAt.getTime() >= now.getTime() - 30 * 86400000) break;
      through = row.seq;
    }
    if (through === undefined) return 0;
    const result = tx.delete(syncChange).where(sql`${syncChange.seq} <= ${through}`).run();
    tx.update(syncState).set({ floorSeq: sql`max(${syncState.floorSeq},${through})` }).where(eq(syncState.id, "instance")).run();
    return result.changes;
  }, { behavior: "immediate" });
}
