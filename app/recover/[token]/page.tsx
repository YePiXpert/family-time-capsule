import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "重置密码 · Family Time Capsule",
};

export default async function RecoverPage(props: PageProps<"/recover/[token]">) {
  const params = await props.params;
  const token = typeof params.token === "string" ? params.token : "";
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">设置新密码</h1>
      <p className="mt-2 text-base leading-7 text-foreground/70">
        这是一次性的服务器恢复链接（15 分钟内有效）。设置成功后，所有已登录设备都会退出，
        需要用新密码重新登录；本机照片与记录不受影响。
      </p>
      <ResetForm token={token} />
      <p className="mt-6 text-xs leading-5 text-foreground/55">
        链接无效或已过期时，请再联系部署者在服务器上重新生成；本实例不提供公开「忘记密码」通道。
      </p>
    </main>
  );
}
