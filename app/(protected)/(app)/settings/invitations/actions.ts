"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { isFamilyRole } from "@/lib/authz/policy";
import {
  createFamilyInvitation,
  revokeFamilyInvitation,
} from "@/lib/invitations/service";

export type CreateInvitationFormState = {
  error?: string;
  invitePath?: string;
  expiresAt?: string;
};

export async function createInvitationAction(
  _previous: CreateInvitationFormState | undefined,
  formData: FormData,
): Promise<CreateInvitationFormState> {
  const context = await requireFamilyCapability("account:invite");
  const role = String(formData.get("role") ?? "");
  const email = String(formData.get("email") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const expiresInDays = Number(formData.get("expiresInDays"));
  if (
    !isFamilyRole(role) ||
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 30
  ) {
    return { error: "请检查角色和有效期。" };
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const result = await createFamilyInvitation({
    familyId: context.familyId,
    actorUserId: context.userId,
    role,
    email: email || null,
    personId: personId || null,
    expiresAt,
  });
  if (!result.ok) {
    const message =
      result.error === "person_unavailable"
        ? "所选家人不属于当前家庭，或已经绑定账号。"
        : result.error === "forbidden"
          ? "只有家庭管理员可以创建邀请。"
          : "邀请信息无效，请检查邮箱和有效期。";
    return { error: message };
  }
  revalidatePath("/settings/invitations");
  return {
    invitePath: `/invite/${result.token}`,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export type RevokeInvitationFormState = { error?: string };

export async function revokeInvitationAction(
  invitationId: string,
  _previous: RevokeInvitationFormState | undefined,
  _formData: FormData,
): Promise<RevokeInvitationFormState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("account:invite");
  const result = await revokeFamilyInvitation({
    familyId: context.familyId,
    actorUserId: context.userId,
    invitationId,
  });
  if (!result.ok) {
    return { error: "邀请不存在、已使用，或已经撤销。" };
  }
  revalidatePath("/settings/invitations");
  return {};
}
