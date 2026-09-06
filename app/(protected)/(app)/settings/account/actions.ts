"use server";

import { redirect } from "next/navigation";
import { requireFamilyCapability } from "@/lib/authz/context";
import { requireCurrentSessionId } from "@/lib/family/context";
import {
  deleteOwnAccount,
  leaveFamily,
} from "@/lib/accounts/service";
import { markRecentAuth } from "@/lib/auth/step-up";

export type AccountSelfState = {
  error?: string;
  success?: string;
  exportReady?: boolean;
};

/** step-up（ID-10）：导出前确认当前密码，标记本会话近期已认证。 */
export async function confirmExportStepUpAction(
  _previous: AccountSelfState | undefined,
  formData: FormData,
): Promise<AccountSelfState> {
  void _previous;
  const context = await requireFamilyCapability("archive:export");
  void context;
  const sessionId = await requireCurrentSessionId();
  const password = String(formData.get("currentPassword") ?? "");
  const ok = await markRecentAuth(sessionId, password);
  if (!ok) return { error: "密码不正确，未通过复核。" };
  return { exportReady: true };
}

/** 退出家庭（ID-13）：解绑并撤销本账号会话，随后回登录页。 */
export async function leaveFamilyAction(
  _previous: AccountSelfState | undefined,
  _formData: FormData,
): Promise<AccountSelfState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("archive:view");
  const result = leaveFamily(context);
  if (!result.ok) {
    const message: Record<string, string> = {
      forbidden: "当前账号状态无法退出。",
      owner_transfer_required: "所有者请先完成所有权移交再退出家庭。",
      last_admin: "家庭必须保留至少一名可用管理员。",
    };
    return { error: message[result.error] ?? "操作未执行。" };
  }
  redirect("/login?left=1");
}

/** 删除自己的账号（ID-14）：需密码确认；成功后身份匿名化并撤销全部凭据。 */
export async function deleteAccountAction(
  _previous: AccountSelfState | undefined,
  formData: FormData,
): Promise<AccountSelfState> {
  void _previous;
  const context = await requireFamilyCapability("archive:view");
  const password = String(formData.get("currentPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (confirmation !== "删除我的账号") {
    return { error: "请输入「删除我的账号」以确认。" };
  }
  const result = await deleteOwnAccount(context, password);
  if (!result.ok) {
    const message: Record<string, string> = {
      forbidden: "当前账号状态无法删除。",
      owner_transfer_required: "所有者请先完成所有权移交再删除账号。",
      last_admin: "家庭必须保留至少一名可用管理员。",
      invalid_password: "密码不正确。",
    };
    return { error: message[result.error] ?? "操作未执行。" };
  }
  redirect("/login?deleted=1");
}
