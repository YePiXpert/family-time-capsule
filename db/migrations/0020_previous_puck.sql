CREATE TABLE `cluster_suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`inbox_item_ids_json` text NOT NULL,
	`reason_text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cluster_suggestion_kind_check" CHECK("cluster_suggestion"."kind" in ('time_proximity', 'similar_media', 'live_photo_pair')),
	CONSTRAINT "cluster_suggestion_status_check" CHECK("cluster_suggestion"."status" in ('pending', 'accepted', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `cluster_suggestion_family_status_idx` ON `cluster_suggestion` (`family_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_suggestion` (
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
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_suggestion_entity_type_check" CHECK("__new_ai_suggestion"."entity_type" in ('memory_event', 'inbox_item')),
	CONSTRAINT "ai_suggestion_type_check" CHECK("__new_ai_suggestion"."suggestion_type" in ('title', 'location', 'person', 'tag', 'occurred_at')),
	CONSTRAINT "ai_suggestion_status_check" CHECK("__new_ai_suggestion"."status" in ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_suggestion`("id", "family_id", "entity_type", "entity_id", "suggestion_type", "value_json", "provider", "model", "status", "created_by_job_id", "source_fingerprint", "created_at", "resolved_at", "resolved_by_user_id") SELECT "id", "family_id", "entity_type", "entity_id", "suggestion_type", "value_json", "provider", "model", "status", "created_by_job_id", "source_fingerprint", "created_at", "resolved_at", "resolved_by_user_id" FROM `ai_suggestion`;--> statement-breakpoint
DROP TABLE `ai_suggestion`;--> statement-breakpoint
ALTER TABLE `__new_ai_suggestion` RENAME TO `ai_suggestion`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_suggestion_family_idx` ON `ai_suggestion` (`family_id`);--> statement-breakpoint
CREATE INDEX `ai_suggestion_entity_status_idx` ON `ai_suggestion` (`entity_type`,`entity_id`,`status`);