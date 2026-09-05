import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { family } from "./family";
import { user } from "./auth";
import { bookProject } from "./book";
/** Transient tasks/artifacts are excluded from portable archives. */
export const bookRenderJob = sqliteTable(
  "book_render_job",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => bookProject.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revision: integer("revision").notNull(),
    templateVersion: text("template_version").notNull(),
    format: text("format", { enum: ["pdf", "epub", "reading_zip"] }).notNull(),
    audience: text("audience", { enum: ["family", "personal"] }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceDigest: text("source_digest").notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    progress: integer("progress").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    pages: integer("pages"),
    bytes: integer("bytes"),
    sha256: text("sha256"),
    errorCode: text("error_code"),
    leaseUntil: integer("lease_until", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("book_render_key_idx").on(t.familyId, t.idempotencyKey),
    index("book_render_queue_idx").on(t.status, t.createdAt),
    index("book_render_project_idx").on(t.projectId),
  ],
);
/** Shared lease also bounds compatibility URL renders across app/worker processes. */
export const bookRenderLease = sqliteTable("book_render_lease", {
  id: integer("id").primaryKey(),
  token: text("token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});
