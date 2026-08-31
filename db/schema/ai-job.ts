import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { family } from "./family";

/**
 * External AI is opt-in per family and capability. A consent version binds a
 * queued job to the exact provider/model disclosure that an administrator
 * accepted; changing or revoking consent invalidates old work.
 */
export const aiProcessingConsent = sqliteTable(
  "ai_processing_consent",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    allowAutomaticFamilyContent: integer("allow_automatic_family_content", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    providerId: text("provider_id"),
    providerName: text("provider_name"),
    model: text("model"),
    disclosureVersion: integer("disclosure_version").notNull(),
    consentVersion: integer("consent_version").notNull(),
    approvedByUserId: text("approved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("ai_consent_family_capability_uidx").on(
      table.familyId,
      table.capability,
    ),
    index("ai_consent_family_enabled_idx").on(table.familyId, table.enabled),
    check(
      "ai_consent_capability_check",
      sql`${table.capability} in ('text', 'vision', 'transcription', 'embeddings')`,
    ),
    check(
      "ai_consent_versions_check",
      sql`typeof(${table.disclosureVersion}) = 'integer' and ${table.disclosureVersion} >= 1 and typeof(${table.consentVersion}) = 'integer' and ${table.consentVersion} >= 1`,
    ),
    check(
      "ai_consent_provider_lengths_check",
      sql`(${table.providerId} is null or (length(${table.providerId}) between 1 and 100)) and (${table.providerName} is null or (length(${table.providerName}) between 1 and 100)) and (${table.model} is null or (length(${table.model}) between 1 and 256))`,
    ),
    check(
      "ai_consent_enabled_shape_check",
      sql`(${table.enabled} = 1 and ${table.providerId} is not null and ${table.providerName} is not null and ${table.model} is not null and ${table.approvedByUserId} is not null and ${table.approvedAt} is not null and ${table.revokedAt} is null and ${table.revokedByUserId} is null) or (${table.enabled} = 0 and ${table.allowAutomaticFamilyContent} = 0)`,
    ),
    check(
      "ai_consent_revoke_pair_check",
      sql`(${table.revokedAt} is null and ${table.revokedByUserId} is null) or (${table.revokedAt} is not null and ${table.revokedByUserId} is not null)`,
    ),
    check(
      "ai_consent_timestamp_check",
      sql`typeof(${table.createdAt}) = 'integer' and ${table.createdAt} >= 0 and typeof(${table.updatedAt}) = 'integer' and ${table.updatedAt} >= ${table.createdAt} and (${table.approvedAt} is null or (typeof(${table.approvedAt}) = 'integer' and ${table.approvedAt} >= 0)) and (${table.revokedAt} is null or (typeof(${table.revokedAt}) = 'integer' and ${table.revokedAt} >= 0))`,
    ),
  ],
);

/**
 * The queue stores only bounded, opaque identifiers and operational metadata.
 * Prompts, family text, media bytes, secrets and provider responses belong in
 * their source/result tables and must never be placed in payload/output JSON.
 */
export const aiJob = sqliteTable(
  "ai_job",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requiredCapability: text("required_capability").notNull(),
    providerId: text("provider_id").notNull(),
    model: text("model").notNull(),
    providerExternal: integer("provider_external", { mode: "boolean" })
      .notNull(),
    consentVersion: integer("consent_version"),
    triggerMode: text("trigger_mode").notNull(),
    contentVisibility: text("content_visibility").notNull(),
    status: text("status").notNull(),
    payloadJson: text("payload_json").notNull(),
    outputJson: text("output_json"),
    idempotencyKey: text("idempotency_key").notNull(),
    priority: integer("priority").notNull().default(50),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: integer("available_at", { mode: "timestamp" }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
    leaseGeneration: integer("lease_generation").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    cancelRequestedAt: integer("cancel_requested_at", { mode: "timestamp" }),
    cancelRequestedByUserId: text("cancel_requested_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("ai_job_family_idempotency_uidx").on(
      table.familyId,
      table.idempotencyKey,
    ),
    index("ai_job_claim_idx").on(
      table.status,
      table.availableAt,
      table.priority,
      table.createdAt,
    ),
    index("ai_job_lease_idx").on(table.status, table.leaseExpiresAt),
    index("ai_job_family_entity_idx").on(
      table.familyId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("ai_job_requester_status_idx").on(
      table.requestedByUserId,
      table.status,
    ),
    check(
      "ai_job_status_check",
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "ai_job_capability_check",
      sql`${table.requiredCapability} in ('text', 'vision', 'transcription', 'embeddings')`,
    ),
    check(
      "ai_job_trigger_mode_check",
      sql`${table.triggerMode} in ('manual', 'automatic')`,
    ),
    check(
      "ai_job_visibility_check",
      sql`${table.contentVisibility} in ('family', 'private', 'parents', 'child_later')`,
    ),
    check(
      "ai_job_automatic_visibility_check",
      sql`${table.triggerMode} = 'manual' or ${table.contentVisibility} = 'family'`,
    ),
    check(
      "ai_job_provider_lengths_check",
      sql`length(${table.providerId}) between 1 and 100 and length(${table.model}) between 1 and 256`,
    ),
    check(
      "ai_job_opaque_fields_check",
      sql`length(${table.id}) between 1 and 256 and ${table.id} not glob '*[^A-Za-z0-9_.:@-]*' and length(${table.jobType}) between 1 and 100 and ${table.jobType} glob '[a-z]*' and ${table.jobType} not glob '*[^a-z0-9_.:-]*' and length(${table.entityType}) between 1 and 100 and ${table.entityType} glob '[a-z]*' and ${table.entityType} not glob '*[^a-z0-9_.:-]*' and length(${table.entityId}) between 1 and 256 and ${table.entityId} not glob '*[^A-Za-z0-9_.:@-]*'`,
    ),
    check(
      "ai_job_external_consent_check",
      sql`(${table.providerExternal} = 1 and ${table.consentVersion} is not null and typeof(${table.consentVersion}) = 'integer' and ${table.consentVersion} >= 1) or (${table.providerExternal} = 0 and ${table.consentVersion} is null)`,
    ),
    check(
      "ai_job_payload_check",
      sql`${table.payloadJson} = '{}'`,
    ),
    check(
      "ai_job_output_check",
      sql`${table.outputJson} is null or ${table.outputJson} = '{}'`,
    ),
    check(
      "ai_job_idempotency_check",
      sql`length(${table.idempotencyKey}) = 64 and ${table.idempotencyKey} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "ai_job_attempt_bounds_check",
      sql`typeof(${table.attempts}) = 'integer' and ${table.attempts} >= 0 and typeof(${table.maxAttempts}) = 'integer' and ${table.maxAttempts} between 1 and 20 and ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check(
      "ai_job_priority_check",
      sql`typeof(${table.priority}) = 'integer' and ${table.priority} between 0 and 100`,
    ),
    check(
      "ai_job_lease_generation_check",
      sql`typeof(${table.leaseGeneration}) = 'integer' and ${table.leaseGeneration} >= 0`,
    ),
    check(
      "ai_job_lease_shape_check",
      sql`(${table.status} = 'running' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'running' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "ai_job_finished_shape_check",
      sql`(${table.status} in ('completed', 'failed', 'cancelled') and ${table.finishedAt} is not null) or (${table.status} in ('pending', 'running') and ${table.finishedAt} is null)`,
    ),
    check(
      "ai_job_cancel_pair_check",
      sql`(${table.cancelRequestedAt} is null and ${table.cancelRequestedByUserId} is null) or (${table.cancelRequestedAt} is not null and ${table.cancelRequestedByUserId} is not null)`,
    ),
    check(
      "ai_job_error_code_check",
      sql`${table.lastErrorCode} is null or (length(${table.lastErrorCode}) between 1 and 64 and ${table.lastErrorCode} not glob '*[^a-z0-9_:-]*')`,
    ),
    check(
      "ai_job_timestamp_check",
      sql`typeof(${table.availableAt}) = 'integer' and ${table.availableAt} >= 0 and typeof(${table.createdAt}) = 'integer' and ${table.createdAt} >= 0 and typeof(${table.updatedAt}) = 'integer' and ${table.updatedAt} >= ${table.createdAt} and (${table.startedAt} is null or (typeof(${table.startedAt}) = 'integer' and ${table.startedAt} >= ${table.createdAt})) and (${table.finishedAt} is null or (typeof(${table.finishedAt}) = 'integer' and ${table.finishedAt} >= ${table.createdAt})) and (${table.leaseExpiresAt} is null or (typeof(${table.leaseExpiresAt}) = 'integer' and ${table.leaseExpiresAt} >= 0)) and (${table.cancelRequestedAt} is null or (typeof(${table.cancelRequestedAt}) = 'integer' and ${table.cancelRequestedAt} >= ${table.createdAt}))`,
    ),
  ],
);

export const aiJobSource = sqliteTable(
  "ai_job_source",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => aiJob.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.sourceKind, table.sourceId] }),
    index("ai_job_source_lookup_idx").on(table.sourceKind, table.sourceId),
    check(
      "ai_job_source_kind_check",
      sql`${table.sourceKind} in ('asset', 'contribution', 'memory_event')`,
    ),
    check(
      "ai_job_source_sha_check",
      sql`length(${table.sourceSha256}) = 64 and ${table.sourceSha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "ai_job_source_opaque_check",
      sql`length(${table.sourceId}) between 1 and 256 and ${table.sourceId} not glob '*[^A-Za-z0-9_.:@-]*' and typeof(${table.createdAt}) = 'integer' and ${table.createdAt} >= 0`,
    ),
  ],
);

export const aiJobAttempt = sqliteTable(
  "ai_job_attempt",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => aiJob.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    leaseGeneration: integer("lease_generation").notNull(),
    workerId: text("worker_id").notNull(),
    status: text("status").notNull(),
    providerId: text("provider_id").notNull(),
    model: text("model").notNull(),
    errorCode: text("error_code"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("ai_job_attempt_number_uidx").on(
      table.jobId,
      table.attemptNumber,
    ),
    index("ai_job_attempt_job_started_idx").on(table.jobId, table.startedAt),
    check(
      "ai_job_attempt_status_check",
      sql`${table.status} in ('running', 'completed', 'retry_scheduled', 'failed', 'cancelled', 'lease_expired')`,
    ),
    check(
      "ai_job_attempt_numbers_check",
      sql`typeof(${table.attemptNumber}) = 'integer' and ${table.attemptNumber} >= 1 and typeof(${table.leaseGeneration}) = 'integer' and ${table.leaseGeneration} >= 1`,
    ),
    check(
      "ai_job_attempt_finished_check",
      sql`(${table.status} = 'running' and ${table.finishedAt} is null) or (${table.status} <> 'running' and ${table.finishedAt} is not null)`,
    ),
    check(
      "ai_job_attempt_error_code_check",
      sql`${table.errorCode} is null or (length(${table.errorCode}) between 1 and 64 and ${table.errorCode} not glob '*[^a-z0-9_:-]*')`,
    ),
    check(
      "ai_job_attempt_opaque_timestamp_check",
      sql`length(${table.id}) between 1 and 256 and ${table.id} not glob '*[^A-Za-z0-9_.:@-]*' and length(${table.workerId}) between 1 and 256 and ${table.workerId} not glob '*[^A-Za-z0-9_.:@-]*' and typeof(${table.startedAt}) = 'integer' and ${table.startedAt} >= 0 and (${table.finishedAt} is null or (typeof(${table.finishedAt}) = 'integer' and ${table.finishedAt} >= ${table.startedAt}))`,
    ),
  ],
);

/** Operational liveness only: no host paths, command lines or environment. */
export const aiWorkerHeartbeat = sqliteTable(
  "ai_worker_heartbeat",
  {
    workerId: text("worker_id").primaryKey(),
    workerVersion: text("worker_version").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("ai_worker_last_seen_idx").on(table.lastSeenAt),
    check(
      "ai_worker_status_check",
      sql`${table.status} in ('idle', 'working', 'stopping')`,
    ),
    check(
      "ai_worker_version_length_check",
      sql`length(${table.workerVersion}) between 1 and 64`,
    ),
    check(
      "ai_worker_opaque_timestamp_check",
      sql`length(${table.workerId}) between 1 and 256 and ${table.workerId} not glob '*[^A-Za-z0-9_.:@-]*' and typeof(${table.startedAt}) = 'integer' and ${table.startedAt} >= 0 and typeof(${table.lastSeenAt}) = 'integer' and ${table.lastSeenAt} >= ${table.startedAt}`,
    ),
  ],
);
