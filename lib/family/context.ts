import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/auth";
import type { FamilyRole } from "@/lib/authz/policy";
import {
  getUserBinding,
  InvalidUserBindingError,
  type UserBinding,
} from "./service";

/**
 * 页面层上下文：认证 + 家庭绑定。
 * 所有业务页面通过这两个 helper 取得作用域，绝不直接信任客户端传入的 familyId。
 */

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

export async function requireSession(): Promise<SessionUser> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}

export type FamilyContext = {
  userId: string;
  userName: string;
  familyId: string;
  personId: string | null;
  role: FamilyRole;
  accountEnabled: true;
  isGuardian: boolean;
  familyTimezone: string;
  childLaterUnlockAge: number;
};

/**
 * Page/Server Action boundary for a persisted principal. Invalid or disabled
 * bindings get a stable, non-500 recovery screen. Route Handlers deliberately
 * use getApiFamilyContext instead so they can return 401/403 themselves.
 */
export async function requireUserBinding(userId: string): Promise<UserBinding> {
  try {
    return await getUserBinding(userId);
  } catch (error) {
    if (error instanceof InvalidUserBindingError) {
      redirect("/login?unavailable=1");
    }
    throw error;
  }
}

/** 业务页面入口：已登录且已绑定家庭，否则分别跳 /login、/onboarding。 */
export async function requireFamily(): Promise<FamilyContext> {
  const session = await requireSession();
  const binding = await requireUserBinding(session.id);
  if (!binding.familyId) redirect("/onboarding");
  if (
    binding.familyTimezone === null ||
    binding.childLaterUnlockAge === null
  ) {
    throw new Error("family policy is unavailable");
  }
  return {
    userId: session.id,
    userName: session.name,
    familyId: binding.familyId,
    personId: binding.personId,
    role: binding.role,
    accountEnabled: binding.accountEnabled,
    isGuardian: binding.isGuardian,
    familyTimezone: binding.familyTimezone,
    childLaterUnlockAge: binding.childLaterUnlockAge,
  };
}

/** API 路由入口：返回 null 而不是 redirect，由调用方决定 401/403。 */
export async function getApiFamilyContext(
  requestHeaders: Headers,
): Promise<FamilyContext | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const binding = await getUserBinding(session.user.id);
  if (!binding.familyId) return null;
  if (
    binding.familyTimezone === null ||
    binding.childLaterUnlockAge === null
  ) {
    throw new Error("family policy is unavailable");
  }
  return {
    userId: session.user.id,
    userName: session.user.name,
    familyId: binding.familyId,
    personId: binding.personId,
    role: binding.role,
    accountEnabled: binding.accountEnabled,
    isGuardian: binding.isGuardian,
    familyTimezone: binding.familyTimezone,
    childLaterUnlockAge: binding.childLaterUnlockAge,
  };
}
