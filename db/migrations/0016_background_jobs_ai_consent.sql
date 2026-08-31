CREATE TABLE `ai_job` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`job_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`required_capability` text NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`provider_external` integer NOT NULL,
	`consent_version` integer,
	`trigger_mode` text NOT NULL,
	`content_visibility` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`output_json` text,
	`idempotency_key` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`available_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`lease_generation` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`cancel_requested_at` integer,
	`cancel_requested_by_user_id` text,
	`requested_by_user_id` text NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cancel_requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_job_status_check" CHECK("ai_job"."status" in ('pending', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ai_job_capability_check" CHECK("ai_job"."required_capability" in ('text', 'vision', 'transcription', 'embeddings')),
	CONSTRAINT "ai_job_trigger_mode_check" CHECK("ai_job"."trigger_mode" in ('manual', 'automatic')),
	CONSTRAINT "ai_job_visibility_check" CHECK("ai_job"."content_visibility" in ('family', 'private', 'parents', 'child_later')),
	CONSTRAINT "ai_job_automatic_visibility_check" CHECK("ai_job"."trigger_mode" = 'manual' or "ai_job"."content_visibility" = 'family'),
	CONSTRAINT "ai_job_provider_lengths_check" CHECK(length("ai_job"."provider_id") between 1 and 100 and length("ai_job"."model") between 1 and 256),
	CONSTRAINT "ai_job_opaque_fields_check" CHECK(length("ai_job"."id") between 1 and 256 and "ai_job"."id" not glob '*[^A-Za-z0-9_.:@-]*' and length("ai_job"."job_type") between 1 and 100 and "ai_job"."job_type" glob '[a-z]*' and "ai_job"."job_type" not glob '*[^a-z0-9_.:-]*' and length("ai_job"."entity_type") between 1 and 100 and "ai_job"."entity_type" glob '[a-z]*' and "ai_job"."entity_type" not glob '*[^a-z0-9_.:-]*' and length("ai_job"."entity_id") between 1 and 256 and "ai_job"."entity_id" not glob '*[^A-Za-z0-9_.:@-]*'),
	CONSTRAINT "ai_job_external_consent_check" CHECK(("ai_job"."provider_external" = 1 and "ai_job"."consent_version" is not null and typeof("ai_job"."consent_version") = 'integer' and "ai_job"."consent_version" >= 1) or ("ai_job"."provider_external" = 0 and "ai_job"."consent_version" is null)),
	CONSTRAINT "ai_job_payload_check" CHECK("ai_job"."payload_json" = '{}'),
	CONSTRAINT "ai_job_output_check" CHECK("ai_job"."output_json" is null or "ai_job"."output_json" = '{}'),
	CONSTRAINT "ai_job_idempotency_check" CHECK(length("ai_job"."idempotency_key") = 64 and "ai_job"."idempotency_key" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_job_attempt_bounds_check" CHECK(typeof("ai_job"."attempts") = 'integer' and "ai_job"."attempts" >= 0 and typeof("ai_job"."max_attempts") = 'integer' and "ai_job"."max_attempts" between 1 and 20 and "ai_job"."attempts" <= "ai_job"."max_attempts"),
	CONSTRAINT "ai_job_priority_check" CHECK(typeof("ai_job"."priority") = 'integer' and "ai_job"."priority" between 0 and 100),
	CONSTRAINT "ai_job_lease_generation_check" CHECK(typeof("ai_job"."lease_generation") = 'integer' and "ai_job"."lease_generation" >= 0),
	CONSTRAINT "ai_job_lease_shape_check" CHECK(("ai_job"."status" = 'running' and "ai_job"."lease_owner" is not null and "ai_job"."lease_expires_at" is not null) or ("ai_job"."status" <> 'running' and "ai_job"."lease_owner" is null and "ai_job"."lease_expires_at" is null)),
	CONSTRAINT "ai_job_finished_shape_check" CHECK(("ai_job"."status" in ('completed', 'failed', 'cancelled') and "ai_job"."finished_at" is not null) or ("ai_job"."status" in ('pending', 'running') and "ai_job"."finished_at" is null)),
	CONSTRAINT "ai_job_cancel_pair_check" CHECK(("ai_job"."cancel_requested_at" is null and "ai_job"."cancel_requested_by_user_id" is null) or ("ai_job"."cancel_requested_at" is not null and "ai_job"."cancel_requested_by_user_id" is not null)),
	CONSTRAINT "ai_job_error_code_check" CHECK("ai_job"."last_error_code" is null or (length("ai_job"."last_error_code") between 1 and 64 and "ai_job"."last_error_code" not glob '*[^a-z0-9_:-]*')),
	CONSTRAINT "ai_job_timestamp_check" CHECK(typeof("ai_job"."available_at") = 'integer' and "ai_job"."available_at" >= 0 and typeof("ai_job"."created_at") = 'integer' and "ai_job"."created_at" >= 0 and typeof("ai_job"."updated_at") = 'integer' and "ai_job"."updated_at" >= "ai_job"."created_at" and ("ai_job"."started_at" is null or (typeof("ai_job"."started_at") = 'integer' and "ai_job"."started_at" >= "ai_job"."created_at")) and ("ai_job"."finished_at" is null or (typeof("ai_job"."finished_at") = 'integer' and "ai_job"."finished_at" >= "ai_job"."created_at")) and ("ai_job"."lease_expires_at" is null or (typeof("ai_job"."lease_expires_at") = 'integer' and "ai_job"."lease_expires_at" >= 0)) and ("ai_job"."cancel_requested_at" is null or (typeof("ai_job"."cancel_requested_at") = 'integer' and "ai_job"."cancel_requested_at" >= "ai_job"."created_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_job_family_idempotency_uidx` ON `ai_job` (`family_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_job_claim_idx` ON `ai_job` (`status`,`available_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_job_lease_idx` ON `ai_job` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `ai_job_family_entity_idx` ON `ai_job` (`family_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_job_requester_status_idx` ON `ai_job` (`requested_by_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `ai_job_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`lease_generation` integer NOT NULL,
	`worker_id` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `ai_job`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_job_attempt_status_check" CHECK("ai_job_attempt"."status" in ('running', 'completed', 'retry_scheduled', 'failed', 'cancelled', 'lease_expired')),
	CONSTRAINT "ai_job_attempt_numbers_check" CHECK(typeof("ai_job_attempt"."attempt_number") = 'integer' and "ai_job_attempt"."attempt_number" >= 1 and typeof("ai_job_attempt"."lease_generation") = 'integer' and "ai_job_attempt"."lease_generation" >= 1),
	CONSTRAINT "ai_job_attempt_finished_check" CHECK(("ai_job_attempt"."status" = 'running' and "ai_job_attempt"."finished_at" is null) or ("ai_job_attempt"."status" <> 'running' and "ai_job_attempt"."finished_at" is not null)),
	CONSTRAINT "ai_job_attempt_error_code_check" CHECK("ai_job_attempt"."error_code" is null or (length("ai_job_attempt"."error_code") between 1 and 64 and "ai_job_attempt"."error_code" not glob '*[^a-z0-9_:-]*')),
	CONSTRAINT "ai_job_attempt_opaque_timestamp_check" CHECK(length("ai_job_attempt"."id") between 1 and 256 and "ai_job_attempt"."id" not glob '*[^A-Za-z0-9_.:@-]*' and length("ai_job_attempt"."worker_id") between 1 and 256 and "ai_job_attempt"."worker_id" not glob '*[^A-Za-z0-9_.:@-]*' and typeof("ai_job_attempt"."started_at") = 'integer' and "ai_job_attempt"."started_at" >= 0 and ("ai_job_attempt"."finished_at" is null or (typeof("ai_job_attempt"."finished_at") = 'integer' and "ai_job_attempt"."finished_at" >= "ai_job_attempt"."started_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_job_attempt_number_uidx` ON `ai_job_attempt` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `ai_job_attempt_job_started_idx` ON `ai_job_attempt` (`job_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `ai_job_source` (
	`job_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `source_kind`, `source_id`),
	FOREIGN KEY (`job_id`) REFERENCES `ai_job`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_job_source_kind_check" CHECK("ai_job_source"."source_kind" in ('asset', 'contribution', 'memory_event')),
	CONSTRAINT "ai_job_source_sha_check" CHECK(length("ai_job_source"."source_sha256") = 64 and "ai_job_source"."source_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_job_source_opaque_check" CHECK(length("ai_job_source"."source_id") between 1 and 256 and "ai_job_source"."source_id" not glob '*[^A-Za-z0-9_.:@-]*' and typeof("ai_job_source"."created_at") = 'integer' and "ai_job_source"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_job_source_lookup_idx` ON `ai_job_source` (`source_kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `ai_processing_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`capability` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`allow_automatic_family_content` integer DEFAULT false NOT NULL,
	`provider_id` text,
	`provider_name` text,
	`model` text,
	`disclosure_version` integer NOT NULL,
	`consent_version` integer NOT NULL,
	`approved_by_user_id` text,
	`approved_at` integer,
	`revoked_by_user_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_consent_capability_check" CHECK("ai_processing_consent"."capability" in ('text', 'vision', 'transcription', 'embeddings')),
	CONSTRAINT "ai_consent_versions_check" CHECK(typeof("ai_processing_consent"."disclosure_version") = 'integer' and "ai_processing_consent"."disclosure_version" >= 1 and typeof("ai_processing_consent"."consent_version") = 'integer' and "ai_processing_consent"."consent_version" >= 1),
	CONSTRAINT "ai_consent_provider_lengths_check" CHECK(("ai_processing_consent"."provider_id" is null or (length("ai_processing_consent"."provider_id") between 1 and 100)) and ("ai_processing_consent"."provider_name" is null or (length("ai_processing_consent"."provider_name") between 1 and 100)) and ("ai_processing_consent"."model" is null or (length("ai_processing_consent"."model") between 1 and 256))),
	CONSTRAINT "ai_consent_enabled_shape_check" CHECK(("ai_processing_consent"."enabled" = 1 and "ai_processing_consent"."provider_id" is not null and "ai_processing_consent"."provider_name" is not null and "ai_processing_consent"."model" is not null and "ai_processing_consent"."approved_by_user_id" is not null and "ai_processing_consent"."approved_at" is not null and "ai_processing_consent"."revoked_at" is null and "ai_processing_consent"."revoked_by_user_id" is null) or ("ai_processing_consent"."enabled" = 0 and "ai_processing_consent"."allow_automatic_family_content" = 0)),
	CONSTRAINT "ai_consent_revoke_pair_check" CHECK(("ai_processing_consent"."revoked_at" is null and "ai_processing_consent"."revoked_by_user_id" is null) or ("ai_processing_consent"."revoked_at" is not null and "ai_processing_consent"."revoked_by_user_id" is not null)),
	CONSTRAINT "ai_consent_timestamp_check" CHECK(typeof("ai_processing_consent"."created_at") = 'integer' and "ai_processing_consent"."created_at" >= 0 and typeof("ai_processing_consent"."updated_at") = 'integer' and "ai_processing_consent"."updated_at" >= "ai_processing_consent"."created_at" and ("ai_processing_consent"."approved_at" is null or (typeof("ai_processing_consent"."approved_at") = 'integer' and "ai_processing_consent"."approved_at" >= 0)) and ("ai_processing_consent"."revoked_at" is null or (typeof("ai_processing_consent"."revoked_at") = 'integer' and "ai_processing_consent"."revoked_at" >= 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_consent_family_capability_uidx` ON `ai_processing_consent` (`family_id`,`capability`);--> statement-breakpoint
CREATE INDEX `ai_consent_family_enabled_idx` ON `ai_processing_consent` (`family_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `ai_worker_heartbeat` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`worker_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT "ai_worker_status_check" CHECK("ai_worker_heartbeat"."status" in ('idle', 'working', 'stopping')),
	CONSTRAINT "ai_worker_version_length_check" CHECK(length("ai_worker_heartbeat"."worker_version") between 1 and 64),
	CONSTRAINT "ai_worker_opaque_timestamp_check" CHECK(length("ai_worker_heartbeat"."worker_id") between 1 and 256 and "ai_worker_heartbeat"."worker_id" not glob '*[^A-Za-z0-9_.:@-]*' and typeof("ai_worker_heartbeat"."started_at") = 'integer' and "ai_worker_heartbeat"."started_at" >= 0 and typeof("ai_worker_heartbeat"."last_seen_at") = 'integer' and "ai_worker_heartbeat"."last_seen_at" >= "ai_worker_heartbeat"."started_at")
);
--> statement-breakpoint
CREATE INDEX `ai_worker_last_seen_idx` ON `ai_worker_heartbeat` (`last_seen_at`);
--> statement-breakpoint
CREATE TRIGGER `ai_consent_actor_insert_guard`
BEFORE INSERT ON `ai_processing_consent`
WHEN (NEW.`enabled` = 1 AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`approved_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` = 'admin'
      AND u.`disabled_at` IS NULL
  ))
  OR (NEW.`revoked_by_user_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`revoked_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` = 'admin'
      AND u.`disabled_at` IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'AI consent actor must be an enabled family admin');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_consent_actor_update_guard`
BEFORE UPDATE ON `ai_processing_consent`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`family_id` IS NOT OLD.`family_id`
  OR NEW.`capability` IS NOT OLD.`capability`
  OR NEW.`consent_version` <> OLD.`consent_version` + 1
  OR (NEW.`enabled` = 1 AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`approved_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` = 'admin'
      AND u.`disabled_at` IS NULL
  ))
  OR (NEW.`revoked_by_user_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`revoked_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` = 'admin'
      AND u.`disabled_at` IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid AI consent update');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_insert_guard`
BEFORE INSERT ON `ai_job`
WHEN NOT EXISTS (
    SELECT 1 FROM `user` requester
    WHERE requester.`id` = NEW.`requested_by_user_id`
      AND requester.`family_id` = NEW.`family_id`
      AND requester.`role` IN ('admin', 'editor')
      AND requester.`disabled_at` IS NULL
  )
  OR (NEW.`cancel_requested_by_user_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `user` canceller
    WHERE canceller.`id` = NEW.`cancel_requested_by_user_id`
      AND canceller.`family_id` = NEW.`family_id`
      AND canceller.`role` IN ('admin', 'editor')
      AND canceller.`disabled_at` IS NULL
  ))
  OR (NEW.`provider_external` = 1 AND NOT EXISTS (
    SELECT 1 FROM `ai_processing_consent` consent
    WHERE consent.`family_id` = NEW.`family_id`
      AND consent.`capability` = NEW.`required_capability`
      AND consent.`enabled` = 1
      AND consent.`provider_id` = NEW.`provider_id`
      AND consent.`model` = NEW.`model`
      AND consent.`consent_version` = NEW.`consent_version`
      AND (NEW.`trigger_mode` = 'manual' OR consent.`allow_automatic_family_content` = 1)
  ))
BEGIN
  SELECT RAISE(ABORT, 'AI job requires live family authorization and consent');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_update_guard`
BEFORE UPDATE ON `ai_job`
WHEN OLD.`status` IN ('completed', 'failed', 'cancelled')
  OR NEW.`id` IS NOT OLD.`id`
  OR NEW.`family_id` IS NOT OLD.`family_id`
  OR NEW.`job_type` IS NOT OLD.`job_type`
  OR NEW.`entity_type` IS NOT OLD.`entity_type`
  OR NEW.`entity_id` IS NOT OLD.`entity_id`
  OR NEW.`required_capability` IS NOT OLD.`required_capability`
  OR NEW.`provider_id` IS NOT OLD.`provider_id`
  OR NEW.`model` IS NOT OLD.`model`
  OR NEW.`provider_external` IS NOT OLD.`provider_external`
  OR NEW.`consent_version` IS NOT OLD.`consent_version`
  OR NEW.`trigger_mode` IS NOT OLD.`trigger_mode`
  OR NEW.`content_visibility` IS NOT OLD.`content_visibility`
  OR NEW.`payload_json` IS NOT OLD.`payload_json`
  OR NEW.`idempotency_key` IS NOT OLD.`idempotency_key`
  OR NEW.`requested_by_user_id` IS NOT OLD.`requested_by_user_id`
  OR NEW.`priority` <> OLD.`priority`
  OR NEW.`max_attempts` <> OLD.`max_attempts`
  OR (OLD.`cancel_requested_at` IS NOT NULL AND (
    NEW.`cancel_requested_at` IS NOT OLD.`cancel_requested_at`
    OR NEW.`cancel_requested_by_user_id` IS NOT OLD.`cancel_requested_by_user_id`
  ))
  OR (OLD.`cancel_requested_at` IS NULL
    AND NEW.`cancel_requested_by_user_id` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `user` canceller
      WHERE canceller.`id` = NEW.`cancel_requested_by_user_id`
        AND canceller.`family_id` = NEW.`family_id`
        AND canceller.`role` IN ('admin', 'editor')
        AND canceller.`disabled_at` IS NULL
    ))
  OR (OLD.`status` = 'pending' AND NEW.`status` NOT IN ('pending', 'running', 'cancelled'))
  OR (OLD.`status` = 'running' AND NEW.`status` NOT IN ('running', 'pending', 'completed', 'failed', 'cancelled'))
  OR (OLD.`status` = 'pending' AND NEW.`status` = 'running' AND (
    NEW.`attempts` <> OLD.`attempts` + 1
    OR NEW.`lease_generation` <> OLD.`lease_generation` + 1
    OR NEW.`lease_owner` IS NULL
    OR NEW.`lease_expires_at` IS NULL
  ))
  OR (NOT (OLD.`status` = 'pending' AND NEW.`status` = 'running') AND (
    NEW.`attempts` <> OLD.`attempts`
    OR NEW.`lease_generation` <> OLD.`lease_generation`
  ))
  OR (OLD.`status` = 'running' AND NEW.`status` = 'running' AND (
    NEW.`lease_owner` IS NOT OLD.`lease_owner`
    OR NEW.`lease_generation` <> OLD.`lease_generation`
  ))
  OR (NEW.`status` <> 'running' AND (
    NEW.`lease_owner` IS NOT NULL OR NEW.`lease_expires_at` IS NOT NULL
  ))
  OR (NEW.`output_json` IS NOT OLD.`output_json`
    AND NOT (OLD.`status` = 'running' AND NEW.`status` = 'completed'
      AND NEW.`output_json` = '{}'))
BEGIN
  SELECT RAISE(ABORT, 'invalid AI job state transition');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_delete_guard`
BEFORE DELETE ON `ai_job`
WHEN OLD.`status` IN ('pending', 'running')
BEGIN
  SELECT RAISE(ABORT, 'active AI jobs cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_attempt_insert_guard`
BEFORE INSERT ON `ai_job_attempt`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_job` job
  WHERE job.`id` = NEW.`job_id`
    AND job.`status` = 'running'
    AND job.`attempts` = NEW.`attempt_number`
    AND job.`lease_generation` = NEW.`lease_generation`
    AND job.`lease_owner` = NEW.`worker_id`
    AND job.`provider_id` = NEW.`provider_id`
    AND job.`model` = NEW.`model`
)
BEGIN
  SELECT RAISE(ABORT, 'AI attempt must match the current fenced lease');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_job_attempt_update_guard`
BEFORE UPDATE ON `ai_job_attempt`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`job_id` IS NOT OLD.`job_id`
  OR NEW.`attempt_number` <> OLD.`attempt_number`
  OR NEW.`lease_generation` <> OLD.`lease_generation`
  OR NEW.`worker_id` IS NOT OLD.`worker_id`
  OR NEW.`provider_id` IS NOT OLD.`provider_id`
  OR NEW.`model` IS NOT OLD.`model`
  OR OLD.`status` <> 'running'
  OR NEW.`status` NOT IN ('completed', 'retry_scheduled', 'failed', 'cancelled', 'lease_expired')
BEGIN
  SELECT RAISE(ABORT, 'invalid AI attempt update');
END;
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
CREATE TRIGGER `ai_worker_heartbeat_update_guard`
BEFORE UPDATE ON `ai_worker_heartbeat`
WHEN NEW.`worker_id` IS NOT OLD.`worker_id`
  OR NEW.`worker_version` IS NOT OLD.`worker_version`
  OR NEW.`started_at` IS NOT OLD.`started_at`
  OR NEW.`last_seen_at` < OLD.`last_seen_at`
BEGIN
  SELECT RAISE(ABORT, 'invalid AI worker heartbeat update');
END;
