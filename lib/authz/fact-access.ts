import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { eventVisibilityCondition } from "./event-access";
import { readableAssetPredicate, readableContributionPredicate, type ContributionAccessSnapshot } from "./contribution-access";

/** A fact inherits every necessary source's current reader boundary. */
export function readableFactPredicate(snapshot: ContributionAccessSnapshot, factId: SQL, options: { confirmedOnly?: boolean } = {}): SQL {
  const familyId = snapshot.principal.familyId;
  return sql`exists (select 1 from fact readable_fact join memory_event fact_event on fact_event.id=readable_fact.memory_event_id
    where readable_fact.id=${factId} and fact_event.family_id=${familyId} and fact_event.deleted_at is null
      and ${options.confirmedOnly ? sql`readable_fact.status='user_confirmed'` : sql`1`}
      and ${eventVisibilityCondition(snapshot, sql`fact_event`)}
      and not exists(select 1 from fact_source readable_fact_source where readable_fact_source.fact_id=readable_fact.id and (
        readable_fact_source.family_id<>${familyId} or not coalesce((
          readable_fact_source.source_type='user_text'
          or (readable_fact_source.source_type in ('asset','asset_analysis') and ${readableAssetPredicate(snapshot, sql`readable_fact_source.source_id`)})
          or (readable_fact_source.source_type='transcript' and exists(select 1 from asset_transcript fact_transcript
            where fact_transcript.id=readable_fact_source.source_id and fact_transcript.family_id=${familyId}
              and ${readableAssetPredicate(snapshot, sql`fact_transcript.asset_id`)}))
          or (readable_fact_source.source_type='contribution' and ${readableContributionPredicate(snapshot, sql`readable_fact_source.source_id`)})
        ),0)
      )))`;
}
