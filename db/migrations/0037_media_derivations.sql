CREATE TABLE `media_job` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`output_asset_id` text,
	`error_code` text,
	`lease` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`output_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_job_source_kind_idx` ON `media_job` (`asset_id`,`kind`);--> statement-breakpoint
CREATE INDEX `media_job_queue_idx` ON `media_job` (`status`,`created_at`);