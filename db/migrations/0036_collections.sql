CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_asset_id` text,
	`start_date` text,
	`end_date` text,
	`sort_mode` text DEFAULT 'manual' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collection_kind_check" CHECK("collection"."kind" in ('album','chapter')),
	CONSTRAINT "collection_sort_check" CHECK("collection"."sort_mode" in ('manual','time')),
	CONSTRAINT "collection_revision_check" CHECK("collection"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `collection_family_cursor_idx` ON `collection` (`family_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `collection_item` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`section_id` text,
	`memory_event_id` text,
	`caption` text DEFAULT '' NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `collection_section`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_event_id`) REFERENCES `memory_event`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_item_source_uidx` ON `collection_item` (`collection_id`,`memory_event_id`);--> statement-breakpoint
CREATE INDEX `collection_item_order_idx` ON `collection_item` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `collection_section` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_section_order_idx` ON `collection_section` (`collection_id`,`position`);