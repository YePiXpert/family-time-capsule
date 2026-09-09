import { describe, expect, it } from "vitest";
import {
  HOME_CAPTURE_ACTIONS,
  resolveSearchTarget,
} from "../src/navigation/intents";
import {
  eligibleContributionAuthors,
  shouldRenderStandaloneCover,
} from "../src/memories/presentation";
import type { Person, Viewer } from "../src/types";

describe("native navigation and reading details", () => {
  it("keeps all four home capture intents distinct", () => {
    expect(HOME_CAPTURE_ACTIONS.map((action) => action.intent)).toEqual([
      "text",
      "photo",
      "audio",
      "library",
    ]);
  });

  it("routes source matches to concrete native detail screens", () => {
    expect(resolveSearchTarget({ type: "contribution", id: "c-1", eventId: "memory-1" })).toEqual({
      kind: "memory",
      id: "memory-1",
    });
  });

  it("does not render a timeline cover again when the gallery already contains it", () => {
    expect(shouldRenderStandaloneCover("asset-1", ["asset-1", "asset-2"])).toBe(false);
    expect(shouldRenderStandaloneCover("asset-1", ["asset-2"])).toBe(true);
  });

  it("limits contributor authorship while allowing editors to identify an author", () => {
    const people: Person[] = [
      { id: "person-a", displayName: "妈妈", relationToChild: null, isChild: false, birthDate: null, updatedAt: "2026-09-04T00:00:00.000Z" },
      { id: "person-b", displayName: "外婆", relationToChild: null, isChild: false, birthDate: null, updatedAt: "2026-09-04T00:00:00.000Z" },
    ];
    const viewer = (role: Viewer["role"], personId: string | null): Viewer => ({
      id: `${role}-user`,
      name: role,
      role,
      personId,
      canCapture: role !== "viewer",
      canReviewInbox: role === "owner" || role === "admin" || role === "editor",
      canCreateContributions: role !== "viewer",
      canEditEvents: role === "owner" || role === "admin" || role === "editor",
    });
    expect(eligibleContributionAuthors(viewer("owner", "person-a"), people).map((person) => person.id)).toEqual(["person-a", "person-b"]);
    expect(eligibleContributionAuthors(viewer("editor", "person-a"), people).map((person) => person.id)).toEqual(["person-a", "person-b"]);
    expect(eligibleContributionAuthors(viewer("contributor", "person-a"), people).map((person) => person.id)).toEqual(["person-a"]);
    expect(eligibleContributionAuthors(viewer("viewer", "person-a"), people)).toEqual([]);
    expect(eligibleContributionAuthors(viewer("contributor", null), people)).toEqual([]);
  });
});
