"use server";

import { redirect } from "next/navigation";
import { requireAccountCapability } from "@/lib/authz/context";
import { bindRestoredFamily } from "@/lib/family/service";

export type BindFormState = { error?: string };

/** RH-004：恢复后把管理员绑定到已恢复家庭中的某个 Person */
export async function bindRestoredAction(
  _prev: BindFormState | undefined,
  formData: FormData,
): Promise<BindFormState> {
  const session = await requireAccountCapability("family:manage");
  const personId = String(formData.get("personId") ?? "");
  const result = await bindRestoredFamily(session.id, personId);
  if (!result.ok) {
    return {
      error:
        result.error === "already_bound"
          ? "已绑定家庭，无需重复操作。"
          : "请选择一个家庭成员（孩子档案不能作为登录身份）。",
    };
  }
  redirect("/");
}
