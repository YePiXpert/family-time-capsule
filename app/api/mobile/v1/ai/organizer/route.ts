import { revalidatePath } from "next/cache";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getOrganizerReview, mutateOrganizer } from "@/lib/ai/organizer/service";
import { aiJobFailureMessage } from "@/lib/ai/job-messages";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
import type { OrganizerKind, OrganizerOperation } from "@/mobile/src/ai/organizer-types";
function validKind(value: unknown): value is OrganizerKind { return value === "asset" || value === "memory_event" || value === "inbox_item"; }
function validId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128; }
export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "ai:review");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  const query = new URL(request.url).searchParams, kind = query.get("kind"), id = query.get("id");
  if (!validKind(kind) || !validId(id)) return mobileJson({ error: "invalid_input" }, { status: 400 });
  const review = await getOrganizerReview(auth.context, { kind, id });
  return review ? mobileJson(review) : mobileJson({ error: "not_found" }, { status: 404 });
}
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "ai:review");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const input = asRecord(await readMobileJson(request, 4096));
    if (!validKind(input.kind) || !validId(input.id) || !["name", "transcribe", "cancel", "retry", "regenerate"].includes(String(input.operation)) || (input.jobId !== undefined && !validId(input.jobId))) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const target = { kind: input.kind, id: input.id };
    const result = mutateOrganizer(auth.context, target, input.operation as OrganizerOperation, input.jobId as string | undefined);
    if (!result.ok) return mobileJson({ error: result.error, message: aiJobFailureMessage(result.error) }, { status: result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "invalid_input" ? 400 : 409 });
    revalidatePath("/", "layout");
    return mobileJson(await getOrganizerReview(auth.context, target));
  } catch (error) { return mobileRequestError(error); }
}
