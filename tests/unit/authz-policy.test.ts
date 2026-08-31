import { describe, expect, it } from "vitest";
import {
  assertFamilyCapability,
  canCreateContributionForPerson,
  canEditContribution,
  canExportCompleteDisasterArchive,
  canViewContribution,
  FamilyAuthorizationError,
  hasFamilyCapability,
  isFamilyRole,
  type ContributionViewer,
  type FamilyRole,
} from "@/lib/authz/policy";

const baseViewer: ContributionViewer = {
  role: "viewer",
  userPersonId: "viewer-person",
  authorPersonId: "author-person",
  isGuardian: false,
  childLaterUnlocked: false,
  accountEnabled: true,
};

describe("family role capabilities", () => {
  it("accepts exactly the four durable roles", () => {
    for (const role of ["admin", "editor", "contributor", "viewer"]) {
      expect(isFamilyRole(role)).toBe(true);
    }
    expect(isFamilyRole("owner")).toBe(false);
    expect(isFamilyRole(null)).toBe(false);
  });

  it("keeps administration and disaster export admin-only", () => {
    for (const role of ["editor", "contributor", "viewer"] as FamilyRole[]) {
      expect(hasFamilyCapability(role, "family:manage")).toBe(false);
      expect(hasFamilyCapability(role, "account:invite")).toBe(false);
      expect(canExportCompleteDisasterArchive(role)).toBe(false);
    }
    expect(hasFamilyCapability("admin", "family:manage")).toBe(true);
    expect(canExportCompleteDisasterArchive("admin")).toBe(true);
  });

  it("allows editors to curate archive state and contributors only to submit", () => {
    expect(hasFamilyCapability("editor", "inbox:review")).toBe(true);
    expect(hasFamilyCapability("editor", "event:write")).toBe(true);
    expect(hasFamilyCapability("contributor", "capture:create")).toBe(true);
    expect(hasFamilyCapability("contributor", "contribution:create")).toBe(true);
    expect(hasFamilyCapability("contributor", "inbox:review")).toBe(false);
    expect(hasFamilyCapability("viewer", "capture:create")).toBe(false);
  });

  it("throws a stable authorization error", () => {
    expect(() => assertFamilyCapability("viewer", "event:write")).toThrow(
      FamilyAuthorizationError,
    );
    try {
      assertFamilyCapability("viewer", "event:write");
    } catch (error) {
      expect(error).toMatchObject({ code: "forbidden", capability: "event:write" });
    }
  });
});

describe("contribution visibility", () => {
  it("private is visible only to its linked author, including against admin", () => {
    expect(canViewContribution("private", baseViewer)).toBe(false);
    expect(
      canViewContribution("private", {
        ...baseViewer,
        role: "admin",
      }),
    ).toBe(false);
    expect(
      canViewContribution("private", {
        ...baseViewer,
        userPersonId: "author-person",
      }),
    ).toBe(true);
  });

  it("parents uses an explicit guardian flag, never a role or display label", () => {
    expect(
      canViewContribution("parents", { ...baseViewer, role: "admin" }),
    ).toBe(false);
    expect(
      canViewContribution("parents", { ...baseViewer, isGuardian: true }),
    ).toBe(true);
  });

  it("family is visible to every enabled same-family role", () => {
    for (const role of ["admin", "editor", "contributor", "viewer"] as const) {
      expect(canViewContribution("family", { ...baseViewer, role })).toBe(true);
    }
  });

  it("child_later stays with author/guardians until the policy unlocks", () => {
    expect(canViewContribution("child_later", baseViewer)).toBe(false);
    expect(
      canViewContribution("child_later", { ...baseViewer, isGuardian: true }),
    ).toBe(true);
    expect(
      canViewContribution("child_later", {
        ...baseViewer,
        childLaterUnlocked: true,
      }),
    ).toBe(true);
  });

  it("disabled accounts cannot read even family-visible content", () => {
    expect(
      canViewContribution("family", { ...baseViewer, accountEnabled: false }),
    ).toBe(false);
  });
});

describe("contribution authorship", () => {
  it("only an enabled author with contribution permission can edit their words", () => {
    expect(
      canEditContribution({ ...baseViewer, role: "admin" }),
    ).toBe(false);
    expect(
      canEditContribution({
        ...baseViewer,
        role: "contributor",
        userPersonId: "author-person",
      }),
    ).toBe(true);
    expect(
      canEditContribution({
        ...baseViewer,
        role: "viewer",
        userPersonId: "author-person",
      }),
    ).toBe(false);
  });

  it("contributors submit as themselves while admin/editor can record non-user Persons", () => {
    expect(
      canCreateContributionForPerson({
        role: "contributor",
        userPersonId: "p1",
        authorPersonId: "p2",
        accountEnabled: true,
      }),
    ).toBe(false);
    expect(
      canCreateContributionForPerson({
        role: "contributor",
        userPersonId: "p1",
        authorPersonId: "p1",
        accountEnabled: true,
      }),
    ).toBe(true);
    expect(
      canCreateContributionForPerson({
        role: "editor",
        userPersonId: "p1",
        authorPersonId: "grandparent",
        accountEnabled: true,
      }),
    ).toBe(true);
  });
});
