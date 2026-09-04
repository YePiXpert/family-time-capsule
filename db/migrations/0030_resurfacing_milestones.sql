ALTER TABLE `memory_event` ADD `milestone_type` text;--> statement-breakpoint
ALTER TABLE `memory_event` ADD `is_pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `memory_family_milestone_idx` ON `memory_event` (`family_id`,`is_pinned`,`milestone_type`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `contribution_request` ADD `recipient_person_id` text REFERENCES person(id);--> statement-breakpoint
CREATE INDEX `contribution_request_person_idx` ON `contribution_request` (`family_id`,`recipient_person_id`);