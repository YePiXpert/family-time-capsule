CREATE TABLE `book_render_job` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`requested_by_user_id` text,
	`revision` integer NOT NULL,
	`template_version` text NOT NULL,
	`format` text NOT NULL,
	`audience` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_digest` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`pages` integer,
	`bytes` integer,
	`sha256` text,
	`error_code` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `book_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_render_key_idx` ON `book_render_job` (`family_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `book_render_queue_idx` ON `book_render_job` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `book_render_project_idx` ON `book_render_job` (`project_id`);--> statement-breakpoint
CREATE TABLE `book_render_lease` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
