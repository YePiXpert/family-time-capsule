-- M2：owner 角色落地（正式 1.0 身份模型）。
-- 1) 角色守卫先放开 'owner'（否则下面的数据迁移会被 0015 的
--    user_role_*_guard ABORT）。
-- 2) 历史安装：最早的 admin 提升为 owner（每实例至多一个）。
--    语义：owner ⊇ admin，另持 family:transfer（所有权移交）。
-- 3) last-admin 守卫升级为 owner 感知：管理类角色 = owner ∪ admin。
--    owner 被禁用/移出家庭/删除同样受“家庭必须保留一个可用管理账号”约束；
--    owner→admin 的降级在触发器层面仍放行（属管理类），应用层只经
--    transferOwnership 原子交换，不会出现无主家庭。

DROP TRIGGER IF EXISTS `user_role_insert_guard`;--> statement-breakpoint

CREATE TRIGGER `user_role_insert_guard`
BEFORE INSERT ON `user`
WHEN NEW.`role` NOT IN ('owner', 'admin', 'editor', 'contributor', 'viewer')
BEGIN
  SELECT RAISE(ABORT, 'invalid family role');
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `user_role_update_guard`;--> statement-breakpoint

CREATE TRIGGER `user_role_update_guard`
BEFORE UPDATE OF `role` ON `user`
WHEN NEW.`role` NOT IN ('owner', 'admin', 'editor', 'contributor', 'viewer')
BEGIN
  SELECT RAISE(ABORT, 'invalid family role');
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `user_last_enabled_admin_update_guard`;--> statement-breakpoint

CREATE TRIGGER `user_last_enabled_admin_update_guard`
BEFORE UPDATE OF `family_id`, `role`, `disabled_at` ON `user`
WHEN OLD.`family_id` IS NOT NULL
  AND OLD.`role` IN ('owner','admin')
  AND OLD.`disabled_at` IS NULL
  AND (
    NEW.`family_id` IS NOT OLD.`family_id`
    OR NEW.`role` NOT IN ('owner','admin')
    OR NEW.`disabled_at` IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM `user` other
    WHERE other.`family_id` = OLD.`family_id`
      AND other.`role` IN ('owner','admin')
      AND other.`disabled_at` IS NULL
      AND other.`id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'family must retain an enabled admin');
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `user_last_enabled_admin_delete_guard`;--> statement-breakpoint

CREATE TRIGGER `user_last_enabled_admin_delete_guard`
BEFORE DELETE ON `user`
WHEN OLD.`family_id` IS NOT NULL
  AND OLD.`role` IN ('owner','admin')
  AND OLD.`disabled_at` IS NULL
  AND EXISTS (SELECT 1 FROM `family` WHERE `id` = OLD.`family_id`)
  AND NOT EXISTS (
    SELECT 1 FROM `user` other
    WHERE other.`family_id` = OLD.`family_id`
      AND other.`role` IN ('owner','admin')
      AND other.`disabled_at` IS NULL
      AND other.`id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'family must retain an enabled admin');
END;--> statement-breakpoint

--
-- 0016 的 AI 触发器按管理类角色(owner ∪ admin)复核;除角色集合外与原文逐字一致。
DROP TRIGGER IF EXISTS `ai_consent_actor_insert_guard`;--> statement-breakpoint

CREATE TRIGGER `ai_consent_actor_insert_guard`
BEFORE INSERT ON `ai_processing_consent`
WHEN (NEW.`enabled` = 1 AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`approved_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` IN ('owner','admin')
      AND u.`disabled_at` IS NULL
  ))
  OR (NEW.`revoked_by_user_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`revoked_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` IN ('owner','admin')
      AND u.`disabled_at` IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'AI consent actor must be an enabled family admin');
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `ai_consent_actor_update_guard`;--> statement-breakpoint

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
      AND u.`role` IN ('owner','admin')
      AND u.`disabled_at` IS NULL
  ))
  OR (NEW.`revoked_by_user_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `user` u
    WHERE u.`id` = NEW.`revoked_by_user_id`
      AND u.`family_id` = NEW.`family_id`
      AND u.`role` IN ('owner','admin')
      AND u.`disabled_at` IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid AI consent update');
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `ai_job_insert_guard`;--> statement-breakpoint

CREATE TRIGGER `ai_job_insert_guard`
BEFORE INSERT ON `ai_job`
WHEN NOT EXISTS (
    SELECT 1 FROM `user` requester
    WHERE requester.`id` = NEW.`requested_by_user_id`
      AND requester.`family_id` = NEW.`family_id`
      AND requester.`role` IN ('owner', 'admin', 'editor')
      AND requester.`disabled_at` IS NULL
  )
  OR (NEW.`cancel_requested_by_user_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `user` canceller
    WHERE canceller.`id` = NEW.`cancel_requested_by_user_id`
      AND canceller.`family_id` = NEW.`family_id`
      AND canceller.`role` IN ('owner', 'admin', 'editor')
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
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `ai_job_update_guard`;--> statement-breakpoint

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
        AND canceller.`role` IN ('owner', 'admin', 'editor')
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
END;--> statement-breakpoint

-- M2 数据收敛:所有触发器就位后,最早的 admin 提升为 owner。
UPDATE "user"
SET "role" = 'owner', "updated_at" = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE "id" = (
  SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" ASC, "id" ASC LIMIT 1
);
