import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./ui/icons";

export function PageHeader({
  title,
  eyebrow,
  description,
  backHref,
  backLabel = "返回",
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {backHref ? (
          <Link href={backHref} className="ui-text-link mb-3 inline-flex min-h-11 items-center gap-2 text-sm">
            <Icon name="arrow-left" size={18} />
            {backLabel}
          </Link>
        ) : null}
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <div className="mt-2 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
