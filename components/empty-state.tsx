import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./ui/icons";

export function EmptyState({
  title,
  description,
  icon = "archive",
  action,
  actionHref,
  secondary,
}: {
  title: string;
  description: ReactNode;
  icon?: IconName;
  action?: string;
  actionHref?: string;
  secondary?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon name={icon} size={26} /></span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="max-w-md text-sm leading-6 text-muted">{description}</div>
      {action && actionHref ? <Link href={actionHref} className="ui-button-primary mt-2">{action}</Link> : null}
      {secondary ? <div className="text-sm text-muted">{secondary}</div> : null}
    </div>
  );
}
