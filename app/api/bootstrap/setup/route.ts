import { performSetup, type SetupFailure } from "@/lib/auth/setup";

/**
 * POST /api/bootstrap/setup —— App 内完成首个管理员初始化（1.3）。
 * 复用 /setup 网页同一条 performSetup 门禁（一次性令牌、限流、
 * timing-safe 比较、进程内串行化），不开放任何旁路注册。
 * setup 成功只代表账号建立；客户端随后用该账号正常登录并 onboarding。
 */

const STATUS_BY_FAILURE: Record<SetupFailure, number> = {
  not_configured: 409,
  already_initialized: 409,
  invalid_token: 403,
  rate_limited: 429,
  invalid_input: 400,
  creation_failed: 500,
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
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await performSetup({
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
