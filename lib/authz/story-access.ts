import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { familyReviewAssetPredicate } from "./contribution-access";

/** Family works require every necessary source to permit the whole family. */
export function familyStoryAssetPredicate(familyId: string, assetId: SQL): SQL {
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
  return sql`exists(select 1 from memory_event story_event where story_event.id=${eventId}
    and story_event.family_id=${familyId} and story_event.visibility='family'
    and story_event.status='confirmed' and story_event.deleted_at is null)`;
}

/** Fact references cannot recurse into facts; their schema has this bounded set. */
function familySimpleSourcePredicate(familyId: string, kind: SQL, sourceId: SQL): SQL {
  return sql`(
    ${kind}='user_text'
    or (${kind}='memory_event' and ${familyEventPredicate(familyId, sourceId)})
    or (${kind}='contribution' and exists(select 1 from contribution story_contribution
      where story_contribution.id=${sourceId} and story_contribution.visibility='family' and story_contribution.deleted_at is null
        and ${familyEventPredicate(familyId, sql`story_contribution.memory_event_id`)}))
    or (${kind} in ('asset','asset_analysis') and ${familyStoryAssetPredicate(familyId, sourceId)})
    or (${kind}='transcript' and exists(select 1 from asset_transcript story_transcript
      where story_transcript.id=${sourceId} and story_transcript.family_id=${familyId}
        and ${familyStoryAssetPredicate(familyId, sql`story_transcript.asset_id`)}))
  )`;
}

export function familyStorySourcePredicate(familyId: string, kind: SQL, sourceId: SQL): SQL {
  return sql`(${familySimpleSourcePredicate(familyId, kind, sourceId)}
    or (${kind}='fact' and exists(select 1 from fact story_fact where story_fact.id=${sourceId}
      and story_fact.status='user_confirmed' and ${familyEventPredicate(familyId, sql`story_fact.memory_event_id`)}
      and not exists(select 1 from fact_source story_fact_source where story_fact_source.fact_id=story_fact.id
        and (story_fact_source.family_id<>${familyId}
          or not coalesce(${familySimpleSourcePredicate(familyId, sql`story_fact_source.source_type`, sql`story_fact_source.source_id`)},0)))))
  )`;
}

export function familyStoryPredicate(familyId: string, storyId: SQL): SQL {
  return sql`exists(select 1 from story input_story where input_story.id=${storyId} and input_story.family_id=${familyId}
    and input_story.input_sources_json is not null
    and not exists(select 1 from json_each(input_story.input_sources_json) input_ref
      where not coalesce(${familyStorySourcePredicate(familyId, sql`json_extract(input_ref.value,'$.sourceType')`, sql`json_extract(input_ref.value,'$.sourceId')`)},0)))
    and not exists(select 1 from story_paragraph story_part where story_part.story_id=${storyId}
    and (story_part.family_id<>${familyId}
      or (story_part.kind='quote' and not exists(select 1 from story_source quoted_source where quoted_source.paragraph_id=story_part.id))
      or exists(select 1 from story_source story_ref where story_ref.paragraph_id=story_part.id
        and (story_ref.family_id<>${familyId}
          or not coalesce(${familyStorySourcePredicate(familyId, sql`story_ref.source_type`, sql`story_ref.source_id`)},0)))))`;
}
