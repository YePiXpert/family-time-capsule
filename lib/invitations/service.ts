import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema/audit";
import { session, user as userTable } from "@/db/schema/auth";
import { family, person } from "@/db/schema/family";
import { familyInvitation } from "@/db/schema/invitation";
import { getAuth } from "@/lib/auth/auth";
import { runWithInvitationProvisioningCapability } from "@/lib/auth/provisioning-capability";
import {
  isFamilyRole,
  type FamilyRole,
} from "@/lib/authz/policy";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLAIM_DURATION_MS = 5 * 60 * 1000;
const MAX_INVITATION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

export const INVITATION_AUDIT_KINDS = {
  created: "invitation.created",
  revoked: "invitation.revoked",
  accepted: "invitation.accepted",
} as const;

type InvitationAdminFailure = "forbidden" | "invalid_input" | "not_found";

export type CreateInvitationInput = {
  familyId: string;
  actorUserId: string;
  role: FamilyRole;
  email?: string | null;
  personId?: string | null;
  expiresAt: Date;
};

export type CreateInvitationResult =
  | {
      ok: true;
      invitationId: string;
      /** Display exactly once. This value is never persisted. */
      token: string;
      expiresAt: Date;
    }
  | { ok: false; error: InvitationAdminFailure | "person_unavailable" };

export type InvitationStatus =
  | "active"
  | "claimed"
  | "expired"
  | "revoked"
  | "used";

export type FamilyInvitationListItem = {
  id: string;
  role: FamilyRole;
  email: string | null;
  personId: string | null;
  personName: string | null;
  status: InvitationStatus;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type InvitationPersonCandidate = {
  id: string;
  displayName: string;
  relationToChild: string | null;
};

export type PublicInvitation =
  | { status: "invalid" }
  | {
      status: InvitationStatus;
      familyName: string;
      role: FamilyRole;
      email: string | null;
      personName: string | null;
      expiresAt: Date;
    };

export type AcceptInvitationInput = {
  token: string;
  displayName: string;
  email: string;
  password: string;
};

export type AcceptInvitationFailure =
  | "invalid_input"
  | "invalid_or_unavailable"
  | "email_mismatch"
  | "account_exists"
  | "person_unavailable"
  | "account_creation_failed";

export type AcceptInvitationResult =
  | { ok: true; userId: string }
  | { ok: false; error: AcceptInvitationFailure };

type ClaimedInvitation = {
  id: string;
  claimNonce: string;
  familyId: string;
  role: FamilyRole;
  email: string | null;
  personId: string | null;
  expiresAt: Date;
  provisionedUserId: string | null;
};

class FinalizeInvitationError extends Error {}
class InvitationAuthorizationError extends Error {}
class InvitationPersonUnavailableError extends Error {}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    !/\p{Cc}/u.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function isValidDisplayName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 50;
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isTokenShapeValid(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

function invitationStatus(
  row: {
    usedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
    claimNonce: string | null;
    claimExpiresAt: Date | null;
  },
  now: Date,
): InvitationStatus {
  if (row.usedAt) return "used";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (
    row.claimNonce &&
    row.claimExpiresAt &&
    row.claimExpiresAt.getTime() > now.getTime()
  ) {
    return "claimed";
  }
  return "active";
}

async function isFamilyAdmin(
  familyId: string,
  actorUserId: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, actorUserId),
        eq(userTable.familyId, familyId),
        eq(userTable.role, "admin"),
        isNull(userTable.disabledAt),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function personCanReceiveAccount(
  familyId: string,
  personId: string,
  excludingUserId?: string,
): Promise<boolean> {
  const people = await getDb()
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.id, personId), eq(person.familyId, familyId)))
    .limit(1);
  if (!people[0]) return false;

  const predicates = [eq(userTable.personId, personId)];
  if (excludingUserId) predicates.push(ne(userTable.id, excludingUserId));
  const bound = await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(...predicates))
    .limit(1);
  return !bound[0];
}

/**
 * Best-effort terminal reconciliation. The receipt remains as a durable
 * tombstone even after deletion, so a writer that was paused between reserve
 * and INSERT can never create an untracked orphan; the next reconciliation
 * pass deletes the same stable id again.
 */
function reconcileTerminalProvisioningReceipts(
  familyId: string,
  now: Date,
): void {
  const db = getDb();
  const receipts = db
    .select({ provisionedUserId: familyInvitation.provisionedUserId })
    .from(familyInvitation)
    .where(
      and(
        eq(familyInvitation.familyId, familyId),
        isNull(familyInvitation.usedAt),
        isNotNull(familyInvitation.provisionedUserId),
        or(
          isNotNull(familyInvitation.revokedAt),
          lte(familyInvitation.expiresAt, now),
        ),
      ),
    )
    .all();
  for (const receipt of receipts) {
    if (!receipt.provisionedUserId) continue;
    try {
      db.delete(userTable)
        .where(
          and(
            eq(userTable.id, receipt.provisionedUserId),
            eq(userTable.role, "viewer"),
            isNull(userTable.familyId),
            isNull(userTable.personId),
          ),
        )
        .run();
    } catch {
      // Keep the durable receipt. A later admin reconciliation safely retries.
    }
  }
}

export async function reconcileFamilyInvitationProvisioning(
  familyId: string,
  actorUserId: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  return db.transaction((tx) => {
    const actor = tx
      .select({ id: userTable.id })
      .from(userTable)
      .leftJoin(person, eq(userTable.personId, person.id))
      .where(
        and(
          eq(userTable.id, actorUserId),
          eq(userTable.familyId, familyId),
          eq(userTable.role, "admin"),
          isNull(userTable.disabledAt),
          or(
            isNull(userTable.personId),
            and(
              eq(person.id, userTable.personId),
              eq(person.familyId, familyId),
            ),
          ),
        ),
      )
      .limit(1)
      .get();
    if (!actor) return false;
    // The helper uses the singleton connection; while this callback is active
    // those statements participate in this same better-sqlite3 transaction.
    reconcileTerminalProvisioningReceipts(familyId, now);
    return true;
  });
}

export async function createFamilyInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  if (!isFamilyRole(input.role)) {
    return { ok: false, error: "invalid_input" };
  }

  const now = new Date();
  const lifetime = input.expiresAt.getTime() - now.getTime();
  if (
    !Number.isFinite(input.expiresAt.getTime()) ||
    lifetime <= 0 ||
    lifetime > MAX_INVITATION_LIFETIME_MS
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const email = input.email ? normalizeEmail(input.email) : null;
  if (email !== null && !isEmail(email)) {
    return { ok: false, error: "invalid_input" };
  }
  const personId = input.personId?.trim() || null;

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const invitationId = randomUUID();
  const db = getDb();

  try {
    db.transaction((tx) => {
      const actor = tx
        .select({ id: userTable.id })
        .from(userTable)
        .leftJoin(person, eq(userTable.personId, person.id))
        .where(
          and(
            eq(userTable.id, input.actorUserId),
            eq(userTable.familyId, input.familyId),
            eq(userTable.role, "admin"),
            isNull(userTable.disabledAt),
            or(
              isNull(userTable.personId),
              and(
                eq(person.id, userTable.personId),
                eq(person.familyId, input.familyId),
              ),
            ),
          ),
        )
        .limit(1)
        .get();
      if (!actor) throw new InvitationAuthorizationError();

      if (personId) {
        const candidate = tx
          .select({ id: person.id, boundUserId: userTable.id })
          .from(person)
          .leftJoin(userTable, eq(userTable.personId, person.id))
          .where(
            and(eq(person.id, personId), eq(person.familyId, input.familyId)),
          )
          .limit(1)
          .get();
        if (!candidate || candidate.boundUserId !== null) {
          throw new InvitationPersonUnavailableError();
        }
      }

      tx.insert(familyInvitation)
        .values({
          id: invitationId,
          tokenHash: hashInvitationToken(token),
          familyId: input.familyId,
          role: input.role,
          email,
          personId,
          expiresAt: input.expiresAt,
          createdByUserId: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(auditLog)
        .values({
          id: randomUUID(),
          familyId: input.familyId,
          kind: INVITATION_AUDIT_KINDS.created,
          actorUserId: input.actorUserId,
          detailJson: JSON.stringify({
            invitationId,
            role: input.role,
            emailBound: email !== null,
            personId,
            expiresAt: input.expiresAt.toISOString(),
          }),
          createdAt: now,
        })
        .run();
    });
  } catch (error) {
    if (error instanceof InvitationAuthorizationError) {
      return { ok: false, error: "forbidden" };
    }
    if (error instanceof InvitationPersonUnavailableError) {
      return { ok: false, error: "person_unavailable" };
    }
    return { ok: false, error: "invalid_input" };
  }

  return { ok: true, invitationId, token, expiresAt: input.expiresAt };
}

export async function listFamilyInvitations(
  familyId: string,
  actorUserId: string,
  now = new Date(),
): Promise<FamilyInvitationListItem[] | null> {
  if (!(await isFamilyAdmin(familyId, actorUserId))) return null;
  const rows = await getDb()
    .select({
      invitation: familyInvitation,
      personName: person.displayName,
    })
    .from(familyInvitation)
    .leftJoin(person, eq(familyInvitation.personId, person.id))
    .where(eq(familyInvitation.familyId, familyId))
    .orderBy(desc(familyInvitation.createdAt));

  return rows.map(({ invitation, personName }) => ({
    id: invitation.id,
    role: invitation.role as FamilyRole,
    email: invitation.email,
    personId: invitation.personId,
    personName,
    status: invitationStatus(invitation, now),
    expiresAt: invitation.expiresAt,
    usedAt: invitation.usedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  }));
}

export async function listInvitationPersonCandidates(
  familyId: string,
  actorUserId: string,
): Promise<InvitationPersonCandidate[] | null> {
  if (!(await isFamilyAdmin(familyId, actorUserId))) return null;
  return getDb()
    .select({
      id: person.id,
      displayName: person.displayName,
      relationToChild: person.relationToChild,
    })
    .from(person)
    .leftJoin(userTable, eq(userTable.personId, person.id))
    .where(and(eq(person.familyId, familyId), isNull(userTable.id)))
    .orderBy(asc(person.displayName));
}

export async function revokeFamilyInvitation(input: {
  familyId: string;
  actorUserId: string;
  invitationId: string;
}): Promise<{ ok: true } | { ok: false; error: InvitationAdminFailure }> {
  const now = new Date();
  const db = getDb();
  try {
    let changed = 0;
    db.transaction((tx) => {
      const actor = tx
        .select({ id: userTable.id })
        .from(userTable)
        .leftJoin(person, eq(userTable.personId, person.id))
        .where(
          and(
            eq(userTable.id, input.actorUserId),
            eq(userTable.familyId, input.familyId),
            eq(userTable.role, "admin"),
            isNull(userTable.disabledAt),
            or(
              isNull(userTable.personId),
              and(
                eq(person.id, userTable.personId),
                eq(person.familyId, input.familyId),
              ),
            ),
          ),
        )
        .limit(1)
        .get();
      if (!actor) throw new InvitationAuthorizationError();

      const receipt = tx
        .select({ provisionedUserId: familyInvitation.provisionedUserId })
        .from(familyInvitation)
        .where(
          and(
            eq(familyInvitation.id, input.invitationId),
            eq(familyInvitation.familyId, input.familyId),
            isNull(familyInvitation.usedAt),
            isNull(familyInvitation.revokedAt),
          ),
        )
        .limit(1)
        .get();
      if (receipt?.provisionedUserId) {
        tx.delete(userTable)
          .where(
            and(
              eq(userTable.id, receipt.provisionedUserId),
              eq(userTable.role, "viewer"),
              isNull(userTable.familyId),
              isNull(userTable.personId),
            ),
          )
          .run();
      }
      const result = tx
        .update(familyInvitation)
        .set({
          revokedAt: now,
          revokedByUserId: input.actorUserId,
          claimNonce: null,
          claimExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(familyInvitation.id, input.invitationId),
            eq(familyInvitation.familyId, input.familyId),
            isNull(familyInvitation.usedAt),
            isNull(familyInvitation.revokedAt),
          ),
        )
        .run();
      changed = result.changes;
      if (changed !== 1) throw new FinalizeInvitationError();
      tx.insert(auditLog)
        .values({
          id: randomUUID(),
          familyId: input.familyId,
          kind: INVITATION_AUDIT_KINDS.revoked,
          actorUserId: input.actorUserId,
          detailJson: JSON.stringify({ invitationId: input.invitationId }),
          createdAt: now,
        })
        .run();
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof InvitationAuthorizationError) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "not_found" };
  }
}

export async function inspectInvitationToken(
  token: string,
  now = new Date(),
): Promise<PublicInvitation> {
  if (!isTokenShapeValid(token)) return { status: "invalid" };
  const rows = await getDb()
    .select({
      invitation: familyInvitation,
      familyName: family.name,
      personName: person.displayName,
    })
    .from(familyInvitation)
    .innerJoin(family, eq(familyInvitation.familyId, family.id))
    .leftJoin(person, eq(familyInvitation.personId, person.id))
    .where(eq(familyInvitation.tokenHash, hashInvitationToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || !isFamilyRole(row.invitation.role)) {
    return { status: "invalid" };
  }
  return {
    status: invitationStatus(row.invitation, now),
    familyName: row.familyName,
    role: row.invitation.role,
    email: row.invitation.email,
    personName: row.personName,
    expiresAt: row.invitation.expiresAt,
  };
}

function claimInvitation(
  token: string,
  now: Date,
): ClaimedInvitation | null {
  if (!isTokenShapeValid(token)) return null;
  const claimNonce = randomBytes(16).toString("hex");
  const claimExpiresAt = new Date(now.getTime() + CLAIM_DURATION_MS);
  const rows = getDb()
    .update(familyInvitation)
    .set({ claimNonce, claimExpiresAt, updatedAt: now })
    .where(
      and(
        eq(familyInvitation.tokenHash, hashInvitationToken(token)),
        gt(familyInvitation.expiresAt, now),
        isNull(familyInvitation.usedAt),
        isNull(familyInvitation.revokedAt),
        or(
          isNull(familyInvitation.claimNonce),
          lte(familyInvitation.claimExpiresAt, now),
        ),
      ),
    )
    .returning({
      id: familyInvitation.id,
      familyId: familyInvitation.familyId,
      role: familyInvitation.role,
      email: familyInvitation.email,
      personId: familyInvitation.personId,
      expiresAt: familyInvitation.expiresAt,
      provisionedUserId: familyInvitation.provisionedUserId,
    })
    .all();
  const row = rows[0];
  if (!row || !isFamilyRole(row.role)) return null;
  return { ...row, role: row.role, claimNonce };
}

function releaseClaim(claim: ClaimedInvitation): void {
  getDb()
    .update(familyInvitation)
    .set({ claimNonce: null, claimExpiresAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(familyInvitation.id, claim.id),
        eq(familyInvitation.claimNonce, claim.claimNonce),
        isNull(familyInvitation.usedAt),
      ),
    )
    .run();
}

function prepareStableProvisioningReceipt(claim: ClaimedInvitation): boolean {
  if (!claim.provisionedUserId) return true;
  const db = getDb();
  try {
    db.transaction((tx) => {
      const candidate = tx
        .select({
          familyId: userTable.familyId,
          personId: userTable.personId,
          role: userTable.role,
        })
        .from(userTable)
        .where(eq(userTable.id, claim.provisionedUserId!))
        .limit(1)
        .get();
      if (
        candidate &&
        (candidate.familyId !== null ||
          candidate.personId !== null ||
          candidate.role !== "viewer")
      ) {
        // A receipt must never authorize deletion of a bound/privileged user,
        // even if a database was manually corrupted.
        throw new FinalizeInvitationError();
      }
      if (candidate) {
        tx.delete(userTable)
          .where(
            and(
              eq(userTable.id, claim.provisionedUserId!),
              eq(userTable.role, "viewer"),
              isNull(userTable.familyId),
              isNull(userTable.personId),
            ),
          )
          .run();
      }
      const stillOwned = tx
        .select({ id: familyInvitation.id })
        .from(familyInvitation)
        .where(
          and(
            eq(familyInvitation.id, claim.id),
            eq(familyInvitation.claimNonce, claim.claimNonce),
            eq(familyInvitation.provisionedUserId, claim.provisionedUserId!),
            isNull(familyInvitation.usedAt),
            isNull(familyInvitation.revokedAt),
          ),
        )
        .limit(1)
        .get();
      if (!stillOwned) throw new FinalizeInvitationError();
    });
    return true;
  } catch {
    return false;
  }
}

function cleanupFailedProvisioning(
  claim: ClaimedInvitation,
  createdUserId: string | null,
): void {
  const db = getDb();
  try {
    db.transaction((tx) => {
      if (createdUserId) {
        // The exact ID receipt is reserved before Better Auth inserts the user.
        // hook. Never delete by email, which could race another invitation.
        tx.delete(userTable)
          .where(
            and(
              eq(userTable.id, createdUserId),
              eq(userTable.role, "viewer"),
              isNull(userTable.familyId),
              isNull(userTable.personId),
            ),
          )
          .run();
      }
      tx.update(familyInvitation)
        .set({
          claimNonce: null,
          claimExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(familyInvitation.id, claim.id),
            eq(familyInvitation.claimNonce, claim.claimNonce),
            isNull(familyInvitation.usedAt),
          ),
        )
        .run();
    });
  } catch {
    // A healthy SQLite connection makes this path deterministic. If the
    // database itself is unavailable, the claim still self-releases on expiry.
  }
}

function finalizeInvitation(
  claim: ClaimedInvitation,
  newUserId: string,
  normalizedEmail: string,
  now: Date,
): void {
  const db = getDb();
  db.transaction((tx) => {
    const current = tx
      .select({ id: familyInvitation.id })
      .from(familyInvitation)
      .where(
        and(
          eq(familyInvitation.id, claim.id),
          eq(familyInvitation.claimNonce, claim.claimNonce),
          eq(familyInvitation.provisionedUserId, newUserId),
          gt(familyInvitation.claimExpiresAt, now),
          gt(familyInvitation.expiresAt, now),
          isNull(familyInvitation.usedAt),
          isNull(familyInvitation.revokedAt),
        ),
      )
      .limit(1)
      .get();
    if (!current) throw new FinalizeInvitationError();

    if (claim.personId) {
      const validPerson = tx
        .select({ id: person.id })
        .from(person)
        .where(
          and(
            eq(person.id, claim.personId),
            eq(person.familyId, claim.familyId),
          ),
        )
        .limit(1)
        .get();
      const anotherAccount = tx
        .select({ id: userTable.id })
        .from(userTable)
        .where(
          and(
            eq(userTable.personId, claim.personId),
            ne(userTable.id, newUserId),
          ),
        )
        .limit(1)
        .get();
      if (!validPerson || anotherAccount) throw new FinalizeInvitationError();
    }

    const updatedUser = tx
      .update(userTable)
      .set({
        familyId: claim.familyId,
        personId: claim.personId,
        role: claim.role,
        updatedAt: now,
      })
      .where(
        and(
          eq(userTable.id, newUserId),
          eq(userTable.email, normalizedEmail),
          eq(userTable.role, "viewer"),
          isNull(userTable.familyId),
          isNull(userTable.personId),
        ),
      )
      .run();
    if (updatedUser.changes !== 1) throw new FinalizeInvitationError();

    const used = tx
      .update(familyInvitation)
      .set({
        usedAt: now,
        usedByUserId: newUserId,
        claimNonce: null,
        claimExpiresAt: null,
        provisionedUserId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(familyInvitation.id, claim.id),
          eq(familyInvitation.claimNonce, claim.claimNonce),
          isNull(familyInvitation.usedAt),
          isNull(familyInvitation.revokedAt),
        ),
      )
      .run();
    if (used.changes !== 1) throw new FinalizeInvitationError();

    // Internal sign-up has no browser cookie consumer. Remove its provisional
    // session so acceptance always finishes at the normal login page.
    tx.delete(session).where(eq(session.userId, newUserId)).run();
    tx.insert(auditLog)
      .values({
        id: randomUUID(),
        familyId: claim.familyId,
        kind: INVITATION_AUDIT_KINDS.accepted,
        actorUserId: newUserId,
        detailJson: JSON.stringify({
          invitationId: claim.id,
          role: claim.role,
          personId: claim.personId,
        }),
        createdAt: now,
      })
      .run();
  });
}

export async function acceptFamilyInvitation(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const displayName = input.displayName.trim();
  const email = normalizeEmail(input.email);
  if (
    !isTokenShapeValid(input.token) ||
    !isValidDisplayName(displayName) ||
    !isEmail(email) ||
    input.password.length < 10 ||
    input.password.length > 128
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const claim = claimInvitation(input.token, new Date());
  if (!claim) return { ok: false, error: "invalid_or_unavailable" };
  if (!prepareStableProvisioningReceipt(claim)) {
    releaseClaim(claim);
    return { ok: false, error: "account_creation_failed" };
  }
  if (claim.email !== null && claim.email !== email) {
    releaseClaim(claim);
    return { ok: false, error: "email_mismatch" };
  }
  if (
    claim.personId &&
    !(await personCanReceiveAccount(claim.familyId, claim.personId))
  ) {
    releaseClaim(claim);
    return { ok: false, error: "person_unavailable" };
  }
  const existing = await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (existing[0]) {
    releaseClaim(claim);
    return { ok: false, error: "account_exists" };
  }

  const provisioning = await runWithInvitationProvisioningCapability(
    {
      invitationId: claim.id,
      claimNonce: claim.claimNonce,
      familyId: claim.familyId,
      role: claim.role,
      personId: claim.personId,
      accountEmail: email,
    },
    () =>
      getAuth().api.signUpEmail({
        body: {
          name: displayName,
          email,
          password: input.password,
          rememberMe: false,
        },
      }),
  );

  if (!provisioning.ok) {
    cleanupFailedProvisioning(claim, provisioning.createdUserId);
    return { ok: false, error: "account_creation_failed" };
  }
  const responseUserId = provisioning.value.user.id;
  const createdUserId = provisioning.createdUserId ?? responseUserId;
  if (
    !createdUserId ||
    (provisioning.createdUserId &&
      provisioning.createdUserId !== responseUserId)
  ) {
    cleanupFailedProvisioning(claim, provisioning.createdUserId);
    return { ok: false, error: "account_creation_failed" };
  }

  try {
    finalizeInvitation(claim, createdUserId, email, new Date());
  } catch {
    cleanupFailedProvisioning(claim, createdUserId);
    return { ok: false, error: "account_creation_failed" };
  }
  return { ok: true, userId: createdUserId };
}
