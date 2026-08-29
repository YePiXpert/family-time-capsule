CREATE TABLE `contribution` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_event_id` text NOT NULL,
	`author_person_id` text NOT NULL,
	`raw_text` text,
	`audio_asset_id` text,
	`transcript` text,
	`edited_text` text,
	`visibility` text DEFAULT 'family' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audio_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contribution_event_idx` ON `contribution` (`memory_event_id`);--> statement-breakpoint
CREATE INDEX `contribution_author_idx` ON `contribution` (`author_person_id`);--> statement-breakpoint
CREATE TABLE `fact` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_event_id` text NOT NULL,
	`statement` text NOT NULL,
	`status` text DEFAULT 'user_confirmed' NOT NULL,
	`confidence` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fact_event_idx` ON `fact` (`memory_event_id`);