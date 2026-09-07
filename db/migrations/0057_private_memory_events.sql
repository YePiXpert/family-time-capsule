-- 私密记忆（正式 1.0 §5）：记忆事件对象级读者模型。
-- 旧事件保持 family 可见；作者无法可靠恢复时 fail closed（不伪造作者）。
ALTER TABLE memory_event ADD COLUMN visibility text NOT NULL DEFAULT 'family' CHECK(visibility IN ('family','members','private'));
--> statement-breakpoint
ALTER TABLE memory_event ADD COLUMN created_by_user_id text;
--> statement-breakpoint
CREATE TABLE memory_event_reader (
  id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  memory_event_id text NOT NULL REFERENCES memory_event(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at integer NOT NULL DEFAULT (unixepoch()),
  UNIQUE(memory_event_id, user_id)
);
--> statement-breakpoint
CREATE INDEX memory_event_reader_event_idx ON memory_event_reader(memory_event_id);
--> statement-breakpoint
CREATE INDEX memory_event_reader_user_idx ON memory_event_reader(user_id);
--> statement-breakpoint
-- 原件可见性：family=家庭共享（默认，历史素材语义不变）；private=仅上传者
-- 与通过引用它的可读对象（私密记忆/讲述）可见。
ALTER TABLE asset ADD COLUMN visibility text NOT NULL DEFAULT 'family' CHECK(visibility IN ('family','private'));
--> statement-breakpoint
-- 去重只约束家庭共享原件；不同成员各自的私密原件允许同字节并存，
-- 重复上传无法探测他人私密原件的存在。
DROP INDEX IF EXISTS asset_family_sha_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX asset_family_sha_idx ON asset(family_id, sha256) WHERE original_asset_id is null AND visibility='family';
--> statement-breakpoint
CREATE INDEX asset_private_owner_sha_idx ON asset(family_id, created_by_user_id, sha256) WHERE original_asset_id is null AND visibility='private';
--> statement-breakpoint
-- 草稿的指定读者清单（members 可见性）；历史草稿为空数组。
ALTER TABLE draft ADD COLUMN reader_user_ids_json text NOT NULL DEFAULT '[]';
