-- ftc:foreign-key-rebuild
-- Disable foreign_keys before the migration transaction (migration-safety.ts).
-- An unsafe standalone migrator must abort before dropping a populated parent.
CREATE TEMP TABLE ftc_rebuild_precondition (foreign_keys INTEGER CHECK (foreign_keys = 0));--> statement-breakpoint
INSERT INTO ftc_rebuild_precondition SELECT foreign_keys * EXISTS(SELECT 1 FROM memory_event) FROM pragma_foreign_keys;--> statement-breakpoint
DROP TABLE ftc_rebuild_precondition;--> statement-breakpoint
PRAGMA legacy_alter_table = ON;--> statement-breakpoint
CREATE TABLE `__new_memory_event` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`child_person_id` text,
	`title` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`occurred_at_precision` text DEFAULT 'exact' NOT NULL,
	`location_text` text,
	`cover_asset_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`age_days` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `last_edited_by_user_id` text, `deleted_at` integer, `milestone_type` text, `is_pinned` integer DEFAULT false NOT NULL, `title_source` text DEFAULT 'legacy_unknown' NOT NULL, `title_revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO __new_memory_event (`id`, `family_id`, `child_person_id`, `title`, `occurred_at`, `occurred_at_precision`, `location_text`, `cover_asset_id`, `status`, `age_days`, `created_at`, `updated_at`, `last_edited_by_user_id`, `deleted_at`, `milestone_type`, `is_pinned`, `title_source`, `title_revision`) SELECT `id`, `family_id`, `child_person_id`, `title`, `occurred_at`, `occurred_at_precision`, `location_text`, `cover_asset_id`, `status`, `age_days`, `created_at`, `updated_at`, `last_edited_by_user_id`, `deleted_at`, `milestone_type`, `is_pinned`, `title_source`, `title_revision` FROM memory_event;--> statement-breakpoint
DROP TABLE memory_event;--> statement-breakpoint
ALTER TABLE __new_memory_event RENAME TO memory_event;--> statement-breakpoint
CREATE INDEX `memory_family_occurred_idx` ON `memory_event` (`family_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `memory_child_idx` ON `memory_event` (`child_person_id`);--> statement-breakpoint
CREATE INDEX `memory_family_status_cursor_idx` ON `memory_event` (`family_id`,`status`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `memory_family_milestone_idx` ON `memory_event` (`family_id`,`is_pinned`,`milestone_type`,`occurred_at`);--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;--> statement-breakpoint
CREATE TEMP TABLE ftc_fk_check (violations INTEGER CHECK (violations = 0));--> statement-breakpoint
INSERT INTO ftc_fk_check SELECT count(*) FROM pragma_foreign_key_check;--> statement-breakpoint
DROP TABLE ftc_fk_check;
