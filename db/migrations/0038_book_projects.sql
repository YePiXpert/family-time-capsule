CREATE TABLE `book_block` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`layout_json` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `book_chapter`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_block_chapter_position_idx` ON `book_block` (`chapter_id`,`position`);--> statement-breakpoint
CREATE TABLE `book_block_source` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`block_id` text NOT NULL,
	`source_ref_id` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `book_block`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_ref_id`) REFERENCES `book_source_ref`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_block_source_unique_idx` ON `book_block_source` (`block_id`,`source_ref_id`);--> statement-breakpoint
CREATE INDEX `book_block_source_project_idx` ON `book_block_source` (`project_id`);--> statement-breakpoint
CREATE TABLE `book_chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_chapter_project_position_idx` ON `book_chapter` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `book_project` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_person_id` text,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`template` text NOT NULL,
	`audience` text NOT NULL,
	`page_size` text DEFAULT 'A5' NOT NULL,
	`start_date` text,
	`end_date` text,
	`cover_asset_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`draft_key` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `book_project_family_cursor_idx` ON `book_project` (`family_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `book_project_active_draft_idx` ON `book_project` (`family_id`,`draft_key`) WHERE "book_project"."draft_key" is not null and "book_project"."deleted_at" is null and "book_project"."status"='active';--> statement-breakpoint
CREATE TABLE `book_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_revision_project_unique_idx` ON `book_revision` (`project_id`,`revision`);--> statement-breakpoint
CREATE TABLE `book_source_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`memory_event_id` text,
	`asset_id` text,
	`contribution_id` text,
	`story_id` text,
	`collection_id` text,
	`fingerprint` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contribution_id`) REFERENCES `contribution`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `book_source_project_idx` ON `book_source_ref` (`project_id`);