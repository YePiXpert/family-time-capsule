-- M2-d：访客限定阅读链接（ID-5）。
-- 与投递箱（只提交）相对：这里给「无账号访客」一个可撤销、可过期、
-- 范围仅限单一相册的只读入口。令牌 256-bit 只存 SHA-256；
-- 撤销/过期即时生效；浏览次数与最近访问留痕供管理员审计。

CREATE TABLE `guest_read_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL REFERENCES family(id) ON UPDATE no action ON DELETE cascade,
	`collection_id` text NOT NULL REFERENCES collection(id) ON UPDATE no action ON DELETE cascade,
	`token_hash` text NOT NULL,
	`title` text NOT NULL,
	`created_by_user_id` text REFERENCES user(id) ON UPDATE no action ON DELETE set null,
	`expires_at` integer,
	`revoked_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX `guest_read_grant_token_hash_unique` ON `guest_read_grant` (`token_hash`);--> statement-breakpoint

CREATE INDEX `guest_read_grant_family_idx` ON `guest_read_grant` (`family_id`, `created_at`);--> statement-breakpoint

CREATE INDEX `guest_read_grant_collection_idx` ON `guest_read_grant` (`collection_id`);
