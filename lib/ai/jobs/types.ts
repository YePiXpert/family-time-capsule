import type { AiCapability } from "@/lib/ai/types";
import type { ContributionVisibility } from "@/lib/authz/policy";

export const AI_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];
export type AiJobTriggerMode = "manual" | "automatic";
export type AiJobSourceKind = "asset" | "contribution" | "memory_event";

export type AiJobSourceReference = Readonly<{
  kind: AiJobSourceKind;
  id: string;
}>;

export type AiJobLease = Readonly<{
  jobId: string;
  familyId: string;
  jobType: string;
  entityType: string;
  entityId: string;
  requiredCapability: AiCapability;
  providerId: string;
  model: string;
  providerExternal: boolean;
  consentVersion: number | null;
  triggerMode: AiJobTriggerMode;
  contentVisibility: ContributionVisibility;
  requestedByUserId: string;
  attemptNumber: number;
  leaseGeneration: number;
  leaseExpiresAt: Date;
  workerId: string;
}>;

/**
 * Callers identify normalized source rows only. The service derives family,
 * current visibility, source hashes, provider identity and idempotency inside
 * one transaction; none of those security decisions are caller supplied.
 */
export type EnqueueAiJobInput = Readonly<{
  familyId: string;
  requestedByUserId: string;
  jobType: string;
  entityType: string;
  entityId: string;
  requiredCapability: AiCapability;
  triggerMode: AiJobTriggerMode;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
  sources: readonly AiJobSourceReference[];
}>;

export type EnqueueAiJobResult =
  | { ok: true; jobId: string; created: boolean }
  | {
      ok: false;
      error:
        | "forbidden"
        | "invalid_input"
        | "capability_unavailable"
        | "capability_not_consented"
        | "source_forbidden_or_not_found"
        | "automatic_restricted_content_forbidden";
    };

