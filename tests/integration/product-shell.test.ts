import { describe, expect, it } from "vitest";
import { filterNavigationByCapabilities, PRIMARY_NAVIGATION, SECONDARY_NAVIGATION, isNavigationItemActive } from "@/components/navigation-items";
import { FAMILY_CAPABILITIES, hasFamilyCapability } from "@/lib/authz/policy";
describe("simplified navigation", () => {
  it("keeps recording between memories and works, with management outside the main menu", () => {
    expect(PRIMARY_NAVIGATION.map(item => item.label)).toEqual(["记忆", "记录", "作品"]);
    expect(PRIMARY_NAVIGATION[1].emphasis).toBe(true);
    expect(SECONDARY_NAVIGATION.map(item => item.href)).toEqual(["/settings"]);
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
    expect(filterNavigationByCapabilities(PRIMARY_NAVIGATION,capabilities).map(item=>item.label)).toEqual(role === "viewer" ? ["记忆", "作品"] : ["记忆", "记录", "作品"]);
    expect(filterNavigationByCapabilities(SECONDARY_NAVIGATION,capabilities).map(item=>item.label)).toEqual(["设置"]);
  });
});
