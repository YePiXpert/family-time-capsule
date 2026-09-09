-- ftc:foreign-key-rebuild
-- Retire optional product modules while preserving accounts, core records and work graphs.
CREATE TEMP TABLE ftc_rebuild_precondition (foreign_keys INTEGER CHECK (foreign_keys = 0));
--> statement-breakpoint
INSERT INTO ftc_rebuild_precondition SELECT foreign_keys * EXISTS(SELECT 1 FROM family) FROM pragma_foreign_keys;
--> statement-breakpoint
DROP TABLE ftc_rebuild_precondition;
--> statement-breakpoint
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
-- A book with retired story sources needs deliberate conversion, never uncited publication.
CREATE TEMP TABLE ftc_retired_source_guard (count INTEGER CHECK (count = 0));
--> statement-breakpoint
INSERT INTO ftc_retired_source_guard SELECT count(*) FROM book_source_ref WHERE kind='story';
--> statement-breakpoint
DROP TABLE ftc_retired_source_guard;
--> statement-breakpoint
CREATE TABLE __new_family (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
 child_later_unlock_age INTEGER NOT NULL DEFAULT 18 CONSTRAINT family_child_later_unlock_age_check CHECK(typeof(child_later_unlock_age)='integer' AND child_later_unlock_age BETWEEN 1 AND 100),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO __new_family SELECT id,name,timezone,child_later_unlock_age,created_at,updated_at FROM family;
--> statement-breakpoint
DROP TABLE family;
--> statement-breakpoint
ALTER TABLE __new_family RENAME TO family;
--> statement-breakpoint
CREATE TABLE `__new_book_source_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`memory_event_id` text,
	`asset_id` text,
	`contribution_id` text,
	`collection_id` text,
	`fingerprint` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contribution_id`) REFERENCES `contribution`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO __new_book_source_ref (id,family_id,project_id,kind,memory_event_id,asset_id,contribution_id,collection_id,fingerprint,label,created_at)
SELECT id,family_id,project_id,kind,memory_event_id,asset_id,contribution_id,collection_id,fingerprint,label,created_at FROM book_source_ref;
--> statement-breakpoint
DROP TABLE book_source_ref;
--> statement-breakpoint
ALTER TABLE __new_book_source_ref RENAME TO book_source_ref;
--> statement-breakpoint
CREATE TRIGGER sync_family_insert AFTER INSERT ON family BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_family_update AFTER UPDATE ON family BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_family_delete AFTER DELETE ON family BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE INDEX `book_source_project_idx` ON `book_source_ref` (`project_id`);
--> statement-breakpoint
CREATE TRIGGER sync_book_source_ref_insert AFTER INSERT ON book_source_ref BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_source_ref_update AFTER UPDATE ON book_source_ref BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_source_ref_delete AFTER DELETE ON book_source_ref BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
DROP TABLE review_period_event;
--> statement-breakpoint
DROP TABLE review_period;
--> statement-breakpoint
DROP TABLE contribution_portal_submission;
--> statement-breakpoint
DROP TABLE contribution_request_submission;
--> statement-breakpoint
DROP TABLE contribution_request;
--> statement-breakpoint
DROP TABLE story_source;
--> statement-breakpoint
DROP TABLE story_paragraph;
--> statement-breakpoint
DROP TABLE story;
--> statement-breakpoint
DROP TABLE capsule_reply;
--> statement-breakpoint
DROP TABLE future_question;
--> statement-breakpoint
DROP TABLE capsule_contribution;
--> statement-breakpoint
DROP TABLE capsule_event;
--> statement-breakpoint
DROP TABLE capsule_asset;
--> statement-breakpoint
DROP TABLE capsule;
--> statement-breakpoint
DELETE FROM search_index WHERE entity_type='story';
--> statement-breakpoint
UPDATE ai_job_attempt SET status='cancelled',error_code='feature_retired',finished_at=max(unixepoch(),started_at) WHERE status='running' AND job_id IN (SELECT id FROM ai_job WHERE job_type IN ('generate.story.v1','optimize.review_story.v1'));
--> statement-breakpoint
UPDATE ai_job SET status='cancelled',last_error_code='feature_retired',finished_at=max(unixepoch(),created_at),updated_at=max(unixepoch(),updated_at),lease_owner=NULL,lease_expires_at=NULL WHERE job_type IN ('generate.story.v1','optimize.review_story.v1') AND status IN ('pending','running');
--> statement-breakpoint
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() FROM family;
--> statement-breakpoint
CREATE TEMP TABLE ftc_post_migration_check (violations INTEGER CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO ftc_post_migration_check SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE ftc_post_migration_check;
