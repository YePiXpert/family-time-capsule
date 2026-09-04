import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-resumable-restart-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "resumable-restart-token";
process.env.AUTH_SECRET = "resumable-restart-secret-with-enough-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("resumable upload process restart", () => {
  it("reopens SQLite and trusts the durable partial's real length", async () => {
    const { performSetup } = await import("@/lib/auth/setup");
    const { getDb, closeDatabase } = await import("@/db");
    const { user } = await import("@/db/schema/auth");
    const { completeOnboarding } = await import("@/lib/family/service");
    const beforeRestart = await import("@/lib/imports/service");
    const setup = await performSetup({
      token: "resumable-restart-token",
      displayName: "妈妈",
      email: "restart@example.test",
      password: "a-long-enough-password",
    });
    if (!setup.ok) throw new Error("setup failed");
    const principal = (await getDb().select().from(user))[0];
    const onboarding = await completeOnboarding(principal.id, {
      familyName: "重启测试家庭",
      timezone: "Asia/Shanghai",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "妈妈",
      selfRelationToChild: "妈妈",
    });
    if (!onboarding.ok) throw new Error("onboarding failed");

    const payload = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
      "hex",
    );
    const created = await beforeRestart.createUploadSession({
      familyId: onboarding.familyId,
      userId: principal.id,
      captureId: randomUUID(),
      filename: "restart.png",
      declaredMime: "image/png",
      totalBytes: payload.byteLength,
      lastModified: null,
      source: "native",
      importSessionId: null,
    });
    await beforeRestart.appendUploadChunk({
      familyId: onboarding.familyId,
      uploadId: created.session.id,
      offset: 0,
      contentLength: 13,
      body: Readable.from(payload.subarray(0, 13)),
    });

    closeDatabase();
    vi.resetModules();
    const afterRestart = await import("@/lib/imports/service");
    const recovered = await afterRestart.getUploadSession(
      onboarding.familyId,
      created.session.id,
    );
    expect(recovered.receivedBytes).toBe(13);
    await afterRestart.appendUploadChunk({
      familyId: onboarding.familyId,
      uploadId: created.session.id,
      offset: 13,
      contentLength: payload.byteLength - 13,
      body: Readable.from(payload.subarray(13)),
    });
    await expect(
      afterRestart.completeUpload(onboarding.familyId, created.session.id),
    ).resolves.toMatchObject({ status: "stored", bytes: payload.byteLength });
  });
});
