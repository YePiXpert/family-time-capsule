import type { ReactNode } from "react";

export function MediaGrid({ children, label = "记忆素材", compact = false }: { children: ReactNode; label?: string; compact?: boolean }) {
  return <div aria-label={label} className={`media-grid ${compact ? "media-grid-compact" : ""}`}>{children}</div>;
}
