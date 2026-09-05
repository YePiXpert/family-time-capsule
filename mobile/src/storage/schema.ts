export const MEMORY_DETAIL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS memory_detail (
    scope TEXT NOT NULL,
    id TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, id)
  );
`;

export const MOBILE_LOCAL_SCHEMA_SQL = `
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
    age_label TEXT,
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
  CREATE TABLE IF NOT EXISTS local_capture (
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
  CREATE INDEX IF NOT EXISTS local_capture_occurred_idx
    ON local_capture(occurred_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS local_import_session (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('files', 'share')),
    status TEXT NOT NULL DEFAULT 'collecting'
      CHECK(status IN ('collecting', 'uploading', 'reviewing', 'completed', 'cancelled')),
    total_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS local_import_session_updated_idx
    ON local_import_session(updated_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS local_import_item (
    id TEXT PRIMARY KEY NOT NULL,
    import_session_id TEXT NOT NULL REFERENCES local_import_session(id) ON DELETE CASCADE,
    capture_id TEXT NOT NULL UNIQUE,
    external_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    intake_state TEXT NOT NULL DEFAULT 'received'
      CHECK(intake_state IN ('received', 'copied', 'queued', 'uploading', 'inbox', 'archived')),
    local_uri TEXT,
    inbox_item_id TEXT,
    memory_event_id TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(import_session_id, external_id)
  );
  CREATE INDEX IF NOT EXISTS local_import_item_session_idx
    ON local_import_item(import_session_id, sort_order, id);
  ${MEMORY_DETAIL_SCHEMA_SQL}

  INSERT OR IGNORE INTO local_capture(
    id, kind, title, occurred_at, local_uri, media_type, sync_state
  )
  SELECT
    id,
    kind,
    CASE
      WHEN kind = 'text_capture' THEN json_extract(payload_json, '$.text')
      ELSE COALESCE(json_extract(payload_json, '$.fileName'), '本地素材')
    END,
    created_at,
    CASE
      WHEN kind = 'media_capture' THEN json_extract(payload_json, '$.localUri')
      ELSE NULL
    END,
    CASE
      WHEN kind = 'media_capture' THEN json_extract(payload_json, '$.mediaType')
      ELSE NULL
    END,
    'pending'
  FROM outbox;
`;
