import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { familyReviewAssetPredicate } from "./contribution-access";

/** Family works require every necessary source to permit the whole family. */
export function familySourceAssetPredicate(familyId: string, assetId: SQL): SQL {
  return sql`exists (
    with recursive ancestors(id,parent) as (
      select id,original_asset_id from asset where id=${assetId} and family_id=${familyId}
      union select a.id,a.original_asset_id from asset a join ancestors p on a.id=p.parent where a.family_id=${familyId}
    ), root(id) as (select id from ancestors where parent is null), tree(id) as (
      select id from root union select a.id from asset a join tree t on a.original_asset_id=t.id where a.family_id=${familyId}
    ) select 1 from root where (
      exists(select 1 from asset a where a.id=root.id and a.visibility='family')
      or exists(select 1 from tree reviewed where ${familyReviewAssetPredicate(familyId, sql`reviewed.id`)})
      or exists(select 1 from memory_event e join memory_event_asset ma on ma.memory_event_id=e.id and ma.family_id=e.family_id
        where e.family_id=${familyId} and e.visibility='family' and e.status='confirmed' and e.deleted_at is null and ma.asset_id in (select id from tree))
    ) and not exists(select 1 from contribution c join memory_event e on e.id=c.memory_event_id
      where c.audio_asset_id in (select id from tree) and (coalesce(c.visibility,'')<>'family' or e.family_id<>${familyId}))
  )`;
}

function familyEventPredicate(familyId: string, eventId: SQL): SQL {
  return sql`exists(select 1 from memory_event source_event where source_event.id=${eventId}
    and source_event.family_id=${familyId} and source_event.visibility='family'
    and source_event.status='confirmed' and source_event.deleted_at is null)`;
}

/** Fact references cannot recurse into facts; their schema has this bounded set. */
function familySimpleSourcePredicate(familyId: string, kind: SQL, sourceId: SQL): SQL {
  return sql`(
    ${kind}='user_text'
    or (${kind}='memory_event' and ${familyEventPredicate(familyId, sourceId)})
    or (${kind}='contribution' and exists(select 1 from contribution source_contribution
      where source_contribution.id=${sourceId} and source_contribution.visibility='family' and source_contribution.deleted_at is null
        and ${familyEventPredicate(familyId, sql`source_contribution.memory_event_id`)}))
    or (${kind} in ('asset','asset_analysis') and ${familySourceAssetPredicate(familyId, sourceId)})
    or (${kind}='transcript' and exists(select 1 from asset_transcript source_transcript
      where source_transcript.id=${sourceId} and source_transcript.family_id=${familyId}
        and ${familySourceAssetPredicate(familyId, sql`source_transcript.asset_id`)}))
  )`;
}

export function familySourcePredicate(familyId: string, kind: SQL, sourceId: SQL): SQL {
  return sql`(${familySimpleSourcePredicate(familyId, kind, sourceId)}
    or (${kind}='fact' and exists(select 1 from fact source_fact where source_fact.id=${sourceId}
      and source_fact.status='user_confirmed' and ${familyEventPredicate(familyId, sql`source_fact.memory_event_id`)}
      and not exists(select 1 from fact_source source_fact_source where source_fact_source.fact_id=source_fact.id
        and (source_fact_source.family_id<>${familyId}
          or not coalesce(${familySimpleSourcePredicate(familyId, sql`source_fact_source.source_type`, sql`source_fact_source.source_id`)},0)))))
  )`;
}


