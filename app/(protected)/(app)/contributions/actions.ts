"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  createContributionPortal,
  extendContributionPortal,
  pauseContributionPortal,
  regenerateContributionPortalToken,
  reopenContributionPortal,
  revokeContributionPortal,
} from "@/lib/contribution-portals/service";

export type PortalActionState = {
  error?: string;
  message?: string;
  token?: string;
  portalId?: string;
  expiresAt?: string;
};

function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on";
}

export async function createPortalAction(
  _previous: PortalActionState | undefined,
  formData: FormData,
): Promise<PortalActionState> {
  void _previous;
  const context = await requireFamilyCapability("contribution:create");
  const result = createContributionPortal(context, {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    recipientPersonId: String(formData.get("recipientPersonId") ?? "") || null,
    ttlDays: Number(formData.get("ttlDays") ?? 30),
    maxSubmissions: Number(formData.get("maxSubmissions") ?? 20),
    maxFilesPerSubmission: Number(formData.get("maxFilesPerSubmission") ?? 10),
    allowImages: checked(formData, "allowImages"),
    allowAudio: checked(formData, "allowAudio"),
    allowVideo: checked(formData, "allowVideo"),
    allowDocuments: checked(formData, "allowDocuments"),
    allowText: checked(formData, "allowText"),
    allowBrowserRecording: checked(formData, "allowBrowserRecording"),
    allowGuestName: checked(formData, "allowGuestName"),
    allowReuse: checked(formData, "allowReuse"),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/contributions");
  return {
    portalId: result.portalId,
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function mutatePortalAction(
  _previous: PortalActionState | undefined,
  formData: FormData,
): Promise<PortalActionState> {
  void _previous;
  const context = await requireFamilyCapability("contribution:create");
  const portalId = String(formData.get("portalId") ?? "");
  const operation = String(formData.get("operation") ?? "");
  if (operation === "regenerate") {
    const result = regenerateContributionPortalToken(context, portalId);
    if (!result.ok) return { error: result.error };
    revalidatePath("/contributions");
    return { token: result.token, portalId, message: "旧链接已立即失效。" };
  }
  if (operation === "extend") {
    const result = extendContributionPortal(context, portalId, 30);
    if (!result.ok) return { error: result.error };
    revalidatePath("/contributions");
    return { message: "有效期已延长 30 天。", expiresAt: result.expiresAt.toISOString() };
  }
  const result = operation === "pause" ? pauseContributionPortal(context, portalId)
    : operation === "reopen" ? reopenContributionPortal(context, portalId)
      : operation === "revoke" ? revokeContributionPortal(context, portalId)
        : { ok: false as const, error: "invalid_operation" };
  if (!result.ok) return { error: result.error };
  revalidatePath("/contributions");
  return { message: operation === "pause" ? "投递箱已暂停。" : operation === "reopen" ? "投递箱已重新开放。" : "投递箱已撤销。" };
}
