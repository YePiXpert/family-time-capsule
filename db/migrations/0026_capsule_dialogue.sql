CREATE TABLE `capsule_reply` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`question_id` text NOT NULL,
	`capsule_id` text NOT NULL,
	`author_person_id` text,
	`text` text,
	`asset_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `future_question`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "capsule_reply_content_check" CHECK(("capsule_reply"."text" is not null and length("capsule_reply"."text") between 1 and 10000) or "capsule_reply"."asset_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `capsule_reply_question_idx` ON `capsule_reply` (`question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `future_question` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`capsule_id` text NOT NULL,
	`question_text` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "future_question_text_check" CHECK(length("future_question"."question_text") between 1 and 500)
);
--> statement-breakpoint
CREATE INDEX `future_question_capsule_idx` ON `future_question` (`capsule_id`);