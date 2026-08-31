ALTER TABLE `inbox_item` ADD `memory_event_id` text REFERENCES memory_event(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `inbox_family_event_idx` ON `inbox_item` (`family_id`,`memory_event_id`);
