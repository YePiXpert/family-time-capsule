import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { createContributionAccessSnapshot, updateVisibleContributionText } from "@/lib/authz/contribution-access";
import { asRecord, mobileJson, mobileRequestError, optionalString, readMobileJson } from "@/lib/mobile/http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "contribution:create");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const text = optionalString(body, "text", 5000);
    if (!text) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const result = updateVisibleContributionText(createContributionAccessSnapshot(authorization.context), (await params).id, text);
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "invalid" ? 400 : 404 });
    return mobileJson({ status: "updated", memoryEventId: result.memoryEventId });
  } catch (error) {
    return mobileRequestError(error);
  }
}
