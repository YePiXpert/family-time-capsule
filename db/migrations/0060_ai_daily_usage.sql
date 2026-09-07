-- AI 每日限额用量（正式 1.0 §9 / AI-21）：部署级、按 UTC 日的原子计数。
-- requests=发出的提供方请求数；images=送分析的图片数；audio_seconds=
-- 送转写的音频时长（调用方未知则不计，显示层如实呈现未知）。
-- 计数与限额裁决在同一条 UPDATE 内完成（原子）；行是纯运维可重建数据，
-- 删表只影响统计与限额，不进入家庭导出包。
CREATE TABLE ai_daily_usage (
  day text PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0,
  images integer NOT NULL DEFAULT 0,
  audio_seconds integer NOT NULL DEFAULT 0,
  updated_at integer NOT NULL DEFAULT (unixepoch())
);
