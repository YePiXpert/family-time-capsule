import type { MemoryAssistant } from "@/lib/ai/types";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import type { AiJobFinalizeContext, AiJobLease } from "@/lib/ai/jobs";
import { isSafeOperationalCode } from "@/lib/ai/jobs/validation";

export type AiJobCommit = (
  tx: ContributionAccessTransaction,
  context: AiJobFinalizeContext,
) => void;

export type AiJobHandlerResult = Readonly<{
  /** Synchronous normalized writes; provider calls must already be finished. */
  commit: AiJobCommit;
}>;

export type AiJobHandlerContext = Readonly<{
  lease: AiJobLease;
  assistant: MemoryAssistant;
  signal: AbortSignal;
}>;

export type AiJobHandler = (
  context: AiJobHandlerContext,
) => Promise<AiJobHandlerResult>;

export class AiJobHandlerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    if (!isSafeOperationalCode(code)) {
      throw new Error("unsafe AI handler error code");
    }
    super("AI job handler failed");
    this.name = "AiJobHandlerError";
    this.code = code;
    this.retryable = retryable;
  }
}
