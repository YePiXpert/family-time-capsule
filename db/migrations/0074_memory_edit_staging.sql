-- ftc:foreign-key-rebuild
-- Keep ordinary drafts and all referring rows while adding a separate sealed edit purpose.
CREATE TEMP TABLE ftc_rebuild_precondition (foreign_keys INTEGER CHECK (foreign_keys = 0));--> statement-breakpoint
INSERT INTO ftc_rebuild_precondition SELECT foreign_keys * EXISTS(SELECT 1 FROM draft) FROM pragma_foreign_keys;--> statement-breakpoint
DROP TABLE ftc_rebuild_precondition;--> statement-breakpoint
PRAGMA legacy_alter_table = ON;--> statement-breakpoint
CREATE TABLE __new_draft (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  author_person_id TEXT REFERENCES person(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT 'capture' CHECK(purpose IN ('capture', 'memory_edit')),
  edit_target_memory_id TEXT REFERENCES memory_event(id) ON DELETE SET NULL,
  milestone_type TEXT CHECK(milestone_type IS NULL OR milestone_type = 'first_time'),
  title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
  occurred_at TEXT, occurred_at_precision TEXT NOT NULL DEFAULT 'exact',
  location_text TEXT NOT NULL DEFAULT '', participant_ids_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'family' CHECK(visibility IN ('family', 'members', 'private')),
  reader_user_ids_json TEXT NOT NULL DEFAULT '[]', cover_item_id TEXT,
  status TEXT NOT NULL DEFAULT 'editing', revision INTEGER NOT NULL DEFAULT 0,
  reviewed_revision INTEGER, mutation_id TEXT NOT NULL,
  inbox_item_id TEXT REFERENCES inbox_item(id) ON DELETE SET NULL,
  memory_event_id TEXT REFERENCES memory_event(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((purpose = 'capture' AND edit_target_memory_id IS NULL AND status IN ('editing','published','discarded'))
    OR (purpose = 'memory_edit' AND status IN ('editing','applied','discarded') AND visibility = 'private'
      AND reader_user_ids_json = '[]' AND inbox_item_id IS NULL AND memory_event_id IS NULL))
);
--> statement-breakpoint
INSERT INTO __new_draft (id,family_id,author_user_id,author_person_id,author_name,title,text,occurred_at,occurred_at_precision,location_text,participant_ids_json,visibility,reader_user_ids_json,cover_item_id,status,revision,reviewed_revision,mutation_id,inbox_item_id,memory_event_id,created_at,updated_at)
SELECT id,family_id,author_user_id,author_person_id,author_name,title,text,occurred_at,occurred_at_precision,location_text,participant_ids_json,visibility,reader_user_ids_json,cover_item_id,status,revision,reviewed_revision,mutation_id,inbox_item_id,memory_event_id,created_at,updated_at FROM draft;--> statement-breakpoint
DROP TABLE draft;--> statement-breakpoint
ALTER TABLE __new_draft RENAME TO draft;--> statement-breakpoint
CREATE INDEX draft_author_updated_idx ON draft(family_id, author_user_id, updated_at);--> statement-breakpoint
CREATE INDEX draft_edit_target_idx ON draft(family_id, edit_target_memory_id, purpose);--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;--> statement-breakpoint
CREATE TEMP TABLE ftc_fk_check (violations INTEGER CHECK (violations = 0));--> statement-breakpoint
INSERT INTO ftc_fk_check SELECT count(*) FROM pragma_foreign_key_check;--> statement-breakpoint
DROP TABLE ftc_fk_check;
