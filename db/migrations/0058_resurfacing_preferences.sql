-- 回顾屏蔽（正式 1.0 §8 / FIND-9）：按用户记录的回顾偏好。
-- 只影响自动推荐（今天页面/回顾卡），不删除来源、不影响主动搜索与打开。
CREATE TABLE resurfacing_preference (
  id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- event=暂不推荐这件事 | person=屏蔽某人物 | date_range=屏蔽日期范围 | pause=暂停回顾
  kind text NOT NULL CHECK(kind IN ('event','person','date_range','pause')),
  -- event: 事件 id；person: 人物 id；date_range: "from..to"；pause: "pause"
  target_key text NOT NULL,
  date_from text,
  date_to text,
  created_at integer NOT NULL DEFAULT (unixepoch()),
  UNIQUE(family_id, user_id, kind, target_key)
);
--> statement-breakpoint
CREATE INDEX resurfacing_preference_user_idx ON resurfacing_preference(family_id, user_id);
