import { describe, expect, it, vi } from "vitest";
import { DeterministicFakeMemoryAssistant } from "@/lib/ai/fake";
import { AiProviderError } from "@/lib/ai/errors";
import type { AiJobLease } from "@/lib/ai/jobs";
import { AiJobHandlerError, AiJobRegistry } from "@/jobs/registry";
import {
  runAiWorkerOnce,
  type AiWorkerQueue,
} from "@/jobs/runtime";

const now = new Date("2026-08-31T00:00:00.000Z");
const lease: AiJobLease = {
  jobId: "job-1",
  familyId: "family-1",
  jobType: "test.handler.v1",
  entityType: "analysis_run",
  entityId: "run-1",
  requiredCapability: "text",
  providerId: "deterministic-fake",
  model: "deterministic-text-v1",
  providerExternal: false,
  consentVersion: null,
  triggerMode: "manual",
  contentVisibility: "family",
  requestedByUserId: "user-1",
  attemptNumber: 1,
  leaseGeneration: 1,
  leaseExpiresAt: new Date(now.getTime() + 60_000),
  workerId: "worker-1",
};

function queue(overrides: Partial<AiWorkerQueue> = {}): AiWorkerQueue {
  return {
    claim: vi.fn(() => lease),
    renew: vi.fn((current) => current),
    finalize: vi.fn(() => ({ ok: true as const, value: undefined })),
    fail: vi.fn(() => ({ ok: true as const })),
    heartbeat: vi.fn(),
    ...overrides,
  };
}

describe("AI worker runtime", () => {
  it("stays idle without a job and records only liveness", async () => {
    const workerQueue = queue({ claim: vi.fn(() => null) });
    await expect(
      runAiWorkerOnce({
        workerId: "worker-1",
        assistant: new DeterministicFakeMemoryAssistant(),
        queue: workerQueue,
      }),
    ).resolves.toEqual({ status: "idle", jobId: null, errorCode: null });
    expect(workerQueue.heartbeat).toHaveBeenCalledTimes(2);
    expect(workerQueue.finalize).not.toHaveBeenCalled();
  });

  it("runs a registered handler and delegates its normalized commit once", async () => {
    const commit = vi.fn();
    const registry = new AiJobRegistry().register(lease.jobType, async () => ({
      commit,
    }));
    const workerQueue = queue();
    await expect(
      runAiWorkerOnce({
        workerId: "worker-1",
        assistant: new DeterministicFakeMemoryAssistant(),
        registry,
        queue: workerQueue,
      }),
    ).resolves.toEqual({
      status: "completed",
      jobId: lease.jobId,
      errorCode: null,
    });
    expect(workerQueue.finalize).toHaveBeenCalledOnce();
    expect(workerQueue.fail).not.toHaveBeenCalled();
    expect(workerQueue.finalize).toHaveBeenCalledWith(
      lease,
      commit,
      expect.objectContaining({
        runtime: expect.objectContaining({
          provider: expect.objectContaining({ id: "deterministic-fake" }),
        }),
      }),
    );
  });

  it("fails an unknown job type without exposing payload data", async () => {
    const workerQueue = queue();
    await expect(
      runAiWorkerOnce({
        workerId: "worker-1",
        assistant: new DeterministicFakeMemoryAssistant(),
        queue: workerQueue,
      }),
    ).resolves.toEqual({
      status: "failed",
      jobId: lease.jobId,
      errorCode: "unknown_job_type",
    });
    expect(workerQueue.fail).toHaveBeenCalledWith(
      lease,
      "unknown_job_type",
      false,
      expect.any(Object),
    );
  });

  it("maps provider and typed handler failures to safe retry decisions", async () => {
    const providerQueue = queue();
    const providerRegistry = new AiJobRegistry().register(
      lease.jobType,
      async () => {
        throw new AiProviderError({
          capability: "text",
          code: "ai_timeout",
          message: "safe timeout",
          retryable: true,
        });
      },
    );
    await runAiWorkerOnce({
      workerId: "worker-1",
      assistant: new DeterministicFakeMemoryAssistant(),
      registry: providerRegistry,
      queue: providerQueue,
    });
    expect(providerQueue.fail).toHaveBeenCalledWith(
      lease,
      "ai_timeout",
      true,
      expect.any(Object),
    );

    const permanentQueue = queue();
    const permanentRegistry = new AiJobRegistry().register(
      lease.jobType,
      async () => {
        throw new AiJobHandlerError("invalid_source_type", false);
      },
    );
    await runAiWorkerOnce({
      workerId: "worker-1",
      assistant: new DeterministicFakeMemoryAssistant(),
      registry: permanentRegistry,
      queue: permanentQueue,
    });
    expect(permanentQueue.fail).toHaveBeenCalledWith(
      lease,
      "invalid_source_type",
      false,
      expect.any(Object),
    );
  });

  it("turns a local finalize crash into a retryable safe code", async () => {
    const workerQueue = queue({
      finalize: vi.fn(() => {
        throw new Error("database details must not escape");
      }),
    });
    const registry = new AiJobRegistry().register(lease.jobType, async () => ({
      commit: () => undefined,
    }));
    await expect(
      runAiWorkerOnce({
        workerId: "worker-1",
        assistant: new DeterministicFakeMemoryAssistant(),
        registry,
        queue: workerQueue,
      }),
    ).resolves.toEqual({
      status: "failed",
      jobId: lease.jobId,
      errorCode: "local_commit_failed",
    });
    expect(workerQueue.fail).toHaveBeenCalledWith(
      lease,
      "local_commit_failed",
      true,
      expect.any(Object),
    );
  });
});
