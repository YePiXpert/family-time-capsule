CREATE TABLE `contribution_request` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`recipient_label` text NOT NULL,
	`prompt_text` text NOT NULL,
	`topic_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` integer NOT NULL,
	`closed_at` integer,
	`closed_by_user_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "contribution_request_token_hash_check" CHECK(length("contribution_request"."token_hash") = 64),
	CONSTRAINT "contribution_request_status_check" CHECK("contribution_request"."status" in ('open', 'closed')),
	CONSTRAINT "contribution_request_label_check" CHECK(length("contribution_request"."recipient_label") between 1 and 50),
	CONSTRAINT "contribution_request_prompt_check" CHECK(length("contribution_request"."prompt_text") between 1 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_request_token_hash_uidx` ON `contribution_request` (`token_hash`);--> statement-breakpoint
CREATE INDEX `contribution_request_family_idx` ON `contribution_request` (`family_id`,`status`);--> statement-breakpoint
CREATE TABLE `contribution_request_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`request_id` text NOT NULL,
	`inbox_item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `contribution_request`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contribution_request_submission_request_idx` ON `contribution_request_submission` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contribution_request_submission_family_idx` ON `contribution_request_submission` (`family_id`);