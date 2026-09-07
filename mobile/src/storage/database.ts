import * as SQLite from "expo-sqlite";
import { readableName } from "../utils/naming";
import type { SyncConsent,
  Family,
  LocalTimelineEvent,
  LocalImportIntakeItem,
  LocalImportSession,
  LocalImportSource,
  MediaCapturePayload,
  MobileLibraryDetail,
  MobileLibraryDomain,
  MobileLibraryPage,
  MobileMemory,
  MobileHome,
  MobileReview,
  OutboxItem,
  Person,
  SyncPage,
  TextCapturePayload,
} from "../types";
import {
  mergeTimelineEvents,
  type LocalCaptureRow,
} from "./local-timeline";
import { LOCAL_DRAFT_SCHEMA_SQL, TIMELINE_SCHEMA_SQL, MEMORY_DETAIL_SCHEMA_SQL, MOBILE_LOCAL_SCHEMA_SQL } from "./schema";

const DB_NAME = "family-time-capsule.sqlite";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DB_NAME);
  return databasePromise;
}

export async function initializeLocalStore(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(MOBILE_LOCAL_SCHEMA_SQL);
  await db.execAsync(LOCAL_DRAFT_SCHEMA_SQL);
  const memoryColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(memory_detail)");
  if (!memoryColumns.some((column) => column.name === "scope")) {
    // Legacy server responses have no proven owner. Discard only this
    // replaceable cache; locally captured originals and outbox rows stay intact.
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`DROP TABLE memory_detail; ${MEMORY_DETAIL_SCHEMA_SQL}`);
    });
  }
  const definition = await db.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'local_capture'",
  );
  const localCaptureColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(local_capture)",
  );
  const localCaptureColumnNames = new Set(
    localCaptureColumns.map((column) => column.name),
  );
  const requiresLocalCaptureMigration = Boolean(
    definition?.sql && (
      !definition.sql.includes("'audio'") ||
      !definition.sql.includes("'document'") ||
      !definition.sql.includes("'archived'") ||
      !localCaptureColumnNames.has("inbox_item_id") ||
      !localCaptureColumnNames.has("memory_event_id")
    ),
  );
  if (requiresLocalCaptureMigration) {
    const mediaTypeExpression = localCaptureColumnNames.has("media_type")
      ? "media_type"
      : "NULL";
    const syncStateExpression = localCaptureColumnNames.has("sync_state")
      ? "CASE WHEN sync_state = 'synced' THEN 'inbox' WHEN sync_state IN ('pending', 'inbox', 'archived') THEN sync_state ELSE 'pending' END"
      : "'pending'";
    const inboxItemIdExpression = localCaptureColumnNames.has("inbox_item_id")
      ? "inbox_item_id"
      : localCaptureColumnNames.has("sync_state")
        ? "CASE WHEN sync_state = 'synced' THEN id ELSE NULL END"
        : "NULL";
    const memoryEventIdExpression = localCaptureColumnNames.has("memory_event_id")
      ? "memory_event_id"
      : "NULL";
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`
        ALTER TABLE local_capture RENAME TO local_capture_before_lifecycle;
        DROP INDEX IF EXISTS local_capture_occurred_idx;
        CREATE TABLE local_capture (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('text_capture', 'media_capture')),
          title TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          local_uri TEXT,
          media_type TEXT CHECK(media_type IN ('image', 'video', 'audio', 'document') OR media_type IS NULL),
          inbox_item_id TEXT,
          memory_event_id TEXT,
          sync_state TEXT NOT NULL DEFAULT 'pending' CHECK(sync_state IN ('pending', 'inbox', 'archived'))
        );
        INSERT INTO local_capture(
          id, kind, title, occurred_at, local_uri, media_type,
          inbox_item_id, memory_event_id, sync_state
        )
          SELECT id, kind, title, occurred_at, local_uri, ${mediaTypeExpression},
            ${inboxItemIdExpression}, ${memoryEventIdExpression}, ${syncStateExpression}
          FROM local_capture_before_lifecycle;
        DROP TABLE local_capture_before_lifecycle;
        CREATE INDEX local_capture_occurred_idx
          ON local_capture(occurred_at DESC, id DESC);
      `);
    });
  }
  // Keep the complete local source after the transient upload queue is removed.
  const namingColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(local_capture)");
  for (const [column, definition] of [
    ["payload_json", "TEXT"], ["title_source", "TEXT NOT NULL DEFAULT 'legacy_unknown'"],
    ["title_revision", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (!namingColumns.some((entry) => entry.name === column)) {
      await db.execAsync(`ALTER TABLE local_capture ADD COLUMN ${column} ${definition}`);
    }
  }
  await db.runAsync(`UPDATE local_capture SET payload_json = (
    SELECT payload_json FROM outbox WHERE outbox.id = local_capture.id
  ) WHERE payload_json IS NULL AND EXISTS (SELECT 1 FROM outbox WHERE outbox.id = local_capture.id)`);
  const timelineColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(timeline_event)",
  );
  if (!timelineColumns.some((column) => column.name === "age_label")) {
    await db.execAsync("ALTER TABLE timeline_event ADD COLUMN age_label TEXT");
  }
  const anchorColumn = (await db.getAllAsync<{ name: string; notnull: number }>("PRAGMA table_info(timeline_event)"))
    .find(column => column.name === "child_person_id");
  if (anchorColumn?.notnull) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`
        ALTER TABLE timeline_event RENAME TO timeline_event_before_optional_anchor;
        DROP INDEX IF EXISTS timeline_occurred_idx;
        ${TIMELINE_SCHEMA_SQL}
        INSERT INTO timeline_event (id,title,occurred_at,occurred_at_precision,location_text,child_person_id,
          age_days,age_label,updated_at,asset_count,participant_names_json,cover_json,local_cover_uri,seen_snapshot)
        SELECT id,title,occurred_at,occurred_at_precision,location_text,child_person_id,
          age_days,age_label,updated_at,asset_count,participant_names_json,cover_json,local_cover_uri,seen_snapshot
        FROM timeline_event_before_optional_anchor;
        DROP TABLE timeline_event_before_optional_anchor;
      `);
    });
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM meta WHERE key = ?", key);
}

export async function cacheMobileHome(home: MobileHome): Promise<void> {
  await setMeta("mobile_home", JSON.stringify(home));
}

export async function getCachedMobileHome(): Promise<MobileHome | null> {
  const raw = await getMeta("mobile_home");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileHome;
  } catch {
    return null;
  }
}

export async function cacheMobileReview(review: MobileReview): Promise<void> {
  await setMeta("mobile_review", JSON.stringify(review));
}

export async function getCachedMobileReview(): Promise<MobileReview | null> {
  const raw = await getMeta("mobile_review");
  if (!raw) return null;
  try { return JSON.parse(raw) as MobileReview; }
  catch { return null; }
}

export async function cacheMobileLibraryPage(domain: MobileLibraryDomain, page: MobileLibraryPage): Promise<void> {
  await setMeta(`library_page:${domain}`, JSON.stringify(page));
}

export async function getCachedMobileLibraryPage(domain: MobileLibraryDomain): Promise<MobileLibraryPage | null> {
  const raw = await getMeta(`library_page:${domain}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as MobileLibraryPage; }
  catch { return null; }
}

export async function cacheMobileLibraryDetail(domain: MobileLibraryDomain, detail: MobileLibraryDetail): Promise<void> {
  await setMeta(`library_detail:${domain}:${detail.id}`, JSON.stringify(detail));
}

export async function getCachedMobileLibraryDetail(domain: MobileLibraryDomain, id: string): Promise<MobileLibraryDetail | null> {
  const raw = await getMeta(`library_detail:${domain}:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as MobileLibraryDetail; }
  catch { return null; }
}

export async function getCachedFamily(): Promise<Family | null> {
  const raw = await getMeta("family");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Family;
  } catch {
    return null;
  }
}

export async function getCachedViewer(): Promise<SyncPage["viewer"] | null> {
  const raw = await getMeta("viewer");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncPage["viewer"];
  } catch {
    return null;
  }
}

export async function listCachedPeople(): Promise<Person[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    display_name: string;
    relation_to_child: string | null;
    is_child: number;
    birth_date: string | null;
    updated_at: string;
  }>("SELECT * FROM people ORDER BY is_child DESC, display_name");
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    relationToChild: row.relation_to_child,
    isChild: row.is_child === 1,
    birthDate: row.birth_date,
    updatedAt: row.updated_at,
  }));
}

export async function cacheMemoryDetail(scope: string, detail: MobileMemory): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO memory_detail(scope, id, detail_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, id) DO UPDATE SET
       detail_json = excluded.detail_json,
       updated_at = excluded.updated_at`,
    scope,
    detail.id,
    JSON.stringify(detail),
    detail.updatedAt,
  );
}

export async function getCachedMemoryDetail(
  scope: string,
  id: string,
): Promise<MobileMemory | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ detail_json: string }>(
    "SELECT detail_json FROM memory_detail WHERE scope = ? AND id = ?",
    scope,
    id,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.detail_json) as MobileMemory;
  } catch {
    return null;
  }
}

export async function removeCachedMemoryDetail(scope: string, id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM memory_detail WHERE scope = ? AND id = ?", scope, id);
}

export async function listTimeline(): Promise<LocalTimelineEvent[]> {
  const db = await getDatabase();
  const [rows, localRows] = await Promise.all([
    db.getAllAsync<{
      id: string;
      title: string;
      occurred_at: string;
      occurred_at_precision: string;
      location_text: string | null;
      child_person_id: string | null;
      age_days: number | null;
      age_label: string | null;
      updated_at: string;
      asset_count: number;
      participant_names_json: string;
      cover_json: string | null;
      local_cover_uri: string | null;
    }>("SELECT * FROM timeline_event ORDER BY occurred_at DESC, id DESC"),
    db.getAllAsync<LocalCaptureRow>(
      `SELECT * FROM local_capture WHERE sync_state <> 'archived' AND NOT EXISTS (
        SELECT 1 FROM local_draft d, json_each(json_extract(d.snapshot_json, '$.content.items')) i
        WHERE json_extract(i.value, '$.localCaptureRef') = local_capture.id
          AND json_extract(d.snapshot_json, '$.status') <> 'discarded'
      ) ORDER BY occurred_at DESC, id DESC`,
    ),
  ]);
  const serverEvents = rows.map((row) => ({
    id: row.id,
    title: row.title,
    occurredAt: row.occurred_at,
    occurredAtPrecision: row.occurred_at_precision,
    locationText: row.location_text,
    childPersonId: row.child_person_id,
    ageDays: row.age_days,
    ageLabel: row.age_label,
    updatedAt: row.updated_at,
    assetCount: row.asset_count,
    participantNames: JSON.parse(row.participant_names_json) as string[],
    captureIds: [],
    cover: row.cover_json
      ? (JSON.parse(row.cover_json) as LocalTimelineEvent["cover"])
      : null,
    localCoverUri: row.local_cover_uri,
    source: "server" as const,
    syncState: null,
  }));
  return mergeTimelineEvents(serverEvents, localRows);
}

export type LocalMemoryMedia = {
  captureId: string;
  title: string;
  localUri: string;
  mediaType: "image" | "video" | "audio" | "document";
};

export async function listLocalMemoryMedia(
  memoryEventId: string,
): Promise<LocalMemoryMedia[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    local_uri: string;
    media_type: LocalMemoryMedia["mediaType"];
  }>(
    `SELECT id, title, local_uri, media_type
     FROM local_capture
     WHERE sync_state = 'archived'
       AND memory_event_id = ?
       AND local_uri IS NOT NULL
       AND media_type IS NOT NULL
     ORDER BY occurred_at, id`,
    memoryEventId,
  );
  return rows.map((row) => ({
    captureId: row.id,
    title: row.title,
    localUri: row.local_uri,
    mediaType: row.media_type,
  }));
}

export async function applySyncPage(
  page: SyncPage,
  snapshotId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const person of page.people) {
      await tx.runAsync(
        `INSERT INTO people(
          id, display_name, relation_to_child, is_child, birth_date, updated_at, seen_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          relation_to_child = excluded.relation_to_child,
          is_child = excluded.is_child,
          birth_date = excluded.birth_date,
          updated_at = excluded.updated_at,
          seen_snapshot = excluded.seen_snapshot`,
        person.id,
        person.displayName,
        person.relationToChild,
        person.isChild ? 1 : 0,
        person.birthDate,
        person.updatedAt,
        snapshotId,
      );
    }
    for (const event of page.events) {
      await tx.runAsync(
        `INSERT INTO timeline_event(
          id, title, occurred_at, occurred_at_precision, location_text,
          child_person_id, age_days, age_label, updated_at, asset_count,
          participant_names_json, cover_json, local_cover_uri, seen_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          occurred_at = excluded.occurred_at,
          occurred_at_precision = excluded.occurred_at_precision,
          location_text = excluded.location_text,
          child_person_id = excluded.child_person_id,
          age_days = excluded.age_days,
          age_label = excluded.age_label,
          updated_at = excluded.updated_at,
          asset_count = excluded.asset_count,
          participant_names_json = excluded.participant_names_json,
          cover_json = excluded.cover_json,
          local_cover_uri = CASE
            WHEN timeline_event.cover_json = excluded.cover_json THEN timeline_event.local_cover_uri
            ELSE NULL
          END,
          seen_snapshot = excluded.seen_snapshot`,
        event.id,
        event.title,
        event.occurredAt,
        event.occurredAtPrecision,
        event.locationText,
        event.childPersonId,
        event.ageDays,
        event.ageLabel,
        event.updatedAt,
        event.assetCount,
        JSON.stringify(event.participantNames),
        event.cover ? JSON.stringify(event.cover) : null,
        snapshotId,
      );
      if (event.captureIds.length > 0) {
        const placeholders = event.captureIds.map(() => "?").join(", ");
        await tx.runAsync(
          `UPDATE local_capture
           SET sync_state = 'archived', memory_event_id = ?
           WHERE inbox_item_id IN (${placeholders})
              OR (inbox_item_id IS NULL AND id IN (${placeholders}))`,
          event.id,
          ...event.captureIds,
          ...event.captureIds,
        );
      }
    }
  });
  await Promise.all([
    setMeta("family", JSON.stringify(page.family)),
    setMeta("viewer", JSON.stringify(page.viewer)),
  ]);
}

export async function finishSyncSnapshot(
  snapshotId: string,
  serverTime: string,
): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      "DELETE FROM timeline_event WHERE seen_snapshot IS NULL OR seen_snapshot <> ?",
      snapshotId,
    );
    await tx.runAsync(
      "DELETE FROM people WHERE seen_snapshot IS NULL OR seen_snapshot <> ?",
      snapshotId,
    );
    await tx.runAsync(`
      UPDATE timeline_event
      SET local_cover_uri = (
        SELECT local_capture.local_uri
        FROM local_capture
        WHERE local_capture.memory_event_id = timeline_event.id
          AND local_capture.media_type = 'image'
          AND local_capture.local_uri IS NOT NULL
        ORDER BY local_capture.occurred_at, local_capture.id
        LIMIT 1
      )
      WHERE EXISTS (
        SELECT 1
        FROM local_capture
        WHERE local_capture.memory_event_id = timeline_event.id
          AND local_capture.media_type = 'image'
          AND local_capture.local_uri IS NOT NULL
      )
    `);
    await tx.runAsync(
      "INSERT INTO meta(key, value) VALUES ('last_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      serverTime,
    );
  });
}

export async function setLocalCoverUri(eventId: string, uri: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE timeline_event SET local_cover_uri = ? WHERE id = ?",
    uri,
    eventId,
  );
}

export async function listLocalCoverUris(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ local_cover_uri: string }>(
    "SELECT local_cover_uri FROM timeline_event WHERE local_cover_uri IS NOT NULL",
  );
  return rows.map((row) => row.local_cover_uri);
}

export async function enqueueTextCapture(
  id: string,
  payload: TextCapturePayload,
): Promise<void> {
  return enqueue(id, "text_capture", payload, null, null);
}

export async function enqueueMediaCapture(
  id: string,
  payload: MediaCapturePayload,
): Promise<void> {
  return enqueue(
    id,
    "media_capture",
    payload,
    payload.localUri,
    payload.mediaType,
  );
}

export async function ingestLocalImportSession(input: {
  id: string;
  source: LocalImportSource;
  createdAt: string;
  items: LocalImportIntakeItem[];
  queue: boolean;
  scope?: string;
}): Promise<{ queued: number; failed: number }> {
  const db = await getDatabase();
  let queued = 0;
  let failed = 0;
  const timezone = (await getCachedFamily())?.timezone ?? "UTC";
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT OR IGNORE INTO local_import_session(
        id, source, status, total_count, completed_count, failed_count, created_at, updated_at
      ) VALUES (?, ?, 'collecting', ?, 0, 0, ?, ?)`,
      input.id,
      input.source,
      input.items.length,
      input.createdAt,
      input.createdAt,
    );
    await tx.runAsync("INSERT OR IGNORE INTO local_intake_choice(session_id,scope) VALUES(?,?)", input.id, input.scope ?? "local");
    for (const [index, item] of input.items.entries()) {
      const now = new Date().toISOString();
      const inserted = await tx.runAsync(
        `INSERT OR IGNORE INTO local_import_item(
          id, import_session_id, capture_id, external_id, sort_order,
          intake_state, local_uri, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)`,
        `${input.id}:${item.externalId}`,
        input.id,
        item.captureId,
        item.externalId,
        item.sortOrder ?? index,
        item.localUri ?? null,
        item.error?.slice(0, 160) ?? null,
        input.createdAt,
        now,
      );
      if (item.kind === "error" || !item.payload) {
        if (inserted.changes > 0) failed += 1;
        continue;
      }
      await tx.runAsync(
        `UPDATE local_import_item
         SET intake_state = 'copied', local_uri = ?, updated_at = ?
         WHERE capture_id = ? AND intake_state = 'received'`,
        item.localUri ?? null,
        now,
        item.captureId,
      );
      // Local preservation and upload consent are separate transactions in
      // the user's workflow. Files must be addressable by a Draft even when
      // no outbox entry is authorized (including a viewer receiving a share).
      const kind = item.kind === "text" ? "text_capture" : "media_capture";
      const title = captureName(kind, item.payload, timezone);
      const mediaPayload = item.kind === "file" ? item.payload as MediaCapturePayload : null;
      await tx.runAsync(
        `INSERT OR IGNORE INTO local_capture(
          id, kind, title, occurred_at, local_uri, media_type, payload_json, title_source, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'rule_generated', 'pending')`,
        item.captureId,
        kind,
        title,
        input.createdAt,
        mediaPayload?.localUri ?? null,
        mediaPayload?.mediaType ?? null,
        JSON.stringify(item.payload),
      );
      if (!input.queue) continue;
      const intake = await tx.getFirstAsync<{ intake_state: string }>(
        "SELECT intake_state FROM local_import_item WHERE capture_id = ?",
        item.captureId,
      );
      if (intake?.intake_state !== "copied") continue;
      const existing = await tx.getFirstAsync<{ value: number }>(
        "SELECT count(*) AS value FROM outbox WHERE id = ?",
        item.captureId,
      );
      if ((existing?.value ?? 0) > 0) continue;
      await tx.runAsync(
        "INSERT OR IGNORE INTO outbox(id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
        item.captureId,
        kind,
        JSON.stringify(item.payload),
        input.createdAt,
      );
      await tx.runAsync(
        `UPDATE local_import_item
         SET intake_state = 'queued', error_code = NULL, updated_at = ?
         WHERE capture_id = ? AND intake_state IN ('received', 'copied')`,
        now,
        item.captureId,
      );
      queued += 1;
    }
    const totals = await tx.getFirstAsync<{ total: number; failed: number; queued: number }>(
      `SELECT count(*) AS total,
        sum(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS failed,
        sum(CASE WHEN intake_state IN ('queued', 'uploading', 'inbox', 'archived') THEN 1 ELSE 0 END) AS queued
       FROM local_import_item WHERE import_session_id = ?`,
      input.id,
    );
    const nextStatus = input.queue && (totals?.queued ?? 0) > 0 ? "uploading" : "collecting";
    await tx.runAsync(
      `UPDATE local_import_session
       SET status = ?, total_count = ?, failed_count = ?, updated_at = ?
       WHERE id = ?`,
      nextStatus,
      totals?.total ?? input.items.length,
      totals?.failed ?? failed,
      new Date().toISOString(),
      input.id,
    );
  });
  return { queued, failed };
}

export async function listLocalImportSessions(scope?: string): Promise<LocalImportSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    source: LocalImportSource;
    status: LocalImportSession["status"];
    total_count: number;
    completed_count: number;
    failed_count: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT s.* FROM local_import_session s LEFT JOIN local_intake_choice c ON c.session_id=s.id
    WHERE ? IS NULL OR c.scope=? OR c.scope='local' OR c.scope IS NULL ORDER BY s.updated_at DESC,s.id DESC`, scope ?? null, scope ?? null);
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    status: row.status,
    totalCount: row.total_count,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function updateMediaUploadState(
  id: string,
  uploadId: string,
  uploadOffset: number,
): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE id = ? AND kind = 'media_capture'",
      id,
    );
    if (!row) return;
    const payload = JSON.parse(row.payload_json) as MediaCapturePayload;
    payload.uploadId = uploadId;
    payload.uploadOffset = uploadOffset;
    await tx.runAsync(
      "UPDATE outbox SET payload_json = ?, last_error = NULL WHERE id = ?",
      JSON.stringify(payload),
      id,
    );
    await tx.runAsync(
      `UPDATE local_import_item SET intake_state = 'uploading', updated_at = ?
       WHERE capture_id = ? AND intake_state IN ('queued', 'uploading')`,
      new Date().toISOString(),
      id,
    );
    await tx.runAsync(
      `UPDATE local_import_item SET error_code = NULL WHERE capture_id = ?`,
      id,
    );
  });
}

function captureName(kind: OutboxItem["kind"], payload: TextCapturePayload | MediaCapturePayload, timezone: string): string {
  if (kind === "text_capture") return readableName({ text: (payload as TextCapturePayload).text }).text;
  const media = payload as MediaCapturePayload;
  return readableName({ mediaType: media.mediaType, originalFilename: media.fileName,
    capturedAt: media.source === "camera" || media.source === "recorder" ? media.lastModified : null,
    timeSource: "user_confirmed", timezone }).text;
}

async function enqueue(
  id: string,
  kind: OutboxItem["kind"],
  payload: TextCapturePayload | MediaCapturePayload,
  localUri: string | null,
  mediaType: MediaCapturePayload["mediaType"] | null,
): Promise<void> {
  const db = await getDatabase();
  const occurredAt = new Date().toISOString();
  const title = captureName(kind, payload, (await getCachedFamily())?.timezone ?? "UTC");
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT INTO local_capture(
        id, kind, title, occurred_at, local_uri, media_type, payload_json, title_source, sync_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'rule_generated', 'pending')`,
      id,
      kind,
      title,
      occurredAt,
      localUri,
      mediaType,
      JSON.stringify(payload),
    );
    await tx.runAsync(
      "INSERT INTO outbox(id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
      id,
      kind,
      JSON.stringify(payload),
      occurredAt,
    );
  });
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    kind: OutboxItem["kind"];
    payload_json: string;
    created_at: string;
    attempt_count: number;
    last_error: string | null;
    import_session_id: string | null;
  }>(`SELECT o.*, i.import_session_id FROM outbox o
      LEFT JOIN local_import_item i ON i.capture_id = o.id
      ORDER BY o.created_at, o.id`);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: {
      ...JSON.parse(row.payload_json),
      ...(row.import_session_id ? { importSessionId: row.import_session_id } : {}),
    } as OutboxItem["payload"],
    createdAt: row.created_at,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
  }));
}

export async function getOutboxCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: number }>(
    "SELECT count(*) AS value FROM outbox",
  );
  return row?.value ?? 0;
}

export async function markOutboxFailure(id: string, message: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      "UPDATE outbox SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?",
      message.slice(0, 300),
      id,
    );
    await tx.runAsync(
      `UPDATE local_import_item
       SET intake_state = 'queued', error_code = ?, updated_at = ?
       WHERE capture_id = ? AND intake_state = 'uploading'`,
      message.slice(0, 160),
      new Date().toISOString(),
      id,
    );
    await tx.runAsync(
      `UPDATE local_import_session
       SET status = 'reviewing',
         failed_count = (
           SELECT count(*) FROM local_import_item
           WHERE import_session_id = local_import_session.id AND error_code IS NOT NULL
         ),
         updated_at = ?
       WHERE id IN (SELECT import_session_id FROM local_import_item WHERE capture_id = ?)`,
      new Date().toISOString(),
      id,
    );
  });
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM outbox WHERE id = ?", id);
    await tx.runAsync("DELETE FROM local_capture WHERE id = ?", id);
  });
}

export async function completeOutboxItem(
  id: string,
  inboxItemId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `UPDATE local_capture
       SET sync_state = 'inbox', inbox_item_id = ?
       WHERE id = ? AND sync_state = 'pending'`,
      inboxItemId,
      id,
    );
    await tx.runAsync("DELETE FROM outbox WHERE id = ?", id);
    await tx.runAsync(
      `UPDATE local_import_item
       SET intake_state = 'inbox', inbox_item_id = ?, updated_at = ?
       WHERE capture_id = ? AND intake_state IN ('queued', 'uploading')`,
      inboxItemId,
      new Date().toISOString(),
      id,
    );
    await tx.runAsync(
      `UPDATE local_import_session
       SET completed_count = (
         SELECT count(*) FROM local_import_item
         WHERE import_session_id = local_import_session.id
           AND intake_state IN ('inbox', 'archived')
       ),
       status = CASE WHEN NOT EXISTS (
         SELECT 1 FROM local_import_item
         WHERE import_session_id = local_import_session.id
           AND intake_state IN ('received', 'copied', 'queued', 'uploading')
           AND error_code IS NULL
       ) THEN 'reviewing' ELSE status END,
       updated_at = ?
       WHERE id IN (SELECT import_session_id FROM local_import_item WHERE capture_id = ?)`,
      new Date().toISOString(),
      id,
    );
  });
}

export async function archiveLocalCaptures(
  inboxItemIds: string[],
  memoryEventId: string,
): Promise<void> {
  if (inboxItemIds.length === 0) return;
  const db = await getDatabase();
  const placeholders = inboxItemIds.map(() => "?").join(", ");
  await db.runAsync(
    `UPDATE local_capture
     SET sync_state = 'archived', memory_event_id = ?
     WHERE inbox_item_id IN (${placeholders})
        OR (inbox_item_id IS NULL AND id IN (${placeholders}))`,
    memoryEventId,
    ...inboxItemIds,
    ...inboxItemIds,
  );
  await db.runAsync(
    `UPDATE local_import_item
     SET intake_state = 'archived', memory_event_id = ?, updated_at = ?
     WHERE inbox_item_id IN (${placeholders})
        OR (inbox_item_id IS NULL AND capture_id IN (${placeholders}))`,
    memoryEventId,
    new Date().toISOString(),
    ...inboxItemIds,
    ...inboxItemIds,
  );
  await db.runAsync(
    `UPDATE local_import_session
     SET completed_count = (
       SELECT count(*) FROM local_import_item
       WHERE import_session_id = local_import_session.id
         AND intake_state IN ('inbox', 'archived')
     ),
     status = CASE WHEN NOT EXISTS (
       SELECT 1 FROM local_import_item
       WHERE import_session_id = local_import_session.id
         AND intake_state <> 'archived' AND error_code IS NULL
     ) THEN 'completed' ELSE status END,
     updated_at = ?
     WHERE id IN (
       SELECT import_session_id FROM local_import_item
       WHERE inbox_item_id IN (${placeholders})
          OR (inbox_item_id IS NULL AND capture_id IN (${placeholders}))
     )`,
    new Date().toISOString(),
    ...inboxItemIds,
    ...inboxItemIds,
  );
}

export async function clearLocalArchive(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM timeline_event;
    DELETE FROM people;
    DELETE FROM outbox;
    DELETE FROM local_draft;
    DELETE FROM local_capture;
    DELETE FROM local_import_item;
    DELETE FROM local_import_session;
    DELETE FROM memory_detail;
    DELETE FROM meta;
  `);
}

export type { Person };

export type LocalCaptureDetail = {
  captureId: string;
  kind: "text_capture" | "media_capture";
  title: string;
  occurredAt: string;
  localUri: string | null;
  mediaType: "image" | "video" | "audio" | "document" | null;
  fileName: string | null;
  mimeType: string | null;
  inboxItemId: string | null;
  memoryEventId: string | null;
  syncState: "pending" | "inbox" | "archived";
  text: string | null;
};

/** 单条本机记录详情（时间轴点击本机条目直接阅读，不要求联网）。 */
export async function getLocalCaptureDetail(
  captureId: string,
): Promise<LocalCaptureDetail | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    id: string;
    kind: "text_capture" | "media_capture";
    title: string;
    occurred_at: string;
    local_uri: string | null;
    media_type: "image" | "video" | "audio" | "document" | null;
    inbox_item_id: string | null;
    memory_event_id: string | null;
    sync_state: "pending" | "inbox" | "archived";
  }>(
    "SELECT * FROM local_capture WHERE id = ? LIMIT 1",
    captureId,
  );
  if (!row) return null;
  let text: string | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  if (row.kind === "text_capture") {
    const outboxRow = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM local_capture WHERE id = ? AND kind = 'text_capture' LIMIT 1",
      captureId,
    );
    if (outboxRow?.payload_json) {
      try {
        const payload = JSON.parse(outboxRow.payload_json) as { text?: unknown };
        if (typeof payload.text === "string") text = payload.text;
      } catch {
        text = null;
      }
    }
  } else {
    const outboxRow = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM local_capture WHERE id = ? AND kind = 'media_capture' LIMIT 1",
      captureId,
    );
    if (outboxRow?.payload_json) {
      try {
        const payload = JSON.parse(outboxRow.payload_json) as {
          fileName?: unknown;
          mimeType?: unknown;
        };
        if (typeof payload.fileName === "string") fileName = payload.fileName;
        if (typeof payload.mimeType === "string") mimeType = payload.mimeType;
      } catch {
        fileName = null;
      }
    }
  }
  return {
    captureId: row.id,
    kind: row.kind,
    title: row.title,
    occurredAt: row.occurred_at,
    localUri: row.local_uri,
    mediaType: row.media_type,
    fileName,
    mimeType,
    inboxItemId: row.inbox_item_id,
    memoryEventId: row.memory_event_id,
    syncState: row.sync_state,
    text,
  };
}

/**
 * 移除一条本机记录条目（不删除本机原件文件）。
 * 用于原件已丢失的残留记录，或用户明确选择只移除条目的场景。
 */
export async function removeLocalCaptureRecord(captureId: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async tx => {
    const reference = await tx.getFirstAsync<{ id: string }>(`SELECT d.id FROM local_draft d,
      json_each(json_extract(d.snapshot_json, '$.content.items')) i
      WHERE json_extract(i.value, '$.localCaptureRef') = ?
      AND json_extract(d.snapshot_json, '$.status') IN ('editing', 'queued') LIMIT 1`, captureId);
    if (reference) throw new Error("这份原件仍在草稿中，请先从草稿移除引用。");
    await tx.runAsync("DELETE FROM outbox WHERE id = ?", captureId);
    await tx.runAsync("DELETE FROM local_capture WHERE id = ?", captureId);
  });
}

// ===== M4：同步授权、目的地隔离与失败操作拆分 =====

const SYNC_CONSENT_KEY = "sync_consent";
const ACTIVE_DEST_KEY = "active_dest";

export async function getSyncConsent(): Promise<SyncConsent | null> {
  const raw = await getMeta(SYNC_CONSENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SyncConsent;
    if (
      (parsed.instanceId !== undefined && (typeof parsed.instanceId !== "string" || !parsed.instanceId || parsed.instanceId.length > 128)) ||
      (parsed.familyId !== null && typeof parsed.familyId !== "string") ||
      typeof parsed.serverUrl !== "string" ||
      typeof parsed.userId !== "string" ||
      !["all", "selected", "local"].includes(parsed.scope) ||
      !Array.isArray(parsed.ids) || parsed.ids.some((id) => typeof id !== "string")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setSyncConsent(consent: SyncConsent): Promise<void> {
  await setMeta(SYNC_CONSENT_KEY, JSON.stringify(consent));
}

export async function getActiveDestination(): Promise<string | null> {
  return getMeta(ACTIVE_DEST_KEY);
}

export async function setActiveDestination(destination: string): Promise<void> {
  await setMeta(ACTIVE_DEST_KEY, destination);
}

/**
 * 切换实例/账号后清理“来自服务器”的缓存：时间轴、人物、family/viewer、
 * 首页/回顾与库缓存、记忆详情缓存。绝不触碰本机记录（local_capture、
 * outbox、原件目录）——它们属于设备主人，不随连接切换删除。
 */
export async function clearServerCaches(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM timeline_event");
  await db.runAsync("DELETE FROM people");
  await db.runAsync("DELETE FROM memory_detail");
  await db.runAsync(
    "DELETE FROM meta WHERE key IN ('mobile_home', 'mobile_review', 'family', 'viewer', 'last_sync_at')",
  );
  await db.runAsync("DELETE FROM meta WHERE key LIKE 'library_%'");
}

/** 仅保留在本机：移除待传队列项，保留 local_capture 与原件文件。 */
export async function keepOutboxItemLocal(itemId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM outbox WHERE id = ?", itemId);
}

/** 彻底删除一条本机记录（含原件文件由调用方处理）。 */
export async function deleteLocalCaptureRecord(captureId: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async tx => {
    const reference = await tx.getFirstAsync<{ id: string }>(`SELECT d.id FROM local_draft d,
      json_each(json_extract(d.snapshot_json, '$.content.items')) i
      WHERE json_extract(i.value, '$.localCaptureRef') = ?
      AND json_extract(d.snapshot_json, '$.status') IN ('editing', 'queued') LIMIT 1`, captureId);
    if (reference) throw new Error("这份原件仍在草稿中，请先从草稿移除引用。");
    await tx.runAsync("DELETE FROM outbox WHERE id = ?", captureId);
    await tx.runAsync("DELETE FROM local_capture WHERE id = ?", captureId);
  });
}

/** 救援包恢复：captureId 是否已存在（幂等导入）。 */
export async function captureRecordExists(captureId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM local_capture WHERE id = ? LIMIT 1",
    captureId,
  );
  return Boolean(row);
}

/** 救援包恢复：忠实保留原 title/occurredAt，恢复后默认仅本机（pending）。 */
export async function insertRestoredTextCapture(input: {
  captureId: string;
  title: string;
  occurredAt: string;
  text: string;
}): Promise<void> {
  const db = await getDatabase();
  const payload: TextCapturePayload = { text: input.text };
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT INTO local_capture(id, kind, title, occurred_at, local_uri, media_type, payload_json, sync_state)
       VALUES (?, 'text_capture', ?, ?, NULL, NULL, ?, 'pending')`,
      input.captureId,
      input.title,
      input.occurredAt,
      JSON.stringify(payload),
    );
    await tx.runAsync(
      "INSERT INTO outbox(id, kind, payload_json, created_at) VALUES (?, 'text_capture', ?, ?)",
      input.captureId,
      JSON.stringify(payload),
      input.occurredAt,
    );
  });
}

export async function insertRestoredMediaCapture(input: {
  captureId: string;
  title: string;
  occurredAt: string;
  fileName: string;
  mimeType: string;
  mediaType: MediaCapturePayload["mediaType"];
  localUri: string;
}): Promise<void> {
  const db = await getDatabase();
  const payload: MediaCapturePayload = {
    localUri: input.localUri,
    fileName: input.fileName,
    mimeType: input.mimeType,
    lastModified: null,
    mediaType: input.mediaType,
    source: "files",
  };
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT INTO local_capture(id, kind, title, occurred_at, local_uri, media_type, payload_json, sync_state)
       VALUES (?, 'media_capture', ?, ?, ?, ?, ?, 'pending')`,
      input.captureId,
      input.title,
      input.occurredAt,
      input.localUri,
      input.mediaType,
      JSON.stringify(payload),
    );
    await tx.runAsync(
      "INSERT INTO outbox(id, kind, payload_json, created_at) VALUES (?, 'media_capture', ?, ?)",
      input.captureId,
      JSON.stringify(payload),
      input.occurredAt,
    );
  });
}

/** 救援包导出用的未入档记录清单（含载荷中的文字/文件名）。 */
export type PendingRescueItem = {
  captureId: string;
  kind: "text_capture" | "media_capture";
  title: string;
  occurredAt: string;
  localUri: string | null;
  mediaType: string | null;
  fileName: string | null;
  mimeType: string | null;
  text: string | null;
};

export async function listPendingRescueItems(): Promise<PendingRescueItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    kind: "text_capture" | "media_capture";
    title: string;
    occurred_at: string;
    local_uri: string | null;
    media_type: string | null;
    payload_json: string | null;
  }>(
    `SELECT l.id, l.kind, l.title, l.occurred_at, l.local_uri, l.media_type, COALESCE(l.payload_json, o.payload_json) AS payload_json
     FROM local_capture l LEFT JOIN outbox o ON o.id = l.id
     WHERE l.sync_state <> 'archived'
     ORDER BY l.occurred_at DESC, l.id DESC`,
  );
  return rows.map((row) => {
    let fileName: string | null = null;
    let mimeType: string | null = null;
    let text: string | null = null;
    try {
      const payload = row.payload_json
        ? (JSON.parse(row.payload_json) as {
            text?: unknown; fileName?: unknown; mimeType?: unknown;
          })
        : null;
      if (payload) {
        if (typeof payload.text === "string") text = payload.text;
        if (typeof payload.fileName === "string") fileName = payload.fileName;
        if (typeof payload.mimeType === "string") mimeType = payload.mimeType;
      }
    } catch {
      // 残缺载荷按纯元数据处理
    }
    return {
      captureId: row.id,
      kind: row.kind,
      title: row.title,
      occurredAt: row.occurred_at,
      localUri: row.local_uri,
      mediaType: row.media_type,
      fileName,
      mimeType,
      text,
    };
  });
}
