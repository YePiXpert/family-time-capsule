import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema/audit";
import { contributionRequest, contributionPortalSubmission } from "@/db/schema/oral-history";
import { family, person } from "@/db/schema/family";
import { importSession, importSessionDefaultParticipant, importSessionItem, uploadSession } from "@/db/schema/import";
import { inboxItem, inboxItemParticipant } from "@/db/schema/inbox";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { requiredAuditValues } from "@/lib/audit/service";
import { classifyDeclaredUpload } from "@/lib/assets/validation";
import { sanitizeDisplayFilename } from "@/lib/assets/service";
import type { FamilyContext } from "@/lib/family/context";
import { createUploadSession, type UploadSessionRow, UploadServiceError } from "@/lib/imports/service";
import { consumeSecurityRateLimit } from "@/lib/security/rate-limit";
import { generateRequestToken, hashRequestToken } from "@/lib/oral-history/service";

export const PORTAL_AUDIT_KINDS = {
  created: "contribution_portal.created",
  paused: "contribution_portal.paused",
  reopened: "contribution_portal.reopened",
  revoked: "contribution_portal.revoked",
  extended: "contribution_portal.extended",
  tokenRotated: "contribution_portal.token_rotated",
  submitted: "contribution_portal.submitted",
} as const;

const MAX_OPEN_PORTALS_PER_FAMILY = 20;
const GUEST_SUBMISSIONS_PER_HOUR = 20;
const INVALID_TOKEN_ATTEMPTS_PER_TEN_MINUTES = 30;
const MAX_GUEST_TEXT_CHARS = 10_000;

export type PortalAssetKind = "image" | "audio" | "video" | "document";

export type PortalFileDeclaration = {
  captureId: string;
  filename: string;
  declaredMime: string;
  totalBytes: number;
  lastModified: Date | null;
  clientFingerprint?: string | null;
};

export type ContributionPortalSummary = {
  id: string;
  title: string;
  description: string;
  recipientPersonId: string | null;
  recipientLabel: string;
  status: "open" | "paused" | "closed";
  expiresAt: Date;
  maxSubmissions: number;
  maxFilesPerSubmission: number;
  allowImages: boolean;
  allowAudio: boolean;
  allowVideo: boolean;
  allowDocuments: boolean;
  allowText: boolean;
  allowBrowserRecording: boolean;
  allowGuestName: boolean;
  allowReuse: boolean;
  submissionCount: number;
  pendingCount: number;
  createdAt: Date;
};

export type PublicContributionPortal = {
  familyName: string;
  title: string;
  description: string;
  recipientLabel: string | null;
  expiresAt: Date;
  maxFilesPerSubmission: number;
  allowImages: boolean;
  allowAudio: boolean;
  allowVideo: boolean;
  allowDocuments: boolean;
  allowText: boolean;
  allowBrowserRecording: boolean;
  allowGuestName: boolean;
};

type PortalRow = typeof contributionRequest.$inferSelect;

function validatePortalInput(input: {
  title: string;
  description: string;
  recipientLabel?: string | null;
  maxSubmissions: number;
  maxFilesPerSubmission: number;
  ttlDays: number;
  allowImages: boolean;
  allowAudio: boolean;
  allowVideo: boolean;
  allowDocuments: boolean;
  allowText: boolean;
}): string | null {
  if (input.title.trim().length < 1 || input.title.trim().length > 100) return "invalid_title";
  if (input.description.trim().length < 1 || input.description.trim().length > 500) return "invalid_description";
  if ((input.recipientLabel?.trim().length ?? 0) > 50) return "invalid_label";
  if (!Number.isInteger(input.maxSubmissions) || input.maxSubmissions < 1 || input.maxSubmissions > 1000) return "invalid_limits";
  if (!Number.isInteger(input.maxFilesPerSubmission) || input.maxFilesPerSubmission < 0 || input.maxFilesPerSubmission > 100) return "invalid_limits";
  if (!Number.isInteger(input.ttlDays) || input.ttlDays < 1 || input.ttlDays > 365) return "invalid_expiry";
  if (!input.allowText && !input.allowImages && !input.allowAudio && !input.allowVideo && !input.allowDocuments) return "nothing_allowed";
  return null;
}

export function createContributionPortal(
  context: FamilyContext,
  input: {
    title: string;
    description: string;
    recipientPersonId?: string | null;
    recipientLabel?: string | null;
    ttlDays: number;
    maxSubmissions: number;
    maxFilesPerSubmission: number;
    allowImages: boolean;
    allowAudio: boolean;
    allowVideo: boolean;
    allowDocuments: boolean;
    allowText: boolean;
    allowBrowserRecording: boolean;
    allowGuestName: boolean;
    allowReuse: boolean;
  },
  now = new Date(),
): { ok: true; portalId: string; token: string; expiresAt: Date } | { ok: false; error: string } {
  try {
    assertFamilyCapability(context.role, "contribution:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const error = validatePortalInput(input);
  if (error) return { ok: false, error };
  const db = getDb();
  let recipientLabel = input.recipientLabel?.trim() || "家人";
  if (input.recipientPersonId) {
    const target = db.select({ displayName: person.displayName, relation: person.relationToChild })
      .from(person)
      .where(and(eq(person.familyId, context.familyId), eq(person.id, input.recipientPersonId)))
      .limit(1)
      .get();
    if (!target) return { ok: false, error: "invalid_person" };
    recipientLabel = input.recipientLabel?.trim() || target.relation || target.displayName;
  }
  const openCount = db.select({ value: count() }).from(contributionRequest)
    .where(and(
      eq(contributionRequest.familyId, context.familyId),
      eq(contributionRequest.kind, "portal"),
      inArray(contributionRequest.status, ["open", "paused"]),
    )).get();
  if (Number(openCount?.value ?? 0) >= MAX_OPEN_PORTALS_PER_FAMILY) {
    return { ok: false, error: "too_many_open" };
  }
  const token = generateRequestToken();
  const portalId = randomUUID();
  const expiresAt = new Date(now.getTime() + input.ttlDays * 86_400_000);
  db.transaction((tx) => {
    tx.insert(contributionRequest).values({
      id: portalId,
      familyId: context.familyId,
      tokenHash: hashRequestToken(token),
      kind: "portal",
      title: input.title.trim(),
      recipientLabel,
      recipientPersonId: input.recipientPersonId ?? null,
      promptText: input.description.trim(),
      topicKey: null,
      status: "open",
      maxSubmissions: input.maxSubmissions,
      maxFilesPerSubmission: input.maxFilesPerSubmission,
      allowImages: input.allowImages,
      allowAudio: input.allowAudio,
      allowVideo: input.allowVideo,
      allowDocuments: input.allowDocuments,
      allowText: input.allowText,
      allowBrowserRecording: input.allowBrowserRecording && input.allowAudio,
      allowGuestName: input.allowGuestName,
      allowReuse: input.allowReuse,
      expiresAt,
      createdByUserId: context.userId,
      createdAt: now,
      updatedAt: now,
    }).run();
    tx.insert(auditLog).values(requiredAuditValues(
      context.familyId,
      PORTAL_AUDIT_KINDS.created,
      context.userId,
      { portalId, expiresAt: expiresAt.toISOString() },
      now,
    )).run();
  });
  return { ok: true, portalId, token, expiresAt };
}

export function listContributionPortals(context: FamilyContext): ContributionPortalSummary[] {
  try {
    assertFamilyCapability(context.role, "contribution:create");
  } catch {
    return [];
  }
  const rows = getDb().select({
    portal: contributionRequest,
    submissionCount: sql<number>`count(${contributionPortalSubmission.id})`,
    pendingCount: sql<number>`sum(case when ${contributionPortalSubmission.status} = 'collecting' then 1 else 0 end)`,
  }).from(contributionRequest)
    .leftJoin(contributionPortalSubmission, eq(contributionPortalSubmission.requestId, contributionRequest.id))
    .where(and(eq(contributionRequest.familyId, context.familyId), eq(contributionRequest.kind, "portal")))
    .groupBy(contributionRequest.id)
    .orderBy(desc(contributionRequest.createdAt))
    .limit(100)
    .all();
  return rows.map(({ portal, submissionCount, pendingCount }) => ({
    id: portal.id,
    title: portal.title ?? "家庭投递箱",
    description: portal.promptText,
    recipientPersonId: portal.recipientPersonId,
    recipientLabel: portal.recipientLabel,
    status: portal.status as ContributionPortalSummary["status"],
    expiresAt: portal.expiresAt,
    maxSubmissions: portal.maxSubmissions,
    maxFilesPerSubmission: portal.maxFilesPerSubmission,
    allowImages: portal.allowImages,
    allowAudio: portal.allowAudio,
    allowVideo: portal.allowVideo,
    allowDocuments: portal.allowDocuments,
    allowText: portal.allowText,
    allowBrowserRecording: portal.allowBrowserRecording,
    allowGuestName: portal.allowGuestName,
    allowReuse: portal.allowReuse,
    submissionCount: Number(submissionCount ?? 0),
    pendingCount: Number(pendingCount ?? 0),
    createdAt: portal.createdAt,
  }));
}

type PortalResolution =
  | { ok: true; portal: PortalRow; publicPortal: PublicContributionPortal }
  | { ok: false; error: "not_found" | "paused" | "closed" | "expired" | "rate_limited" };

function unresolvedPortal(
  token: string,
  subject: string | null,
  now: Date,
): PortalResolution {
  if (subject) {
    const limited = consumeSecurityRateLimit({
      scope: "guest-portal-lookup",
      subject,
      limit: INVALID_TOKEN_ATTEMPTS_PER_TEN_MINUTES,
      windowMs: 10 * 60 * 1000,
      now,
    });
    if (!limited.allowed) return { ok: false, error: "rate_limited" };
  }
  void token;
  return { ok: false, error: "not_found" };
}

export function resolveContributionPortal(
  token: string,
  invalidLookupSubject: string | null = null,
  now = new Date(),
): PortalResolution {
  if (typeof token !== "string" || token.length < 20 || token.length > 128) {
    return unresolvedPortal(token, invalidLookupSubject, now);
  }
  const row = getDb().select({ portal: contributionRequest, familyName: family.name })
    .from(contributionRequest)
    .innerJoin(family, eq(family.id, contributionRequest.familyId))
    .where(and(
      eq(contributionRequest.kind, "portal"),
      eq(contributionRequest.tokenHash, hashRequestToken(token)),
    ))
    .limit(1)
    .get();
  if (!row) return unresolvedPortal(token, invalidLookupSubject, now);
  if (row.portal.status === "paused") return { ok: false, error: "paused" };
  if (row.portal.status === "closed") return { ok: false, error: "closed" };
  if (row.portal.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expired" };
  return {
    ok: true,
    portal: row.portal,
    publicPortal: {
      familyName: row.familyName,
      title: row.portal.title ?? "家庭投递箱",
      description: row.portal.promptText,
      recipientLabel: row.portal.recipientPersonId ? row.portal.recipientLabel : null,
      expiresAt: row.portal.expiresAt,
      maxFilesPerSubmission: row.portal.maxFilesPerSubmission,
      allowImages: row.portal.allowImages,
      allowAudio: row.portal.allowAudio,
      allowVideo: row.portal.allowVideo,
      allowDocuments: row.portal.allowDocuments,
      allowText: row.portal.allowText,
      allowBrowserRecording: row.portal.allowBrowserRecording,
      allowGuestName: row.portal.allowGuestName,
    },
  };
}

function assetKindAllowed(portal: PortalRow, kind: PortalAssetKind): boolean {
  return kind === "image" ? portal.allowImages
    : kind === "audio" ? portal.allowAudio
      : kind === "video" ? portal.allowVideo
        : portal.allowDocuments;
}

function validatePortalFile(portal: PortalRow, file: PortalFileDeclaration): string | null {
  const classification = classifyDeclaredUpload(file.declaredMime);
  if (!classification || !assetKindAllowed(portal, classification.type)) return "mime_not_allowed";
  if (!Number.isSafeInteger(file.totalBytes) || file.totalBytes <= 0 || file.totalBytes > classification.maxBytes) {
    return "too_large";
  }
  return null;
}

export type PortalUploadDescriptor = {
  captureId: string;
  uploadId: string;
  uploadOffset: number;
  chunkSize: number;
  expiresAt: string;
};

export async function createPortalSubmission(
  token: string,
  input: { guestDisplayName?: string | null; text?: string | null; files: PortalFileDeclaration[] },
  invalidLookupSubject: string | null,
  now = new Date(),
): Promise<
  | { ok: true; submissionId: string; uploads: PortalUploadDescriptor[]; failedCaptureIds: string[] }
  | { ok: false; error: string }
> {
  const resolved = resolveContributionPortal(token, invalidLookupSubject, now);
  if (!resolved.ok) return resolved;
  const portal = resolved.portal;
  const guestDisplayName = input.guestDisplayName?.trim() || null;
  const text = input.text?.trim() || null;
  if (guestDisplayName && (!portal.allowGuestName || guestDisplayName.length > 50)) {
    return { ok: false, error: "invalid_guest_name" };
  }
  if (text && (!portal.allowText || text.length > MAX_GUEST_TEXT_CHARS)) {
    return { ok: false, error: "invalid_text" };
  }
  if (!Array.isArray(input.files) || input.files.length > portal.maxFilesPerSubmission) {
    return { ok: false, error: "too_many_files" };
  }
  if (!text && input.files.length === 0) return { ok: false, error: "empty_submission" };
  const captureIds = new Set<string>();
  for (const file of input.files) {
    if (captureIds.has(file.captureId)) return { ok: false, error: "duplicate_capture_id" };
    captureIds.add(file.captureId);
    const fileError = validatePortalFile(portal, file);
    if (fileError) return { ok: false, error: fileError };
  }
  const submissionLimit = consumeSecurityRateLimit({
    scope: "guest-portal-submit",
    subject: `${portal.id}\0${invalidLookupSubject ?? "unknown"}`,
    limit: GUEST_SUBMISSIONS_PER_HOUR,
    windowMs: 60 * 60 * 1000,
    now,
  });
  if (!submissionLimit.allowed) return { ok: false, error: "rate_limited" };

  const submissionId = randomUUID();
  const importSessionId = randomUUID();
  const textCaptureId = text ? randomUUID() : null;
  try {
    getDb().transaction((tx) => {
      const live = tx.select().from(contributionRequest)
        .where(and(eq(contributionRequest.id, portal.id), eq(contributionRequest.tokenHash, hashRequestToken(token))))
        .limit(1).get();
      if (!live || live.status !== "open" || live.expiresAt.getTime() <= now.getTime()) {
        throw new UploadServiceError("not_found", 404);
      }
      const used = tx.select({ value: count() }).from(contributionPortalSubmission)
        .where(eq(contributionPortalSubmission.requestId, portal.id)).get();
      if (Number(used?.value ?? 0) >= live.maxSubmissions) {
        throw new UploadServiceError("submission_limit", 429);
      }
      tx.insert(importSession).values({
        id: importSessionId,
        familyId: portal.familyId,
        source: "guest",
        status: input.files.length > 0 ? "uploading" : "reviewing",
        totalCount: input.files.length + (text ? 1 : 0),
        completedCount: text ? 1 : 0,
        failedCount: 0,
        defaultTitle: portal.title,
        createdByUserId: null,
        createdAt: now,
        updatedAt: now,
      }).run();
      if (portal.recipientPersonId) {
        tx.insert(importSessionDefaultParticipant).values({
          id: randomUUID(), familyId: portal.familyId, importSessionId,
          personId: portal.recipientPersonId, createdAt: now,
        }).run();
      }
      tx.insert(contributionPortalSubmission).values({
        id: submissionId,
        familyId: portal.familyId,
        requestId: portal.id,
        importSessionId,
        guestDisplayName,
        status: "collecting",
        createdAt: now,
      }).run();
      if (text && textCaptureId) {
        tx.insert(inboxItem).values({
          id: textCaptureId,
          familyId: portal.familyId,
          kind: "text",
          status: "new",
          rawText: text,
          draftTitle: portal.title,
          createdAt: now,
          updatedAt: now,
        }).run();
        if (portal.recipientPersonId) {
          tx.insert(inboxItemParticipant).values({
            id: randomUUID(), inboxItemId: textCaptureId, personId: portal.recipientPersonId,
            familyId: portal.familyId, createdAt: now,
          }).run();
        }
        tx.insert(importSessionItem).values({
          id: randomUUID(), familyId: portal.familyId, importSessionId,
          captureId: textCaptureId, inboxItemId: textCaptureId,
          status: "completed", sortOrder: 0, createdAt: now, updatedAt: now,
        }).run();
      }
      if (input.files.length > 0) {
        tx.insert(importSessionItem).values(input.files.map((file, index) => ({
          id: randomUUID(), familyId: portal.familyId, importSessionId,
          captureId: file.captureId,
          filename: sanitizeDisplayFilename(file.filename),
          declaredMime: classifyDeclaredUpload(file.declaredMime)!.mimeType,
          totalBytes: file.totalBytes,
          lastModified: file.lastModified,
          clientFingerprint: file.clientFingerprint ?? null,
          status: "pending" as const,
          sortOrder: index + (text ? 1 : 0), createdAt: now, updatedAt: now,
        }))).run();
      }
    });
  } catch (error) {
    if (error instanceof UploadServiceError) return { ok: false, error: error.code };
    throw error;
  }

  const uploads: PortalUploadDescriptor[] = [];
  const failedCaptureIds: string[] = [];
  for (const file of input.files) {
    try {
      const created = await createUploadSession({
        familyId: portal.familyId,
        // Asset attribution remains a real family account; the visitor never
        // receives or impersonates this identity and the bundle records guest provenance.
        userId: portal.createdByUserId,
        captureId: file.captureId,
        filename: file.filename,
        declaredMime: file.declaredMime,
        totalBytes: file.totalBytes,
        lastModified: file.lastModified,
        source: "guest",
        importSessionId,
        clientFingerprint: file.clientFingerprint ?? null,
      });
      uploads.push({
        captureId: file.captureId,
        uploadId: created.session.id,
        uploadOffset: created.session.receivedBytes,
        chunkSize: 8 * 1024 * 1024,
        expiresAt: created.session.expiresAt.toISOString(),
      });
    } catch (error) {
      const errorCode = error instanceof UploadServiceError ? error.code : "upload_setup_failed";
      getDb().transaction((tx) => {
        const item = tx.select({ id: importSessionItem.id, status: importSessionItem.status })
          .from(importSessionItem).where(and(
            eq(importSessionItem.importSessionId, importSessionId),
            eq(importSessionItem.captureId, file.captureId),
          )).limit(1).get();
        if (item && item.status !== "failed") {
          tx.update(importSessionItem).set({ status: "failed", errorCode, updatedAt: now })
            .where(eq(importSessionItem.id, item.id)).run();
          tx.update(importSession).set({
            failedCount: sql`${importSession.failedCount} + 1`, updatedAt: now,
          }).where(eq(importSession.id, importSessionId)).run();
        }
      });
      failedCaptureIds.push(file.captureId);
    }
  }
  return { ok: true, submissionId, uploads, failedCaptureIds };
}

/** Retry creation of a transfer that was durably declared in a guest bundle. */
export async function createPortalSubmissionUpload(
  token: string,
  submissionId: string,
  file: PortalFileDeclaration,
  invalidLookupSubject: string | null,
  now = new Date(),
): Promise<{ ok: true; upload: PortalUploadDescriptor } | { ok: false; error: string }> {
  const resolved = resolveContributionPortal(token, invalidLookupSubject, now);
  if (!resolved.ok) return resolved;
  const fileError = validatePortalFile(resolved.portal, file);
  if (fileError) return { ok: false, error: fileError };
  const declared = getDb().select({
    submission: contributionPortalSubmission,
    item: importSessionItem,
    upload: uploadSession,
  }).from(contributionPortalSubmission)
    .innerJoin(importSessionItem, eq(importSessionItem.importSessionId, contributionPortalSubmission.importSessionId))
    .leftJoin(uploadSession, eq(uploadSession.id, importSessionItem.uploadSessionId))
    .where(and(
      eq(contributionPortalSubmission.id, submissionId),
      eq(contributionPortalSubmission.requestId, resolved.portal.id),
      eq(contributionPortalSubmission.familyId, resolved.portal.familyId),
      eq(contributionPortalSubmission.status, "collecting"),
      eq(importSessionItem.captureId, file.captureId),
    )).limit(1).get();
  if (!declared) return { ok: false, error: "not_found" };
  if (declared.upload) {
    return { ok: true, upload: {
      captureId: file.captureId,
      uploadId: declared.upload.id,
      uploadOffset: declared.upload.receivedBytes,
      chunkSize: 8 * 1024 * 1024,
      expiresAt: declared.upload.expiresAt.toISOString(),
    } };
  }
  try {
    const created = await createUploadSession({
      familyId: resolved.portal.familyId,
      userId: resolved.portal.createdByUserId,
      captureId: file.captureId,
      filename: file.filename,
      declaredMime: file.declaredMime,
      totalBytes: file.totalBytes,
      lastModified: file.lastModified,
      source: "guest",
      importSessionId: declared.submission.importSessionId,
      clientFingerprint: file.clientFingerprint ?? null,
    });
    return { ok: true, upload: {
      captureId: file.captureId,
      uploadId: created.session.id,
      uploadOffset: created.session.receivedBytes,
      chunkSize: 8 * 1024 * 1024,
      expiresAt: created.session.expiresAt.toISOString(),
    } };
  } catch (error) {
    return { ok: false, error: error instanceof UploadServiceError ? error.code : "upload_setup_failed" };
  }
}

export function authorizePortalUpload(
  token: string,
  uploadId: string,
  invalidLookupSubject: string | null,
  now = new Date(),
): { ok: true; familyId: string; session: UploadSessionRow } | { ok: false; error: string } {
  const resolved = resolveContributionPortal(token, invalidLookupSubject, now);
  if (!resolved.ok) return resolved;
  const row = getDb().select({ upload: uploadSession })
    .from(uploadSession)
    .innerJoin(contributionPortalSubmission, eq(contributionPortalSubmission.importSessionId, uploadSession.importSessionId))
    .where(and(
      eq(uploadSession.id, uploadId),
      eq(uploadSession.familyId, resolved.portal.familyId),
      eq(uploadSession.source, "guest"),
      eq(contributionPortalSubmission.requestId, resolved.portal.id),
    )).limit(1).get();
  return row ? { ok: true, familyId: resolved.portal.familyId, session: row.upload }
    : { ok: false, error: "not_found" };
}

export function completePortalSubmission(
  token: string,
  submissionId: string,
  invalidLookupSubject: string | null,
  now = new Date(),
): { ok: true } | { ok: false; error: string } {
  const resolved = resolveContributionPortal(token, invalidLookupSubject, now);
  if (!resolved.ok) {
    if (resolved.error === "closed" && typeof token === "string" && token.length >= 20 && token.length <= 128) {
      const completed = getDb().select({ id: contributionPortalSubmission.id })
        .from(contributionPortalSubmission)
        .innerJoin(contributionRequest, eq(contributionRequest.id, contributionPortalSubmission.requestId))
        .where(and(
          eq(contributionRequest.kind, "portal"),
          eq(contributionRequest.tokenHash, hashRequestToken(token)),
          eq(contributionPortalSubmission.id, submissionId),
          eq(contributionPortalSubmission.status, "completed"),
        )).limit(1).get();
      if (completed) return { ok: true };
    }
    return resolved;
  }
  try {
    getDb().transaction((tx) => {
      const submission = tx.select().from(contributionPortalSubmission).where(and(
        eq(contributionPortalSubmission.id, submissionId),
        eq(contributionPortalSubmission.requestId, resolved.portal.id),
        eq(contributionPortalSubmission.familyId, resolved.portal.familyId),
      )).limit(1).get();
      if (!submission) throw new UploadServiceError("not_found", 404);
      if (submission.status === "completed") return;
      const incomplete = tx.select({ value: count() }).from(importSessionItem).where(and(
        eq(importSessionItem.importSessionId, submission.importSessionId),
        inArray(importSessionItem.status, ["pending", "uploading", "failed", "cancelled"]),
      )).get();
      if (Number(incomplete?.value ?? 0) > 0) throw new UploadServiceError("upload_incomplete", 409);
      tx.update(contributionPortalSubmission).set({ status: "completed", completedAt: now })
        .where(eq(contributionPortalSubmission.id, submission.id)).run();
      tx.update(importSession).set({ status: "reviewing", updatedAt: now })
        .where(eq(importSession.id, submission.importSessionId)).run();
      if (!resolved.portal.allowReuse) {
        tx.update(contributionRequest).set({
          status: "closed", closedAt: now, closedByUserId: null, updatedAt: now,
        }).where(eq(contributionRequest.id, resolved.portal.id)).run();
      }
      tx.insert(auditLog).values({
        id: randomUUID(), familyId: resolved.portal.familyId,
        kind: PORTAL_AUDIT_KINDS.submitted, actorUserId: null,
        detailJson: JSON.stringify({ portalId: resolved.portal.id, submissionId }),
        createdAt: now,
      }).run();
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof UploadServiceError) return { ok: false, error: error.code };
    throw error;
  }
}

function updatePortalState(
  context: FamilyContext,
  portalId: string,
  status: "open" | "paused" | "closed",
  auditKind: string,
  now = new Date(),
): { ok: true } | { ok: false; error: string } {
  try { assertFamilyCapability(context.role, "contribution:create"); }
  catch { return { ok: false, error: "forbidden" }; }
  const changed = getDb().transaction((tx) => {
    const row = tx.select({ id: contributionRequest.id, status: contributionRequest.status }).from(contributionRequest).where(and(
      eq(contributionRequest.id, portalId), eq(contributionRequest.familyId, context.familyId),
      eq(contributionRequest.kind, "portal"),
    )).limit(1).get();
    if (!row) return false;
    if ((status === "paused" && row.status !== "open") || (status === "open" && row.status !== "paused")) {
      return false;
    }
    tx.update(contributionRequest).set({
      status,
      closedAt: status === "closed" ? now : null,
      closedByUserId: status === "closed" ? context.userId : null,
      updatedAt: now,
    }).where(eq(contributionRequest.id, portalId)).run();
    tx.insert(auditLog).values(requiredAuditValues(
      context.familyId, auditKind, context.userId, { portalId }, now,
    )).run();
    return true;
  });
  return changed ? { ok: true } : { ok: false, error: "not_found" };
}

export const pauseContributionPortal = (context: FamilyContext, id: string) =>
  updatePortalState(context, id, "paused", PORTAL_AUDIT_KINDS.paused);
export const reopenContributionPortal = (context: FamilyContext, id: string) =>
  updatePortalState(context, id, "open", PORTAL_AUDIT_KINDS.reopened);
export const revokeContributionPortal = (context: FamilyContext, id: string) =>
  updatePortalState(context, id, "closed", PORTAL_AUDIT_KINDS.revoked);

export function extendContributionPortal(
  context: FamilyContext,
  portalId: string,
  days: number,
  now = new Date(),
): { ok: true; expiresAt: Date } | { ok: false; error: string } {
  try { assertFamilyCapability(context.role, "contribution:create"); }
  catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: "invalid_expiry" };
  const result = getDb().transaction((tx) => {
    const row = tx.select().from(contributionRequest).where(and(
      eq(contributionRequest.id, portalId), eq(contributionRequest.familyId, context.familyId),
      eq(contributionRequest.kind, "portal"),
    )).limit(1).get();
    if (!row) return null;
    const expiresAt = new Date(Math.max(now.getTime(), row.expiresAt.getTime()) + days * 86_400_000);
    tx.update(contributionRequest).set({ expiresAt, updatedAt: now })
      .where(eq(contributionRequest.id, portalId)).run();
    tx.insert(auditLog).values(requiredAuditValues(
      context.familyId, PORTAL_AUDIT_KINDS.extended, context.userId,
      { portalId, expiresAt: expiresAt.toISOString() }, now,
    )).run();
    return expiresAt;
  });
  return result ? { ok: true, expiresAt: result } : { ok: false, error: "not_found" };
}

export function regenerateContributionPortalToken(
  context: FamilyContext,
  portalId: string,
  now = new Date(),
): { ok: true; token: string } | { ok: false; error: string } {
  try { assertFamilyCapability(context.role, "contribution:create"); }
  catch { return { ok: false, error: "forbidden" }; }
  const token = generateRequestToken();
  const changed = getDb().transaction((tx) => {
    const row = tx.select({ id: contributionRequest.id }).from(contributionRequest).where(and(
      eq(contributionRequest.id, portalId), eq(contributionRequest.familyId, context.familyId),
      eq(contributionRequest.kind, "portal"),
    )).limit(1).get();
    if (!row) return false;
    tx.update(contributionRequest).set({
      tokenHash: hashRequestToken(token), status: "open", closedAt: null,
      closedByUserId: null, updatedAt: now,
    }).where(eq(contributionRequest.id, portalId)).run();
    tx.insert(auditLog).values(requiredAuditValues(
      context.familyId, PORTAL_AUDIT_KINDS.tokenRotated, context.userId,
      { portalId }, now,
    )).run();
    return true;
  });
  return changed ? { ok: true, token } : { ok: false, error: "not_found" };
}

export function listPortalSubmissionBundles(
  context: FamilyContext,
  portalId?: string,
): Array<{ id: string; portalId: string; guestDisplayName: string | null; status: string; createdAt: Date; importSessionId: string }> {
  try { assertFamilyCapability(context.role, "contribution:create"); }
  catch { return []; }
  return getDb().select({
    id: contributionPortalSubmission.id,
    portalId: contributionPortalSubmission.requestId,
    guestDisplayName: contributionPortalSubmission.guestDisplayName,
    status: contributionPortalSubmission.status,
    createdAt: contributionPortalSubmission.createdAt,
    importSessionId: contributionPortalSubmission.importSessionId,
  }).from(contributionPortalSubmission).innerJoin(
    contributionRequest, eq(contributionRequest.id, contributionPortalSubmission.requestId),
  ).where(and(
    eq(contributionPortalSubmission.familyId, context.familyId),
    eq(contributionRequest.familyId, context.familyId),
    eq(contributionRequest.kind, "portal"),
    ...(portalId ? [eq(contributionPortalSubmission.requestId, portalId)] : []),
  )).orderBy(desc(contributionPortalSubmission.createdAt), asc(contributionPortalSubmission.id)).limit(100).all();
}
