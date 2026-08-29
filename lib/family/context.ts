import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/auth";
import { getUserBinding } from "./service";

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
};

/** 业务页面入口：已登录且已绑定家庭，否则分别跳 /login、/onboarding。 */
export async function requireFamily(): Promise<FamilyContext> {
  const session = await requireSession();
  const binding = await getUserBinding(session.id);
  if (!binding.familyId) redirect("/onboarding");
  return {
    userId: session.id,
    userName: session.name,
    familyId: binding.familyId,
    personId: binding.personId,
  };
}
