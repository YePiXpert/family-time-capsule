CREATE TABLE `story` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`edited_at` integer,
	`published_at` integer,
	`published_by_user_id` text,
	`created_by_job_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_kind_check" CHECK("story"."kind" in ('weekly', 'monthly', 'yearly')),
	CONSTRAINT "story_status_check" CHECK("story"."status" in ('draft', 'edited', 'published'))
);
--> statement-breakpoint
CREATE INDEX `story_family_period_idx` ON `story` (`family_id`,`kind`,`period_start`);--> statement-breakpoint
CREATE INDEX `story_family_status_idx` ON `story` (`family_id`,`status`);--> statement-breakpoint
CREATE TABLE `story_paragraph` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`story_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_paragraph_kind_check" CHECK("story_paragraph"."kind" in ('narrative', 'quote'))
);
--> statement-breakpoint
CREATE INDEX `story_paragraph_story_idx` ON `story_paragraph` (`story_id`,`position`);--> statement-breakpoint
CREATE TABLE `story_source` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`paragraph_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`quote` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paragraph_id`) REFERENCES `story_paragraph`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_source_type_check" CHECK("story_source"."source_type" in ('fact', 'contribution', 'transcript', 'user_text'))
);
--> statement-breakpoint
CREATE INDEX `story_source_paragraph_idx` ON `story_source` (`paragraph_id`);