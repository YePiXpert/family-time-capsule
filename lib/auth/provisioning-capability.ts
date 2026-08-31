import { AsyncLocalStorage } from "node:async_hooks";
import type { FamilyRole } from "@/lib/authz/policy";

/**
 * Process-local capability carried only across the verified invitation
 * provisioning call.  A normal Better Auth HTTP request can never manufacture
 * this AsyncLocalStorage state, and auth.ts still rejects every request-backed
 * /sign-up/email invocation before consulting it.
 */
export type InvitationProvisioningCapability = Readonly<{
  invitationId: string;
  claimNonce: string;
  familyId: string;
  role: FamilyRole;
  personId: string | null;
  accountEmail: string;
}>;

type InvitationProvisioningStore = InvitationProvisioningCapability & {
  createdUserId: string | null;
};

const invitationProvisioningStorage =
  new AsyncLocalStorage<InvitationProvisioningStore>();

export function getInvitationProvisioningCapability():
  | InvitationProvisioningCapability
  | undefined {
  return invitationProvisioningStorage.getStore();
}

/** @internal Better Auth user.create.after records an exact cleanup receipt. */
export function recordInvitationProvisionedUser(userId: string): void {
  const store = invitationProvisioningStorage.getStore();
  if (!store) return;
  if (store.createdUserId && store.createdUserId !== userId) {
    throw new Error("an invitation claim attempted to create multiple users");
  }
  store.createdUserId = userId;
}

export type InvitationProvisioningRunResult<T> =
  | { ok: true; value: T; createdUserId: string | null }
  | { ok: false; createdUserId: string | null };

/** @internal Called only after the invitation service acquired an atomic claim. */
export async function runWithInvitationProvisioningCapability<T>(
  capability: InvitationProvisioningCapability,
  operation: () => Promise<T>,
): Promise<InvitationProvisioningRunResult<T>> {
  if (invitationProvisioningStorage.getStore()) {
    throw new Error("nested invitation provisioning is not allowed");
  }
  const store: InvitationProvisioningStore = {
    ...capability,
    createdUserId: null,
  };
  try {
    const value = await invitationProvisioningStorage.run(store, operation);
    return { ok: true, value, createdUserId: store.createdUserId };
  } catch {
    // Deliberately discard the provider error: callers expose one generic
    // failure and never risk logging a credential-bearing request object.
    return { ok: false, createdUserId: store.createdUserId };
  }
}
