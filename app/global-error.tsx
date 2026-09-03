"use client";

import "./globals.css";

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full">
        <title>暂时无法打开 · Family Time Capsule</title>
        <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-start justify-center px-6 py-16">
          <h1 className="text-2xl font-semibold">暂时无法打开家庭档案</h1>
          <p className="mt-3 text-sm leading-6 text-foreground/65">
            数据不会因为页面错误而被删除。请重试；若问题持续，请检查服务器日志与存储状态。
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 min-h-11 rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium hover:border-accent"
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
