CREATE TABLE `capsule` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`title` text NOT NULL,
	`unlock_type` text NOT NULL,
	`unlock_value` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sealed_at` integer,
	`opened_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capsule_family_idx` ON `capsule` (`family_id`,`status`);--> statement-breakpoint
CREATE TABLE `capsule_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`capsule_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capsule_asset_capsule_idx` ON `capsule_asset` (`capsule_id`);--> statement-breakpoint
CREATE TABLE `capsule_contribution` (
	`id` text PRIMARY KEY NOT NULL,
	`capsule_id` text NOT NULL,
	`contribution_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contribution_id`) REFERENCES `contribution`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capsule_contribution_capsule_idx` ON `capsule_contribution` (`capsule_id`);--> statement-breakpoint
CREATE TABLE `capsule_event` (
	`id` text PRIMARY KEY NOT NULL,
	`capsule_id` text NOT NULL,
	`memory_event_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capsule_event_capsule_idx` ON `capsule_event` (`capsule_id`);