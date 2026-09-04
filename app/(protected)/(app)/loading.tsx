import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="page-container" role="status" aria-live="polite">
      <span className="sr-only">正在加载家庭档案</span>
      <Skeleton className="h-8 w-40" />
      <div className="mt-8 grid gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </main>
  );
}
