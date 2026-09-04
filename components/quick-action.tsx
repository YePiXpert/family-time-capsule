import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./ui/icons";

export function QuickAction({
  href,
  icon,
  label,
  description,
  emphasized = false,
  trailing,
}: {
  href: string;
  icon: IconName;
  label: string;
  description?: string;
  emphasized?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <Link href={href} className={`quick-action ${emphasized ? "quick-action-emphasized" : ""}`}>
      <span className="quick-action-icon"><Icon name={icon} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span> : null}
      </span>
      {trailing ?? <Icon name="chevron-right" size={17} className="shrink-0 text-faint" />}
    </Link>
  );
}
