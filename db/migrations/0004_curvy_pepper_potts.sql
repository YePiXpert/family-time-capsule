CREATE TABLE `memory_event` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`child_person_id` text NOT NULL,
	`title` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`occurred_at_precision` text DEFAULT 'exact' NOT NULL,
	`location_text` text,
	`cover_asset_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`age_days` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_family_occurred_idx` ON `memory_event` (`family_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `memory_child_idx` ON `memory_event` (`child_person_id`);--> statement-breakpoint
CREATE TABLE `memory_event_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_event_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_event_asset_event_idx` ON `memory_event_asset` (`memory_event_id`);--> statement-breakpoint
CREATE INDEX `memory_event_asset_asset_idx` ON `memory_event_asset` (`asset_id`);--> statement-breakpoint
CREATE TABLE `memory_event_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_event_id` text NOT NULL,
	`person_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_participant_event_idx` ON `memory_event_participant` (`memory_event_id`);--> statement-breakpoint
CREATE INDEX `memory_participant_person_idx` ON `memory_event_participant` (`person_id`);