import type { Metadata } from "next";
import Link from "next/link";
import { requireFamilyCapability } from "@/lib/authz/context";
import { getTwoFactorStatus } from "@/lib/auth/two-factor-service";
import { listPasskeysForUser } from "@/lib/auth/passkey-service";
import { TwoFactorPanel } from "./two-factor-panel";
import { PasskeyPanel } from "./passkey-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "账号安全 · Family Time Capsule",
};

export default async function SecurityPage() {
  const context = await requireFamilyCapability("archive:view");
  const [twoFactorStatus, passkeys] = await Promise.all([
    getTwoFactorStatus(context.userId),
    listPasskeysForUser(context.userId),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-6 sm:py-16">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center rounded-lg text-sm text-foreground/70 underline decoration-foreground/30 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        返回设置
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">账号安全</h1>
      <p className="mt-2 max-w-2xl text-base leading-7 text-foreground/70">
        给登录加上第二把锁：验证器 App 的动态码（TOTP）与设备通行密钥都是可撤销的，
        密码始终是第一道门。恢复码只在生成时显示一次，请把它放到密码管理器或纸质抄写保管。
      </p>

      <TwoFactorPanel enabled={twoFactorStatus.enabled} />

      <PasskeyPanel
        initialPasskeys={passkeys.map((row) => ({
          ...row,
          createdAt: row.createdAt?.toISOString() ?? null,
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        }))}
      />

      <p className="mt-10 text-xs leading-5 text-foreground/55">
        两步验证开启后，手机 App 暂时需要先在网页完成登录验证；原生端直接支持在后续版本提供。
        忘记密码且无法收到恢复方式时，由部署者在服务器本机运行受审计的恢复命令（见 docs/SECURITY.md）。
      </p>
    </main>
  );
}
