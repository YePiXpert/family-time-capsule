PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fact_source` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`quote` text,
	`start_ms` integer,
	`end_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fact_source_type_check" CHECK("__new_fact_source"."source_type" in ('asset', 'asset_analysis', 'contribution', 'transcript', 'user_text'))
);
--> statement-breakpoint
INSERT INTO `__new_fact_source`("id", "family_id", "fact_id", "source_type", "source_id", "created_at") SELECT "id", "family_id", "fact_id", "source_type", "source_id", "created_at" FROM `fact_source`;--> statement-breakpoint
DROP TABLE `fact_source`;--> statement-breakpoint
ALTER TABLE `__new_fact_source` RENAME TO `fact_source`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fact_source_fact_idx` ON `fact_source` (`fact_id`);--> statement-breakpoint
CREATE INDEX `fact_source_family_idx` ON `fact_source` (`family_id`);