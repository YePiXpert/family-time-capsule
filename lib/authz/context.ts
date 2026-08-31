import "server-only";

import {
  assertFamilyCapability,
  hasFamilyCapability,
  type FamilyCapability,
} from "./policy";
import {
  getApiFamilyContext,
  requireFamily,
  requireSession,
  requireUserBinding,
  type FamilyContext,
  type SessionUser,
} from "@/lib/family/context";
import { InvalidUserBindingError, type UserBinding } from "@/lib/family/service";

/** Server-only authorization context for an authenticated, possibly unbound account. */
export type AccountAuthorizationContext = SessionUser & UserBinding;

/**
 * Used by bootstrap/restore-family actions that run before a user has a family
 * binding. The role is loaded from the database on every call, never trusted
 * from FormData or a stale rendered page.
 */
export async function requireAccountCapability(
  capability: FamilyCapability,
): Promise<AccountAuthorizationContext> {
  const session = await requireSession();
  const binding = await requireUserBinding(session.id);
  assertFamilyCapability(binding.role, capability);
  return { ...session, ...binding };
}

/** Re-authorize every Server Action at its own entry point. */
export async function requireFamilyCapability(
  capability: FamilyCapability,
): Promise<FamilyContext> {
  const context = await requireFamily();
  assertFamilyCapability(context.role, capability);
  return context;
}

export type ApiFamilyAuthorization =
  | { ok: true; context: FamilyContext }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden" };

/**
 * Route Handler authorization with an explicit 401/403 distinction. Invalid
 * persisted roles fail closed as 403 instead of being coerced or escalating.
 */
export async function authorizeApiFamilyRequest(
  requestHeaders: Headers,
  capability: FamilyCapability,
): Promise<ApiFamilyAuthorization> {
  let context: FamilyContext | null;
  try {
    context = await getApiFamilyContext(requestHeaders);
  } catch (error) {
    if (error instanceof InvalidUserBindingError) {
      return { ok: false, status: 403, error: "forbidden" };
    }
    throw error;
  }
  if (!context) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!hasFamilyCapability(context.role, capability)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, context };
}
