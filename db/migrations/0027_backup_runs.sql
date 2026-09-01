CREATE TABLE `backup_run` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`remote_path` text NOT NULL,
	`bytes` integer,
	`sha256` text,
	`strategy` text,
	`error` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`triggered_by_user_id` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "backup_run_status_check" CHECK("backup_run"."status" in ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "backup_run_sha_check" CHECK("backup_run"."sha256" is null or length("backup_run"."sha256") = 64)
);
--> statement-breakpoint
CREATE INDEX `backup_run_family_idx` ON `backup_run` (`family_id`,`created_at`);