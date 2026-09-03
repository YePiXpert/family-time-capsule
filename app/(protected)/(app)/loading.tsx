export default function Loading() {
  return (
    <main
      className="mx-auto w-full max-w-5xl flex-1 px-6 py-16"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">正在加载家庭档案</span>
      <div className="h-7 w-36 animate-pulse rounded bg-foreground/10 motion-reduce:animate-none" />
      <div className="mt-8 grid gap-4">
        <div className="h-28 animate-pulse rounded-xl border border-foreground/10 bg-foreground/[0.02] motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-xl border border-foreground/10 bg-foreground/[0.02] motion-reduce:animate-none" />
      </div>
    </main>
  );
}
