CREATE TABLE `ai_job_dependency` (
	`job_id` text NOT NULL,
	`depends_on_job_id` text NOT NULL,
	PRIMARY KEY(`job_id`, `depends_on_job_id`),
	FOREIGN KEY (`job_id`) REFERENCES `ai_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_job_id`) REFERENCES `ai_job`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_job_dependency_distinct" CHECK("ai_job_dependency"."job_id" <> "ai_job_dependency"."depends_on_job_id")
);
--> statement-breakpoint
CREATE INDEX `ai_job_dependency_parent_idx` ON `ai_job_dependency` (`depends_on_job_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_job_source` (
	`job_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `source_kind`, `source_id`),
	FOREIGN KEY (`job_id`) REFERENCES `ai_job`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_job_source_kind_check" CHECK("__new_ai_job_source"."source_kind" in ('asset', 'contribution', 'memory_event', 'inbox_item')),
	CONSTRAINT "ai_job_source_sha_check" CHECK(length("__new_ai_job_source"."source_sha256") = 64 and "__new_ai_job_source"."source_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_job_source_opaque_check" CHECK(length("__new_ai_job_source"."source_id") between 1 and 256 and "__new_ai_job_source"."source_id" not glob '*[^A-Za-z0-9_.:@-]*' and typeof("__new_ai_job_source"."created_at") = 'integer' and "__new_ai_job_source"."created_at" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_ai_job_source`("job_id", "source_kind", "source_id", "source_sha256", "created_at") SELECT "job_id", "source_kind", "source_id", "source_sha256", "created_at" FROM `ai_job_source`;--> statement-breakpoint
DROP TABLE `ai_job_source`;--> statement-breakpoint
ALTER TABLE `__new_ai_job_source` RENAME TO `ai_job_source`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_job_source_lookup_idx` ON `ai_job_source` (`source_kind`,`source_id`);--> statement-breakpoint
ALTER TABLE `ai_job` ADD `target_revision` integer;
--> statement-breakpoint
CREATE TRIGGER `ai_job_source_insert_guard`
BEFORE INSERT ON `ai_job_source`
WHEN NOT EXISTS (
    SELECT 1 FROM `ai_job` job
    WHERE job.`id` = NEW.`job_id`
      AND job.`status` = 'pending'
      AND job.`created_at` = NEW.`created_at`
      AND (
        (NEW.`source_kind` = 'asset' AND EXISTS (
          SELECT 1 FROM `asset` source
          WHERE source.`id` = NEW.`source_id`
            AND source.`family_id` = job.`family_id`
            AND source.`sha256` = NEW.`source_sha256`
        ))
        OR (NEW.`source_kind` = 'contribution' AND EXISTS (
          SELECT 1 FROM `contribution` source
          JOIN `memory_event` event ON event.`id` = source.`memory_event_id`
          WHERE source.`id` = NEW.`source_id`
            AND event.`family_id` = job.`family_id`
        ))
        OR (NEW.`source_kind` = 'inbox_item' AND EXISTS (
          SELECT 1 FROM `inbox_item` source
          WHERE source.`id` = NEW.`source_id` AND source.`family_id` = job.`family_id`
        ))
        OR (NEW.`source_kind` = 'memory_event' AND EXISTS (
          SELECT 1 FROM `memory_event` source
          WHERE source.`id` = NEW.`source_id`
            AND source.`family_id` = job.`family_id`
        ))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'AI job source must be a current same-family row');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_source_update_guard`
BEFORE UPDATE ON `ai_job_source`
BEGIN
  SELECT RAISE(ABORT, 'AI job source identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_source_delete_guard`
AFTER DELETE ON `ai_job_source`
WHEN EXISTS (SELECT 1 FROM `ai_job` job WHERE job.`id` = OLD.`job_id`)
BEGIN
  SELECT RAISE(ABORT, 'AI job sources cannot be removed independently');
END;
--> statement-breakpoint
CREATE TRIGGER ai_job_target_revision_insert_guard
BEFORE INSERT ON ai_job
WHEN NEW.target_revision IS NOT NULL AND (typeof(NEW.target_revision) <> 'integer' OR NEW.target_revision < 0)
BEGIN SELECT RAISE(ABORT, 'invalid AI target revision'); END;
--> statement-breakpoint
CREATE TRIGGER ai_job_target_revision_update_guard
BEFORE UPDATE ON ai_job WHEN NEW.target_revision IS NOT OLD.target_revision
BEGIN SELECT RAISE(ABORT, 'AI target revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_job_dependency_insert_guard
BEFORE INSERT ON ai_job_dependency
WHEN NOT EXISTS (
  SELECT 1 FROM ai_job child JOIN ai_job parent ON parent.id = NEW.depends_on_job_id
  WHERE child.id = NEW.job_id AND child.status = 'pending' AND child.attempts = 0
    AND child.family_id = parent.family_id
    AND child.requested_by_user_id = parent.requested_by_user_id
    AND child.configuration_id = parent.configuration_id
    AND child.provider_id = parent.provider_id
    AND child.provider_external = parent.provider_external
) OR EXISTS (
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.depends_on_job_id UNION
    SELECT d.depends_on_job_id FROM ai_job_dependency d JOIN ancestors a ON d.job_id = a.id
  ) SELECT 1 FROM ancestors WHERE id = NEW.job_id
)
BEGIN SELECT RAISE(ABORT, 'invalid AI dependency'); END;
--> statement-breakpoint
CREATE TRIGGER ai_job_dependency_update_guard
BEFORE UPDATE ON ai_job_dependency
BEGIN SELECT RAISE(ABORT, 'AI dependency is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_job_dependency_delete_guard
AFTER DELETE ON ai_job_dependency
WHEN EXISTS (SELECT 1 FROM ai_job WHERE id = OLD.job_id)
BEGIN SELECT RAISE(ABORT, 'AI dependencies cannot be removed independently'); END;
