import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录 · Family Time Capsule" };

export default async function LoginPage(props: PageProps<"/login">) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/");

  const searchParams = await props.searchParams;
  const justSetup = searchParams?.setup === "1";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20">
      <h1 className="text-2xl font-semibold">家庭时间胶囊</h1>
      <p className="mt-1 text-sm text-foreground/60">
        私人家庭记忆档案，仅限家庭成员访问。
      </p>
      {justSetup && (
        <p className="mt-6 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm leading-6">
          初始化完成。请使用刚创建的管理员账号登录。
        </p>
      )}
      <LoginForm />
      <p className="mt-6 text-xs text-foreground/45">
        首次部署？由服务器管理员执行{" "}
        <a href="/setup" className="underline underline-offset-2 hover:text-foreground">
          初始化
        </a>
        （需要 INITIAL_SETUP_TOKEN）。
      </p>
    </main>
  );
}
