import { redirect } from "next/navigation";
import { getSetupState } from "@/lib/auth/setup";
import { SetupForm } from "./setup-form";

// 初始化状态取决于数据库内容，绝不能被构建期静态预渲染冻结
export const dynamic = "force-dynamic";

export const metadata = { title: "初始化 · Family Time Capsule" };

export default async function SetupPage() {
  const state = await getSetupState();
  // 初始化是一次性动作：只要已有用户就永久失效（docs/SECURITY.md）
  if (state.hasUsers) redirect("/login");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20">
      <h1 className="text-2xl font-semibold">初始化家庭时间胶囊</h1>
      <p className="mt-1 text-sm leading-6 text-foreground/60">
        创建第一个管理员账号。此页面只在首次部署、且数据库中还没有任何用户时可用。
      </p>
      {state.tokenConfigured ? (
        <SetupForm />
      ) : (
        <p className="mt-6 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm leading-6">
          服务器未设置 <code className="font-mono">INITIAL_SETUP_TOKEN</code>{" "}
          环境变量，初始化已禁用。请由服务器管理员配置后刷新本页。
        </p>
      )}
    </main>
  );
}
