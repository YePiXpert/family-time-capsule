import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-contribution-portals-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "portal-setup-token";
process.env.AUTH_SECRET = "portal-test-secret-with-enough-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { auditLog } = await import("@/db/schema/audit");
const { asset } = await import("@/db/schema/asset");
const { inboxItem } = await import("@/db/schema/inbox");
const { importSession, importSessionItem, uploadSession } = await import("@/db/schema/import");
const { rateLimit } = await import("@/db/schema/auth");
const { contributionRequest, contributionPortalSubmission } = await import("@/db/schema/oral-history");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { hashRequestToken } = await import("@/lib/oral-history/service");
const {
  authorizePortalUpload,
  completePortalSubmission,
  createContributionPortal,
  createPortalSubmissionUpload,
  createPortalSubmission,
  extendContributionPortal,
  listContributionPortals,
  pauseContributionPortal,
  regenerateContributionPortalToken,
  reopenContributionPortal,
  resolveContributionPortal,
  revokeContributionPortal,
} = await import("@/lib/contribution-portals/service");
const { appendUploadChunk, completeUpload } = await import("@/lib/imports/service");

const setup = await performSetup({
  token: "portal-setup-token",
  displayName: "妈妈",
  email: "portal@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select().from(user).get();
if (!admin) throw new Error("admin missing");
const onboarding = await completeOnboarding(admin.id, {
  familyName: "小满家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const binding = await getUserBinding(admin.id);
if (!binding.personId || !binding.familyTimezone || binding.childLaterUnlockAge === null) {
  throw new Error("binding missing");
}
const context: FamilyContext = {
  userId: admin.id,
  userName: "妈妈",
  familyId: onboarding.familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone,
  childLaterUnlockAge: binding.childLaterUnlockAge,
};

function portal(overrides: Partial<Parameters<typeof createContributionPortal>[1]> = {}) {
  return createContributionPortal(context, {
    title: "满月照片收集",
    description: "请大家留下今天的照片、声音或一段话。",
    ttlDays: 30,
    maxSubmissions: 10,
    maxFilesPerSubmission: 5,
    allowImages: true,
    allowAudio: true,
    allowVideo: true,
    allowDocuments: true,
    allowText: true,
    allowBrowserRecording: true,
    allowGuestName: true,
    allowReuse: true,
    ...overrides,
  });
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("private family contribution portals", () => {
  it("stores only the token hash, exposes a minimal public DTO, and audits creation", () => {
    const created = portal();
    if (!created.ok) throw new Error(created.error);
    expect(created.token).toHaveLength(43);
    const row = getDb().select().from(contributionRequest)
      .where(eq(contributionRequest.id, created.portalId)).get();
    expect(row?.tokenHash).toBe(hashRequestToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);
    const resolved = resolveContributionPortal(created.token);
    expect(resolved.ok && resolved.publicPortal).toMatchObject({
      familyName: "小满家",
      title: "满月照片收集",
      allowDocuments: true,
    });
    if (resolved.ok) {
      expect(resolved.publicPortal).not.toHaveProperty("familyId");
      expect(resolved.publicPortal).not.toHaveProperty("createdByUserId");
    }
    expect(getDb().select().from(auditLog)
      .where(eq(auditLog.kind, "contribution_portal.created")).all()).toHaveLength(1);
  });

  it("pauses, extends, rotates and revokes the same hardened bearer token", () => {
    const created = portal({ title: "旧照片征集" });
    if (!created.ok) throw new Error(created.error);
    expect(pauseContributionPortal(context, created.portalId)).toEqual({ ok: true });
    expect(resolveContributionPortal(created.token)).toEqual({ ok: false, error: "paused" });
    expect(reopenContributionPortal(context, created.portalId)).toEqual({ ok: true });
    expect(resolveContributionPortal(created.token).ok).toBe(true);
    expect(extendContributionPortal(context, created.portalId, 30).ok).toBe(true);
    const rotated = regenerateContributionPortalToken(context, created.portalId);
    if (!rotated.ok) throw new Error(rotated.error);
    expect(resolveContributionPortal(created.token)).toEqual({ ok: false, error: "not_found" });
    expect(resolveContributionPortal(rotated.token).ok).toBe(true);
    expect(revokeContributionPortal(context, created.portalId)).toEqual({ ok: true });
    expect(resolveContributionPortal(rotated.token)).toEqual({ ok: false, error: "closed" });
    expect(reopenContributionPortal(context, created.portalId)).toEqual({ ok: false, error: "not_found" });
  });

  it("keeps one-shot submission completion idempotent after the portal closes", async () => {
    const created = portal({ allowReuse: false });
    if (!created.ok) throw new Error(created.error);
    const submission = await createPortalSubmission(created.token, { text: "只投递一次", files: [] }, "guest-once");
    if (!submission.ok) throw new Error(submission.error);
    expect(completePortalSubmission(created.token, submission.submissionId, "guest-once")).toEqual({ ok: true });
    expect(resolveContributionPortal(created.token)).toEqual({ ok: false, error: "closed" });
    expect(completePortalSubmission(created.token, submission.submissionId, "guest-once")).toEqual({ ok: true });
  });

  it("creates one guest ImportSession bundle and streams every original into Inbox", async () => {
    const created = portal({ recipientPersonId: binding.personId });
    if (!created.ok) throw new Error(created.error);
    const captureId = randomUUID();
    const submission = await createPortalSubmission(created.token, {
      guestDisplayName: "外婆",
      text: "今天大家一起拍了满月照。",
      files: [{
        captureId,
        filename: "full-moon.png",
        declaredMime: "image/png",
        totalBytes: PNG.byteLength,
        lastModified: null,
      }],
    }, "guest-a");
    if (!submission.ok) throw new Error(submission.error);
    expect(submission.uploads).toHaveLength(1);
    expect(submission.failedCaptureIds).toEqual([]);
    expect(completePortalSubmission(created.token, submission.submissionId, "guest-a"))
      .toEqual({ ok: false, error: "upload_incomplete" });
    const descriptor = submission.uploads[0];
    await appendUploadChunk({
      familyId: context.familyId,
      uploadId: descriptor.uploadId,
      offset: 0,
      contentLength: PNG.byteLength,
      body: (await import("node:stream")).Readable.from(PNG),
    });
    const completed = await completeUpload(context.familyId, descriptor.uploadId);
    expect(completed.inboxItemId).toBe(captureId);
    expect(completePortalSubmission(created.token, submission.submissionId, "guest-a")).toEqual({ ok: true });
    expect(completePortalSubmission(created.token, submission.submissionId, "guest-a")).toEqual({ ok: true });

    const bundle = getDb().select().from(contributionPortalSubmission)
      .where(eq(contributionPortalSubmission.id, submission.submissionId)).get();
    expect(bundle).toMatchObject({ guestDisplayName: "外婆", status: "completed" });
    const session = getDb().select().from(importSession)
      .where(eq(importSession.id, bundle!.importSessionId)).get();
    expect(session).toMatchObject({ source: "guest", status: "reviewing", totalCount: 2, completedCount: 2 });
    expect(getDb().select().from(importSessionItem)
      .where(eq(importSessionItem.importSessionId, bundle!.importSessionId)).all()).toHaveLength(2);
    expect(getDb().select().from(inboxItem)
      .where(eq(inboxItem.familyId, context.familyId)).all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rawText: "今天大家一起拍了满月照。", status: "new" }),
          expect.objectContaining({ id: captureId, kind: "asset" }),
        ]),
      );
    expect(getDb().select().from(asset).where(eq(asset.id, completed.assetId)).all()).toHaveLength(1);
    expect(listContributionPortals(context).find((entry) => entry.id === created.portalId)?.submissionCount).toBe(1);
  });

  it("reuses a durable declaration when transfer setup is retried", async () => {
    const created = portal();
    if (!created.ok) throw new Error(created.error);
    const captureId = randomUUID();
    const submission = await createPortalSubmission(created.token, {
      files: [{ captureId, filename: "retry.png", declaredMime: "image/png", totalBytes: PNG.byteLength, lastModified: null }],
    }, "guest-retry");
    if (!submission.ok) throw new Error(submission.error);
    const first = submission.uploads[0];
    expect(first).toBeDefined();
    const bundle = getDb().select().from(contributionPortalSubmission)
      .where(eq(contributionPortalSubmission.id, submission.submissionId)).get()!;
    getDb().delete(uploadSession).where(eq(uploadSession.id, first.uploadId)).run();
    getDb().update(importSessionItem).set({ status: "failed", errorCode: "upload_setup_failed" })
      .where(eq(importSessionItem.captureId, captureId)).run();
    getDb().update(importSession).set({ failedCount: 1 })
      .where(eq(importSession.id, bundle.importSessionId)).run();
    expect(await createPortalSubmissionUpload(created.token, submission.submissionId, {
      captureId, filename: "different.png", declaredMime: "image/png", totalBytes: PNG.byteLength, lastModified: null,
    }, "guest-retry")).toEqual({ ok: false, error: "capture_id_conflict" });
    const repeated = await createPortalSubmissionUpload(created.token, submission.submissionId, {
      captureId, filename: "retry.png", declaredMime: "image/png", totalBytes: PNG.byteLength, lastModified: null,
    }, "guest-retry");
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) throw new Error(repeated.error);
    expect(repeated.upload.uploadId).not.toBe(first.uploadId);
    expect(getDb().select().from(importSessionItem).where(eq(importSessionItem.captureId, captureId)).all())
      .toHaveLength(1);
    expect(getDb().select().from(importSession).where(eq(importSession.id, bundle.importSessionId)).get()?.failedCount)
      .toBe(0);
  });

  it("one-way hashes anonymous abuse-control subjects", () => {
    const subject = "198.51.100.44\0browser-with-private-details";
    expect(resolveContributionPortal("definitely-invalid-token", subject))
      .toEqual({ ok: false, error: "not_found" });
    const rows = getDb().select().from(rateLimit)
      .where(eq(rateLimit.key, `ftc:guest-portal-lookup:${subject}`)).all();
    expect(rows).toEqual([]);
    const serialized = JSON.stringify(getDb().select().from(rateLimit).all());
    expect(serialized).not.toContain(subject);
    expect(serialized).not.toContain("definitely-invalid-token");
  });

  it("enforces file/type/submission limits and fails foreign upload ids as not found", async () => {
    const created = portal({ maxSubmissions: 1, maxFilesPerSubmission: 1, allowVideo: false, allowDocuments: false });
    if (!created.ok) throw new Error(created.error);
    const tooMany = await createPortalSubmission(created.token, {
      files: [1, 2].map((index) => ({
        captureId: randomUUID(), filename: `${index}.png`, declaredMime: "image/png",
        totalBytes: PNG.byteLength, lastModified: null,
      })),
    }, "guest-b");
    expect(tooMany).toEqual({ ok: false, error: "too_many_files" });
    const masked = await createPortalSubmission(created.token, {
      files: [{ captureId: randomUUID(), filename: "bad.mp4", declaredMime: "video/mp4", totalBytes: 20, lastModified: null }],
    }, "guest-b");
    expect(masked).toEqual({ ok: false, error: "mime_not_allowed" });
    const accepted = await createPortalSubmission(created.token, { text: "第一份", files: [] }, "guest-b");
    expect(accepted.ok).toBe(true);
    const overLimit = await createPortalSubmission(created.token, { text: "第二份", files: [] }, "guest-b");
    expect(overLimit).toEqual({ ok: false, error: "submission_limit" });
    expect(authorizePortalUpload(created.token, randomUUID(), "guest-b")).toEqual({ ok: false, error: "not_found" });
  });

  it("does not mix oral-history requests into portal lists or portal tokens into requests", () => {
    const created = portal({ title: "隔离测试" });
    if (!created.ok) throw new Error(created.error);
    const rows = getDb().select().from(contributionRequest).where(and(
      eq(contributionRequest.id, created.portalId), eq(contributionRequest.kind, "portal"),
    )).all();
    expect(rows).toHaveLength(1);
    expect(listContributionPortals(context).some((entry) => entry.id === created.portalId)).toBe(true);
  });
});
