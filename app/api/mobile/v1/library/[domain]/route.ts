import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { addPerson } from "@/lib/family/service";
import {
  collectStoryMaterial,
  collectTranscriptMaterial,
  createStoryDraft,
  periodForKind,
  planDeterministicDraft,
} from "@/lib/stories/service";
import { createCapsule, type UnlockType } from "@/lib/capsules/service";
import { createContributionRequest } from "@/lib/oral-history/service";
import { createContributionPortal } from "@/lib/contribution-portals/service";
import { asRecord, mobileJson, mobileRequestError, optionalString, readMobileJson } from "@/lib/mobile/http";
import { getMobileLibraryPage, MOBILE_LIBRARY_DOMAINS, type MobileLibraryDomain } from "@/lib/mobile/library";

function domainOf(value: string): MobileLibraryDomain | null {
  return MOBILE_LIBRARY_DOMAINS.includes(value as MobileLibraryDomain) ? value as MobileLibraryDomain : null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/mobile/v1/library/[domain]">) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const domain = domainOf((await params).domain);
  if (!domain) return mobileJson({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 25;
  return mobileJson(await getMobileLibraryPage(authorization.context, domain, url.searchParams.get("cursor"), limit));
}

export async function POST(request: Request, { params }: RouteContext<"/api/mobile/v1/library/[domain]">) {
  const domain = domainOf((await params).domain);
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
    if (domain === "people") {
      const result = await addPerson(authorization.context.familyId, {
        displayName: optionalString(body, "displayName", 50) ?? "",
        relationToChild: optionalString(body, "relationToChild", 20) ?? "",
        birthDate: optionalString(body, "birthDate", 10) ?? "",
      });
      return result.ok ? mobileJson({ id: result.personId }, { status: 201 }) : mobileJson({ error: result.error }, { status: 400 });
    }
    if (domain === "stories") {
      const anchor = new Date(optionalString(body, "anchor", 32) ?? "");
      if (Number.isNaN(anchor.getTime())) return mobileJson({ error: "invalid_input" }, { status: 400 });
      const period = periodForKind("weekly", anchor);
      const material = collectStoryMaterial(authorization.context.familyId, period);
      const transcripts = collectTranscriptMaterial(authorization.context.familyId, period);
      const result = createStoryDraft(authorization.context, { kind: "weekly", anchor }, planDeterministicDraft(material, transcripts));
      return result.ok ? mobileJson({ id: result.storyId }, { status: 201 }) : mobileJson({ error: result.error }, { status: 400 });
    }
    if (domain === "capsules") {
      const unlockType = optionalString(body, "unlockType", 8) as UnlockType | null;
      const result = await createCapsule(authorization.context.familyId, {
        title: optionalString(body, "title", 100) ?? "",
        unlockType: unlockType === "age" ? "age" : "date",
        unlockValue: optionalString(body, "unlockValue", 20) ?? "",
      });
      return result.ok ? mobileJson({ id: result.capsuleId }, { status: 201 }) : mobileJson({ error: result.error }, { status: 400 });
    }
    if (domain === "requests") {
      const result = createContributionRequest(authorization.context, {
        recipientLabel: optionalString(body, "recipientLabel", 50) ?? "",
        promptText: optionalString(body, "promptText", 500) ?? "",
        recipientPersonId: optionalString(body, "recipientPersonId", 128) ?? null,
      });
      return result.ok ? mobileJson({ id: result.requestId, token: result.token, expiresAt: result.expiresAt.toISOString() }, { status: 201 }) : mobileJson({ error: result.error }, { status: 400 });
    }
    if (domain === "portals") {
      const result = createContributionPortal(authorization.context, {
        title: optionalString(body, "title", 100) ?? "",
        description: optionalString(body, "description", 500) ?? "",
        recipientPersonId: optionalString(body, "recipientPersonId", 128) ?? null,
        ttlDays: 30,
        maxSubmissions: 20,
        maxFilesPerSubmission: 10,
        allowImages: true,
        allowAudio: true,
        allowVideo: true,
        allowDocuments: true,
        allowText: true,
        allowBrowserRecording: true,
        allowGuestName: true,
        allowReuse: true,
      });
      return result.ok ? mobileJson({ id: result.portalId, token: result.token, expiresAt: result.expiresAt.toISOString() }, { status: 201 }) : mobileJson({ error: result.error }, { status: 400 });
    }
    return mobileJson({ error: "invalid_operation" }, { status: 400 });
  } catch (error) {
    return mobileRequestError(error);
  }
}
