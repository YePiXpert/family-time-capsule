import type { Metadata } from "next";
import Link from "next/link";
import { VerifyForm } from "./verify-form";

// nonce CSP（proxy.ts）要求动态渲染：静态预渲染的 HTML 没有每请求 nonce，
// 会被自家 script-src 策略拦截，页面永远无法水合。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "两步验证 · Family Time Capsule",
};

export default function TwoFactorLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">两步验证</h1>
      <p className="mt-2 text-base leading-7 text-foreground/70">
        输入验证器 App 里的 6 位动态码；验证器不可用时，可改用恢复码（每个只能用一次）。
      </p>
      <VerifyForm />
      <p className="mt-6 text-sm text-foreground/60">
        <Link href="/login" className="underline decoration-foreground/30 underline-offset-4">
          返回重新登录
        </Link>
      </p>
    </main>
  );
}
