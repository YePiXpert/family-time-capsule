import type { ReactNode } from "react";

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger" | "ai";

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
