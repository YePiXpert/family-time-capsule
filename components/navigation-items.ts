import type { IconName } from "./ui/icons";
import type { FamilyCapability } from "@/lib/authz/policy";

export type NavigationItem = {
  href: string;
  label: string;
  icon: IconName;
  capability: FamilyCapability;
  emphasis?: boolean;
};

export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "首页", icon: "home", capability: "archive:view" },
  { href: "/timeline", label: "时间轴", icon: "timeline", capability: "archive:view" },
  { href: "/capture", label: "记录", icon: "capture", capability: "capture:create", emphasis: true },
  { href: "/inbox", label: "收件箱", icon: "inbox", capability: "inbox:review" },
  { href: "/more", label: "更多", icon: "more", capability: "archive:view" },
];

export const SECONDARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/search", label: "搜索", icon: "search", capability: "archive:view" },
  { href: "/family", label: "家人", icon: "people", capability: "family:manage" },
  { href: "/stories", label: "故事", icon: "story", capability: "story:write" },
  { href: "/requests", label: "口述史", icon: "microphone", capability: "contribution:create" },
  { href: "/capsules", label: "时间胶囊", icon: "capsule", capability: "capsule:write" },
  { href: "/books", label: "书籍与备份", icon: "book", capability: "archive:view" },
  { href: "/settings", label: "设置", icon: "settings", capability: "archive:view" },
  { href: "/trash", label: "回收站", icon: "trash", capability: "event:write" },
];

export function filterNavigationByCapabilities(
  items: readonly NavigationItem[],
  capabilities: readonly FamilyCapability[],
): NavigationItem[] {
  const allowed = new Set(capabilities);
  return items.filter((item) => allowed.has(item.capability));
}

const MORE_PREFIXES = ["/more", "/search", "/family", "/stories", "/requests", "/capsules", "/books", "/settings", "/trash"];

export function isNavigationItemActive(pathname: string, href: string, mobile = false): boolean {
  if (href === "/") return pathname === "/";
  if (mobile && href === "/timeline" && pathname.startsWith("/memories/")) return true;
  if (mobile && href === "/more") return MORE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
