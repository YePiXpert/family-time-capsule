import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  SECONDARY_NAVIGATION,
  isNavigationItemActive,
} from "@/components/navigation-items";

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
});
