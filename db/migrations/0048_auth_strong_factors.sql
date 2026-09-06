-- M2-b：认证强化（正式 1.0 身份模型 ID-6/ID-8）。
-- 1) user.two_factor_enabled：better-auth twoFactor 插件读取的开关列。
-- 2) two_factor 表：TOTP 密钥 + 恢复码（AEAD 加密存储）+ 防爆破计数。
-- 3) passkey 表：WebAuthn 通行密钥（credentialId 唯一，rpId 绑定注册源）。
-- 全部为新增可空/带默认值结构，旧行为零改动；升级与全新安装同构。

ALTER TABLE `user` ADD `two_factor_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL REFERENCES user(id) ON UPDATE no action ON DELETE cascade,
	`verified` integer DEFAULT 1 NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint

CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES user(id) ON UPDATE no action ON DELETE cascade,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`device_type` text,
	`backed_up` integer DEFAULT 0 NOT NULL,
	`rp_id` text NOT NULL,
	`label` text DEFAULT '通行密钥' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);--> statement-breakpoint

CREATE UNIQUE INDEX `passkey_credential_id_unique` ON `passkey` (`credential_id`);--> statement-breakpoint

CREATE INDEX `passkey_user_idx` ON `passkey` (`user_id`);
