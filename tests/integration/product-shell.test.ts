import { describe, expect, it } from "vitest";
import { filterNavigationByCapabilities, PRIMARY_NAVIGATION, SECONDARY_NAVIGATION, isNavigationItemActive } from "@/components/navigation-items";
import { FAMILY_CAPABILITIES, hasFamilyCapability } from "@/lib/authz/policy";
describe("simplified navigation", () => {
  it("keeps growth, books and profile with a separate permission-gated capture action", () => {
    expect(PRIMARY_NAVIGATION.map(item => item.label)).toEqual(["成长", "成长册", "我的"]);
    expect(SECONDARY_NAVIGATION[0].emphasis).toBe(true);
    expect(SECONDARY_NAVIGATION.map(item => item.href)).toEqual(["/capture"]);
  });
  it("keeps detail and search routes in their parent destination", () => {
    for (const path of ["/", "/memories/a", "/inbox", "/search"]) expect(isNavigationItemActive(path, "/timeline")).toBe(true);
    expect(isNavigationItemActive("/collections/a", "/books")).toBe(true);
    expect(isNavigationItemActive("/collections/a", "/timeline")).toBe(false);
    expect(isNavigationItemActive("/books/a", "/books")).toBe(true);
    expect(isNavigationItemActive("/settings", "/books")).toBe(false);
  });
  it.each(["owner", "admin", "editor", "contributor", "viewer"] as const)("preserves %s capabilities while simplifying navigation", role => {
    const capabilities = FAMILY_CAPABILITIES.filter(c => hasFamilyCapability(role,c));
    expect(filterNavigationByCapabilities(PRIMARY_NAVIGATION,capabilities).map(item=>item.label)).toEqual(["成长", "成长册", "我的"]);
    expect(filterNavigationByCapabilities(SECONDARY_NAVIGATION,capabilities).map(item=>item.label)).toEqual(role === "viewer" ? [] : ["记录一刻"]);
  });
});
