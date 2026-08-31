import "server-only";

import type { FamilyRole } from "./policy";
import {
  getUserBinding,
  InvalidUserBindingError,
} from "@/lib/family/service";
import type { FamilyContext } from "@/lib/family/context";

export type LiveFamilyPrincipal = Readonly<{
  userId: string;
  familyId: string;
  personId: string | null;
  role: FamilyRole;
  accountEnabled: true;
  isGuardian: boolean;
  familyTimezone: string;
  childLaterUnlockAge: number;
}>;

export class PrincipalAuthorizationError extends Error {
  readonly code = "forbidden";

  constructor() {
    super("family principal is not enabled in the requested family");
    this.name = "PrincipalAuthorizationError";
  }
}

/** Worker-safe live lookup: never accepts role/Person policy from a job payload. */
export async function getLiveFamilyPrincipal(
  userId: string,
  expectedFamilyId: string,
): Promise<LiveFamilyPrincipal> {
  const binding = await getUserBinding(userId);
  if (
    binding.familyId !== expectedFamilyId ||
    binding.familyTimezone === null ||
    binding.childLaterUnlockAge === null
  ) {
    throw new PrincipalAuthorizationError();
  }
  return {
    userId,
    familyId: binding.familyId,
    personId: binding.personId,
    role: binding.role,
    accountEnabled: binding.accountEnabled,
    isGuardian: binding.isGuardian,
    familyTimezone: binding.familyTimezone,
    childLaterUnlockAge: binding.childLaterUnlockAge,
  };
}

/** Fail-closed equality check for a previously captured request snapshot. */
export async function isLiveFamilyPrincipal(
  principal: LiveFamilyPrincipal,
): Promise<boolean> {
  try {
    const live = await getLiveFamilyPrincipal(principal.userId, principal.familyId);
    return (
      live.personId === principal.personId &&
      live.role === principal.role &&
      live.accountEnabled === principal.accountEnabled &&
      live.isGuardian === principal.isGuardian &&
      live.familyTimezone === principal.familyTimezone &&
      live.childLaterUnlockAge === principal.childLaterUnlockAge
    );
  } catch (error) {
    if (
      error instanceof PrincipalAuthorizationError ||
      error instanceof InvalidUserBindingError
    ) {
      return false;
    }
    throw error;
  }
}

export function principalFromFamilyContext(
  context: FamilyContext,
): LiveFamilyPrincipal {
  return {
    userId: context.userId,
    familyId: context.familyId,
    personId: context.personId,
    role: context.role,
    accountEnabled: context.accountEnabled,
    isGuardian: context.isGuardian,
    familyTimezone: context.familyTimezone,
    childLaterUnlockAge: context.childLaterUnlockAge,
  };
}

/** Stable YYYY-MM-DD in the family's IANA timezone. */
export function familyLocalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error("family local date unavailable");
  return `${year}-${month}-${day}`;
}
