CREATE TABLE `review_period` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`story_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "review_period_status_check" CHECK("review_period"."status" in ('open', 'in_progress', 'completed')),
	CONSTRAINT "review_period_window_check" CHECK("review_period"."period_end" > "review_period"."period_start")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_period_family_window_uidx` ON `review_period` (`family_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `review_period_family_status_idx` ON `review_period` (`family_id`,`status`,`period_start`);--> statement-breakpoint
CREATE TABLE `review_period_event` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`review_period_id` text NOT NULL,
	`memory_event_id` text NOT NULL,
	`selected_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_period_id`) REFERENCES `review_period`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_period_event_uidx` ON `review_period_event` (`review_period_id`,`memory_event_id`);--> statement-breakpoint
CREATE INDEX `review_period_event_family_idx` ON `review_period_event` (`family_id`,`review_period_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_story_source` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`paragraph_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`quote` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paragraph_id`) REFERENCES `story_paragraph`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_source_type_check" CHECK("__new_story_source"."source_type" in ('fact', 'contribution', 'transcript', 'user_text', 'memory_event'))
);
--> statement-breakpoint
INSERT INTO `__new_story_source`("id", "family_id", "paragraph_id", "source_type", "source_id", "quote", "created_at") SELECT "id", "family_id", "paragraph_id", "source_type", "source_id", "quote", "created_at" FROM `story_source`;--> statement-breakpoint
DROP TABLE `story_source`;--> statement-breakpoint
ALTER TABLE `__new_story_source` RENAME TO `story_source`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `story_source_paragraph_idx` ON `story_source` (`paragraph_id`);--> statement-breakpoint
ALTER TABLE `family` ADD `week_starts_on` integer DEFAULT 1 NOT NULL CHECK (`week_starts_on` between 0 and 6);--> statement-breakpoint
ALTER TABLE `family` ADD `review_reminder_weekday` integer DEFAULT 0 NOT NULL CHECK (`review_reminder_weekday` between 0 and 6);--> statement-breakpoint
ALTER TABLE `family` ADD `review_reminder_local_time` text DEFAULT '19:30' NOT NULL CHECK (`review_reminder_local_time` glob '[0-2][0-9]:[0-5][0-9]' and substr(`review_reminder_local_time`, 1, 2) between '00' and '23');--> statement-breakpoint
ALTER TABLE `family` ADD `remind_pending_inbox` integer DEFAULT true NOT NULL CHECK (`remind_pending_inbox` in (0, 1));--> statement-breakpoint
ALTER TABLE `family` ADD `remind_pending_requests` integer DEFAULT true NOT NULL CHECK (`remind_pending_requests` in (0, 1));--> statement-breakpoint
ALTER TABLE `family` ADD `remind_upcoming_capsules` integer DEFAULT true NOT NULL CHECK (`remind_upcoming_capsules` in (0, 1));
