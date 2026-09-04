import type { IconName } from "./ui/icons";

export type NavigationItem = {
  href: string;
  label: string;
  icon: IconName;
  emphasis?: boolean;
};

export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "首页", icon: "home" },
  { href: "/timeline", label: "时间轴", icon: "timeline" },
  { href: "/capture", label: "记录", icon: "capture", emphasis: true },
  { href: "/inbox", label: "收件箱", icon: "inbox" },
  { href: "/more", label: "更多", icon: "more" },
];

export const SECONDARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/search", label: "搜索", icon: "search" },
  { href: "/family", label: "家人", icon: "people" },
  { href: "/stories", label: "故事", icon: "story" },
  { href: "/requests", label: "口述史", icon: "microphone" },
  { href: "/capsules", label: "时间胶囊", icon: "capsule" },
  { href: "/books", label: "书籍与备份", icon: "book" },
  { href: "/settings", label: "设置", icon: "settings" },
  { href: "/trash", label: "回收站", icon: "trash" },
];

const MORE_PREFIXES = ["/more", "/search", "/family", "/stories", "/requests", "/capsules", "/books", "/settings", "/trash"];

export function isNavigationItemActive(pathname: string, href: string, mobile = false): boolean {
  if (href === "/") return pathname === "/";
  if (mobile && href === "/timeline" && pathname.startsWith("/memories/")) return true;
  if (mobile && href === "/more") return MORE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
