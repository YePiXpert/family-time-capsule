export function Skeleton({ className = "h-5 w-full", label = "正在加载" }: { className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={`block animate-pulse rounded-lg bg-foreground/10 motion-reduce:animate-none ${className}`} />;
}
