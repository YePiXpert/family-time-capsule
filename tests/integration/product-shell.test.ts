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

/**
 * 正式 1.0 信息架构(M1):一级入口 今天/记忆/记录/家人/我的;
 * 收件箱下沉为「整理入口」(二级导航 + 记忆页内),/inbox 路由保留。
 */
describe("product shell navigation", () => {
  it("keeps exactly five primary destinations with capture emphasized", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual([
      "今天",
      "记忆",
      "记录",
      "家人",
      "我的",
    ]);
    expect(PRIMARY_NAVIGATION).toHaveLength(5);
    expect(PRIMARY_NAVIGATION.find((item) => item.emphasis)?.href).toBe(
      "/capture",
    );
  });

  it("demotes the inbox to an organizing entry in secondary navigation", () => {
    // /inbox 保留在二级导航首位(整理入口),不在一级导航。
    expect(PRIMARY_NAVIGATION.some((item) => item.href === "/inbox")).toBe(
      false,
    );
    expect(SECONDARY_NAVIGATION[0]).toMatchObject({
      href: "/inbox",
      label: "待整理",
    });
    expect(SECONDARY_NAVIGATION.map((item) => item.href)).toEqual([
      "/inbox",
      "/search",
      "/review",
      "/stories",
      "/requests",
      "/contributions",
      "/capsules",
      "/books",
      "/imports",
      "/settings",
      "/trash",
    ]);
  });

  it("maps memory reading (incl. inbox/collections) to the memories tab and secondary routes to mine", () => {
    expect(isNavigationItemActive("/memories/event-1", "/timeline")).toBe(
      true,
    );
    expect(isNavigationItemActive("/inbox", "/timeline")).toBe(true);
    expect(isNavigationItemActive("/inbox/item", "/timeline")).toBe(true);
    expect(isNavigationItemActive("/collections/summer", "/timeline")).toBe(
      true,
    );
    expect(isNavigationItemActive("/family/person-1", "/family")).toBe(true);
    expect(isNavigationItemActive("/stories/story-1", "/more")).toBe(
      true,
    );
    expect(isNavigationItemActive("/contributions/new", "/more")).toBe(
      true,
    );
    expect(isNavigationItemActive("/capture", "/more")).toBe(false);
  });

  it.each([
    ["admin", ["今天", "记忆", "记录", "家人", "我的"], ["待整理", "搜索", "每周回顾", "故事", "口述史", "家庭投递箱", "时间胶囊", "书籍与备份", "批量导入", "设置", "回收站"]],
    ["editor", ["今天", "记忆", "记录", "家人", "我的"], ["待整理", "搜索", "每周回顾", "故事", "口述史", "家庭投递箱", "时间胶囊", "书籍与备份", "批量导入", "设置", "回收站"]],
    ["contributor", ["今天", "记忆", "记录", "家人", "我的"], ["搜索", "每周回顾", "口述史", "家庭投递箱", "书籍与备份", "批量导入", "设置"]],
    ["viewer", ["今天", "记忆", "家人", "我的"], ["搜索", "每周回顾", "书籍与备份", "批量导入", "设置"]],
  ] as const)("filters %s navigation by durable capabilities", (role, primary, secondary) => {
    const capabilities = FAMILY_CAPABILITIES.filter((capability) =>
      hasFamilyCapability(role as FamilyRole, capability),
    );
    expect(filterNavigationByCapabilities(PRIMARY_NAVIGATION, capabilities).map((item) => item.label)).toEqual(primary);
    expect(filterNavigationByCapabilities(SECONDARY_NAVIGATION, capabilities).map((item) => item.label)).toEqual(secondary);
  });
});
