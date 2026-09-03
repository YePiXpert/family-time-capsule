import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-start justify-center px-6 py-16">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold">这里没有这段记忆</h1>
      <p className="mt-3 text-sm leading-6 text-foreground/65">
        链接可能已失效、内容已移入回收站，或当前账号没有访问权限。
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium hover:border-accent"
      >
        返回家庭档案
      </Link>
    </main>
  );
}
