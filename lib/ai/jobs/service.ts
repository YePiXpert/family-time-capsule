import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import {
  aiJob,
  aiJobAttempt,
  aiJobSource,
  aiProcessingConsent,
  aiWorkerHeartbeat,
} from "@/db/schema/ai-job";
import { asset as assetTable } from "@/db/schema/asset";
import { auditLog } from "@/db/schema/audit";
import { user as userTable } from "@/db/schema/auth";
import { contribution } from "@/db/schema/contribution";
import { family as familyTable, person as personTable } from "@/db/schema/family";
import { memoryEvent } from "@/db/schema/memory";
import { createMemoryAssistant } from "@/lib/ai/server";
import {
  AI_CAPABILITIES,
  type AiCapability,
  type AiCapabilityMap,
  type AiProviderDescriptor,
} from "@/lib/ai/types";
import { AUDIT_KINDS, requiredAuditValues } from "@/lib/audit/service";
import {
  getContributionAssetAccessInTransaction,
  getVisibleContributionInTransaction,
  type ContributionAccessSnapshot,
  type ContributionAccessTransaction,
} from "@/lib/authz/contribution-access";
import {
  assertFamilyCapability,
  isContributionVisibility,
  isFamilyRole,
  type ContributionVisibility,
  type FamilyCapability,
} from "@/lib/authz/policy";
import { familyLocalDate } from "@/lib/authz/principal";
import type { FamilyContext } from "@/lib/family/context";
import type {
  AiJobLease,
  AiJobSourceKind,
  AiJobSourceReference,
  EnqueueAiJobInput,
  EnqueueAiJobResult,
} from "./types";
import {
  isOpaqueEntityId,
  isSafeJobType,
  isSafeOperationalCode,
  isSafeProviderLabel,
  isSha256,
} from "./validation";

export const AI_CONSENT_DISCLOSURE_VERSION = 1;
export const DEFAULT_AI_JOB_LEASE_MS = 60_000;
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 15 * 60_000;
const EMPTY_OPERATIONAL_JSON = "{}";

export type AiJobRuntimeIdentity = Readonly<{
  provider: AiProviderDescriptor;
  capabilities: AiCapabilityMap;
}>;

export type AiJobServiceDependencies = Readonly<{
  database?: AppDatabase;
  /** Test seam. Production callers omit this and use server AI configuration. */
  runtime?: AiJobRuntimeIdentity;
}>;

type Transaction = ContributionAccessTransaction;

type LiveActor = Readonly<{
  id: string;
  familyId: string;
  role: "admin" | "editor" | "contributor" | "viewer";
  snapshot: ContributionAccessSnapshot;
}>;

type HydratedSource = Readonly<{
  kind: AiJobSourceKind;
  id: string;
  sha256: string;
  visibility: ContributionVisibility;
}>;

type HydrateResult =
  | { ok: true; sources: HydratedSource[]; visibility: ContributionVisibility }
  | {
      ok: false;
      error:
        | "invalid_input"
        | "source_forbidden_or_not_found"
        | "automatic_restricted_content_forbidden";
    };

function database(dependencies: AiJobServiceDependencies): AppDatabase {
  return dependencies.database ?? getDb();
}

function runtimeIdentity(
  dependencies: AiJobServiceDependencies,
): AiJobRuntimeIdentity | null {
  try {
    const runtime = dependencies.runtime ?? createMemoryAssistant();
    if (
      !isSafeProviderLabel(runtime.provider.id, 100) ||
      !isSafeProviderLabel(runtime.provider.displayName, 100) ||
      typeof runtime.provider.external !== "boolean"
    ) {
      return null;
    }
    return { provider: runtime.provider, capabilities: runtime.capabilities };
  } catch {
    return null;
  }
}

function runtimeModel(
  runtime: AiJobRuntimeIdentity | null,
  capability: AiCapability,
): string | null {
  const status = runtime?.capabilities[capability];
  return status?.available && isSafeProviderLabel(status.model, 256)
    ? status.model
    : null;
}

function isCapability(value: unknown): value is AiCapability {
  return (
    typeof value === "string" &&
    AI_CAPABILITIES.includes(value as AiCapability)
  );
}

function isSourceKind(value: unknown): value is AiJobSourceKind {
  return value === "asset" || value === "contribution" || value === "memory_event";
}

function validPositiveInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maximum
  );
}

function epochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function leaseDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_LEASE_MS || value > MAX_LEASE_MS) {
    throw new Error("AI job lease duration is outside the safe range");
  }
  return value;
}

function retryDelayMs(attemptNumber: number): number {
  return Math.min(60 * 60_000, 1_000 * 2 ** Math.min(12, attemptNumber - 1));
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function getLiveActor(
  tx: Transaction,
  familyId: string,
  userId: string,
  capability: FamilyCapability,
  evaluatedAt: Date,
): LiveActor | null {
  const row = tx
    .select({
      id: userTable.id,
      familyId: userTable.familyId,
      personId: userTable.personId,
      role: userTable.role,
      familyTimezone: familyTable.timezone,
      childLaterUnlockAge: familyTable.childLaterUnlockAge,
      personRowId: personTable.id,
      isGuardian: personTable.isGuardian,
    })
    .from(userTable)
    .innerJoin(familyTable, eq(familyTable.id, userTable.familyId))
    .leftJoin(
      personTable,
      and(
        eq(userTable.personId, personTable.id),
        eq(personTable.familyId, userTable.familyId),
      ),
    )
    .where(
      and(
        eq(userTable.id, userId),
        eq(userTable.familyId, familyId),
        isNull(userTable.disabledAt),
        or(
          and(isNull(userTable.personId), isNull(personTable.id)),
          and(
            eq(personTable.id, userTable.personId),
            eq(personTable.familyId, familyId),
          ),
        ),
      ),
    )
    .limit(1)
    .get();
  if (
    !row ||
    row.familyId === null ||
    !isFamilyRole(row.role) ||
    !Number.isInteger(row.childLaterUnlockAge)
  ) {
    return null;
  }
  try {
    assertFamilyCapability(row.role, capability);
  } catch {
    return null;
  }
  const principal = {
    userId: row.id,
    familyId: row.familyId,
    personId: row.personId,
    role: row.role,
    accountEnabled: true as const,
    isGuardian: row.personRowId === null ? false : (row.isGuardian ?? false),
    familyTimezone: row.familyTimezone,
    childLaterUnlockAge: row.childLaterUnlockAge,
  };
  return {
    id: row.id,
    familyId: row.familyId,
    role: row.role,
    snapshot: {
      principal,
      evaluatedAt,
      familyLocalDate: familyLocalDate(evaluatedAt, row.familyTimezone),
    },
  };
}

function visibilityRank(value: ContributionVisibility): number {
  switch (value) {
    case "family":
      return 0;
    case "child_later":
      return 1;
    case "parents":
      return 2;
    case "private":
      return 3;
  }
}

function aggregateVisibility(sources: readonly HydratedSource[]): ContributionVisibility {
  return sources.reduce<ContributionVisibility>(
    (current, source) =>
      visibilityRank(source.visibility) > visibilityRank(current)
        ? source.visibility
        : current,
    "family",
  );
}

function hydrateSources(
  tx: Transaction,
  snapshot: ContributionAccessSnapshot,
  references: readonly AiJobSourceReference[],
  triggerMode: "manual" | "automatic",
): HydrateResult {
  if (references.length < 1 || references.length > 50) {
    return { ok: false, error: "invalid_input" };
  }
  const sorted = [...references].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
  const unique = new Set(sorted.map((source) => `${source.kind}\u0000${source.id}`));
  if (
    unique.size !== sorted.length ||
    sorted.some(
      (source) => !isSourceKind(source.kind) || !isOpaqueEntityId(source.id),
    )
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const hydrated: HydratedSource[] = [];
  for (const reference of sorted) {
    if (reference.kind === "asset") {
      const row = tx
        .select()
        .from(assetTable)
        .where(
          and(
            eq(assetTable.id, reference.id),
            eq(assetTable.familyId, snapshot.principal.familyId),
          ),
        )
        .limit(1)
        .get();
      if (!row || !isSha256(row.sha256)) {
        return { ok: false, error: "source_forbidden_or_not_found" };
      }
      const access = getContributionAssetAccessInTransaction(
        tx,
        snapshot,
        reference.id,
      );
      if (!access.readable) {
        return { ok: false, error: "source_forbidden_or_not_found" };
      }
      const visibility: ContributionVisibility = access.automaticEligible
        ? "family"
        : "private";
      if (triggerMode === "automatic" && visibility !== "family") {
        return {
          ok: false,
          error: "automatic_restricted_content_forbidden",
        };
      }
      hydrated.push({
        kind: reference.kind,
        id: reference.id,
        sha256: row.sha256,
        visibility,
      });
      continue;
    }

    if (reference.kind === "contribution") {
      const authorized = getVisibleContributionInTransaction(
        tx,
        snapshot,
        reference.id,
      );
      if (!authorized) {
        return { ok: false, error: "source_forbidden_or_not_found" };
      }
      const row = tx
        .select({ row: contribution })
        .from(contribution)
        .innerJoin(memoryEvent, eq(contribution.memoryEventId, memoryEvent.id))
        .where(
          and(
            eq(contribution.id, reference.id),
            eq(memoryEvent.familyId, snapshot.principal.familyId),
          ),
        )
        .limit(1)
        .get()?.row;
      if (!row || !isContributionVisibility(row.visibility)) {
        return { ok: false, error: "source_forbidden_or_not_found" };
      }
      if (triggerMode === "automatic" && row.visibility !== "family") {
        return {
          ok: false,
          error: "automatic_restricted_content_forbidden",
        };
      }
      hydrated.push({
        kind: reference.kind,
        id: reference.id,
        visibility: row.visibility,
        sha256: hashCanonical({
          id: row.id,
          memoryEventId: row.memoryEventId,
          authorPersonId: row.authorPersonId,
          recordedByPersonId: row.recordedByPersonId,
          recordedByNameSnapshot: row.recordedByNameSnapshot,
          recordingMode: row.recordingMode,
          rawText: row.rawText,
          transcript: row.transcript,
          editedText: row.editedText,
          audioAssetId: row.audioAssetId,
          visibility: row.visibility,
          updatedAt: iso(row.updatedAt),
        }),
      });
      continue;
    }

    const row = tx
      .select()
      .from(memoryEvent)
      .where(
        and(
          eq(memoryEvent.id, reference.id),
          eq(memoryEvent.familyId, snapshot.principal.familyId),
        ),
      )
      .limit(1)
      .get();
    if (!row) {
      return { ok: false, error: "source_forbidden_or_not_found" };
    }
    hydrated.push({
      kind: reference.kind,
      id: reference.id,
      visibility: "family",
      sha256: hashCanonical({
        id: row.id,
        childPersonId: row.childPersonId,
        title: row.title,
        occurredAt: iso(row.occurredAt),
        occurredAtPrecision: row.occurredAtPrecision,
        locationText: row.locationText,
        coverAssetId: row.coverAssetId,
        status: row.status,
        updatedAt: iso(row.updatedAt),
      }),
    });
  }
  return {
    ok: true,
    sources: hydrated,
    visibility: aggregateVisibility(hydrated),
  };
}

function currentRuntimeMatches(
  job: typeof aiJob.$inferSelect,
  runtime: AiJobRuntimeIdentity | null,
): boolean {
  const model = isCapability(job.requiredCapability)
    ? runtimeModel(runtime, job.requiredCapability)
    : null;
  return (
    runtime !== null &&
    model !== null &&
    runtime.provider.id === job.providerId &&
    runtime.provider.external === job.providerExternal &&
    model === job.model
  );
}

function sourcesEqual(
  left: readonly Pick<HydratedSource, "kind" | "id" | "sha256">[],
  right: readonly Pick<HydratedSource, "kind" | "id" | "sha256">[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (source, index) =>
      source.kind === right[index]?.kind &&
      source.id === right[index]?.id &&
      source.sha256 === right[index]?.sha256,
  );
}

function normalizeStoredSources(
  rows: readonly { kind: string; id: string; sha256: string }[],
): Array<Pick<HydratedSource, "kind" | "id" | "sha256">> | null {
  const normalized: Array<Pick<HydratedSource, "kind" | "id" | "sha256">> = [];
  for (const row of rows) {
    if (
      !isSourceKind(row.kind) ||
      !isOpaqueEntityId(row.id) ||
      !isSha256(row.sha256)
    ) {
      return null;
    }
    normalized.push({ kind: row.kind, id: row.id, sha256: row.sha256 });
  }
  return normalized;
}

function externalConsentMatches(
  tx: Transaction,
  job: typeof aiJob.$inferSelect,
  runtime: AiJobRuntimeIdentity,
): boolean {
  if (!job.providerExternal) return job.consentVersion === null;
  return Boolean(
    tx
      .select({ id: aiProcessingConsent.id })
      .from(aiProcessingConsent)
      .where(
        and(
          eq(aiProcessingConsent.familyId, job.familyId),
          eq(aiProcessingConsent.capability, job.requiredCapability),
          eq(aiProcessingConsent.enabled, true),
          eq(aiProcessingConsent.providerId, runtime.provider.id),
          eq(aiProcessingConsent.providerName, runtime.provider.displayName),
          eq(aiProcessingConsent.model, job.model),
          eq(aiProcessingConsent.disclosureVersion, AI_CONSENT_DISCLOSURE_VERSION),
          eq(aiProcessingConsent.consentVersion, job.consentVersion ?? -1),
          job.triggerMode === "automatic"
            ? eq(aiProcessingConsent.allowAutomaticFamilyContent, true)
            : undefined,
        ),
      )
      .limit(1)
      .get(),
  );
}

export type AiConsentMutationResult =
  | { ok: true; consentVersion: number }
  | { ok: false; error: "forbidden" | "invalid_input" | "not_enabled" };

export function enableAiProcessingConsent(
  context: FamilyContext,
  input: {
    capability: AiCapability;
    allowAutomaticFamilyContent: boolean;
  },
  options: AiJobServiceDependencies & { now?: Date } = {},
): AiConsentMutationResult {
  const now = options.now ?? new Date();
  const runtime = runtimeIdentity(options);
  const model = isCapability(input.capability)
    ? runtimeModel(runtime, input.capability)
    : null;
  if (
    !runtime ||
    !runtime.provider.external ||
    model === null ||
    typeof input.allowAutomaticFamilyContent !== "boolean"
  ) {
    return { ok: false, error: "invalid_input" };
  }

  return database(options).transaction(
    (tx) => {
      const actor = getLiveActor(
        tx,
        context.familyId,
        context.userId,
        "ai:configure",
        now,
      );
      if (!actor) return { ok: false, error: "forbidden" } as const;
      const current = tx
        .select()
        .from(aiProcessingConsent)
        .where(
          and(
            eq(aiProcessingConsent.familyId, context.familyId),
            eq(aiProcessingConsent.capability, input.capability),
          ),
        )
        .get();
      const consentVersion = (current?.consentVersion ?? 0) + 1;
      const values = {
        familyId: context.familyId,
        capability: input.capability,
        enabled: true,
        allowAutomaticFamilyContent: input.allowAutomaticFamilyContent,
        providerId: runtime.provider.id,
        providerName: runtime.provider.displayName,
        model,
        disclosureVersion: AI_CONSENT_DISCLOSURE_VERSION,
        consentVersion,
        approvedByUserId: actor.id,
        approvedAt: now,
        revokedByUserId: null,
        revokedAt: null,
        updatedAt: now,
      } as const;
      if (current) {
        tx.update(aiProcessingConsent)
          .set(values)
          .where(eq(aiProcessingConsent.id, current.id))
          .run();
      } else {
        tx.insert(aiProcessingConsent)
          .values({ id: randomUUID(), createdAt: now, ...values })
          .run();
      }
      invalidateExternalJobs(
        tx,
        context.familyId,
        input.capability,
        consentVersion,
        actor.id,
        now,
        "consent_changed",
      );
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            context.familyId,
            AUDIT_KINDS.aiConsentEnabled,
            actor.id,
            {
              capability: input.capability,
              providerId: runtime.provider.id,
              model,
              consentVersion,
              allowAutomaticFamilyContent: input.allowAutomaticFamilyContent,
              disclosureVersion: AI_CONSENT_DISCLOSURE_VERSION,
            },
            now,
          ),
        )
        .run();
      return { ok: true, consentVersion } as const;
    },
    { behavior: "immediate" },
  );
}

export function revokeAiProcessingConsent(
  context: FamilyContext,
  capability: AiCapability,
  options: AiJobServiceDependencies & { now?: Date } = {},
): AiConsentMutationResult {
  if (!isCapability(capability)) return { ok: false, error: "invalid_input" };
  const now = options.now ?? new Date();
  return database(options).transaction(
    (tx) => {
      const actor = getLiveActor(
        tx,
        context.familyId,
        context.userId,
        "ai:configure",
        now,
      );
      if (!actor) return { ok: false, error: "forbidden" } as const;
      const current = tx
        .select()
        .from(aiProcessingConsent)
        .where(
          and(
            eq(aiProcessingConsent.familyId, context.familyId),
            eq(aiProcessingConsent.capability, capability),
          ),
        )
        .get();
      if (!current?.enabled) return { ok: false, error: "not_enabled" } as const;
      const consentVersion = current.consentVersion + 1;
      tx.update(aiProcessingConsent)
        .set({
          enabled: false,
          allowAutomaticFamilyContent: false,
          consentVersion,
          revokedByUserId: actor.id,
          revokedAt: now,
          updatedAt: now,
        })
        .where(eq(aiProcessingConsent.id, current.id))
        .run();
      invalidateExternalJobs(
        tx,
        context.familyId,
        capability,
        null,
        actor.id,
        now,
        "consent_revoked",
      );
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            context.familyId,
            AUDIT_KINDS.aiConsentRevoked,
            actor.id,
            { capability, consentVersion },
            now,
          ),
        )
        .run();
      return { ok: true, consentVersion } as const;
    },
    { behavior: "immediate" },
  );
}

function invalidateExternalJobs(
  tx: Transaction,
  familyId: string,
  capability: AiCapability,
  retainedConsentVersion: number | null,
  actorUserId: string,
  now: Date,
  errorCode: string,
): void {
  const versionCondition =
    retainedConsentVersion === null
      ? undefined
      : ne(aiJob.consentVersion, retainedConsentVersion);
  tx.update(aiJob)
    .set({
      status: "cancelled",
      cancelRequestedAt: now,
      cancelRequestedByUserId: actorUserId,
      lastErrorCode: errorCode,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiJob.familyId, familyId),
        eq(aiJob.requiredCapability, capability),
        eq(aiJob.providerExternal, true),
        eq(aiJob.status, "pending"),
        versionCondition,
      ),
    )
    .run();
  tx.update(aiJob)
    .set({
      cancelRequestedAt: now,
      cancelRequestedByUserId: actorUserId,
      lastErrorCode: errorCode,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiJob.familyId, familyId),
        eq(aiJob.requiredCapability, capability),
        eq(aiJob.providerExternal, true),
        eq(aiJob.status, "running"),
        versionCondition,
      ),
    )
    .run();
}

export type AiConsentDto = Readonly<{
  capability: AiCapability;
  enabled: boolean;
  allowAutomaticFamilyContent: boolean;
  providerId: string | null;
  providerName: string | null;
  model: string | null;
  disclosureVersion: number;
  consentVersion: number;
  approvedAt: Date | null;
  revokedAt: Date | null;
}>;

export type AiRuntimeDisclosure = Readonly<{
  valid: boolean;
  providerId: string | null;
  providerName: string | null;
  external: boolean;
  capabilities: AiCapabilityMap | null;
}>;

/** Safe UI summary. Secrets and endpoint credentials never leave config.ts. */
export function getAiRuntimeDisclosure(
  dependencies: AiJobServiceDependencies = {},
): AiRuntimeDisclosure {
  const runtime = runtimeIdentity(dependencies);
  if (!runtime) {
    return {
      valid: false,
      providerId: null,
      providerName: null,
      external: false,
      capabilities: null,
    };
  }
  return {
    valid: true,
    providerId: runtime.provider.id,
    providerName: runtime.provider.displayName,
    external: runtime.provider.external,
    capabilities: runtime.capabilities,
  };
}

export function listAiProcessingConsents(
  context: FamilyContext,
  dependencies: AiJobServiceDependencies = {},
): AiConsentDto[] {
  assertFamilyCapability(context.role, "ai:configure");
  const now = new Date();
  return database(dependencies).transaction((tx) => {
    if (!getLiveActor(tx, context.familyId, context.userId, "ai:configure", now)) {
      return [];
    }
    return tx
      .select({
        capability: aiProcessingConsent.capability,
        enabled: aiProcessingConsent.enabled,
        allowAutomaticFamilyContent:
          aiProcessingConsent.allowAutomaticFamilyContent,
        providerId: aiProcessingConsent.providerId,
        providerName: aiProcessingConsent.providerName,
        model: aiProcessingConsent.model,
        disclosureVersion: aiProcessingConsent.disclosureVersion,
        consentVersion: aiProcessingConsent.consentVersion,
        approvedAt: aiProcessingConsent.approvedAt,
        revokedAt: aiProcessingConsent.revokedAt,
      })
      .from(aiProcessingConsent)
      .where(eq(aiProcessingConsent.familyId, context.familyId))
      .orderBy(asc(aiProcessingConsent.capability))
      .all()
      .flatMap((row) =>
        isCapability(row.capability)
          ? [{ ...row, capability: row.capability }]
          : [],
      );
  });
}

function validEnqueueInput(input: EnqueueAiJobInput): boolean {
  return (
    isOpaqueEntityId(input.familyId) &&
    isOpaqueEntityId(input.requestedByUserId) &&
    isSafeJobType(input.jobType) &&
    isSafeJobType(input.entityType) &&
    isOpaqueEntityId(input.entityId) &&
    isCapability(input.requiredCapability) &&
    (input.triggerMode === "manual" || input.triggerMode === "automatic") &&
    (input.priority === undefined ||
      (Number.isSafeInteger(input.priority) && input.priority >= 0 && input.priority <= 100)) &&
    (input.maxAttempts === undefined || validPositiveInteger(input.maxAttempts, 20)) &&
    (input.availableAt === undefined || !Number.isNaN(input.availableAt.getTime())) &&
    Array.isArray(input.sources) &&
    input.sources.length >= 1 &&
    input.sources.length <= 50 &&
    input.sources.every(
      (source) => isSourceKind(source.kind) && isOpaqueEntityId(source.id),
    )
  );
}

export function enqueueAiJob(
  input: EnqueueAiJobInput,
  options: AiJobServiceDependencies & { now?: Date } = {},
): EnqueueAiJobResult {
  if (!validEnqueueInput(input)) return { ok: false, error: "invalid_input" };
  const now = options.now ?? new Date();
  const runtime = runtimeIdentity(options);
  const model = runtimeModel(runtime, input.requiredCapability);
  if (!runtime || model === null) {
    return { ok: false, error: "capability_unavailable" };
  }

  return database(options).transaction(
    (tx) => {
      const actor = getLiveActor(
        tx,
        input.familyId,
        input.requestedByUserId,
        "ai:review",
        now,
      );
      if (!actor) return { ok: false, error: "forbidden" } as const;
      const hydrated = hydrateSources(
        tx,
        actor.snapshot,
        input.sources,
        input.triggerMode,
      );
      if (!hydrated.ok) return { ok: false, error: hydrated.error } as const;

      let consentVersion: number | null = null;
      if (runtime.provider.external) {
        const consent = tx
          .select()
          .from(aiProcessingConsent)
          .where(
            and(
              eq(aiProcessingConsent.familyId, input.familyId),
              eq(aiProcessingConsent.capability, input.requiredCapability),
              eq(aiProcessingConsent.enabled, true),
              eq(aiProcessingConsent.providerId, runtime.provider.id),
              eq(aiProcessingConsent.providerName, runtime.provider.displayName),
              eq(aiProcessingConsent.model, model),
              eq(
                aiProcessingConsent.disclosureVersion,
                AI_CONSENT_DISCLOSURE_VERSION,
              ),
              input.triggerMode === "automatic"
                ? eq(aiProcessingConsent.allowAutomaticFamilyContent, true)
                : undefined,
            ),
          )
          .get();
        if (!consent) {
          return { ok: false, error: "capability_not_consented" } as const;
        }
        consentVersion = consent.consentVersion;
      }

      const priority = input.priority ?? 50;
      const maxAttempts = input.maxAttempts ?? 5;
      const idempotencyKey = hashCanonical({
        familyId: input.familyId,
        requestedByUserId: input.requestedByUserId,
        jobType: input.jobType,
        entityType: input.entityType,
        entityId: input.entityId,
        requiredCapability: input.requiredCapability,
        providerId: runtime.provider.id,
        providerExternal: runtime.provider.external,
        model,
        consentVersion,
        triggerMode: input.triggerMode,
        contentVisibility: hydrated.visibility,
        priority,
        maxAttempts,
        requestedAvailableAt: input.availableAt?.toISOString() ?? null,
        sources: hydrated.sources.map(({ kind, id, sha256 }) => ({ kind, id, sha256 })),
      });
      const existing = tx
        .select()
        .from(aiJob)
        .where(
          and(
            eq(aiJob.familyId, input.familyId),
            eq(aiJob.idempotencyKey, idempotencyKey),
          ),
        )
        .get();
      if (existing) {
        const stored = tx
          .select({
            kind: aiJobSource.sourceKind,
            id: aiJobSource.sourceId,
            sha256: aiJobSource.sourceSha256,
          })
          .from(aiJobSource)
          .where(eq(aiJobSource.jobId, existing.id))
          .orderBy(asc(aiJobSource.sourceKind), asc(aiJobSource.sourceId))
          .all();
        const normalizedStored = normalizeStoredSources(stored);
        const same =
          existing.requestedByUserId === input.requestedByUserId &&
          existing.jobType === input.jobType &&
          existing.entityType === input.entityType &&
          existing.entityId === input.entityId &&
          existing.requiredCapability === input.requiredCapability &&
          existing.providerId === runtime.provider.id &&
          existing.providerExternal === runtime.provider.external &&
          existing.model === model &&
          existing.consentVersion === consentVersion &&
          existing.triggerMode === input.triggerMode &&
          existing.contentVisibility === hydrated.visibility &&
          existing.priority === priority &&
          existing.maxAttempts === maxAttempts &&
          existing.payloadJson === EMPTY_OPERATIONAL_JSON &&
          normalizedStored !== null &&
          sourcesEqual(hydrated.sources, normalizedStored);
        return same
          ? ({ ok: true, jobId: existing.id, created: false } as const)
          : ({ ok: false, error: "invalid_input" } as const);
      }

      const jobId = randomUUID();
      tx.insert(aiJob)
        .values({
          id: jobId,
          familyId: input.familyId,
          jobType: input.jobType,
          entityType: input.entityType,
          entityId: input.entityId,
          requiredCapability: input.requiredCapability,
          providerId: runtime.provider.id,
          model,
          providerExternal: runtime.provider.external,
          consentVersion,
          triggerMode: input.triggerMode,
          contentVisibility: hydrated.visibility,
          status: "pending",
          payloadJson: EMPTY_OPERATIONAL_JSON,
          idempotencyKey,
          priority,
          maxAttempts,
          availableAt: input.availableAt ?? now,
          requestedByUserId: input.requestedByUserId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(aiJobSource)
        .values(
          hydrated.sources.map((source) => ({
            jobId,
            sourceKind: source.kind,
            sourceId: source.id,
            sourceSha256: source.sha256,
            createdAt: now,
          })),
        )
        .run();
      return { ok: true, jobId, created: true } as const;
    },
    { behavior: "immediate" },
  );
}

function finishAttempt(
  tx: Transaction,
  lease: AiJobLease,
  status: "completed" | "retry_scheduled" | "failed" | "cancelled" | "lease_expired",
  now: Date,
  errorCode: string | null,
): void {
  tx.update(aiJobAttempt)
    .set({ status, errorCode, finishedAt: now })
    .where(
      and(
        eq(aiJobAttempt.jobId, lease.jobId),
        eq(aiJobAttempt.leaseGeneration, lease.leaseGeneration),
        eq(aiJobAttempt.workerId, lease.workerId),
        eq(aiJobAttempt.status, "running"),
      ),
    )
    .run();
}

function recoverExpiredJobsInTransaction(tx: Transaction, now: Date): number {
  const expired = tx
    .select()
    .from(aiJob)
    .where(
      and(eq(aiJob.status, "running"), lte(aiJob.leaseExpiresAt, now)),
    )
    .all();
  for (const job of expired) {
    if (job.leaseOwner === null) continue;
    const lease: AiJobLease = {
      jobId: job.id,
      familyId: job.familyId,
      jobType: job.jobType,
      entityType: job.entityType,
      entityId: job.entityId,
      requiredCapability: isCapability(job.requiredCapability)
        ? job.requiredCapability
        : "text",
      providerId: job.providerId,
      model: job.model,
      providerExternal: job.providerExternal,
      consentVersion: job.consentVersion,
      triggerMode: job.triggerMode === "automatic" ? "automatic" : "manual",
      contentVisibility: isContributionVisibility(job.contentVisibility)
        ? job.contentVisibility
        : "private",
      requestedByUserId: job.requestedByUserId,
      attemptNumber: job.attempts,
      leaseGeneration: job.leaseGeneration,
      leaseExpiresAt: job.leaseExpiresAt ?? now,
      workerId: job.leaseOwner,
    };
    const cancelled = job.cancelRequestedAt !== null;
    const exhausted = job.attempts >= job.maxAttempts;
    const nextStatus = cancelled
      ? "cancelled"
      : exhausted
        ? "failed"
        : "pending";
    finishAttempt(
      tx,
      lease,
      cancelled ? "cancelled" : "lease_expired",
      now,
      cancelled ? "cancel_requested" : "lease_expired",
    );
    tx.update(aiJob)
      .set({
        status: nextStatus,
        availableAt:
          nextStatus === "pending"
            ? new Date(now.getTime() + retryDelayMs(job.attempts))
            : job.availableAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: cancelled ? "cancel_requested" : "lease_expired",
        finishedAt: nextStatus === "pending" ? null : now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiJob.id, job.id),
          eq(aiJob.status, "running"),
          eq(aiJob.leaseGeneration, job.leaseGeneration),
        ),
      )
      .run();
  }
  return expired.length;
}

export function recoverExpiredAiJobs(
  options: AiJobServiceDependencies & { now?: Date } = {},
): number {
  const now = options.now ?? new Date();
  return database(options).transaction(
    (tx) => recoverExpiredJobsInTransaction(tx, now),
    { behavior: "immediate" },
  );
}

function leaseFromRow(
  row: typeof aiJob.$inferSelect,
  workerId: string,
): AiJobLease {
  if (
    !isCapability(row.requiredCapability) ||
    (row.triggerMode !== "manual" && row.triggerMode !== "automatic") ||
    !isContributionVisibility(row.contentVisibility) ||
    row.leaseExpiresAt === null
  ) {
    throw new Error("AI job contains invalid persisted policy values");
  }
  return {
    jobId: row.id,
    familyId: row.familyId,
    jobType: row.jobType,
    entityType: row.entityType,
    entityId: row.entityId,
    requiredCapability: row.requiredCapability,
    providerId: row.providerId,
    model: row.model,
    providerExternal: row.providerExternal,
    consentVersion: row.consentVersion,
    triggerMode: row.triggerMode,
    contentVisibility: row.contentVisibility,
    requestedByUserId: row.requestedByUserId,
    attemptNumber: row.attempts,
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt,
    workerId,
  };
}

export type AiExecutionValidation =
  | { ok: true }
  | {
      ok: false;
      error:
        | "lease_lost"
        | "lease_expired"
        | "cancel_requested"
        | "authorization_revoked"
        | "configuration_changed"
        | "consent_changed"
        | "source_forbidden"
        | "source_changed";
    };

function inspectRunningJob(
  tx: Transaction,
  lease: AiJobLease,
  runtime: AiJobRuntimeIdentity | null,
  now: Date,
):
  | { ok: true; row: typeof aiJob.$inferSelect }
  | Exclude<AiExecutionValidation, { ok: true }> {
  const row = tx
    .select()
    .from(aiJob)
    .where(
      and(
        eq(aiJob.id, lease.jobId),
        eq(aiJob.status, "running"),
        eq(aiJob.leaseOwner, lease.workerId),
        eq(aiJob.leaseGeneration, lease.leaseGeneration),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "lease_lost" };
  if (row.leaseExpiresAt === null || row.leaseExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "lease_expired" };
  }
  if (row.cancelRequestedAt !== null) {
    return { ok: false, error: "cancel_requested" };
  }
  if (!currentRuntimeMatches(row, runtime)) {
    return { ok: false, error: "configuration_changed" };
  }
  const actor = getLiveActor(
    tx,
    row.familyId,
    row.requestedByUserId,
    "ai:review",
    now,
  );
  if (!actor) return { ok: false, error: "authorization_revoked" };
  if (!externalConsentMatches(tx, row, runtime!)) {
    return { ok: false, error: "consent_changed" };
  }
  const stored = tx
    .select({
      kind: aiJobSource.sourceKind,
      id: aiJobSource.sourceId,
      sha256: aiJobSource.sourceSha256,
    })
    .from(aiJobSource)
    .where(eq(aiJobSource.jobId, row.id))
    .orderBy(asc(aiJobSource.sourceKind), asc(aiJobSource.sourceId))
    .all();
  const normalizedStored = normalizeStoredSources(stored);
  if (!normalizedStored) return { ok: false, error: "source_changed" };
  const references: AiJobSourceReference[] = normalizedStored.map(
    ({ kind, id }) => ({ kind, id }),
  );
  const hydrated = hydrateSources(
    tx,
    actor.snapshot,
    references,
    row.triggerMode === "automatic" ? "automatic" : "manual",
  );
  if (!hydrated.ok) {
    return {
      ok: false,
      error:
        hydrated.error === "source_forbidden_or_not_found"
          ? "source_forbidden"
          : "source_changed",
    };
  }
  if (
    hydrated.visibility !== row.contentVisibility ||
    !sourcesEqual(hydrated.sources, normalizedStored)
  ) {
    return { ok: false, error: "source_changed" };
  }
  return { ok: true, row };
}

function terminateInvalidLease(
  tx: Transaction,
  lease: AiJobLease,
  error: Exclude<AiExecutionValidation, { ok: true }>["error"],
  now: Date,
): void {
  if (error === "lease_lost") return;
  if (error === "lease_expired") {
    recoverExpiredJobsInTransaction(tx, now);
    return;
  }
  tx.update(aiJob)
    .set({
      status: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: error,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiJob.id, lease.jobId),
        eq(aiJob.status, "running"),
        eq(aiJob.leaseOwner, lease.workerId),
        eq(aiJob.leaseGeneration, lease.leaseGeneration),
      ),
    )
    .run();
  finishAttempt(tx, lease, "cancelled", now, error);
}

export function claimNextAiJob(
  workerId: string,
  options: AiJobServiceDependencies & { now?: Date; leaseMs?: number } = {},
): AiJobLease | null {
  if (!isOpaqueEntityId(workerId)) throw new Error("invalid AI worker identifier");
  const now = options.now ?? new Date();
  const duration = leaseDuration(options.leaseMs ?? DEFAULT_AI_JOB_LEASE_MS);
  const leaseExpiresAt = new Date(now.getTime() + duration);
  const runtime = runtimeIdentity(options);
  return database(options).transaction(
    (tx) => {
      recoverExpiredJobsInTransaction(tx, now);
      const claimed = tx.get<{ id: string }>(sql`
        UPDATE ${aiJob}
        SET status = 'running',
            attempts = attempts + 1,
            lease_owner = ${workerId},
            lease_expires_at = ${epochSeconds(leaseExpiresAt)},
            lease_generation = lease_generation + 1,
            started_at = coalesce(started_at, ${epochSeconds(now)}),
            updated_at = ${epochSeconds(now)}
        WHERE id = (
          SELECT id
          FROM ${aiJob}
          WHERE status = 'pending'
            AND available_at <= ${epochSeconds(now)}
            AND cancel_requested_at is null
            AND attempts < max_attempts
          ORDER BY priority DESC, available_at ASC, created_at ASC, id ASC
          LIMIT 1
        )
          AND status = 'pending'
        RETURNING id
      `);
      if (!claimed) return null;
      const row = tx.select().from(aiJob).where(eq(aiJob.id, claimed.id)).get();
      if (!row) throw new Error("claimed AI job disappeared");
      const lease = leaseFromRow(row, workerId);
      tx.insert(aiJobAttempt)
        .values({
          id: randomUUID(),
          jobId: row.id,
          attemptNumber: row.attempts,
          leaseGeneration: row.leaseGeneration,
          workerId,
          status: "running",
          providerId: row.providerId,
          model: row.model,
          startedAt: now,
        })
        .run();
      const validation = inspectRunningJob(tx, lease, runtime, now);
      if (!validation.ok) {
        terminateInvalidLease(tx, lease, validation.error, now);
        return null;
      }
      return lease;
    },
    { behavior: "immediate" },
  );
}

export function validateAiJobExecution(
  lease: AiJobLease,
  options: AiJobServiceDependencies & { now?: Date } = {},
): AiExecutionValidation {
  const now = options.now ?? new Date();
  const runtime = runtimeIdentity(options);
  return database(options).transaction(
    (tx) => {
      const validation = inspectRunningJob(tx, lease, runtime, now);
      if (!validation.ok) terminateInvalidLease(tx, lease, validation.error, now);
      return validation.ok ? { ok: true } : validation;
    },
    { behavior: "immediate" },
  );
}

export function renewAiJobLease(
  lease: AiJobLease,
  options: AiJobServiceDependencies & { now?: Date; leaseMs?: number } = {},
): AiJobLease | null {
  const now = options.now ?? new Date();
  const duration = leaseDuration(options.leaseMs ?? DEFAULT_AI_JOB_LEASE_MS);
  const leaseExpiresAt = new Date(now.getTime() + duration);
  const runtime = runtimeIdentity(options);
  return database(options).transaction(
    (tx) => {
      const validation = inspectRunningJob(tx, lease, runtime, now);
      if (!validation.ok) {
        terminateInvalidLease(tx, lease, validation.error, now);
        return null;
      }
      const changed = tx
        .update(aiJob)
        .set({ leaseExpiresAt, updatedAt: now })
        .where(
          and(
            eq(aiJob.id, lease.jobId),
            eq(aiJob.status, "running"),
            eq(aiJob.leaseOwner, lease.workerId),
            eq(aiJob.leaseGeneration, lease.leaseGeneration),
            isNull(aiJob.cancelRequestedAt),
          ),
        )
        .returning({ id: aiJob.id })
        .get();
      return changed ? { ...lease, leaseExpiresAt } : null;
    },
    { behavior: "immediate" },
  );
}

export type AiJobFinalizeContext = Readonly<{
  jobId: string;
  familyId: string;
  entityType: string;
  entityId: string;
  requestedByUserId: string;
  attemptNumber: number;
}>;

export type AiJobFinalizeResult<T> =
  | { ok: true; value: T }
  | Exclude<AiExecutionValidation, { ok: true }>;

export function finalizeAiJob<T>(
  lease: AiJobLease,
  effect: (tx: Transaction, context: AiJobFinalizeContext) => T,
  options: AiJobServiceDependencies & { now?: Date } = {},
): AiJobFinalizeResult<T> {
  const now = options.now ?? new Date();
  const runtime = runtimeIdentity(options);
  return database(options).transaction(
    (tx) => {
      const validation = inspectRunningJob(tx, lease, runtime, now);
      if (!validation.ok) {
        terminateInvalidLease(tx, lease, validation.error, now);
        return validation;
      }
      const value = effect(tx, {
        jobId: lease.jobId,
        familyId: lease.familyId,
        entityType: lease.entityType,
        entityId: lease.entityId,
        requestedByUserId: lease.requestedByUserId,
        attemptNumber: lease.attemptNumber,
      });
      if (
        value !== null &&
        typeof value === "object" &&
        "then" in value &&
        typeof value.then === "function"
      ) {
        throw new Error("AI finalize effect must be synchronous");
      }
      const changed = tx
        .update(aiJob)
        .set({
          status: "completed",
          outputJson: EMPTY_OPERATIONAL_JSON,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiJob.id, lease.jobId),
            eq(aiJob.status, "running"),
            eq(aiJob.leaseOwner, lease.workerId),
            eq(aiJob.leaseGeneration, lease.leaseGeneration),
          ),
        )
        .returning({ id: aiJob.id })
        .get();
      if (!changed) return { ok: false, error: "lease_lost" } as const;
      finishAttempt(tx, lease, "completed", now, null);
      return { ok: true, value } as const;
    },
    { behavior: "immediate" },
  );
}

export function completeAiJob(
  lease: AiJobLease,
  options: AiJobServiceDependencies & { now?: Date } = {},
): AiExecutionValidation {
  const result = finalizeAiJob(lease, () => undefined, options);
  return result.ok ? { ok: true } : result;
}

export function failAiJob(
  lease: AiJobLease,
  errorCode: string,
  retryable: boolean,
  options: AiJobServiceDependencies & { now?: Date } = {},
): AiExecutionValidation {
  if (!isSafeOperationalCode(errorCode)) {
    throw new Error("AI job error code is unsafe");
  }
  const now = options.now ?? new Date();
  const runtime = runtimeIdentity(options);
  return database(options).transaction(
    (tx) => {
      const validation = inspectRunningJob(tx, lease, runtime, now);
      if (!validation.ok) {
        terminateInvalidLease(tx, lease, validation.error, now);
        return validation;
      }
      const row = validation.row;
      const willRetry = retryable && row.attempts < row.maxAttempts;
      const status = willRetry ? "pending" : "failed";
      tx.update(aiJob)
        .set({
          status,
          availableAt: willRetry
            ? new Date(now.getTime() + retryDelayMs(row.attempts))
            : row.availableAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          finishedAt: willRetry ? null : now,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiJob.id, lease.jobId),
            eq(aiJob.status, "running"),
            eq(aiJob.leaseOwner, lease.workerId),
            eq(aiJob.leaseGeneration, lease.leaseGeneration),
          ),
        )
        .run();
      finishAttempt(
        tx,
        lease,
        willRetry ? "retry_scheduled" : "failed",
        now,
        errorCode,
      );
      return { ok: true } as const;
    },
    { behavior: "immediate" },
  );
}

export type CancelAiJobResult =
  | { ok: true; status: "cancelled" | "cancellation_requested" | "unchanged" }
  | { ok: false; error: "forbidden" | "not_found" };

export type RetryAiJobResult =
  | { ok: true; jobId: string; created: boolean }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "not_retryable"
        | "capability_unavailable"
        | "capability_not_consented"
        | "source_forbidden_or_not_found"
        | "automatic_restricted_content_forbidden";
    };

/**
 * Terminal jobs remain immutable. Retry clones the current trusted source
 * snapshot into a new job; the old attempt stays available for audit/history.
 */
export function retryAiJob(
  context: FamilyContext,
  jobId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): RetryAiJobResult {
  if (!isOpaqueEntityId(jobId)) return { ok: false, error: "not_found" };
  const now = options.now ?? new Date();
  const runtime = runtimeIdentity(options);
  return database(options).transaction(
    (tx) => {
      const actor = getLiveActor(
        tx,
        context.familyId,
        context.userId,
        "ai:review",
        now,
      );
      if (!actor) return { ok: false, error: "forbidden" } as const;
      const old = tx
        .select()
        .from(aiJob)
        .where(and(eq(aiJob.id, jobId), eq(aiJob.familyId, context.familyId)))
        .get();
      if (!old) return { ok: false, error: "not_found" } as const;
      if (old.status !== "failed" && old.status !== "cancelled") {
        return { ok: false, error: "not_retryable" } as const;
      }
      if (!isCapability(old.requiredCapability)) {
        return { ok: false, error: "capability_unavailable" } as const;
      }
      const model = runtimeModel(runtime, old.requiredCapability);
      if (!runtime || model === null) {
        return { ok: false, error: "capability_unavailable" } as const;
      }
      const stored = tx
        .select({ kind: aiJobSource.sourceKind, id: aiJobSource.sourceId })
        .from(aiJobSource)
        .where(eq(aiJobSource.jobId, old.id))
        .orderBy(asc(aiJobSource.sourceKind), asc(aiJobSource.sourceId))
        .all();
      const references: AiJobSourceReference[] = [];
      for (const source of stored) {
        if (!isSourceKind(source.kind) || !isOpaqueEntityId(source.id)) {
          return {
            ok: false,
            error: "source_forbidden_or_not_found",
          } as const;
        }
        references.push({ kind: source.kind, id: source.id });
      }
      const triggerMode = old.triggerMode === "automatic" ? "automatic" : "manual";
      const hydrated = hydrateSources(tx, actor.snapshot, references, triggerMode);
      if (!hydrated.ok) {
        return {
          ok: false,
          error:
            hydrated.error === "invalid_input"
              ? "source_forbidden_or_not_found"
              : hydrated.error,
        } as const;
      }

      let consentVersion: number | null = null;
      if (runtime.provider.external) {
        const consent = tx
          .select()
          .from(aiProcessingConsent)
          .where(
            and(
              eq(aiProcessingConsent.familyId, old.familyId),
              eq(aiProcessingConsent.capability, old.requiredCapability),
              eq(aiProcessingConsent.enabled, true),
              eq(aiProcessingConsent.providerId, runtime.provider.id),
              eq(aiProcessingConsent.providerName, runtime.provider.displayName),
              eq(aiProcessingConsent.model, model),
              eq(
                aiProcessingConsent.disclosureVersion,
                AI_CONSENT_DISCLOSURE_VERSION,
              ),
              triggerMode === "automatic"
                ? eq(aiProcessingConsent.allowAutomaticFamilyContent, true)
                : undefined,
            ),
          )
          .get();
        if (!consent) {
          return { ok: false, error: "capability_not_consented" } as const;
        }
        consentVersion = consent.consentVersion;
      }

      const idempotencyKey = hashCanonical({
        retryOfJobId: old.id,
        requestedByUserId: actor.id,
        providerId: runtime.provider.id,
        providerExternal: runtime.provider.external,
        model,
        consentVersion,
        sources: hydrated.sources.map(({ kind, id, sha256 }) => ({
          kind,
          id,
          sha256,
        })),
      });
      const existing = tx
        .select({ id: aiJob.id })
        .from(aiJob)
        .where(
          and(
            eq(aiJob.familyId, old.familyId),
            eq(aiJob.idempotencyKey, idempotencyKey),
          ),
        )
        .get();
      if (existing) {
        return { ok: true, jobId: existing.id, created: false } as const;
      }

      const newJobId = randomUUID();
      tx.insert(aiJob)
        .values({
          id: newJobId,
          familyId: old.familyId,
          jobType: old.jobType,
          entityType: old.entityType,
          entityId: old.entityId,
          requiredCapability: old.requiredCapability,
          providerId: runtime.provider.id,
          model,
          providerExternal: runtime.provider.external,
          consentVersion,
          triggerMode,
          contentVisibility: hydrated.visibility,
          status: "pending",
          payloadJson: EMPTY_OPERATIONAL_JSON,
          idempotencyKey,
          priority: old.priority,
          maxAttempts: old.maxAttempts,
          availableAt: now,
          requestedByUserId: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(aiJobSource)
        .values(
          hydrated.sources.map((source) => ({
            jobId: newJobId,
            sourceKind: source.kind,
            sourceId: source.id,
            sourceSha256: source.sha256,
            createdAt: now,
          })),
        )
        .run();
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            old.familyId,
            AUDIT_KINDS.aiJobRetried,
            actor.id,
            { previousJobId: old.id, newJobId, jobType: old.jobType },
            now,
          ),
        )
        .run();
      return { ok: true, jobId: newJobId, created: true } as const;
    },
    { behavior: "immediate" },
  );
}

export function requestAiJobCancellation(
  context: FamilyContext,
  jobId: string,
  options: AiJobServiceDependencies & { now?: Date } = {},
): CancelAiJobResult {
  if (!isOpaqueEntityId(jobId)) return { ok: false, error: "not_found" };
  const now = options.now ?? new Date();
  return database(options).transaction(
    (tx) => {
      const actor = getLiveActor(
        tx,
        context.familyId,
        context.userId,
        "ai:review",
        now,
      );
      if (!actor) return { ok: false, error: "forbidden" } as const;
      const job = tx
        .select()
        .from(aiJob)
        .where(and(eq(aiJob.id, jobId), eq(aiJob.familyId, context.familyId)))
        .get();
      if (!job) return { ok: false, error: "not_found" } as const;
      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled" ||
        job.cancelRequestedAt !== null
      ) {
        return { ok: true, status: "unchanged" } as const;
      }
      const running = job.status === "running";
      tx.update(aiJob)
        .set({
          status: running ? "running" : "cancelled",
          cancelRequestedAt: now,
          cancelRequestedByUserId: actor.id,
          lastErrorCode: "cancel_requested",
          finishedAt: running ? null : now,
          updatedAt: now,
        })
        .where(eq(aiJob.id, job.id))
        .run();
      tx.insert(auditLog)
        .values(
          requiredAuditValues(
            context.familyId,
            AUDIT_KINDS.aiJobCancelled,
            actor.id,
            { jobId: job.id, jobType: job.jobType, running },
            now,
          ),
        )
        .run();
      return {
        ok: true,
        status: running ? "cancellation_requested" : "cancelled",
      } as const;
    },
    { behavior: "immediate" },
  );
}

export function updateAiWorkerHeartbeat(
  input: {
    workerId: string;
    workerVersion: string;
    status: "idle" | "working" | "stopping";
    now?: Date;
  },
  dependencies: AiJobServiceDependencies = {},
): void {
  if (
    !isOpaqueEntityId(input.workerId) ||
    !isSafeProviderLabel(input.workerVersion, 64)
  ) {
    throw new Error("invalid AI worker heartbeat");
  }
  const now = input.now ?? new Date();
  database(dependencies)
    .insert(aiWorkerHeartbeat)
    .values({
      workerId: input.workerId,
      workerVersion: input.workerVersion,
      status: input.status,
      startedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: aiWorkerHeartbeat.workerId,
      set: {
        status: input.status,
        // A host clock correction must not make liveness move backwards.
        lastSeenAt: sql`max(${aiWorkerHeartbeat.lastSeenAt}, ${epochSeconds(now)})`,
      },
    })
    .run();
}

export type AiJobSummary = Readonly<{
  id: string;
  jobType: string;
  entityType: string;
  entityId: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export function listRecentAiJobs(
  context: FamilyContext,
  limit = 20,
  dependencies: AiJobServiceDependencies = {},
): AiJobSummary[] {
  assertFamilyCapability(context.role, "ai:review");
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const now = new Date();
  return database(dependencies).transaction((tx) => {
    if (!getLiveActor(tx, context.familyId, context.userId, "ai:review", now)) {
      return [];
    }
    return tx
      .select({
        id: aiJob.id,
        jobType: aiJob.jobType,
        entityType: aiJob.entityType,
        entityId: aiJob.entityId,
        status: aiJob.status,
        attempts: aiJob.attempts,
        maxAttempts: aiJob.maxAttempts,
        lastErrorCode: aiJob.lastErrorCode,
        createdAt: aiJob.createdAt,
        updatedAt: aiJob.updatedAt,
      })
      .from(aiJob)
      .where(eq(aiJob.familyId, context.familyId))
      .orderBy(desc(aiJob.createdAt))
      .limit(boundedLimit)
      .all();
  });
}

export function listJobsForEntity(
  context: FamilyContext,
  entityType: string,
  entityId: string,
  dependencies: AiJobServiceDependencies = {},
): AiJobSummary[] {
  assertFamilyCapability(context.role, "ai:review");
  const now = new Date();
  return database(dependencies).transaction((tx) => {
    if (!getLiveActor(tx, context.familyId, context.userId, "ai:review", now)) {
      return [];
    }
    return tx
      .select({
        id: aiJob.id,
        jobType: aiJob.jobType,
        entityType: aiJob.entityType,
        entityId: aiJob.entityId,
        status: aiJob.status,
        attempts: aiJob.attempts,
        maxAttempts: aiJob.maxAttempts,
        lastErrorCode: aiJob.lastErrorCode,
        createdAt: aiJob.createdAt,
        updatedAt: aiJob.updatedAt,
      })
      .from(aiJob)
      .where(
        and(
          eq(aiJob.familyId, context.familyId),
          eq(aiJob.entityType, entityType),
          eq(aiJob.entityId, entityId),
        ),
      )
      .orderBy(desc(aiJob.createdAt))
      .all();
  });
}
