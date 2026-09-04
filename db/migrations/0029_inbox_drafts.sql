CREATE TABLE `inbox_item_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_item_id` text NOT NULL,
	`person_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_item_participant_unique_idx` ON `inbox_item_participant` (`inbox_item_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `inbox_item_participant_family_idx` ON `inbox_item_participant` (`family_id`,`inbox_item_id`);--> statement-breakpoint
ALTER TABLE `inbox_item` ADD `draft_title` text;--> statement-breakpoint
ALTER TABLE `inbox_item` ADD `draft_occurred_at` integer;--> statement-breakpoint
ALTER TABLE `inbox_item` ADD `draft_location_text` text;