CREATE TABLE `document_text` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`text` text NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_text_asset_uidx` ON `document_text` (`asset_id`);--> statement-breakpoint
CREATE INDEX `document_text_family_idx` ON `document_text` (`family_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `import_session_default_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`import_session_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_session_id`) REFERENCES `import_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_default_participant_uidx` ON `import_session_default_participant` (`import_session_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `import_default_participant_family_idx` ON `import_session_default_participant` (`family_id`,`import_session_id`);--> statement-breakpoint
ALTER TABLE `upload_session` ADD `client_fingerprint` text;