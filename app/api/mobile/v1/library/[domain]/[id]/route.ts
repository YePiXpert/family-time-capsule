import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { updatePerson } from "@/lib/family/service";
import { addManualParagraph, publishStory, updateStoryTitle } from "@/lib/stories/service";
import { addCapsuleEvent, openCapsule, sealCapsule } from "@/lib/capsules/service";
import { closeContributionRequest } from "@/lib/oral-history/service";
import {
  extendContributionPortal,
  pauseContributionPortal,
  regenerateContributionPortalToken,
  reopenContributionPortal,
  revokeContributionPortal,
} from "@/lib/contribution-portals/service";
import { cancelImportSession, getImportSessionDetail, restartUpload, setImportSessionUploading } from "@/lib/imports/service";
import { UploadServiceError } from "@/lib/imports/service";
import { listPeople } from "@/lib/family/service";
import { asRecord, mobileJson, mobileRequestError, optionalString, readMobileJson } from "@/lib/mobile/http";
import { getMobileLibraryDetail, MOBILE_LIBRARY_DOMAINS, type MobileLibraryDomain } from "@/lib/mobile/library";

function domainOf(value: string): MobileLibraryDomain | null {
  return MOBILE_LIBRARY_DOMAINS.includes(value as MobileLibraryDomain) ? value as MobileLibraryDomain : null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/mobile/v1/library/[domain]/[id]">) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const { domain: rawDomain, id } = await params;
  const domain = domainOf(rawDomain);
  if (!domain) return mobileJson({ error: "not_found" }, { status: 404 });
  const detail = await getMobileLibraryDetail(authorization.context, domain, id);
  return detail ? mobileJson(detail) : mobileJson({ error: "not_found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/mobile/v1/library/[domain]/[id]">) {
  const { domain: rawDomain, id } = await params;
  const domain = domainOf(rawDomain);
  if (!domain) return mobileJson({ error: "not_found" }, { status: 404 });
  const capability = domain === "people" ? "family:manage"
    : domain === "stories" ? "story:write"
      : domain === "capsules" ? "capsule:write"
        : domain === "requests" || domain === "portals" ? "contribution:create"
          : "capture:create";
  const authorization = await authorizeApiFamilyRequest(request.headers, capability);
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    if (Object.hasOwn(body, "familyId")) return mobileJson({ error: "family_id_not_accepted" }, { status: 400 });
    // Resolve through the same family-scoped read model before mutation. This
    // keeps foreign ids indistinguishable from missing ids for every domain.
    if (!(await getMobileLibraryDetail(authorization.context, domain, id))) {
      return mobileJson({ error: "not_found" }, { status: 404 });
    }
    let result: { ok: boolean; error?: string; token?: string } = { ok: false, error: "invalid_operation" };
    if (domain === "people") {
      result = await updatePerson(authorization.context, id, {
        displayName: optionalString(body, "displayName", 50) ?? "",
        relationToChild: optionalString(body, "relationToChild", 20) ?? "",
        birthDate: optionalString(body, "birthDate", 10) ?? "",
      });
    } else if (domain === "stories") {
      const operation = body.operation;
      result = operation === "title" ? updateStoryTitle(authorization.context, id, optionalString(body, "title", 100) ?? "")
        : operation === "paragraph" ? addManualParagraph(authorization.context, id, optionalString(body, "text", 2_000) ?? "")
          : operation === "publish" ? publishStory(authorization.context, id)
            : result;
    } else if (domain === "capsules") {
      const operation = body.operation;
      if (operation === "seal") result = { ok: Boolean(await sealCapsule(authorization.context.familyId, id)), error: "invalid_state" };
      else if (operation === "open") {
        const people = await listPeople(authorization.context.familyId);
        result = await openCapsule(authorization.context.familyId, id, people.find((entry) => entry.isChild)?.birthDate ?? null, authorization.context.familyTimezone);
      } else if (operation === "add_event") {
        // The domain service rechecks that both ids belong to the live family and that the capsule is draft.
        result = { ok: await addCapsuleEvent(authorization.context.familyId, id, optionalString(body, "eventId", 128) ?? ""), error: "not_found" };
      }
    } else if (domain === "requests") {
      result = closeContributionRequest(authorization.context, id);
    } else if (domain === "portals") {
      const operation = body.operation;
      if (operation === "pause") result = pauseContributionPortal(authorization.context, id);
      else if (operation === "reopen") result = reopenContributionPortal(authorization.context, id);
      else if (operation === "revoke") result = revokeContributionPortal(authorization.context, id);
      else if (operation === "extend") result = extendContributionPortal(authorization.context, id, 30);
      else if (operation === "regenerate") result = regenerateContributionPortalToken(authorization.context, id);
    } else if (domain === "imports") {
      const operation = body.operation;
      if (operation === "pause" || operation === "resume") {
        await setImportSessionUploading(authorization.context.familyId, id, operation === "resume");
        result = { ok: true };
      } else if (operation === "cancel") {
        await cancelImportSession(authorization.context.familyId, id);
        result = { ok: true };
      } else if (operation === "retry") {
        const uploadId = optionalString(body, "uploadId", 128) ?? "";
        const detail = await getImportSessionDetail(authorization.context.familyId, id);
        if (!detail?.items.some((entry) => entry.upload?.id === uploadId)) {
          return mobileJson({ error: "not_found" }, { status: 404 });
        }
        await restartUpload(authorization.context.familyId, uploadId);
        result = { ok: true };
      }
    }
    if (!result.ok) return mobileJson({ error: result.error ?? "invalid_operation" }, { status: result.error === "not_found" ? 404 : 400 });
    return mobileJson({ success: true, ...(result.token ? { token: result.token } : {}) });
  } catch (error) {
    if (error instanceof UploadServiceError) {
      return mobileJson({ error: error.code }, { status: error.status });
    }
    return mobileRequestError(error);
  }
}
