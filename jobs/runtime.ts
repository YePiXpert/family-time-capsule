import "server-only";

import { randomUUID } from "node:crypto";
import { AiError, AiProviderError } from "@/lib/ai/errors";
import { createMemoryAssistant } from "@/lib/ai/server";
import type { MemoryAssistant } from "@/lib/ai/types";
import {
  claimNextAiJob,
  failAiJob,
  finalizeAiJob,
  renewAiJobLease,
  updateAiWorkerHeartbeat,
  type AiExecutionValidation,
  type AiJobFinalizeContext,
  type AiJobLease,
  type AiJobRuntimeIdentity,
} from "@/lib/ai/jobs";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import {
  AiJobHandlerError,
  AiJobRegistry,
  createProductionAiJobRegistry,
  type AiJobCommit,
} from "./registry";

const WORKER_VERSION = "1";

type FinalizeResult =
  | { ok: true; value: void }
  | Exclude<AiExecutionValidation, { ok: true }>;

export type AiWorkerQueue = Readonly<{
  claim: (
    workerId: string,
    options: { runtime: AiJobRuntimeIdentity; leaseMs: number },
  ) => AiJobLease | null;
  renew: (
    lease: AiJobLease,
    options: { runtime: AiJobRuntimeIdentity; leaseMs: number },
  ) => AiJobLease | null;
  finalize: (
    lease: AiJobLease,
    effect: (
      tx: ContributionAccessTransaction,
      context: AiJobFinalizeContext,
    ) => void,
    options: { runtime: AiJobRuntimeIdentity },
  ) => FinalizeResult;
  fail: (
    lease: AiJobLease,
    errorCode: string,
    retryable: boolean,
    options: { runtime: AiJobRuntimeIdentity },
  ) => AiExecutionValidation;
  heartbeat: (input: {
    workerId: string;
    workerVersion: string;
    status: "idle" | "working" | "stopping";
  }) => void;
}>;

const DEFAULT_QUEUE: AiWorkerQueue = {
  claim: (workerId, options) => claimNextAiJob(workerId, options),
  renew: (lease, options) => renewAiJobLease(lease, options),
  finalize: (lease, effect, options) =>
    finalizeAiJob(lease, effect, options),
  fail: (lease, errorCode, retryable, options) =>
    failAiJob(lease, errorCode, retryable, options),
  heartbeat: (input) => updateAiWorkerHeartbeat(input),
};

export type AiWorkerOnceResult = Readonly<{
  status: "idle" | "completed" | "failed" | "discarded";
  jobId: string | null;
  errorCode: string | null;
}>;

export type AiWorkerOptions = Readonly<{
  workerId?: string;
  assistant?: MemoryAssistant;
  registry?: AiJobRegistry;
  queue?: AiWorkerQueue;
  leaseMs?: number;
}>;

function runtimeIdentity(assistant: MemoryAssistant): AiJobRuntimeIdentity {
  return {
    provider: assistant.provider,
    capabilities: assistant.capabilities,
  };
}

function safeHeartbeat(
  queue: AiWorkerQueue,
  input: Parameters<AiWorkerQueue["heartbeat"]>[0],
): void {
  try {
    queue.heartbeat(input);
  } catch {
    // Liveness telemetry must never corrupt or duplicate a job result.
  }
}

function safeFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof AiJobHandlerError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof AiProviderError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof AiError) {
    return { code: error.code, retryable: false };
  }
  return { code: "handler_failed", retryable: false };
}

export async function runAiWorkerOnce(
  options: AiWorkerOptions = {},
): Promise<AiWorkerOnceResult> {
  const workerId = options.workerId ?? randomUUID();
  const assistant = options.assistant ?? createMemoryAssistant();
  const registry = options.registry ?? createProductionAiJobRegistry();
  const queue = options.queue ?? DEFAULT_QUEUE;
  const leaseMs = options.leaseMs ?? 60_000;
  const runtime = runtimeIdentity(assistant);
  safeHeartbeat(queue, {
    workerId,
    workerVersion: WORKER_VERSION,
    status: "working",
  });

  const claimedLease = queue.claim(workerId, { runtime, leaseMs });
  if (!claimedLease) {
    safeHeartbeat(queue, {
      workerId,
      workerVersion: WORKER_VERSION,
      status: "idle",
    });
    return { status: "idle", jobId: null, errorCode: null };
  }
  let activeLease: AiJobLease = claimedLease;

  const handler = registry.get(activeLease.jobType);
  if (!handler) {
    queue.fail(activeLease, "unknown_job_type", false, { runtime });
    safeHeartbeat(queue, {
      workerId,
      workerVersion: WORKER_VERSION,
      status: "idle",
    });
    return {
      status: "failed",
      jobId: activeLease.jobId,
      errorCode: "unknown_job_type",
    };
  }

  const controller = new AbortController();
  const renewEveryMs = Math.max(1_000, Math.min(30_000, Math.floor(leaseMs / 3)));
  const timer = setInterval(() => {
    const renewed = queue.renew(activeLease, { runtime, leaseMs });
    if (!renewed) {
      controller.abort();
      return;
    }
    activeLease = renewed;
  }, renewEveryMs);
  timer.unref();

  try {
    const prepared = await handler({
      lease: activeLease,
      assistant,
      signal: controller.signal,
    });
    clearInterval(timer);
    if (controller.signal.aborted) {
      return {
        status: "discarded",
        jobId: activeLease.jobId,
        errorCode: "lease_lost",
      };
    }

    let finalized: FinalizeResult;
    try {
      finalized = queue.finalize(activeLease, prepared.commit, { runtime });
    } catch {
      queue.fail(activeLease, "local_commit_failed", true, { runtime });
      return {
        status: "failed",
        jobId: activeLease.jobId,
        errorCode: "local_commit_failed",
      };
    }
    if (!finalized.ok) {
      return {
        status: "discarded",
        jobId: activeLease.jobId,
        errorCode: finalized.error,
      };
    }
    return { status: "completed", jobId: activeLease.jobId, errorCode: null };
  } catch (error) {
    clearInterval(timer);
    const failure = safeFailure(error);
    queue.fail(activeLease, failure.code, failure.retryable, { runtime });
    return {
      status: "failed",
      jobId: activeLease.jobId,
      errorCode: failure.code,
    };
  } finally {
    clearInterval(timer);
    safeHeartbeat(queue, {
      workerId,
      workerVersion: WORKER_VERSION,
      status: "idle",
    });
  }
}

function boundedPollMs(raw: number | undefined): number {
  if (raw === undefined) return 1_000;
  if (!Number.isSafeInteger(raw) || raw < 100 || raw > 30_000) {
    throw new Error("AI worker poll interval must be 100-30000ms");
  }
  return raw;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function runAiWorkerLoop(
  options: AiWorkerOptions & {
    signal: AbortSignal;
    pollMs?: number;
  },
): Promise<void> {
  const pollMs = boundedPollMs(options.pollMs);
  const workerId = options.workerId ?? randomUUID();
  while (!options.signal.aborted) {
    const result = await runAiWorkerOnce({ ...options, workerId });
    if (result.status === "idle") await wait(pollMs, options.signal);
  }
  const queue = options.queue ?? DEFAULT_QUEUE;
  safeHeartbeat(queue, {
    workerId,
    workerVersion: WORKER_VERSION,
    status: "stopping",
  });
}

export type { AiJobCommit };
