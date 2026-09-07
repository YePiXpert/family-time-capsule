/**
 * Family authorization policy.
 *
 * This module is deliberately pure: every page, Server Action, Route Handler,
 * search query and background job consumes the same decisions instead of
 * re-implementing role checks. Database lookups that build these contexts live
 * in the server-only authorization service.
 */

/**
 * 正式 1.0(M2):owner 是唯一的家庭所有权持有者。
 * owner ⊇ admin,另持 family:transfer(所有权移交);日常管理两者等价,
 * 避免“每个管理员都能解散/移交家庭”的歧义。历史安装由迁移 0047 把最早的
 * admin 提升为 owner;新实例首个管理员直接以 owner 建立。
 */
export const FAMILY_ROLES = [
  "owner",
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
  "family:transfer",
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
  owner: new Set(FAMILY_CAPABILITIES),
  admin: new Set(
    FAMILY_CAPABILITIES.filter((capability) => capability !== "family:transfer"),
  ),
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

/** 管理类角色：owner ∪ admin。SQL actor 复核与“最后一个管理员”守卫共用。 */
export const ADMIN_CLASS_ROLES: readonly FamilyRole[] = ["owner", "admin"];

export function isAdminClassRole(role: FamilyRole): boolean {
  return ADMIN_CLASS_ROLES.includes(role);
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

export const EVENT_VISIBILITIES = ["family", "members", "private"] as const;

export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export function isEventVisibility(value: unknown): value is EventVisibility {
  return (
    typeof value === "string" &&
    EVENT_VISIBILITIES.includes(value as EventVisibility)
  );
}

export type EventViewer = {
  /** The viewer and event have already been proven to share a family. */
  role: FamilyRole;
  userId: string;
  /** Disabled accounts are rejected even if an old session cookie remains. */
  accountEnabled: boolean;
};

/**
 * 正式 1.0 §5 对象级读者裁决（纯函数，所有读路径共用）：
 * - family：有 archive:view 即可读（历史事件语义）；
 * - members：仅作者与显式读者清单中的用户；
 * - private：仅作者。
 * 管理员/owner 不是旁路——他们与普通成员走同一裁决；完整灾备导出走
 * 独立的 canExportCompleteDisasterArchive 通道。作者缺失（历史数据无法
 * 可靠恢复）时非 family 一律拒绝，绝不伪造作者。
 */
export function canViewMemoryEvent(
  visibility: EventVisibility,
  authorUserId: string | null,
  readerUserIds: ReadonlySet<string>,
  viewer: EventViewer,
): boolean {
  if (!viewer.accountEnabled || !hasFamilyCapability(viewer.role, "archive:view")) {
    return false;
  }
  const isAuthor = authorUserId !== null && authorUserId === viewer.userId;
  switch (visibility) {
    case "family":
      return true;
    case "members":
      return isAuthor || readerUserIds.has(viewer.userId);
    case "private":
      return isAuthor;
  }
}

/** 读者与可见性管理仅归作者；读取不授予编辑，编辑不授予扩大读者。 */
export function canManageEventVisibility(
  visibility: EventVisibility,
  authorUserId: string | null,
  viewer: EventViewer,
): boolean {
  if (!viewer.accountEnabled) return false;
  const isAuthor = authorUserId !== null && authorUserId === viewer.userId;
  switch (visibility) {
    case "family":
      return hasFamilyCapability(viewer.role, "event:write");
    case "members":
    case "private":
      return isAuthor && hasFamilyCapability(viewer.role, "event:write");
  }
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
  if (input.role === "owner" || input.role === "admin" || input.role === "editor") return true;
  return (
    input.userPersonId !== null &&
    input.userPersonId === input.authorPersonId
  );
}

/** Only this explicit operation bypasses row visibility, for complete backups. */
export function canExportCompleteDisasterArchive(role: FamilyRole): boolean {
  return hasFamilyCapability(role, "archive:export");
}
