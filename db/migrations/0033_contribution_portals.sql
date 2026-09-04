-- Drizzle runs SQLite migrations inside a transaction, where changing
-- PRAGMA foreign_keys is a no-op. Preserve the existing child rows explicitly
-- before rebuilding contribution_request or DROP would cascade-delete them.
CREATE TABLE `__preserved_contribution_request_submission` AS
SELECT `id`, `family_id`, `request_id`, `inbox_item_id`, `created_at`
FROM `contribution_request_submission`;--> statement-breakpoint
DROP TABLE `contribution_request_submission`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contribution_request` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text,
	`kind` text DEFAULT 'request' NOT NULL,
	`title` text,
	`recipient_label` text NOT NULL,
	`recipient_person_id` text,
	`prompt_text` text NOT NULL,
	`topic_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`max_submissions` integer DEFAULT 5 NOT NULL,
	`max_files_per_submission` integer DEFAULT 10 NOT NULL,
	`allow_images` integer DEFAULT true NOT NULL,
	`allow_audio` integer DEFAULT true NOT NULL,
	`allow_video` integer DEFAULT true NOT NULL,
	`allow_documents` integer DEFAULT false NOT NULL,
	`allow_text` integer DEFAULT true NOT NULL,
	`allow_browser_recording` integer DEFAULT true NOT NULL,
	`allow_guest_name` integer DEFAULT false NOT NULL,
	`allow_reuse` integer DEFAULT true NOT NULL,
	`expires_at` integer NOT NULL,
	`closed_at` integer,
	`closed_by_user_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "contribution_request_token_hash_check" CHECK("__new_contribution_request"."token_hash" is null or length("__new_contribution_request"."token_hash") = 64),
	CONSTRAINT "contribution_request_kind_check" CHECK("__new_contribution_request"."kind" in ('request', 'portal')),
	CONSTRAINT "contribution_request_status_check" CHECK("__new_contribution_request"."status" in ('open', 'paused', 'closed')),
	CONSTRAINT "contribution_request_label_check" CHECK(length("__new_contribution_request"."recipient_label") between 1 and 50),
	CONSTRAINT "contribution_request_prompt_check" CHECK(length("__new_contribution_request"."prompt_text") between 1 and 500),
	CONSTRAINT "contribution_request_title_check" CHECK("__new_contribution_request"."title" is null or length("__new_contribution_request"."title") between 1 and 100),
	CONSTRAINT "contribution_request_limits_check" CHECK("__new_contribution_request"."max_submissions" between 1 and 1000 and "__new_contribution_request"."max_files_per_submission" between 0 and 100)
);
--> statement-breakpoint
INSERT INTO `__new_contribution_request`("id", "family_id", "token_hash", "kind", "title", "recipient_label", "recipient_person_id", "prompt_text", "topic_key", "status", "max_submissions", "max_files_per_submission", "allow_images", "allow_audio", "allow_video", "allow_documents", "allow_text", "allow_browser_recording", "allow_guest_name", "allow_reuse", "expires_at", "closed_at", "closed_by_user_id", "created_by_user_id", "created_at", "updated_at") SELECT "id", "family_id", "token_hash", 'request', NULL, "recipient_label", "recipient_person_id", "prompt_text", "topic_key", "status", 5, 10, 1, 1, 1, 0, 1, 1, 0, 1, "expires_at", "closed_at", "closed_by_user_id", "created_by_user_id", "created_at", "updated_at" FROM `contribution_request`;--> statement-breakpoint
DROP TABLE `contribution_request`;--> statement-breakpoint
ALTER TABLE `__new_contribution_request` RENAME TO `contribution_request`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_request_token_hash_uidx` ON `contribution_request` (`token_hash`);--> statement-breakpoint
CREATE INDEX `contribution_request_family_idx` ON `contribution_request` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `contribution_request_person_idx` ON `contribution_request` (`family_id`,`recipient_person_id`);--> statement-breakpoint
CREATE TABLE `contribution_request_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`request_id` text NOT NULL,
	`inbox_item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `contribution_request`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `contribution_request_submission` (`id`, `family_id`, `request_id`, `inbox_item_id`, `created_at`)
SELECT `id`, `family_id`, `request_id`, `inbox_item_id`, `created_at`
FROM `__preserved_contribution_request_submission`;--> statement-breakpoint
DROP TABLE `__preserved_contribution_request_submission`;--> statement-breakpoint
CREATE INDEX `contribution_request_submission_request_idx` ON `contribution_request_submission` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contribution_request_submission_family_idx` ON `contribution_request_submission` (`family_id`);--> statement-breakpoint
CREATE TABLE `contribution_portal_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`request_id` text NOT NULL,
	`import_session_id` text NOT NULL,
	`guest_display_name` text,
	`status` text DEFAULT 'collecting' NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `contribution_request`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_session_id`) REFERENCES `import_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contribution_portal_submission_status_check" CHECK("contribution_portal_submission"."status" in ('collecting', 'completed')),
	CONSTRAINT "contribution_portal_submission_name_check" CHECK("contribution_portal_submission"."guest_display_name" is null or length("contribution_portal_submission"."guest_display_name") between 1 and 50)
);--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_portal_submission_import_uidx` ON `contribution_portal_submission` (`import_session_id`);--> statement-breakpoint
CREATE INDEX `contribution_portal_submission_request_idx` ON `contribution_portal_submission` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contribution_portal_submission_family_idx` ON `contribution_portal_submission` (`family_id`,`created_at`);
