CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`type` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`captured_at` integer,
	`imported_at` integer NOT NULL,
	`time_source` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`metadata_json` text,
	`created_by_user_id` text NOT NULL,
	`original_asset_id` text,
	`derivative_type` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_family_sha_idx` ON `asset` (`family_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `asset_family_created_idx` ON `asset` (`family_id`,`created_at`);