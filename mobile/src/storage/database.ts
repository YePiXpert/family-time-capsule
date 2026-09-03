import * as SQLite from "expo-sqlite";
import type {
  Family,
  LocalTimelineEvent,
  MediaCapturePayload,
  OutboxItem,
  Person,
  SyncPage,
  TextCapturePayload,
} from "../types";

const DB_NAME = "family-time-capsule.sqlite";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DB_NAME);
  return databasePromise;
}

export async function initializeLocalStore(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      relation_to_child TEXT,
      is_child INTEGER NOT NULL,
      birth_date TEXT,
      updated_at TEXT NOT NULL,
      seen_snapshot TEXT
    );
    CREATE TABLE IF NOT EXISTS timeline_event (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      occurred_at_precision TEXT NOT NULL,
      location_text TEXT,
      child_person_id TEXT NOT NULL,
      age_days INTEGER,
      updated_at TEXT NOT NULL,
      asset_count INTEGER NOT NULL,
      participant_names_json TEXT NOT NULL,
      cover_json TEXT,
      local_cover_uri TEXT,
      seen_snapshot TEXT
    );
    CREATE INDEX IF NOT EXISTS timeline_occurred_idx
      ON timeline_event(occurred_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('text_capture', 'media_capture')),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS outbox_created_idx ON outbox(created_at, id);
  `);
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
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

export async function listTimeline(): Promise<LocalTimelineEvent[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    occurred_at: string;
    occurred_at_precision: string;
    location_text: string | null;
    child_person_id: string;
    age_days: number | null;
    updated_at: string;
    asset_count: number;
    participant_names_json: string;
    cover_json: string | null;
    local_cover_uri: string | null;
  }>("SELECT * FROM timeline_event ORDER BY occurred_at DESC, id DESC");
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    occurredAt: row.occurred_at,
    occurredAtPrecision: row.occurred_at_precision,
    locationText: row.location_text,
    childPersonId: row.child_person_id,
    ageDays: row.age_days,
    updatedAt: row.updated_at,
    assetCount: row.asset_count,
    participantNames: JSON.parse(row.participant_names_json) as string[],
    cover: row.cover_json ? (JSON.parse(row.cover_json) as LocalTimelineEvent["cover"]) : null,
    localCoverUri: row.local_cover_uri,
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
          child_person_id, age_days, updated_at, asset_count,
          participant_names_json, cover_json, local_cover_uri, seen_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          occurred_at = excluded.occurred_at,
          occurred_at_precision = excluded.occurred_at_precision,
          location_text = excluded.location_text,
          child_person_id = excluded.child_person_id,
          age_days = excluded.age_days,
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
        event.updatedAt,
        event.assetCount,
        JSON.stringify(event.participantNames),
        event.cover ? JSON.stringify(event.cover) : null,
        snapshotId,
      );
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
  return enqueue(id, "text_capture", payload);
}

export async function enqueueMediaCapture(
  id: string,
  payload: MediaCapturePayload,
): Promise<void> {
  return enqueue(id, "media_capture", payload);
}

async function enqueue(
  id: string,
  kind: OutboxItem["kind"],
  payload: TextCapturePayload | MediaCapturePayload,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO outbox(id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
    id,
    kind,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
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
  }>("SELECT * FROM outbox ORDER BY created_at, id");
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as OutboxItem["payload"],
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
  await db.runAsync(
    "UPDATE outbox SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?",
    message.slice(0, 300),
    id,
  );
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM outbox WHERE id = ?", id);
}

export async function clearLocalArchive(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM timeline_event;
    DELETE FROM people;
    DELETE FROM outbox;
    DELETE FROM meta;
  `);
}

export type { Person };
