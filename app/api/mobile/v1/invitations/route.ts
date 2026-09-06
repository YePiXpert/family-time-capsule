import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { isFamilyRole } from "@/lib/authz/policy";
import { createFamilyInvitation } from "@/lib/invitations/service";

/**
 * POST /api/mobile/v1/invitations —— 在 App 内创建账号邀请（1.3）。
 * 复用 createFamilyInvitation：权限（account:invite）、角色与人物归属校验、
 * 高熵一次性 token（只在本响应中出现一次）都在服务端完成。
 * 响应返回 invitePath；客户端用自己的服务器 origin 拼出完整链接与二维码。
 */

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "account:invite",
  );
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { context } = authorization;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "invalid_input" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const role = readString(body, "role");
  const email = readString(body, "email");
  const personId = readString(body, "personId");
  const expiresInDays = Number(body.expiresInDays);
  if (
    !isFamilyRole(role) ||
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 30
  ) {
    return Response.json(
      { error: "invalid_input" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await createFamilyInvitation({
    familyId: context.familyId,
    actorUserId: context.userId,
    role,
    email: email || null,
    personId: personId || null,
    expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
  });
  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : 400;
    return Response.json(
      { error: result.error },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    {
      ok: true,
      invitationId: result.invitationId,
      token: result.token,
      invitePath: `/invite/${result.token}`,
      expiresAt: result.expiresAt.toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
