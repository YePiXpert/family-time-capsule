CREATE TABLE `asset_transcript` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`language` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`raw_transcript` text NOT NULL,
	`edited_transcript` text,
	`segments_json` text,
	`status` text DEFAULT 'machine' NOT NULL,
	`source_sha256` text NOT NULL,
	`created_by_job_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_transcript_status_check" CHECK("asset_transcript"."status" in ('machine', 'user_edited'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_transcript_asset_uidx` ON `asset_transcript` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_transcript_family_idx` ON `asset_transcript` (`family_id`);