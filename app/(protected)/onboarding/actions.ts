"use server";

import { redirect } from "next/navigation";
import { requireAccountCapability } from "@/lib/authz/context";
import { completeOnboarding } from "@/lib/family/service";

export type OnboardingFormState = { error?: string };

export async function onboardingAction(
  _prev: OnboardingFormState | undefined,
  formData: FormData,
): Promise<OnboardingFormState> {
  const session = await requireAccountCapability("family:manage");
  const input = {
    familyName: String(formData.get("familyName") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    childDisplayName: String(formData.get("childDisplayName") ?? ""),
    childBirthDate: String(formData.get("childBirthDate") ?? ""),
    selfDisplayName: String(formData.get("selfDisplayName") ?? ""),
    selfRelationToChild: String(formData.get("selfRelationToChild") ?? ""),
    selfIsGuardian: formData.get("selfIsGuardian") === "yes",
  };
  const result = await completeOnboarding(session.id, input);
  if (!result.ok) {
    return {
      error:
        result.error === "already_bound"
          ? "已有家庭，无需重复初始化。"
          : "请检查填写内容：家庭名 1–50 字，孩子姓名 1–50 字，出生日期为有效日期。",
    };
  }
  redirect("/");
}
