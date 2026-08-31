"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  changeFamilyAccountRole,
  disableFamilyAccount,
  enableFamilyAccount,
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
