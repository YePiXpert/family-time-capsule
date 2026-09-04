CREATE TABLE `import_session` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'collecting' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`default_title` text,
	`default_occurred_at` integer,
	`default_location_text` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_session_source_check" CHECK("import_session"."source" in ('web', 'native', 'share', 'guest')),
	CONSTRAINT "import_session_status_check" CHECK("import_session"."status" in ('collecting', 'uploading', 'reviewing', 'completed', 'cancelled')),
	CONSTRAINT "import_session_counts_check" CHECK("import_session"."total_count" >= 0 and "import_session"."completed_count" >= 0 and "import_session"."failed_count" >= 0 and "import_session"."completed_count" + "import_session"."failed_count" <= "import_session"."total_count")
);
--> statement-breakpoint
CREATE INDEX `import_session_family_status_idx` ON `import_session` (`family_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `import_session_item` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`import_session_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`upload_session_id` text,
	`asset_id` text,
	`inbox_item_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_code` text,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_session_id`) REFERENCES `import_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`upload_session_id`) REFERENCES `upload_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_session_item_status_check" CHECK("import_session_item"."status" in ('pending', 'uploading', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "import_session_item_order_check" CHECK("import_session_item"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_session_item_capture_uidx` ON `import_session_item` (`import_session_id`,`capture_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_session_item_upload_uidx` ON `import_session_item` (`upload_session_id`);--> statement-breakpoint
CREATE INDEX `import_session_item_family_idx` ON `import_session_item` (`family_id`,`import_session_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `import_session_item_status_idx` ON `import_session_item` (`import_session_id`,`status`);--> statement-breakpoint
CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text,
	`capture_id` text NOT NULL,
	`filename` text NOT NULL,
	`declared_mime` text NOT NULL,
	`total_bytes` integer NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`last_modified` integer,
	`source` text NOT NULL,
	`import_session_id` text,
	`temp_storage_key` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`error_code` text,
	`expires_at` integer NOT NULL,
	`final_asset_id` text,
	`final_inbox_item_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_session_id`) REFERENCES `import_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`final_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`final_inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "upload_session_source_check" CHECK("upload_session"."source" in ('web', 'native', 'share', 'guest')),
	CONSTRAINT "upload_session_status_check" CHECK("upload_session"."status" in ('created', 'uploading', 'completed', 'cancelled', 'failed', 'expired')),
	CONSTRAINT "upload_session_bytes_check" CHECK("upload_session"."total_bytes" > 0 and "upload_session"."received_bytes" >= 0 and "upload_session"."received_bytes" <= "upload_session"."total_bytes")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_session_family_capture_uidx` ON `upload_session` (`family_id`,`capture_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `upload_session_temp_key_uidx` ON `upload_session` (`temp_storage_key`);--> statement-breakpoint
CREATE INDEX `upload_session_family_status_idx` ON `upload_session` (`family_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `upload_session_expiry_idx` ON `upload_session` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `upload_session_import_idx` ON `upload_session` (`family_id`,`import_session_id`);