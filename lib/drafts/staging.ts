import "server-only";
import { sql } from "drizzle-orm";
import { canManageEventVisibilityInTransaction, createEventAccessSnapshot } from "@/lib/authz/event-access";
import type { ContributionAccessTransaction } from "@/lib/authz/contribution-access";
import type { FamilyContext } from "@/lib/family/context";

export type DraftPurpose = "capture" | "memory_edit";
export type DraftPurposeInput = { purpose?: unknown; editTargetMemoryId?: unknown };

export function canStageMemoryEdit(tx: ContributionAccessTransaction, context: FamilyContext, eventId: string | null): boolean {
  return !!eventId && canManageEventVisibilityInTransaction(tx, createEventAccessSnapshot(context), eventId);
}

/** Private editing originals can only gain a new published reference in apply. */
export function isUnappliedEditOriginal(tx: ContributionAccessTransaction, familyId: string, assetId: string): boolean {
  return !!tx.get(sql`select 1 from upload_session u join draft d on d.id=u.draft_id
    where u.family_id=${familyId} and d.family_id=${familyId} and u.final_asset_id=${assetId}
      and d.purpose='memory_edit' and d.status <> 'applied' limit 1`);
}
