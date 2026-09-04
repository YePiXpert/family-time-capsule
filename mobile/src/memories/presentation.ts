import type { Person, Viewer } from "../types";

export function shouldRenderStandaloneCover(
  coverAssetId: string | null | undefined,
  galleryAssetIds: readonly string[],
): boolean {
  return Boolean(coverAssetId && !galleryAssetIds.includes(coverAssetId));
}

export function eligibleContributionAuthors(
  viewer: Viewer | null,
  people: readonly Person[],
): Person[] {
  if (!viewer?.canCreateContributions) return [];
  if (viewer.role === "admin" || viewer.role === "editor") return [...people];
  return viewer.personId
    ? people.filter((person) => person.id === viewer.personId)
    : [];
}
