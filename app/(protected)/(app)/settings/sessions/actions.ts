"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { requireCurrentSessionId } from "@/lib/family/context";
import { revokeOtherSessions } from "@/lib/accounts/service";

export type SessionsFormState = {
  error?: string;
  success?: string;
};

/** 撤销本人除当前会话外的全部登录（含其他浏览器与原生设备）。 */
export async function revokeOtherSessionsAction(
  _previous: SessionsFormState | undefined,
  _formData: FormData,
): Promise<SessionsFormState> {
  void _previous;
  void _formData;
  const context = await requireFamilyCapability("archive:view");
  const currentSessionId = await requireCurrentSessionId();
  const result = revokeOtherSessions(context, currentSessionId);
  if ("error" in result && result.error) {
    return { error: "权限校验失败，本次未执行撤销。" };
  }
  revalidatePath("/settings/sessions");
  return { success: "其他设备已全部退出，需要重新登录；本机原件与记录不受影响。" };
}
