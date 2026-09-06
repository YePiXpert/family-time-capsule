import { getAuth } from "@/lib/auth/auth";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  completeOnboarding,
  getUserBinding,
  InvalidUserBindingError,
  type OnboardingInput,
} from "@/lib/family/service";

/**
 * POST /api/mobile/v1/onboarding —— App 内建立家庭（1.3）。
 * 复用 completeOnboarding（Family + 孩子 Person + 本人 Person + 绑定，
 * 单事务、幂等）；权限与 Web /onboarding 相同：仅 family:manage（首个
 * 管理员）可在未绑定状态建立家庭。角色/家庭/人物一律由服务端控制。
 */

function readString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  let binding;
  try {
    binding = await getUserBinding(session.user.id);
  } catch (error) {
    if (error instanceof InvalidUserBindingError) {
      return Response.json(
        { error: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
  if (!hasFamilyCapability(binding.role, "family:manage")) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_input" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input: OnboardingInput = {
    familyName: readString(body, "familyName"),
    timezone: readString(body, "timezone"),
    childDisplayName: readString(body, "childDisplayName"),
    childBirthDate: readString(body, "childBirthDate"),
    selfDisplayName: readString(body, "selfDisplayName"),
    selfRelationToChild: readString(body, "selfRelationToChild"),
    selfIsGuardian: body instanceof Object && "selfIsGuardian" in (body as object)
      ? Boolean((body as Record<string, unknown>).selfIsGuardian)
      : true,
  };
  const result = await completeOnboarding(session.user.id, input);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      {
        status: result.error === "already_bound" ? 409 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  return Response.json(
    { ok: true, familyId: result.familyId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
