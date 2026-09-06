"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  changeFamilyAccountRole,
  disableFamilyAccount,
  enableFamilyAccount,
  removeFamilyMember,
  transferOwnership,
  type AccountMutationError,
} from "@/lib/accounts/service";

export type AccountFormState = {
  error?: string;
  success?: string;
};

function errorMessage(error: AccountMutationError): string {
  switch (error) {
    case "forbidden":
      return "你的管理员权限已经变化，本次操作未执行。";
    case "not_found":
      return "账号不存在或不属于当前家庭。";
    case "invalid_role":
      return "请选择有效的账号角色。";
    case "already_disabled":
      return "账号已经停用。";
    case "already_enabled":
      return "账号已经恢复。";
    case "cannot_disable_self":
      return "不能停用当前正在使用的账号。";
    case "last_admin":
      return "家庭必须保留至少一名可用管理员。请先把另一账号设为管理员。";
    case "owner_transfer_required":
      return "所有者账号不能这样直接修改；请先在“所有权”中完成移交。";
    case "password_required":
      return "需要重新输入当前密码完成认证。";
  }
}

function revalidateAccountAdministration(): void {
  revalidatePath("/settings/accounts");
  revalidatePath("/settings");
}

export async function disableAccountAction(
  targetUserId: string,
  _previous: AccountFormState | undefined,
  _formData: FormData,
): Promise<AccountFormState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("account:manage");
  const result = disableFamilyAccount(context, targetUserId);
  if (!result.ok) return { error: errorMessage(result.error) };
  revalidateAccountAdministration();
  return { success: "账号已停用，现有登录会话已全部撤销。" };
}

export async function enableAccountAction(
  targetUserId: string,
  _previous: AccountFormState | undefined,
  _formData: FormData,
): Promise<AccountFormState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("account:manage");
  const result = enableFamilyAccount(context, targetUserId);
  if (!result.ok) return { error: errorMessage(result.error) };
  revalidateAccountAdministration();
  return { success: "账号已恢复，可以重新登录。" };
}

export async function changeAccountRoleAction(
  targetUserId: string,
  _previous: AccountFormState | undefined,
  formData: FormData,
): Promise<AccountFormState> {
  void _previous;
  const context = await requireFamilyCapability("account:manage");
  const role = String(formData.get("role") ?? "");
  const result = changeFamilyAccountRole(context, targetUserId, role);
  if (!result.ok) return { error: errorMessage(result.error) };
  revalidateAccountAdministration();
  if (targetUserId === context.userId && role !== "admin") {
    redirect("/settings?accountRoleUpdated=1");
  }
  return { success: "账号角色已更新。" };
}

/**
 * 所有权移交（M2）：要求当前 owner 重新输入密码（近期重新认证），
 * 目标必须是已启用的 admin 成员；原子交换后原 owner 变为 admin。
 */
export async function transferOwnershipAction(
  targetUserId: string,
  _previous: AccountFormState | undefined,
  formData: FormData,
): Promise<AccountFormState> {
  void _previous;
  const context = await requireFamilyCapability("family:transfer");
  const password = String(formData.get("currentPassword") ?? "");
  if (!password) return { error: errorMessage("password_required") };
  const result = await transferOwnership({ context, targetUserId, currentPassword: password });
  if (!result.ok) {
    const message =
      result.error === "invalid_target"
        ? "移交目标必须是本家庭已启用的管理员账号。"
        : result.error === "password_required"
          ? "需要重新输入当前密码完成认证。"
          : errorMessage(result.error);
    return { error: message };
  }
  revalidateAccountAdministration();
  return { success: "所有权已移交；你现在是管理员，新所有者已就位。" };
}

/** 把成员移出家庭（ID-13）：解绑并撤销其会话；人物与讲述保留。 */
export async function removeMemberAction(
  targetUserId: string,
  _previous: AccountFormState | undefined,
  _formData: FormData,
): Promise<AccountFormState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("account:manage");
  const result = removeFamilyMember(context, targetUserId);
  if (!result.ok) {
    const message: Record<string, string> = {
      forbidden: "你的管理员权限已经变化，本次操作未执行。",
      not_found: "账号不存在或不属于当前家庭。",
      owner_transfer_required: "所有者不能被移出家庭；请先完成所有权移交。",
      last_admin: "家庭必须保留至少一名可用管理员。",
    };
    return { error: message[result.error] ?? "操作未执行。" };
  }
  revalidateAccountAdministration();
  return { success: "成员已移出家庭；其讲述与人物记录保留在家庭档案中。" };
}
