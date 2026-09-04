import "server-only";

import { hasFamilyCapability } from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";
import { getReviewOverview } from "@/lib/review/service";

export async function getMobileReview(context: FamilyContext, anchorDate?: string) {
  const review = await getReviewOverview(context, anchorDate);
  return {
    id: review.period.id,
    key: review.key,
    periodStart: review.period.periodStart.toISOString(),
    periodEnd: review.period.periodEnd.toISOString(),
    status: review.period.status,
    storyId: review.period.storyId,
    startedAt: review.period.startedAt?.toISOString() ?? null,
    completedAt: review.period.completedAt?.toISOString() ?? null,
    canWrite: hasFamilyCapability(context.role, "story:write"),
    preferences: review.preferences,
    counts: review.counts,
    reminderAt: review.reminderAt?.toISOString() ?? null,
    events: review.events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}
