import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { person as personTable } from "@/db/schema/family";
import {
  createContributionAccessSnapshot,
  listVisibleContributionsByAuthor,
} from "@/lib/authz/contribution-access";
import type { FamilyContext } from "@/lib/family/context";
import {
  getTimelineEntriesByIds,
  getTimelinePage,
  type TimelineEntry,
} from "@/lib/memories/service";
import {
  listContributionRequests,
  type RequestWithStats,
} from "@/lib/oral-history/service";

export type PersonNarrative = {
  id: string;
  memoryEventId: string;
  memoryTitle: string;
  text: string;
  visibility: string;
  createdAt: Date;
};

export type PersonProfile = {
  person: typeof personTable.$inferSelect;
  participatingMemories: TimelineEntry[];
  sharedWithChildren: TimelineEntry[];
  narratives: PersonNarrative[];
  oralHistoryRequests: RequestWithStats[];
};

/**
 * Central person-profile read model. Contribution visibility is evaluated for
 * the live viewer, and all event/card data is loaded in bounded batches.
 */
export async function getPersonProfile(
  context: FamilyContext,
  personId: string,
): Promise<PersonProfile | null> {
  const target = await getDb()
    .select()
    .from(personTable)
    .where(
      and(
        eq(personTable.familyId, context.familyId),
        eq(personTable.id, personId),
      ),
    )
    .limit(1);
  if (!target[0]) return null;

  const snapshot = createContributionAccessSnapshot(context);
  const [timeline, visibleNarratives, requests] = await Promise.all([
    getTimelinePage(context.familyId, { personId, limit: 24 }),
    listVisibleContributionsByAuthor(snapshot, personId),
    Promise.resolve(listContributionRequests(context)),
  ]);
  const recentNarratives = [...visibleNarratives]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12);
  const narrativeEvents = await getTimelineEntriesByIds(
    context.familyId,
    recentNarratives.map((row) => row.memoryEventId),
  );
  const eventById = new Map(
    narrativeEvents.map((entry) => [entry.event.id, entry.event]),
  );

  return {
    person: target[0],
    participatingMemories: timeline.entries,
    sharedWithChildren: timeline.entries.filter(
      (entry) => entry.event.childPersonId !== personId,
    ),
    narratives: recentNarratives.flatMap((row) => {
      const event = eventById.get(row.memoryEventId);
      const text = row.editedText ?? row.rawText ?? row.transcript;
      return event && text
        ? [
            {
              id: row.id,
              memoryEventId: row.memoryEventId,
              memoryTitle: event.title,
              text,
              visibility: row.visibility,
              createdAt: row.createdAt,
            },
          ]
        : [];
    }),
    oralHistoryRequests: requests.filter(
      (request) => request.recipientPersonId === personId,
    ),
  };
}
