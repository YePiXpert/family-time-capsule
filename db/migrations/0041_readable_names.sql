ALTER TABLE `asset` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `asset` ADD `name_source` text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `asset` ADD `name_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_item` ADD `title_source` text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_item` ADD `title_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_event` ADD `title_source` text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_event` ADD `title_revision` integer DEFAULT 0 NOT NULL;