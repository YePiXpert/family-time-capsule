import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getMobileSyncPage } from "@/lib/mobile/sync";

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
  const page = await getMobileSyncPage({
    familyId: context.familyId,
    userId: context.userId,
    userName: context.userName,
    role: context.role,
    cursor,
    limit,
  });

  return Response.json(page, {
    headers: { "cache-control": "private, no-store" },
  });
}
