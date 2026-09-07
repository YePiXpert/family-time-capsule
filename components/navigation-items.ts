import type { IconName } from "./ui/icons";
import type { FamilyCapability } from "@/lib/authz/policy";

export type NavigationItem = {
  href: string;
  label: string;
  icon: IconName;
  capability: FamilyCapability;
  emphasis?: boolean;
};

// 正式 1.0 信息架构(M1):五个一级入口 今天/记忆/记录/家人/我的。
// 收件箱下沉为「整理入口」:在二级导航(桌面侧栏)与「记忆」页内可达,
// /inbox 路由与既有深链全部保留,不做删除或跳转劫持。
export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "今天", icon: "home", capability: "archive:view" },
  { href: "/timeline", label: "记忆", icon: "timeline", capability: "archive:view" },
  { href: "/capture", label: "记录", icon: "capture", capability: "capture:create", emphasis: true },
  { href: "/family", label: "家人", icon: "people", capability: "archive:view" },
  { href: "/more", label: "我的", icon: "more", capability: "archive:view" },
];

export const SECONDARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/inbox", label: "待整理", icon: "inbox", capability: "inbox:review" },
  { href: "/search", label: "搜索", icon: "search", capability: "archive:view" },
  { href: "/review", label: "每周回顾", icon: "story", capability: "archive:view" },
  { href: "/stories", label: "故事", icon: "story", capability: "story:write" },
  { href: "/requests", label: "口述史", icon: "microphone", capability: "contribution:create" },
  { href: "/contributions", label: "家庭投递箱", icon: "upload", capability: "contribution:create" },
  { href: "/capsules", label: "时间胶囊", icon: "capsule", capability: "capsule:write" },
  { href: "/books", label: "书籍与备份", icon: "book", capability: "archive:view" },
  { href: "/imports", label: "批量导入", icon: "upload", capability: "archive:view" },
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

const MORE_PREFIXES = ["/more", "/search", "/review", "/stories", "/requests", "/contributions", "/capsules", "/books", "/imports", "/settings", "/trash"];

// 「记忆」聚合了时间轴/日历/相册与整理入口(收件箱);这些路径都让记忆 tab 保持激活。
const MEMORIES_PREFIXES = ["/library", "/timeline", "/memories", "/collections", "/inbox"];

export function isNavigationItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/timeline") return MEMORIES_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (href === "/family") return pathname === href || pathname.startsWith(`${href}/`);
  if (href === "/more") return MORE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
