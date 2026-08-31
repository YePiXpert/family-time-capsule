import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  FamilyAccountAuthorizationError,
  listFamilyAccounts,
} from "@/lib/accounts/service";
import { AccountCard } from "./account-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "账号管理 · Family Time Capsule",
};

export default async function AccountsPage() {
  const context = await requireFamilyCapability("account:manage");
  let accounts;
  try {
    accounts = await listFamilyAccounts(context);
  } catch (error) {
    if (error instanceof FamilyAccountAuthorizationError) {
      redirect("/settings?authorizationChanged=1");
    }
    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-6 sm:py-16">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center rounded-lg text-sm text-foreground/70 underline decoration-foreground/30 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        返回设置
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">账号管理</h1>
      <p className="mt-2 max-w-2xl text-base leading-7 text-foreground/70">
        角色决定账号能做什么。停用会立即撤销该账号的全部登录会话，但保留历史署名和家人档案；恢复后，对方可以用原密码重新登录。
      </p>
      <p className="mt-3 rounded-xl border border-amber-700/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-200">
        家庭始终需要至少一名可用管理员。要调整最后一名管理员，请先将另一账号设为管理员。
      </p>

      <ul className="mt-8 flex flex-col gap-4">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </ul>
    </main>
  );
}
