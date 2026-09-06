"use server";

import { headers } from "next/headers";
import { resetPasswordWithRecoveryToken } from "@/lib/auth/account-recovery";

export type ResetFormState = {
  error?: string;
  success?: string;
};

/** 恢复令牌换新密码：单次使用，成功后撤销全部会话。 */
export async function resetPasswordAction(
  _previous: ResetFormState | undefined,
  formData: FormData,
): Promise<ResetFormState> {
  void _previous;
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    return { error: "两次输入的新密码不一致。" };
  }
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  const clientKey =
    forwarded?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  const result = await resetPasswordWithRecoveryToken({
    token,
    newPassword: password,
    clientKey,
  });
  if (result.ok) {
    return { success: "密码已更新，请用新密码重新登录。" };
  }
  if (result.error === "rate_limited") {
    return { error: "尝试次数过多，请 15 分钟后再试。" };
  }
  if (result.error === "weak_password") {
    return { error: "新密码至少 10 位。" };
  }
  return { error: "恢复链接无效或已过期。" };
}
