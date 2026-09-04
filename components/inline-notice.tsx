import type { ReactNode } from "react";

export function InlineNotice({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "success" | "warning" | "danger"; title?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`inline-notice inline-notice-${tone}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className="text-sm leading-6">{children}</div>
    </div>
  );
}
