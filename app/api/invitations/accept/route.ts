import {
  acceptFamilyInvitation,
  type AcceptInvitationFailure,
} from "@/lib/invitations/service";

/**
 * POST /api/invitations/accept —— 受邀人在 App 内注册账号并加入家庭（1.3）。
 * 复用 acceptFamilyInvitation 的原子 claim / 幂等恢复 / 审计，不另建注册路径。
 * 账号邀请 token 与匿名投递 token 是不同凭据；投递 token 无法通过本端点。
 * 成功后客户端再用既有 /api/auth/sign-in/email 登录。
 */

const STATUS_BY_FAILURE: Record<AcceptInvitationFailure, number> = {
  invalid_input: 400,
  invalid_or_unavailable: 403,
  email_mismatch: 403,
  account_exists: 409,
  person_unavailable: 409,
  account_creation_failed: 500,
};

function readString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_input" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await acceptFamilyInvitation({
    token: readString(body, "token"),
    displayName: readString(body, "displayName"),
    email: readString(body, "email"),
    password: readString(body, "password"),
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      {
        status: STATUS_BY_FAILURE[result.error],
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
