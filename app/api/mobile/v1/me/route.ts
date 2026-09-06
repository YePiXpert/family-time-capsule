import { getAuth } from "@/lib/auth/auth";
import {
  getFamily,
  getUserBinding,
  InvalidUserBindingError,
} from "@/lib/family/service";

/**
 * GET /api/mobile/v1/me —— 账号与家庭状态（1.3）。
 * 与其他 /api/mobile/v1/* 不同：不要求已绑定家庭。
 * needsOnboarding = 账号有效但尚未建立/绑定家庭，登录不算失败，
 * 客户端应继续走 onboarding，而不是把 401 误判为“登录已过期”。
 */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { status: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  let binding;
  try {
    binding = await getUserBinding(session.user.id);
  } catch (error) {
    if (error instanceof InvalidUserBindingError) {
      if (
        error.code === "account_disabled" ||
        error.code === "user_not_found"
      ) {
        return Response.json(
          { status: "revoked" },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { status: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
  const user = {
    id: session.user.id,
    displayName: session.user.name,
    email: session.user.email,
  };
  if (!binding.familyId) {
    return Response.json(
      {
        status: "needsOnboarding",
        user,
        account: { role: binding.role },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const familyRow = await getFamily(binding.familyId);
  return Response.json(
    {
      status: "ready",
      user,
      account: {
        role: binding.role,
        personId: binding.personId,
        isGuardian: binding.isGuardian,
      },
      family: {
        id: binding.familyId,
        name: familyRow?.name ?? "",
        timezone: binding.familyTimezone ?? "UTC",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
