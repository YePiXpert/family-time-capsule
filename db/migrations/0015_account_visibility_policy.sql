CREATE TABLE `_0015_policy_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));--> statement-breakpoint
INSERT INTO `_0015_policy_guard` (`ok`)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM `user` WHERE `role` NOT IN ('admin', 'editor', 'contributor', 'viewer'))
  OR EXISTS (SELECT 1 FROM `person` WHERE `is_child` NOT IN (0, 1))
  OR EXISTS (SELECT 1 FROM `contribution` WHERE `visibility` NOT IN ('private', 'parents', 'family', 'child_later'))
  OR EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`person_id` IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM `person` p
        WHERE p.`id` = u.`person_id` AND p.`family_id` = u.`family_id`
      )
  )
  OR EXISTS (
    SELECT 1 FROM `contribution` c
    JOIN `memory_event` e ON e.`id` = c.`memory_event_id`
    WHERE NOT EXISTS (
      SELECT 1 FROM `person` p
      WHERE p.`id` = c.`author_person_id` AND p.`family_id` = e.`family_id`
    )
  )
  OR EXISTS (
    SELECT 1 FROM `user` member
    WHERE member.`family_id` IS NOT NULL
    GROUP BY member.`family_id`
    HAVING SUM(CASE WHEN member.`role` = 'admin' THEN 1 ELSE 0 END) = 0
  )
THEN 0 ELSE 1 END;--> statement-breakpoint
DROP TABLE `_0015_policy_guard`;--> statement-breakpoint
ALTER TABLE `user` ADD `disabled_at` integer
  CONSTRAINT `user_disabled_at_check`
  CHECK (`disabled_at` IS NULL OR (typeof(`disabled_at`) = 'integer' AND `disabled_at` >= 0));--> statement-breakpoint
ALTER TABLE `user` ADD `disabled_by_user_id` text REFERENCES user(id) ON DELETE SET NULL
  CONSTRAINT `user_disabled_pair_check`
  CHECK (`disabled_by_user_id` IS NULL OR `disabled_at` IS NOT NULL);--> statement-breakpoint
ALTER TABLE `family` ADD `child_later_unlock_age` integer DEFAULT 18 NOT NULL
  CONSTRAINT `family_child_later_unlock_age_check`
  CHECK (typeof(`child_later_unlock_age`) = 'integer' AND `child_later_unlock_age` BETWEEN 1 AND 100);--> statement-breakpoint
ALTER TABLE `person` ADD `is_guardian` integer DEFAULT false NOT NULL
  CONSTRAINT `person_guardian_check`
  CHECK (`is_child` IN (0, 1) AND `is_guardian` IN (0, 1) AND (`is_guardian` = 0 OR `is_child` = 0));--> statement-breakpoint
ALTER TABLE `person` ADD `child_later_unlocked_at` integer
  CONSTRAINT `person_child_later_unlock_check`
  CHECK (`child_later_unlocked_at` IS NULL OR (
    typeof(`child_later_unlocked_at`) = 'integer'
    AND `child_later_unlocked_at` >= 0
    AND `is_child` = 1
  ));--> statement-breakpoint
ALTER TABLE `contribution` ADD `recorded_by_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `contribution` ADD `recorded_by_person_id` text REFERENCES person(id);--> statement-breakpoint
ALTER TABLE `contribution` ADD `recorded_by_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `contribution` ADD `recording_mode` text DEFAULT 'legacy' NOT NULL
  CONSTRAINT `contribution_recording_provenance_check`
  CHECK (
    (`recording_mode` = 'legacy'
      AND `recorded_by_user_id` IS NULL
      AND `recorded_by_person_id` IS NULL
      AND `recorded_by_name_snapshot` IS NULL)
    OR
    (`recording_mode` = 'self'
      AND `recorded_by_person_id` IS NOT NULL
      AND `recorded_by_person_id` = `author_person_id`
      AND `recorded_by_name_snapshot` IS NOT NULL
      AND length(trim(`recorded_by_name_snapshot`)) BETWEEN 1 AND 50)
    OR
    (`recording_mode` = 'on_behalf'
      AND (`recorded_by_person_id` IS NULL OR `recorded_by_person_id` <> `author_person_id`)
      AND `recorded_by_name_snapshot` IS NOT NULL
      AND length(trim(`recorded_by_name_snapshot`)) BETWEEN 1 AND 50)
  );--> statement-breakpoint
CREATE INDEX `user_family_role_disabled_idx` ON `user` (`family_id`,`role`,`disabled_at`);--> statement-breakpoint
CREATE INDEX `contribution_event_visibility_author_idx` ON `contribution` (`memory_event_id`,`visibility`,`author_person_id`);--> statement-breakpoint
CREATE INDEX `contribution_audio_asset_idx` ON `contribution` (`audio_asset_id`);--> statement-breakpoint
CREATE INDEX `contribution_recorded_by_user_idx` ON `contribution` (`recorded_by_user_id`);--> statement-breakpoint
CREATE INDEX `contribution_recorded_by_person_idx` ON `contribution` (`recorded_by_person_id`);--> statement-breakpoint
CREATE TRIGGER `user_role_insert_guard`
BEFORE INSERT ON `user`
WHEN NEW.`role` NOT IN ('admin', 'editor', 'contributor', 'viewer')
BEGIN
  SELECT RAISE(ABORT, 'invalid family role');
END;--> statement-breakpoint
CREATE TRIGGER `user_role_update_guard`
BEFORE UPDATE OF `role` ON `user`
WHEN NEW.`role` NOT IN ('admin', 'editor', 'contributor', 'viewer')
BEGIN
  SELECT RAISE(ABORT, 'invalid family role');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_visibility_insert_guard`
BEFORE INSERT ON `contribution`
WHEN NEW.`visibility` NOT IN ('private', 'parents', 'family', 'child_later')
BEGIN
  SELECT RAISE(ABORT, 'invalid contribution visibility');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_visibility_update_guard`
BEFORE UPDATE OF `visibility` ON `contribution`
WHEN NEW.`visibility` NOT IN ('private', 'parents', 'family', 'child_later')
BEGIN
  SELECT RAISE(ABORT, 'invalid contribution visibility');
END;--> statement-breakpoint
CREATE TRIGGER `user_person_family_insert_guard`
BEFORE INSERT ON `user`
WHEN NEW.`person_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `person` p
  WHERE p.`id` = NEW.`person_id` AND p.`family_id` = NEW.`family_id`
)
BEGIN
  SELECT RAISE(ABORT, 'user Person binding must stay inside family');
END;--> statement-breakpoint
CREATE TRIGGER `user_person_family_update_guard`
BEFORE UPDATE OF `family_id`, `person_id` ON `user`
WHEN NEW.`person_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `person` p
  WHERE p.`id` = NEW.`person_id` AND p.`family_id` = NEW.`family_id`
)
BEGIN
  SELECT RAISE(ABORT, 'user Person binding must stay inside family');
END;--> statement-breakpoint
CREATE TRIGGER `person_family_immutable_guard`
BEFORE UPDATE OF `family_id` ON `person`
WHEN NEW.`family_id` IS NOT OLD.`family_id`
BEGIN
  SELECT RAISE(ABORT, 'Person family is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `user_disabled_pair_update_guard`
BEFORE UPDATE OF `disabled_at`, `disabled_by_user_id` ON `user`
WHEN NEW.`disabled_by_user_id` IS NOT NULL AND NEW.`disabled_at` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'disabled actor requires disabled timestamp');
END;--> statement-breakpoint
CREATE TRIGGER `user_last_enabled_admin_update_guard`
BEFORE UPDATE OF `family_id`, `role`, `disabled_at` ON `user`
WHEN OLD.`family_id` IS NOT NULL
  AND OLD.`role` = 'admin'
  AND OLD.`disabled_at` IS NULL
  AND (
    NEW.`family_id` IS NOT OLD.`family_id`
    OR NEW.`role` <> 'admin'
    OR NEW.`disabled_at` IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM `user` other
    WHERE other.`family_id` = OLD.`family_id`
      AND other.`role` = 'admin'
      AND other.`disabled_at` IS NULL
      AND other.`id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'family must retain an enabled admin');
END;--> statement-breakpoint
CREATE TRIGGER `user_last_enabled_admin_delete_guard`
BEFORE DELETE ON `user`
WHEN OLD.`family_id` IS NOT NULL
  AND OLD.`role` = 'admin'
  AND OLD.`disabled_at` IS NULL
  AND EXISTS (SELECT 1 FROM `family` WHERE `id` = OLD.`family_id`)
  AND NOT EXISTS (
    SELECT 1 FROM `user` other
    WHERE other.`family_id` = OLD.`family_id`
      AND other.`role` = 'admin'
      AND other.`disabled_at` IS NULL
      AND other.`id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'family must retain an enabled admin');
END;--> statement-breakpoint
CREATE TRIGGER `session_enabled_user_insert_guard`
BEFORE INSERT ON `session`
WHEN NOT EXISTS (
  SELECT 1 FROM `user` u
  WHERE u.`id` = NEW.`user_id` AND u.`disabled_at` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'session requires enabled user');
END;--> statement-breakpoint
CREATE TRIGGER `session_enabled_user_update_guard`
BEFORE UPDATE ON `session`
WHEN NOT EXISTS (
  SELECT 1 FROM `user` u
  WHERE u.`id` = NEW.`user_id` AND u.`disabled_at` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'session requires enabled user');
END;--> statement-breakpoint
CREATE TRIGGER `user_disable_revoke_sessions`
AFTER UPDATE OF `disabled_at` ON `user`
WHEN NEW.`disabled_at` IS NOT NULL
BEGIN
  DELETE FROM `session` WHERE `user_id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `person_child_policy_insert_guard`
BEFORE INSERT ON `person`
WHEN NEW.`is_child` NOT IN (0, 1)
  OR NEW.`is_guardian` NOT IN (0, 1)
  OR (NEW.`is_guardian` = 1 AND NEW.`is_child` = 1)
  OR (NEW.`child_later_unlocked_at` IS NOT NULL AND (
    typeof(NEW.`child_later_unlocked_at`) <> 'integer'
    OR NEW.`child_later_unlocked_at` < 0
    OR NEW.`is_child` <> 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid Person guardian or child unlock policy');
END;--> statement-breakpoint
CREATE TRIGGER `person_child_policy_update_guard`
BEFORE UPDATE OF `is_child`, `is_guardian`, `child_later_unlocked_at` ON `person`
WHEN NEW.`is_child` NOT IN (0, 1)
  OR NEW.`is_guardian` NOT IN (0, 1)
  OR (NEW.`is_guardian` = 1 AND NEW.`is_child` = 1)
  OR (NEW.`child_later_unlocked_at` IS NOT NULL AND (
    typeof(NEW.`child_later_unlocked_at`) <> 'integer'
    OR NEW.`child_later_unlocked_at` < 0
    OR NEW.`is_child` <> 1
  ))
  OR (
    OLD.`child_later_unlocked_at` IS NOT NULL
    AND NEW.`child_later_unlocked_at` IS NOT OLD.`child_later_unlocked_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid Person guardian or child unlock policy');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_family_provenance_insert_guard`
BEFORE INSERT ON `contribution`
WHEN NOT EXISTS (
    SELECT 1 FROM `memory_event` e
    JOIN `person` author ON author.`id` = NEW.`author_person_id`
    WHERE e.`id` = NEW.`memory_event_id`
      AND author.`family_id` = e.`family_id`
  )
  OR (
    NEW.`recorded_by_person_id` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `memory_event` e
      JOIN `person` recorder ON recorder.`id` = NEW.`recorded_by_person_id`
      WHERE e.`id` = NEW.`memory_event_id`
        AND recorder.`family_id` = e.`family_id`
    )
  )
  OR (
    NEW.`recorded_by_user_id` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `memory_event` e
      JOIN `user` recorder ON recorder.`id` = NEW.`recorded_by_user_id`
      WHERE e.`id` = NEW.`memory_event_id`
        AND recorder.`family_id` = e.`family_id`
        AND recorder.`person_id` IS NEW.`recorded_by_person_id`
        AND recorder.`name` = NEW.`recorded_by_name_snapshot`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Contribution provenance must stay inside family');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_family_provenance_update_guard`
BEFORE UPDATE OF `memory_event_id`, `author_person_id`, `recorded_by_user_id`, `recorded_by_person_id`, `recorded_by_name_snapshot`, `recording_mode` ON `contribution`
WHEN NOT EXISTS (
    SELECT 1 FROM `memory_event` e
    JOIN `person` author ON author.`id` = NEW.`author_person_id`
    WHERE e.`id` = NEW.`memory_event_id`
      AND author.`family_id` = e.`family_id`
  )
  OR (
    NEW.`recorded_by_person_id` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `memory_event` e
      JOIN `person` recorder ON recorder.`id` = NEW.`recorded_by_person_id`
      WHERE e.`id` = NEW.`memory_event_id`
        AND recorder.`family_id` = e.`family_id`
    )
  )
  OR (
    NEW.`recorded_by_user_id` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `memory_event` e
      JOIN `user` recorder ON recorder.`id` = NEW.`recorded_by_user_id`
      WHERE e.`id` = NEW.`memory_event_id`
        AND recorder.`family_id` = e.`family_id`
        AND recorder.`person_id` IS NEW.`recorded_by_person_id`
        AND recorder.`name` = NEW.`recorded_by_name_snapshot`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Contribution provenance must stay inside family');
END;
