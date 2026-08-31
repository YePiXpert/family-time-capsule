CREATE TABLE `ai_suggestion` (
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
	CONSTRAINT "ai_suggestion_entity_type_check" CHECK("ai_suggestion"."entity_type" in ('memory_event')),
	CONSTRAINT "ai_suggestion_type_check" CHECK("ai_suggestion"."suggestion_type" in ('title', 'location', 'person', 'tag')),
	CONSTRAINT "ai_suggestion_status_check" CHECK("ai_suggestion"."status" in ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `ai_suggestion_family_idx` ON `ai_suggestion` (`family_id`);--> statement-breakpoint
CREATE INDEX `ai_suggestion_entity_status_idx` ON `ai_suggestion` (`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE TABLE `fact_source` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fact_source_type_check" CHECK("fact_source"."source_type" in ('asset', 'contribution', 'transcript', 'user_text'))
);
--> statement-breakpoint
CREATE INDEX `fact_source_fact_idx` ON `fact_source` (`fact_id`);--> statement-breakpoint
CREATE INDEX `fact_source_family_idx` ON `fact_source` (`family_id`);--> statement-breakpoint
CREATE TABLE `memory_event_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`memory_event_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_event_tag_event_tag_uidx` ON `memory_event_tag` (`memory_event_id`,`tag`);--> statement-breakpoint
CREATE INDEX `memory_event_tag_family_idx` ON `memory_event_tag` (`family_id`,`tag`);