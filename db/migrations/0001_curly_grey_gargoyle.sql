CREATE TABLE `family` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`display_name` text NOT NULL,
	`relation_to_child` text,
	`is_child` integer DEFAULT false NOT NULL,
	`birth_date` text,
	`avatar_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `person_family_idx` ON `person` (`family_id`);--> statement-breakpoint
ALTER TABLE `user` ADD `family_id` text REFERENCES family(id);--> statement-breakpoint
ALTER TABLE `user` ADD `person_id` text REFERENCES person(id);