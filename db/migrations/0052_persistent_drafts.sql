CREATE TABLE draft (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  author_person_id TEXT REFERENCES person(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  occurred_at_precision TEXT NOT NULL DEFAULT 'exact',
  location_text TEXT NOT NULL DEFAULT '',
  participant_ids_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'family' CHECK(visibility IN ('family', 'private')),
  cover_item_id TEXT,
  status TEXT NOT NULL DEFAULT 'editing' CHECK(status IN ('editing', 'published', 'discarded')),
  revision INTEGER NOT NULL DEFAULT 0,
  mutation_id TEXT NOT NULL,
  inbox_item_id TEXT REFERENCES inbox_item(id) ON DELETE SET NULL,
  memory_event_id TEXT REFERENCES memory_event(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX draft_author_updated_idx ON draft(family_id, author_user_id, updated_at);
--> statement-breakpoint
CREATE TABLE draft_item (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES asset(id) ON DELETE SET NULL,
  local_capture_ref TEXT,
  sort_order INTEGER NOT NULL,
  caption TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX draft_item_order_idx ON draft_item(draft_id, sort_order);
--> statement-breakpoint
ALTER TABLE memory_event_asset ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE memory_event_asset ADD COLUMN caption TEXT NOT NULL DEFAULT '';
