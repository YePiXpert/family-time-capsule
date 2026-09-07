-- ftc:foreign-key-rebuild
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
CREATE TABLE `__asset_ai_suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`suggestion_type` text NOT NULL,
	`value_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_job_id` text,
	`source_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`target_revision` integer,
	`applied_revision` integer,
	`previous_name_json` text,
	`undone_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_suggestion_entity_type_check" CHECK("entity_type" in ('memory_event', 'inbox_item', 'asset')),
	CONSTRAINT "ai_suggestion_type_check" CHECK("suggestion_type" in ('title', 'location', 'person', 'tag', 'occurred_at')),
	CONSTRAINT "ai_suggestion_status_check" CHECK("status" in ('pending', 'accepted', 'rejected'))
);

--> statement-breakpoint
INSERT INTO __asset_ai_suggestion (id,family_id,entity_type,entity_id,suggestion_type,value_json,provider,model,status,created_by_job_id,source_fingerprint,created_at,resolved_at,resolved_by_user_id,revision,target_revision,applied_revision,previous_name_json,undone_at) SELECT id,family_id,entity_type,entity_id,suggestion_type,value_json,provider,model,status,created_by_job_id,source_fingerprint,created_at,resolved_at,resolved_by_user_id,revision,target_revision,applied_revision,previous_name_json,undone_at FROM ai_suggestion;
--> statement-breakpoint
DROP TABLE ai_suggestion;
--> statement-breakpoint
ALTER TABLE __asset_ai_suggestion RENAME TO ai_suggestion;
--> statement-breakpoint
CREATE INDEX ai_suggestion_family_idx ON ai_suggestion(family_id);
--> statement-breakpoint
CREATE INDEX ai_suggestion_entity_status_idx ON ai_suggestion(entity_type,entity_id,status);
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
--> statement-breakpoint
CREATE TEMP TABLE ftc_fk_check (violations INTEGER CHECK (violations=0));
--> statement-breakpoint
INSERT INTO ftc_fk_check SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE ftc_fk_check;
