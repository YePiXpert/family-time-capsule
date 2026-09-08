import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isSameOrigin } from "@/lib/security/origin";
import { runNaturalSearchOperation } from "@/lib/search/operations";
import type { SearchParams } from "@/lib/search/service";
import { AiError } from "@/lib/ai/errors";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return Response.json({ error: "invalid_content_type" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "invalid_input" }, { status: 400 });
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); return Response.json({ error: "too_large" }, { status: 413 }); }
    chunks.push(value);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if ([...form.keys()].some(k => form.getAll(k).length > 1)) return Response.json({ error: "invalid_input" }, { status: 400 });
  const first = (key: string) => form.get(key)?.trim() || undefined;
  const q = first("q") ?? "", id = first("operation_id") ?? "";
  const media = first("media");
  const input: SearchParams = { q, personId: first("person"), dateFrom: first("from"), dateTo: first("to"), tag: first("tag"), mediaType: media as SearchParams["mediaType"] };
  if (q.length > 300 || [input.personId,input.tag].some(v => v && v.length > 128) || (media && !["image","video","audio","document"].includes(media)) || [input.dateFrom,input.dateTo].some(v => v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v))) return Response.json({ error: "invalid_input" }, { status: 400 });
  const query = new URLSearchParams({ q });
  for (const key of ["person","from","to","tag","media"] as const) if (first(key)) query.set(key,first(key)!);
  try {
    await runNaturalSearchOperation(authorization.context, id, input);
    query.set("natural",id);
  } catch (error) { query.set("natural_error",error instanceof AiError ? error.code : "invalid_input"); }
  return new Response(null, { status: 303, headers: { location: `/search?${query}`, "cache-control": "private, no-store" } });
}
