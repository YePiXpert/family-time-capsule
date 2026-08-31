import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { family, person } from "./family";

/**
 * A family-scoped, single-use account invitation.
 *
 * The bearer token never enters SQLite: tokenHash is the lowercase SHA-256
 * digest of a 256-bit random token.  claimNonce is a short-lived internal
 * lease used to serialize slow password hashing without holding a SQLite
 * transaction open.
 */
export const familyInvitation = sqliteTable(
  "family_invitation",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    email: text("email"),
    personId: text("person_id").references(() => person.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    claimNonce: text("claim_nonce"),
    claimExpiresAt: integer("claim_expires_at", {
      mode: "timestamp",
    }),
    // Reserved Better Auth user id, written before the user insert. It is
    // intentionally not an FK so a process crash at either side of that insert
    // still leaves an exact, reclaimable cleanup receipt.
    provisionedUserId: text("provisioned_user_id"),
    usedAt: integer("used_at", { mode: "timestamp" }),
    usedByUserId: text("used_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("family_invitation_token_hash_uidx").on(table.tokenHash),
    index("family_invitation_family_created_idx").on(
      table.familyId,
      table.createdAt,
    ),
    index("family_invitation_person_idx").on(table.personId),
    check(
      "family_invitation_token_hash_length_check",
      sql`length(${table.tokenHash}) = 64`,
    ),
    check(
      "family_invitation_role_check",
      sql`${table.role} in ('admin', 'editor', 'contributor', 'viewer')`,
    ),
    check(
      "family_invitation_claim_pair_check",
      sql`((${table.claimNonce} is null) and (${table.claimExpiresAt} is null)) or ((${table.claimNonce} is not null) and (${table.claimExpiresAt} is not null))`,
    ),
  ],
);
