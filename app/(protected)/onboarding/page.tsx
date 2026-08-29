import { redirect } from "next/navigation";
import { requireSession } from "@/lib/family/context";
import { getUserBinding } from "@/lib/family/service";
import { OnboardingForm } from "./onboarding-form";

// 绑定状态取决于数据库，禁止构建期静态预渲染（同 D-005 教训）
export const dynamic = "force-dynamic";

export const metadata = { title: "创建家庭 · Family Time Capsule" };

export default async function OnboardingPage() {
  const session = await requireSession();
  const binding = await getUserBinding(session.id);
  if (binding.familyId) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20">
      <h1 className="text-2xl font-semibold">创建你的家庭</h1>
      <p className="mt-1 text-sm leading-6 text-foreground/60">
        一次性建立家庭空间与孩子档案。之后可以随时在「家人」页添加没有账号的成员（祖辈等）。
      </p>
      <OnboardingForm defaultDisplayName={session.name} />
    </main>
  );
}
