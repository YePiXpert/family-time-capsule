import "server-only";

/**
 * 注意：本模块刻意不引入 `server-only` —— `npm run search:rebuild` 与恢复
 * CLI 都要在纯 Node 进程中直接导入它（与 lib/restore、lib/export 同一惯例）。
 * 授权语义由调用方保证：searchFamily 必须传入 requireFamily() 的 FamilyContext。
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { asset as assetTable, documentText as documentTextTable } from "@/db/schema/asset";
import { contribution as contributionTable } from "@/db/schema/contribution";
import { fact as factTable } from "@/db/schema/contribution";
import { memoryEvent, memoryEventAsset, memoryEventParticipant } from "@/db/schema/memory";
import { memoryEventTag } from "@/db/schema/suggestion";
import { assetTranscript } from "@/db/schema/transcript";
import { story as storyTable, storyParagraph as storyParagraphTable } from "@/db/schema/story";
import { person as personTable } from "@/db/schema/family";
import type { FamilyContext } from "@/lib/family/context";
import { canViewContribution, type ContributionVisibility } from "@/lib/authz/policy";
import { tokensForIndex, ftsQueryExpression, isSingleCjkChar } from "./tokenizer";

type Db = AppDatabase;

/**
 * M4 全文搜索：SQLite FTS5（bigram 预分词），完全离线、不依赖 AI。
 *
 * - 索引是可整体重建的 derivative：`npm run search:rebuild` 全量重建，
 *   恢复完成后自动重建；主数据永远以关系表为准；
 * - 家庭隔离（family_id）+ 可见性后过滤：private/parents/child_later 的
 *   Contribution 行只有策略允许的读者能在搜索中看到，绝不泄漏；
 * - 只索引 user_confirmed Fact、用户修订过的 Transcript、family 域的事件标题。
 */

export type SearchEntityType =
  | "memory_event"
  | "fact"
  | "contribution"
  | "transcript"
  | "story"
  | "document";

type IndexRow = {
  original_text: string;
  family_id: string;
  entity_type: SearchEntityType;
  entity_id: string;
  event_id: string | null;
  visibility: string;
  author_person_id: string | null;
  child_person_id: string | null;
};

function insertIndexRows(db: Db, rows: IndexRow[]): void {
  if (rows.length === 0) return;
  for (const row of rows) {
    db.run(
      // FTS5 表不在 drizzle schema 中；sql`` 模板保持参数化
      sql`INSERT INTO search_index (tokens, original_text, family_id, entity_type, entity_id, event_id, visibility, author_person_id, child_person_id)
          VALUES (${tokensForIndex(row.original_text)}, ${row.original_text}, ${row.family_id}, ${row.entity_type}, ${row.entity_id}, ${row.event_id}, ${row.visibility}, ${row.author_person_id}, ${row.child_person_id})`,
    );
  }
}

export function removeFromSearchIndex(
  entityType: SearchEntityType,
  entityId: string,
): void {
  getDb().run(
    sql`DELETE FROM search_index WHERE entity_type = ${entityType} AND entity_id = ${entityId}`,
  );
}

// ---- 单实体索引挂钩（服务层写入路径调用） ----

export function indexMemoryEvent(event: {
  id: string;
  familyId: string;
  title: string;
  childPersonId: string;
}): void {
  removeFromSearchIndex("memory_event", event.id);
  insertIndexRows(getDb(), [
    {
      original_text: event.title,
      family_id: event.familyId,
      entity_type: "memory_event",
      entity_id: event.id,
      event_id: event.id,
      visibility: "family",
      author_person_id: null,
      child_person_id: event.childPersonId,
    },
  ]);
}

export function indexFactIfConfirmed(factRow: {
  id: string;
  familyId: string;
  memoryEventId: string;
  statement: string;
  status: string;
}): void {
  removeFromSearchIndex("fact", factRow.id);
  if (factRow.status !== "user_confirmed") return;
  insertIndexRows(getDb(), [
    {
      original_text: factRow.statement,
      family_id: factRow.familyId,
      entity_type: "fact",
      entity_id: factRow.id,
      event_id: factRow.memoryEventId,
      visibility: "family",
      author_person_id: null,
      child_person_id: null,
    },
  ]);
}

export function indexContribution(row: {
  id: string;
  familyId: string;
  memoryEventId: string;
  authorPersonId: string;
  rawText: string | null;
  editedText: string | null;
  visibility: string;
}): void {
  removeFromSearchIndex("contribution", row.id);
  const text = (row.editedText ?? row.rawText ?? "").trim();
  if (!text) return;
  insertIndexRows(getDb(), [
    {
      original_text: text,
      family_id: row.familyId,
      entity_type: "contribution",
      entity_id: row.id,
      event_id: row.memoryEventId,
      visibility: row.visibility,
      author_person_id: row.authorPersonId,
      child_person_id: null,
    },
  ]);
}

export function indexEditedTranscript(row: {
  id: string;
  familyId: string;
  assetId: string;
  editedTranscript: string | null;
}): void {
  removeFromSearchIndex("transcript", row.id);
  const text = (row.editedTranscript ?? "").trim();
  if (!text) return;
  const db = getDb();
  const link = db
    .select({ eventId: memoryEventAsset.memoryEventId })
    .from(memoryEventAsset)
    .where(eq(memoryEventAsset.assetId, row.assetId))
    .limit(1)
    .get();
  if (!link) return; // 未关联事件的转录暂不入索引
  insertIndexRows(db, [
    {
      original_text: text,
      family_id: row.familyId,
      entity_type: "transcript",
      entity_id: row.id,
      event_id: link.eventId,
      visibility: "family",
      author_person_id: null,
      child_person_id: null,
    },
  ]);
}

export function indexStory(row: {
  id: string;
  familyId: string;
  title: string;
  bodyText: string;
}): void {
  removeFromSearchIndex("story", row.id);
  insertIndexRows(getDb(), [
    {
      original_text: `${row.title}\n${row.bodyText}`,
      family_id: row.familyId,
      entity_type: "story",
      entity_id: row.id,
      event_id: null,
      visibility: "family",
      author_person_id: null,
      child_person_id: null,
    },
  ]);
}

export function indexDocumentAssetsForEvent(
  familyId: string,
  eventId: string,
  assetIds: string[],
): void {
  const db = getDb();
  for (const assetId of assetIds) removeFromSearchIndex("document", assetId);
  if (assetIds.length === 0) return;
  const rows = db
    .select({ id: documentTextTable.assetId, text: documentTextTable.text })
    .from(documentTextTable)
    .where(
      and(
        eq(documentTextTable.familyId, familyId),
        inArray(documentTextTable.assetId, assetIds),
      ),
    )
    .all();
  insertIndexRows(db, rows.map((row) => ({
    original_text: row.text,
    family_id: familyId,
    entity_type: "document" as const,
    entity_id: row.id,
    event_id: eventId,
    visibility: "family",
    author_person_id: null,
    child_person_id: null,
  })));
}

// ---- 全量重建 ----

export function rebuildSearchIndex(): {
  events: number;
  facts: number;
  contributions: number;
  transcripts: number;
} {
  const db = getDb();
  db.run(sql`DELETE FROM search_index`);

  const events = db
    .select()
    .from(memoryEvent)
    .all()
    .filter((e) => e.deletedAt === null);
  const familyByEventId = new Map(events.map((e) => [e.id, e.familyId]));
  insertIndexRows(
    db,
    events.map((e) => ({
      original_text: e.title,
      family_id: e.familyId,
      entity_type: "memory_event" as const,
      entity_id: e.id,
      event_id: e.id,
      visibility: "family",
      author_person_id: null,
      child_person_id: e.childPersonId,
    })),
  );

  const facts = db.select().from(factTable).all();
  const confirmedFacts = facts.filter(
    (f) => f.status === "user_confirmed" && familyByEventId.has(f.memoryEventId),
  );
  insertIndexRows(
    db,
    confirmedFacts.map((f) => ({
      original_text: f.statement,
      family_id: familyByEventId.get(f.memoryEventId)!,
      entity_type: "fact" as const,
      entity_id: f.id,
      event_id: f.memoryEventId,
      visibility: "family",
      author_person_id: null,
      child_person_id: null,
    })),
  );

  const contributions = db
    .select()
    .from(contributionTable)
    .all()
    .filter((c) => c.deletedAt === null);
  const contributionRows = contributions
    .filter((c) => familyByEventId.has(c.memoryEventId))
    .map((c) => ({
      original_text: (c.editedText ?? c.rawText ?? "").trim(),
      family_id: familyByEventId.get(c.memoryEventId)!,
      entity_type: "contribution" as const,
      entity_id: c.id,
      event_id: c.memoryEventId,
      visibility: c.visibility,
      author_person_id: c.authorPersonId,
      child_person_id: null,
    }))
    .filter((r) => r.original_text.length > 0);
  insertIndexRows(db, contributionRows);

  const transcripts = db.select().from(assetTranscript).all();
  const edited = transcripts.filter((t) => (t.editedTranscript ?? "").trim().length > 0);
  for (const t of edited) {
    indexEditedTranscript({
      id: t.id,
      familyId: t.familyId,
      assetId: t.assetId,
      editedTranscript: t.editedTranscript,
    });
  }

  // 已发布故事（标题 + 段落文本）随重建进入索引
  const stories = db
    .select()
    .from(storyTable)
    .all()
    .filter((st) => st.status === "published" && st.deletedAt === null);
  for (const st of stories) {
    const body = db
      .select({ text: storyParagraphTable.text })
      .from(storyParagraphTable)
      .where(eq(storyParagraphTable.storyId, st.id))
      .all()
      .map((pp) => pp.text)
      .join("\n");
    insertIndexRows(db, [
      {
        original_text: `${st.title}\n${body}`,
        family_id: st.familyId,
        entity_type: "story",
        entity_id: st.id,
        event_id: null,
        visibility: "family",
        author_person_id: null,
        child_person_id: null,
      },
    ]);
  }

  const documentRows = db
    .select({
      assetId: documentTextTable.assetId,
      text: documentTextTable.text,
      familyId: documentTextTable.familyId,
      eventId: memoryEventAsset.memoryEventId,
    })
    .from(documentTextTable)
    .innerJoin(memoryEventAsset, eq(memoryEventAsset.assetId, documentTextTable.assetId))
    .innerJoin(memoryEvent, eq(memoryEvent.id, memoryEventAsset.memoryEventId))
    .where(isNull(memoryEvent.deletedAt))
    .all();
  insertIndexRows(db, documentRows.map((row) => ({
    original_text: row.text,
    family_id: row.familyId,
    entity_type: "document" as const,
    entity_id: row.assetId,
    event_id: row.eventId,
    visibility: "family",
    author_person_id: null,
    child_person_id: null,
  })));

  return {
    events: events.length,
    facts: confirmedFacts.length,
    contributions: contributionRows.length,
    transcripts: edited.length,
  };
}

// ---- 查询 ----

export type SearchParams = {
  q: string;
  personId?: string;
  dateFrom?: string; // YYYY-MM-DD（家庭时区外的粗粒度过滤按 UTC 日界）
  dateTo?: string;
  tag?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  limit?: number;
};

export type SearchHit = {
  entityType: SearchEntityType;
  entityId: string;
  eventId: string | null;
  title: string;
  snippet: string;
};

export type SearchResult = {
  events: Array<{ id: string; title: string; occurredAt: string; snippet: string }>;
  facts: Array<{ id: string; eventId: string; statement: string }>;
  contributions: Array<{ id: string; eventId: string; text: string; authorName: string | null }>;
  transcripts: Array<{ id: string; eventId: string; text: string }>;
  stories: Array<{ id: string; title: string; snippet: string }>;
  documents: Array<{ id: string; eventId: string; filename: string; snippet: string }>;
  total: number;
};

type RawHit = {
  entity_type: SearchEntityType;
  entity_id: string;
  event_id: string | null;
  original_text: string;
  visibility: string;
  author_person_id: string | null;
};

const MATCH_CAP = 400;
const SNIPPET_CHARS = 80;

function makeSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (idx === -1) return text.slice(0, SNIPPET_CHARS);
  const start = Math.max(0, idx - Math.floor(SNIPPET_CHARS / 3));
  return (start > 0 ? "…" : "") + text.slice(start, start + SNIPPET_CHARS);
}

export function searchFamily(
  context: FamilyContext,
  params: SearchParams,
): SearchResult {
  const db = getDb();
  const q = params.q.trim();
  if (!q) {
    return { events: [], facts: [], contributions: [], transcripts: [], stories: [], documents: [], total: 0 };
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

  // FTS 匹配（单字中文回退 LIKE）
  let raw: RawHit[];
  if (isSingleCjkChar(q)) {
    raw = db
      .all(
        sql`SELECT entity_type, entity_id, event_id, original_text, visibility, author_person_id
            FROM search_index WHERE family_id = ${context.familyId} AND original_text LIKE ${`%${q}%`}
            LIMIT ${MATCH_CAP}`,
      ) as unknown as RawHit[];
  } else {
    const expr = ftsQueryExpression(q);
    if (!expr) {
      return { events: [], facts: [], contributions: [], transcripts: [], stories: [], documents: [], total: 0 };
    }
    raw = db
      .all(
        sql`SELECT entity_type, entity_id, event_id, original_text, visibility, author_person_id
            FROM search_index WHERE search_index MATCH ${expr} AND family_id = ${context.familyId}
            LIMIT ${MATCH_CAP}`,
      ) as unknown as RawHit[];
  }

  // 可见性后过滤（contribution 行按家庭策略逐行判断，绝不泄漏）
  const matchedEventIds = new Set(
    raw.map((r) => r.event_id).filter(Boolean) as string[],
  );
  const activeEventRows = matchedEventIds.size > 0
    ? db
        .select({ id: memoryEvent.id, childPersonId: memoryEvent.childPersonId })
        .from(memoryEvent)
        .where(
          and(
            eq(memoryEvent.familyId, context.familyId),
            isNull(memoryEvent.deletedAt),
            inArray(memoryEvent.id, [...matchedEventIds]),
          ),
        )
        .all()
    : [];
  const activeEventIds = new Set(activeEventRows.map((event) => event.id));
  const childPersonIds = new Set(activeEventRows.map((event) => event.childPersonId));
  const unlockedByChild = new Map<string, boolean>();
  if (childPersonIds.size > 0) {
    const childRows = db
      .select({ id: personTable.id, unlockedAt: personTable.childLaterUnlockedAt })
      .from(personTable)
      .where(
        and(
          eq(personTable.familyId, context.familyId),
          inArray(personTable.id, [...childPersonIds]),
        ),
      )
      .all();
    for (const child of childRows) {
      unlockedByChild.set(child.id, child.unlockedAt !== null);
    }
  }
  const eventChildById = new Map(
    activeEventRows
      .map((e) => [e.id, e.childPersonId]),
  );

  const storyHitIds = raw
    .filter((row) => row.entity_type === "story")
    .map((row) => row.entity_id);
  const activeStoryIds = new Set(
    storyHitIds.length > 0
      ? db
          .select({ id: storyTable.id })
          .from(storyTable)
          .where(
            and(
              eq(storyTable.familyId, context.familyId),
              eq(storyTable.status, "published"),
              isNull(storyTable.deletedAt),
              inArray(storyTable.id, storyHitIds),
            ),
          )
          .all()
          .map((story) => story.id)
      : [],
  );
  const contributionHitIds = raw
    .filter((row) => row.entity_type === "contribution")
    .map((row) => row.entity_id);
  const activeContributionIds = new Set(
    contributionHitIds.length > 0
      ? db
          .select({ id: contributionTable.id })
          .from(contributionTable)
          .innerJoin(memoryEvent, eq(memoryEvent.id, contributionTable.memoryEventId))
          .where(
            and(
              eq(memoryEvent.familyId, context.familyId),
              isNull(memoryEvent.deletedAt),
              isNull(contributionTable.deletedAt),
              inArray(contributionTable.id, contributionHitIds),
            ),
          )
          .all()
          .map((contribution) => contribution.id)
      : [],
  );

  const visible: RawHit[] = raw.filter((r) => {
    if (r.event_id && !activeEventIds.has(r.event_id)) return false;
    if (r.entity_type === "story" && !activeStoryIds.has(r.entity_id)) return false;
    if (
      r.entity_type === "contribution" &&
      !activeContributionIds.has(r.entity_id)
    ) {
      return false;
    }
    if (r.entity_type !== "contribution") return true;
    const childId = r.event_id ? eventChildById.get(r.event_id) : undefined;
    return canViewContribution(r.visibility as ContributionVisibility, {
      role: context.role,
      userPersonId: context.personId,
      authorPersonId: r.author_person_id ?? "",
      isGuardian: context.isGuardian,
      childLaterUnlocked: childId ? (unlockedByChild.get(childId) ?? false) : false,
      accountEnabled: true,
    });
  });

  // 事件级过滤器（person/tag/media/date）→ 计算允许的事件集合
  const hasEventFilter =
    params.personId !== undefined ||
    params.tag !== undefined ||
    params.mediaType !== undefined ||
    params.dateFrom !== undefined ||
    params.dateTo !== undefined;
  let allowedEventIds: Set<string> | null = null;
  if (hasEventFilter) {
    const eventIds = [
      ...new Set(visible.map((r) => r.event_id).filter(Boolean) as string[]),
    ];
    allowedEventIds =
      eventIds.length === 0
        ? new Set()
        : filterEventIds(db, context.familyId, eventIds, params);
  }

  const result: SearchResult = {
    events: [],
    facts: [],
    contributions: [],
    transcripts: [],
    stories: [],
    documents: [],
    total: 0,
  };

  const personById = new Map(
    db
      .select({ id: personTable.id, displayName: personTable.displayName })
      .from(personTable)
      .where(eq(personTable.familyId, context.familyId))
      .all()
      .map((p) => [p.id, p.displayName]),
  );

  for (const hit of visible) {
    if (allowedEventIds !== null) {
      if (!hit.event_id || !allowedEventIds.has(hit.event_id)) continue;
    }
    const snippet = makeSnippet(hit.original_text, q);
    switch (hit.entity_type) {
      case "memory_event":
        if (result.events.length < limit) {
          const event = db
            .select({ occurredAt: memoryEvent.occurredAt })
            .from(memoryEvent)
            .where(
              and(
                eq(memoryEvent.id, hit.entity_id),
                eq(memoryEvent.familyId, context.familyId),
                isNull(memoryEvent.deletedAt),
              ),
            )
            .get();
          if (event) {
            result.events.push({
              id: hit.entity_id,
              title: hit.original_text,
              occurredAt: event.occurredAt.toISOString(),
              snippet,
            });
          }
        }
        break;
      case "fact":
        if (result.facts.length < limit) {
          result.facts.push({
            id: hit.entity_id,
            eventId: hit.event_id ?? "",
            statement: hit.original_text,
          });
        }
        break;
      case "contribution":
        if (result.contributions.length < limit) {
          result.contributions.push({
            id: hit.entity_id,
            eventId: hit.event_id ?? "",
            text: snippet,
            authorName: hit.author_person_id
              ? (personById.get(hit.author_person_id) ?? null)
              : null,
          });
        }
        break;
      case "transcript":
        if (result.transcripts.length < limit) {
          result.transcripts.push({
            id: hit.entity_id,
            eventId: hit.event_id ?? "",
            text: snippet,
          });
        }
        break;
      case "story":
        if (result.stories.length < limit) {
          const storyRow = db
            .select({ title: storyTable.title })
            .from(storyTable)
            .where(
              and(
                eq(storyTable.id, hit.entity_id),
                eq(storyTable.familyId, context.familyId),
                eq(storyTable.status, "published"),
                isNull(storyTable.deletedAt),
              ),
            )
            .get();
          if (storyRow) {
            result.stories.push({
              id: hit.entity_id,
              title: storyRow.title,
              snippet,
            });
          }
        }
        break;
      case "document":
        if (result.documents.length < limit && hit.event_id) {
          const document = db
            .select({ filename: assetTable.originalFilename })
            .from(assetTable)
            .where(
              and(
                eq(assetTable.familyId, context.familyId),
                eq(assetTable.id, hit.entity_id),
                eq(assetTable.type, "document"),
              ),
            )
            .get();
          if (document) {
            result.documents.push({
              id: hit.entity_id,
              eventId: hit.event_id,
              filename: document.filename,
              snippet,
            });
          }
        }
        break;
    }
  }
  result.total =
    result.events.length +
    result.facts.length +
    result.contributions.length +
    result.transcripts.length +
    result.stories.length;
  result.total += result.documents.length;
  return result;
}

function filterEventIds(
  db: Db,
  familyId: string,
  eventIds: string[],
  params: SearchParams,
): Set<string> {
  let ids = new Set(eventIds);

  if (params.personId) {
    const rows = db
      .select({ eventId: memoryEventParticipant.memoryEventId })
      .from(memoryEventParticipant)
      .where(
        and(
          eq(memoryEventParticipant.familyId, familyId),
          eq(memoryEventParticipant.personId, params.personId),
          inArray(memoryEventParticipant.memoryEventId, [...ids]),
        ),
      )
      .all();
    ids = new Set(rows.map((r: { eventId: string }) => r.eventId));
  }

  if (params.tag && ids.size > 0) {
    const rows = db
      .select({ eventId: memoryEventTag.memoryEventId })
      .from(memoryEventTag)
      .where(
        and(
          eq(memoryEventTag.familyId, familyId),
          eq(memoryEventTag.tag, params.tag),
          inArray(memoryEventTag.memoryEventId, [...ids]),
        ),
      )
      .all();
    ids = new Set(rows.map((r: { eventId: string }) => r.eventId));
  }

  if (params.mediaType && ids.size > 0) {
    const rows = db
      .select({ eventId: memoryEventAsset.memoryEventId })
      .from(memoryEventAsset)
      .innerJoin(assetTable, eq(assetTable.id, memoryEventAsset.assetId))
      .where(
        and(
          eq(assetTable.familyId, familyId),
          eq(assetTable.type, params.mediaType),
          inArray(memoryEventAsset.memoryEventId, [...ids]),
        ),
      )
      .all();
    ids = new Set(rows.map((r: { eventId: string }) => r.eventId));
  }

  if ((params.dateFrom || params.dateTo) && ids.size > 0) {
    const events = db
      .select({ id: memoryEvent.id, occurredAt: memoryEvent.occurredAt })
      .from(memoryEvent)
      .where(
        and(eq(memoryEvent.familyId, familyId), inArray(memoryEvent.id, [...ids])),
      )
      .all();
    const from = params.dateFrom ? new Date(`${params.dateFrom}T00:00:00.000Z`) : null;
    const to = params.dateTo ? new Date(`${params.dateTo}T23:59:59.999Z`) : null;
    ids = new Set(
      events
        .filter((e: { id: string; occurredAt: Date }) => {
          if (from && e.occurredAt < from) return false;
          if (to && e.occurredAt > to) return false;
          return true;
        })
        .map((e: { id: string }) => e.id),
    );
  }

  return ids;
}
