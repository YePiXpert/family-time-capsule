"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./ui/icons";

const COLLAPSE_SCROLL_THRESHOLD = 64;

/*
 * iOS-style large-title header for the web app: the hero title fades/shrinks away
 * once the page scrolls past ~64px while a compact glass bar (glass-dock) fades in.
 * SSR-safe: listeners attach in useEffect and the initial state is expanded.
 */
export function CollapsingPageHeader({
  title,
  eyebrow,
  description,
  backHref,
  backLabel = "返回",
  actions,
  compactTitle,
  heroArt,
  heroExtra,
  heroClassName,
  heroAriaLabel,
  children,
}: {
  title?: string;
  eyebrow?: string;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  compactTitle?: string;
  heroArt?: ReactNode;
  heroExtra?: ReactNode;
  heroClassName?: string;
  heroAriaLabel?: string;
  children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCollapsed(window.scrollY > COLLAPSE_SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className={`collapsing-header ${collapsed ? "is-collapsed" : ""}`}>
      <div className="collapsing-header-bar glass-dock" aria-hidden={!collapsed}>
        {backHref ? (
          <Link href={backHref} className="collapsing-header-bar-back" tabIndex={collapsed ? 0 : -1}>
            <Icon name="arrow-left" size={18} />
            <span className="collapsing-header-bar-back-label">{backLabel}</span>
          </Link>
        ) : (
          <span />
        )}
        <span className="collapsing-header-bar-title">{compactTitle ?? title}</span>
        <span />
      </div>
      {children ? (
        <div className="collapsing-header-hero-custom">{children}</div>
      ) : (
        <header className={heroClassName ?? "collapsing-header-hero flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"} aria-label={heroAriaLabel}>
          <div className="min-w-0 flex-1">
            {backHref ? (
              <Link href={backHref} className="ui-text-link mb-3 inline-flex min-h-11 items-center gap-2 text-sm">
                <Icon name="arrow-left" size={18} />
                {backLabel}
              </Link>
            ) : null}
            {eyebrow ? <p className="page-eyebrow collapsing-header-eyebrow">{eyebrow}</p> : null}
            {title ? <h1 className="collapsing-header-title">{title}</h1> : null}
            {description ? (
              <div className="mt-2 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</div>
            ) : null}
            {heroExtra ? <div className="collapsing-header-extra">{heroExtra}</div> : null}
          </div>
          {heroArt}
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </header>
      )}
    </div>
  );
}
