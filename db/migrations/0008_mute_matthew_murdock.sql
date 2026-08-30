CREATE TABLE `memory_event_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`memory_event_id` text NOT NULL,
	`edited_by_user_id` text,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `revision_event_idx` ON `memory_event_revision` (`memory_event_id`,`created_at`);