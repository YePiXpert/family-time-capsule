import { describe, expect, it } from "vitest";
import {
  filterNavigationByCapabilities,
  PRIMARY_NAVIGATION,
  SECONDARY_NAVIGATION,
  isNavigationItemActive,
} from "@/components/navigation-items";
import {
  FAMILY_CAPABILITIES,
  hasFamilyCapability,
  type FamilyRole,
} from "@/lib/authz/policy";

describe("product shell navigation", () => {
  it("keeps exactly five mobile-level destinations with capture emphasized", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual([
      "首页",
      "时间轴",
      "记录",
      "收件箱",
      "更多",
    ]);
    expect(PRIMARY_NAVIGATION).toHaveLength(5);
    expect(PRIMARY_NAVIGATION.find((item) => item.emphasis)?.href).toBe(
      "/capture",
    );
  });

  it("places every requested secondary destination under more", () => {
    expect(SECONDARY_NAVIGATION.map((item) => item.href)).toEqual([
      "/search",
      "/family",
      "/stories",
      "/requests",
      "/capsules",
      "/books",
      "/settings",
      "/trash",
    ]);
  });

  it("maps memory reading to timeline and secondary routes to more on mobile", () => {
    expect(isNavigationItemActive("/memories/event-1", "/timeline", true)).toBe(
      true,
    );
    expect(isNavigationItemActive("/stories/story-1", "/more", true)).toBe(
      true,
    );
    expect(isNavigationItemActive("/capture", "/more", true)).toBe(false);
  });

  it.each([
    ["admin", ["首页", "时间轴", "记录", "收件箱", "更多"], ["搜索", "家人", "故事", "口述史", "时间胶囊", "书籍与备份", "设置", "回收站"]],
    ["editor", ["首页", "时间轴", "记录", "收件箱", "更多"], ["搜索", "故事", "口述史", "时间胶囊", "书籍与备份", "设置", "回收站"]],
    ["contributor", ["首页", "时间轴", "记录", "更多"], ["搜索", "口述史", "书籍与备份", "设置"]],
    ["viewer", ["首页", "时间轴", "更多"], ["搜索", "书籍与备份", "设置"]],
  ] as const)("filters %s navigation by durable capabilities", (role, primary, secondary) => {
    const capabilities = FAMILY_CAPABILITIES.filter((capability) =>
      hasFamilyCapability(role as FamilyRole, capability),
    );
    expect(filterNavigationByCapabilities(PRIMARY_NAVIGATION, capabilities).map((item) => item.label)).toEqual(primary);
    expect(filterNavigationByCapabilities(SECONDARY_NAVIGATION, capabilities).map((item) => item.label)).toEqual(secondary);
  });
});
