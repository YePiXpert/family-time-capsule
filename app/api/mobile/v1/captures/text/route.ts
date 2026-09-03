import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { createTextInboxItemIdempotent } from "@/lib/inbox/service";

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
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "capture:create",
  );
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "invalid_content_type" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error && error.message === "too_large" ? "too_large" : "invalid_json" },
      { status: error instanceof Error && error.message === "too_large" ? 413 : 400 },
    );
  }
  const candidate = body as { id?: unknown; text?: unknown } | null;
  const id = typeof candidate?.id === "string" ? candidate.id : "";
  const text = typeof candidate?.text === "string" ? candidate.text.trim() : "";
  if (!UUID_PATTERN.test(id) || text.length < 1 || text.length > 5000) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await createTextInboxItemIdempotent(
    authorization.context.familyId,
    text,
    id,
  );
  if (result.status === "conflict") {
    return Response.json({ error: "id_conflict" }, { status: 409 });
  }
  return Response.json(
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
