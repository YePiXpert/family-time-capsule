import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isEventVisibility } from "@/lib/authz/policy";
import { updateMemoryEventVisibility } from "@/lib/memories/service";
import { asRecord, mobileJson, mobileRequestError, optionalStringArray, readMobileJson } from "@/lib/mobile/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    if (!isEventVisibility(body.visibility) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 ||
      typeof body.mutationId !== "string" || !/^[\w-]{1,128}$/u.test(body.mutationId)) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const readers = optionalStringArray(body, "readerUserIds");
    if (!readers) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const result = await updateMemoryEventVisibility(authorization.context, (await params).id, body.visibility, readers, Number(body.expectedRevision), body.mutationId);
    return mobileJson(result, { status: result.ok ? 200 : result.error === "conflict" ? 409 : result.error === "not_found" ? 404 : ["forbidden", "source_reshare_forbidden"].includes(result.error) ? 403 : 400 });
  } catch (error) { return mobileRequestError(error); }
}
