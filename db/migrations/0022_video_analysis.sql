PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_asset_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`description` text NOT NULL,
	`ocr_text` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`source_sha256` text NOT NULL,
	`analyzed_via` text NOT NULL,
	`created_by_job_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_analysis_analyzed_via_check" CHECK("__new_asset_analysis"."analyzed_via" in ('original', 'thumbnail', 'video_frames'))
);
--> statement-breakpoint
INSERT INTO `__new_asset_analysis`("id", "family_id", "asset_id", "description", "ocr_text", "provider", "model", "source_sha256", "analyzed_via", "created_by_job_id", "created_at", "updated_at") SELECT "id", "family_id", "asset_id", "description", "ocr_text", "provider", "model", "source_sha256", "analyzed_via", "created_by_job_id", "created_at", "updated_at" FROM `asset_analysis`;--> statement-breakpoint
DROP TABLE `asset_analysis`;--> statement-breakpoint
ALTER TABLE `__new_asset_analysis` RENAME TO `asset_analysis`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_analysis_asset_uidx` ON `asset_analysis` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_analysis_family_idx` ON `asset_analysis` (`family_id`);