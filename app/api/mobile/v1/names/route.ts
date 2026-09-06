import { revalidatePath } from "next/cache";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getNameReview, renameTarget, reviewTitleSuggestion, type NameTargetKind } from "@/lib/names/service";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";

function targetKind(value: unknown): value is NameTargetKind { return value === "asset" || value === "inbox_item" || value === "memory_event"; }
function id(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128; }

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind"), targetId = query.get("id");
  if (!targetKind(kind) || !id(targetId)) return mobileJson({ error: "invalid_input" }, { status: 400 });
  const result = await getNameReview(authorization.context.familyId, authorization.context.userId, kind, targetId);
  return result ? mobileJson(result) : mobileJson({ error: "not_found" }, { status: 404 });
}

export async function POST(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const input = asRecord(await readMobileJson(request, 4096));
    if (!targetKind(input.kind) || !id(input.id) || !Number.isSafeInteger(input.revision)) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const { familyId, userId } = authorization.context;
    const result = input.operation === "rename" && typeof input.title === "string"
      ? await renameTarget(familyId, userId, { kind: input.kind, id: input.id, revision: Number(input.revision), title: input.title })
      : id(input.suggestionId) && Number.isSafeInteger(input.suggestionRevision) && ["accept", "reject", "undo"].includes(String(input.operation))
        ? await reviewTitleSuggestion(familyId, userId, { targetKind: input.kind, targetId: input.id, targetRevision: Number(input.revision), suggestionId: input.suggestionId, suggestionRevision: Number(input.suggestionRevision), operation: input.operation as "accept" | "reject" | "undo", ...(input.editedTitle === undefined ? {} : { editedTitle: typeof input.editedTitle === "string" ? input.editedTitle : "" }) })
        : { ok: false as const, error: "invalid_input" };
    if (!result.ok) return mobileJson(result, { status: result.error === "forbidden" || result.error === "private_context" ? 403 : result.error === "not_found" ? 404 : result.error === "invalid_input" ? 400 : 409 });
    revalidatePath("/", "layout");
    return mobileJson(await getNameReview(familyId, userId, input.kind, input.id));
  } catch (error) { return mobileRequestError(error); }
}
