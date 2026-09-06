ALTER TABLE `ai_suggestion` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_suggestion` ADD `target_revision` integer;--> statement-breakpoint
ALTER TABLE `ai_suggestion` ADD `applied_revision` integer;--> statement-breakpoint
ALTER TABLE `ai_suggestion` ADD `previous_name_json` text;--> statement-breakpoint
ALTER TABLE `ai_suggestion` ADD `undone_at` integer;