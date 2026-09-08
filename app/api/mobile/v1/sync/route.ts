import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getMobileSyncPage } from "@/lib/mobile/sync";
import { getMobileSyncProtocolPage } from "@/lib/mobile/sync-protocol";
import { assertSyncPageCurrent, SyncReadError } from "@/lib/mobile/sync-state";

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "archive:view",
  );
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const rawLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 50;
  const { context } = authorization;
  try {
    const page = url.searchParams.get("protocol") === "2" ? await getMobileSyncProtocolPage(context, cursor, limit) : await getMobileSyncPage({ context, cursor, limit });
    assertSyncPageCurrent(context, page);
    return Response.json(page, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyncReadError) return Response.json({ error: error.code,
      ...(error.current ? { generation: error.current.generation, permissionStamp: error.current.permissionStamp } : {}) },
      { status: error.code === "forbidden" ? 403 : 409, headers: { "cache-control": "private, no-store" } });
    throw error;
  }
}
