import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { createContribution } from "@/lib/contributions/service";
import { asRecord, mobileJson, mobileRequestError, optionalString, readMobileJson } from "@/lib/mobile/http";
import { isContributionVisibility } from "@/lib/authz/policy";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "contribution:create");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const body = asRecord(await readMobileJson(request));
    const authorPersonId = optionalString(body, "authorPersonId", 128);
    const rawText = optionalString(body, "text", 5000);
    const visibility = optionalString(body, "visibility", 32) ?? "family";
    if (!authorPersonId || !rawText || !isContributionVisibility(visibility)) {
      return mobileJson({ error: "invalid_input" }, { status: 400 });
    }
    const result = await createContribution(authorization.context.familyId, {
      memoryEventId: (await params).id,
      authorPersonId,
      recordedByUserId: authorization.context.userId,
      rawText,
      visibility,
    });
    if (!result.ok) {
      const status = result.error === "forbidden" || result.error === "author_not_allowed" ? 403 : result.error === "invalid" ? 400 : 404;
      return mobileJson({ error: result.error }, { status });
    }
    return mobileJson({ contributionId: result.contributionId }, { status: 201 });
  } catch (error) {
    return mobileRequestError(error);
  }
}
