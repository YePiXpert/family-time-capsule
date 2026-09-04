import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { createTextInboxItemIdempotent } from "@/lib/inbox/service";
import { createImportedTextCapture } from "@/lib/imports/service";
import { uploadError, uploadJson } from "@/lib/imports/http";
import { isSameOrigin } from "@/lib/security/origin";

const MAX_JSON_BYTES = 16 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function readLimitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) throw new Error("too_large");
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return uploadJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "capture:create",
  );
  if (!authorization.ok) {
    return uploadJson(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return uploadJson({ error: "invalid_content_type" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return uploadJson(
      { error: error instanceof Error && error.message === "too_large" ? "too_large" : "invalid_json" },
      { status: error instanceof Error && error.message === "too_large" ? 413 : 400 },
    );
  }
  const candidate = body as { id?: unknown; text?: unknown; importSessionId?: unknown } | null;
  const id = typeof candidate?.id === "string" ? candidate.id : "";
  const text = typeof candidate?.text === "string" ? candidate.text.trim() : "";
  const importId = candidate?.importSessionId;
  if (importId !== undefined && importId !== null && (typeof importId !== "string" || !UUID_PATTERN.test(importId))) {
    return uploadJson({ error: "invalid_import_session" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(id) || text.length < 1 || text.length > 5000) {
    return uploadJson({ error: "invalid_input" }, { status: 400 });
  }

  let result;
  try {
    result = typeof importId === "string"
      ? createImportedTextCapture(authorization.context.familyId, authorization.context.userId, importId, id, text)
      : createTextInboxItemIdempotent(authorization.context.familyId, text, id);
  } catch (error) {
    return uploadError(error);
  }
  if (result.status === "conflict") {
    return uploadJson({ error: "id_conflict" }, { status: 409 });
  }
  return uploadJson(
    {
      status: result.status,
      inboxItemId: result.item.id,
      receivedAt: result.item.createdAt.toISOString(),
    },
    {
      status: result.status === "created" ? 201 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
