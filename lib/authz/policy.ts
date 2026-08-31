/**
 * Family authorization policy.
 *
 * This module is deliberately pure: every page, Server Action, Route Handler,
 * search query and background job consumes the same decisions instead of
 * re-implementing role checks. Database lookups that build these contexts live
 * in the server-only authorization service.
 */

export const FAMILY_ROLES = [
  "admin",
  "editor",
  "contributor",
  "viewer",
] as const;

export type FamilyRole = (typeof FAMILY_ROLES)[number];

export const FAMILY_CAPABILITIES = [
  "archive:view",
  "capture:create",
  "inbox:review",
  "event:write",
  "story:write",
  "contribution:create",
  "capsule:write",
  "family:manage",
  "account:manage",
  "account:invite",
  "archive:export",
  "backup:manage",
  "audit:view",
  "ai:configure",
  "ai:review",
] as const;

export type FamilyCapability = (typeof FAMILY_CAPABILITIES)[number];

const ROLE_CAPABILITIES: Readonly<Record<FamilyRole, ReadonlySet<FamilyCapability>>> = {
  admin: new Set(FAMILY_CAPABILITIES),
  editor: new Set([
    "archive:view",
    "capture:create",
    "inbox:review",
    "event:write",
    "story:write",
    "contribution:create",
    "capsule:write",
    "ai:review",
  ]),
  contributor: new Set([
    "archive:view",
    "capture:create",
    "contribution:create",
  ]),
  viewer: new Set(["archive:view"]),
};

export function isFamilyRole(value: unknown): value is FamilyRole {
  return typeof value === "string" && FAMILY_ROLES.includes(value as FamilyRole);
}

export function hasFamilyCapability(
  role: FamilyRole,
  capability: FamilyCapability,
): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export class FamilyAuthorizationError extends Error {
  readonly code = "forbidden";
  readonly capability: FamilyCapability;

  constructor(capability: FamilyCapability) {
    super(`family role is not allowed to perform ${capability}`);
    this.name = "FamilyAuthorizationError";
    this.capability = capability;
  }
}

export function assertFamilyCapability(
  role: FamilyRole,
  capability: FamilyCapability,
): void {
  if (!hasFamilyCapability(role, capability)) {
    throw new FamilyAuthorizationError(capability);
  }
}

export const CONTRIBUTION_VISIBILITIES = [
  "private",
  "parents",
  "family",
  "child_later",
] as const;

export type ContributionVisibility =
  (typeof CONTRIBUTION_VISIBILITIES)[number];

export function isContributionVisibility(
  value: unknown,
): value is ContributionVisibility {
  return (
    typeof value === "string" &&
    CONTRIBUTION_VISIBILITIES.includes(value as ContributionVisibility)
  );
}

export type ContributionViewer = {
  /** The viewer and contribution have already been proven to share a family. */
  role: FamilyRole;
  userPersonId: string | null;
  authorPersonId: string;
  /** Explicit Person.isGuardian; never inferred from a free-form relationship label. */
  isGuardian: boolean;
  /** Computed from the event child and the family's explicit unlock policy. */
  childLaterUnlocked: boolean;
  /** Disabled accounts are rejected even if an old session cookie remains. */
  accountEnabled: boolean;
};

/**
 * Normal archive reads, search and Story generation all use this function.
 * Admin is intentionally not a visibility bypass. A separate admin-only
 * disaster export contains every durable row without weakening day-to-day
 * private-content semantics.
 */
export function canViewContribution(
  visibility: ContributionVisibility,
  viewer: ContributionViewer,
): boolean {
  if (!viewer.accountEnabled || !hasFamilyCapability(viewer.role, "archive:view")) {
    return false;
  }

  const isAuthor =
    viewer.userPersonId !== null &&
    viewer.userPersonId === viewer.authorPersonId;

  switch (visibility) {
    case "private":
      return isAuthor;
    case "parents":
      return isAuthor || viewer.isGuardian;
    case "family":
      return true;
    case "child_later":
      return isAuthor || viewer.isGuardian || viewer.childLaterUnlocked;
  }
}

/** Family members may edit only their own words; role does not transfer authorship. */
export function canEditContribution(viewer: ContributionViewer): boolean {
  return (
    viewer.accountEnabled &&
    hasFamilyCapability(viewer.role, "contribution:create") &&
    viewer.userPersonId !== null &&
    viewer.userPersonId === viewer.authorPersonId
  );
}

/**
 * Admins/editors may faithfully record a non-user Person's account; a
 * contributor can submit only as their own linked Person.
 */
export function canCreateContributionForPerson(input: {
  role: FamilyRole;
  userPersonId: string | null;
  authorPersonId: string;
  accountEnabled: boolean;
}): boolean {
  if (
    !input.accountEnabled ||
    !hasFamilyCapability(input.role, "contribution:create")
  ) {
    return false;
  }
  if (input.role === "admin" || input.role === "editor") return true;
  return (
    input.userPersonId !== null &&
    input.userPersonId === input.authorPersonId
  );
}

/** Only this explicit operation bypasses row visibility, for complete backups. */
export function canExportCompleteDisasterArchive(role: FamilyRole): boolean {
  return hasFamilyCapability(role, "archive:export");
}
