import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { addPerson } from "@/lib/family/service";

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
  const capability = domain === "people" ? "family:manage" : "capture:create";
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

    return mobileJson({ error: "invalid_operation" }, { status: 400 });
  } catch (error) {
    return mobileRequestError(error);
  }
}
