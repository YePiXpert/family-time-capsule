CREATE TABLE `inbox_item` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`raw_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inbox_family_status_idx` ON `inbox_item` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `inbox_family_created_idx` ON `inbox_item` (`family_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inbox_item_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_item_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`family_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inbox_item_asset_item_idx` ON `inbox_item_asset` (`inbox_item_id`);--> statement-breakpoint
CREATE INDEX `inbox_item_asset_asset_idx` ON `inbox_item_asset` (`asset_id`);