import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { asRecord, mobileJson, mobileRequestError, optionalString, readMobileJson } from "@/lib/mobile/http";
import { getMobileReview } from "@/lib/mobile/review";
import { generateReviewStory, requestReviewStoryOptimization, setReviewHighlight, setReviewProgress } from "@/lib/review/service";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const key = new URL(request.url).searchParams.get("period") ?? undefined;
  if (key && !DATE_PATTERN.test(key)) return mobileJson({ error: "not_found" }, { status: 404 });
  return mobileJson(await getMobileReview(authorization.context, key));
}

export async function PATCH(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  if (!hasFamilyCapability(authorization.context.role, "story:write")) {
    return mobileJson({ error: "forbidden" }, { status: 403 });
  }
  try {
    const body = asRecord(await readMobileJson(request));
    if (Object.hasOwn(body, "familyId")) return mobileJson({ error: "family_id_not_accepted" }, { status: 400 });
    const reviewId = optionalString(body, "reviewId", 128) ?? "";
    const key = optionalString(body, "key", 10) ?? "";
    const operation = optionalString(body, "operation", 32) ?? "";
    if (!reviewId || !DATE_PATTERN.test(key)) return mobileJson({ error: "invalid_input" }, { status: 400 });

    let result: { ok: boolean; error?: string; storyId?: string };
    if (operation === "start" || operation === "complete" || operation === "reopen") {
      result = await setReviewProgress(authorization.context, reviewId, operation);
    } else if (operation === "highlight") {
      const eventId = optionalString(body, "eventId", 128) ?? "";
      if (typeof body.selected !== "boolean") return mobileJson({ error: "invalid_input" }, { status: 400 });
      result = await setReviewHighlight(authorization.context, reviewId, eventId, body.selected);
    } else if (operation === "generate") {
      result = await generateReviewStory(authorization.context, reviewId);
    } else if (operation === "optimize_ai") {
      result = await requestReviewStoryOptimization(authorization.context, reviewId);
    } else {
      return mobileJson({ error: "invalid_operation" }, { status: 400 });
    }
    if (!result.ok) {
      return mobileJson({ error: result.error ?? "invalid_operation" }, { status: result.error === "not_found" ? 404 : 400 });
    }
    return mobileJson({ review: await getMobileReview(authorization.context, key), ...(result.storyId ? { storyId: result.storyId } : {}) });
  } catch (error) {
    return mobileRequestError(error);
  }
}
