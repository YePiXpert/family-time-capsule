"use server";

import { redirect } from "next/navigation";
import {
  acceptFamilyInvitation,
  type AcceptInvitationFailure,
} from "@/lib/invitations/service";

export type AcceptInvitationFormState = { error?: string };

const ERROR_MESSAGE: Record<AcceptInvitationFailure, string> = {
  invalid_input:
    "请检查姓名、邮箱和密码：姓名 1–50 字，密码至少 10 位。",
  invalid_or_unavailable: "邀请已过期、已撤销、已使用，或正在被接受。",
  email_mismatch: "此邀请限定了另一个邮箱，请使用邀请中指定的邮箱。",
  account_exists: "该邮箱已经有账号，请直接前往登录。",
  person_unavailable: "邀请绑定的家人档案已经关联账号，请联系家庭管理员。",
  account_creation_failed: "账号创建失败；邀请没有被消耗，请稍后重试。",
};

export async function acceptInvitationAction(
  token: string,
  _previous: AcceptInvitationFormState | undefined,
  formData: FormData,
): Promise<AcceptInvitationFormState> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("passwordConfirm") ?? "")) {
    return { error: "两次输入的密码不一致。" };
  }
  const result = await acceptFamilyInvitation({
    token,
    displayName: String(formData.get("displayName") ?? ""),
    email: String(formData.get("email") ?? ""),
    password,
  });
  if (!result.ok) return { error: ERROR_MESSAGE[result.error] };
  redirect("/login?invited=1");
}
