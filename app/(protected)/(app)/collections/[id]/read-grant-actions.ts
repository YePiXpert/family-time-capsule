"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  createReadGrant,
  revokeReadGrant,
} from "@/lib/family/read-grants";

export type ReadGrantFormState = {
  error?: string;
  invitePath?: string;
  revoked?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 为单一相册创建访客只读链接（ID-5）；令牌只显示一次。 */
export async function createReadGrantAction(
  _previous: ReadGrantFormState | undefined,
  formData: FormData,
): Promise<ReadGrantFormState> {
  void _previous;
  const context = await requireFamilyCapability("family:manage");
  const collectionId = String(formData.get("collectionId") ?? "");
  const days = Number(formData.get("days") ?? "0");
  const expiresAt =
    Number.isInteger(days) && days > 0
      ? new Date(Date.now() + days * DAY_MS)
      : null;
  const result = await createReadGrant(context, { collectionId, expiresAt });
  if (!result.ok) {
    const message: Record<string, string> = {
      forbidden: "只有家庭管理员可以创建阅读链接。",
      collection_not_found: "相册不存在或已在回收站。",
      invalid_input: "链接参数无效。",
    };
    return { error: message[result.error] ?? "创建失败。" };
  }
  revalidatePath(`/collections/${collectionId}`);
  return { invitePath: `/view/${result.token}` };
}

export async function revokeReadGrantAction(
  _previous: ReadGrantFormState | undefined,
  formData: FormData,
): Promise<ReadGrantFormState> {
  void _previous;
  const context = await requireFamilyCapability("family:manage");
  const grantId = String(formData.get("grantId") ?? "");
  const collectionId = String(formData.get("collectionId") ?? "");
  const result = revokeReadGrant(context, grantId);
  if (!result.ok) {
    return { error: "链接不存在或已收回。" };
  }
  revalidatePath(`/collections/${collectionId}`);
  return { revoked: true };
}
