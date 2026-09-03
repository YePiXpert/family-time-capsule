"use client";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-start justify-center px-6 py-16">
      <p className="text-sm font-medium text-accent">暂时没有加载成功</p>
      <h1 className="mt-2 text-2xl font-semibold">家庭档案仍安全保存在服务器上</h1>
      <p className="mt-3 text-sm leading-6 text-foreground/65">
        这次页面请求遇到了问题。可以重试；如果仍然失败，请检查服务器日志与存储状态。
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 min-h-11 rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium hover:border-accent"
      >
        重试
      </button>
    </main>
  );
}
