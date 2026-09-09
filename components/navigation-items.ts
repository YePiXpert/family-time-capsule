import type { IconName } from "./ui/icons";
import type { FamilyCapability } from "@/lib/authz/policy";

export type NavigationItem = {
  href: string;
  label: string;
  icon: IconName;
  capability: FamilyCapability;
  emphasis?: boolean;
};

// 日常只有浏览、记录和作品；管理入口独立于主导航。
export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/timeline", label: "记忆", icon: "timeline", capability: "archive:view" },
  { href: "/capture", label: "记录", icon: "capture", capability: "capture:create", emphasis: true },
  { href: "/books", label: "作品", icon: "book", capability: "archive:view" },
];

export const SECONDARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/settings", label: "设置", icon: "settings", capability: "archive:view" },
];

export function filterNavigationByCapabilities(
  items: readonly NavigationItem[],
  capabilities: readonly FamilyCapability[],
): NavigationItem[] {
  const allowed = new Set(capabilities);
  return items.filter((item) => allowed.has(item.capability));
}

const MEMORIES_PREFIXES = ["/library", "/timeline", "/memories", "/inbox", "/imports", "/search", "/pending"];

export function isNavigationItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/timeline") return pathname === "/" || MEMORIES_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (href === "/books") return ["/books", "/collections"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (href === "/family") return pathname === href || pathname.startsWith(`${href}/`);
  if (href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
