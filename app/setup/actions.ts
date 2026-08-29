"use server";

import { redirect } from "next/navigation";
import { performSetup, type SetupFailure } from "@/lib/auth/setup";

export type SetupFormState = { error?: string };

const MESSAGES: Record<SetupFailure, string> = {
  not_configured: "服务器未配置 INITIAL_SETUP_TOKEN，无法初始化。",
  already_initialized: "初始化已完成，不能重复执行。",
  invalid_token: "初始化令牌不正确。",
  invalid_input:
    "请检查填写内容：显示名称 1–50 字，邮箱格式正确，密码至少 10 位。",
  creation_failed: "创建管理员失败，请稍后重试。",
};

export async function setupAction(
  _prev: SetupFormState | undefined,
  formData: FormData,
): Promise<SetupFormState> {
  const input = {
    token: String(formData.get("token") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  if (input.password !== String(formData.get("passwordConfirm") ?? "")) {
    return { error: "两次输入的密码不一致。" };
  }
  const result = await performSetup(input);
  if (!result.ok) {
    return { error: MESSAGES[result.error] };
  }
  redirect("/login?setup=1");
}
