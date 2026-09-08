import "server-only";
import { sql } from "drizzle-orm";
import { familyReviewAssetPredicate, type ContributionAccessTransaction } from "./contribution-access";

/** Call after live role and original-read authorization, in the mutation transaction. */
export function canManageOriginalInTransaction(
  tx: ContributionAccessTransaction,
  principal: { familyId: string; userId: string },
  original: { id: string; familyId: string; originalAssetId: string | null; visibility: string; createdByUserId: string | null },
): boolean {
  if (original.familyId !== principal.familyId || original.originalAssetId !== null) return false;
  return original.visibility === "family" || original.createdByUserId === principal.userId ||
    Boolean(tx.get(sql`select 1 where ${familyReviewAssetPredicate(principal.familyId, sql`${original.id}`)}`));
}
