import Link from "next/link";
import type { ReactNode } from "react";

export function SectionHeader({
  title,
  description,
  actionLabel,
  actionHref,
  trailing,
}: {
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <div className="mt-1 text-sm leading-5 text-muted">{description}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {trailing}
        {actionLabel && actionHref ? (
          <Link href={actionHref} className="ui-text-link shrink-0 text-sm">
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
