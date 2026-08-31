-- M4 全文搜索：FTS5 虚拟表（可整体重建的 derivative 索引，不属于关系 schema）。
-- tokens 列存 bigram 预分词文本（CJK 双字 + 拉丁词），original_text 保留原文用于
-- 高亮/单字 LIKE 回退。UNINDEXED 列用于家庭隔离、可见性后过滤与结果回表。
CREATE VIRTUAL TABLE IF NOT EXISTS `search_index` USING fts5(
  `tokens`,
  `original_text` UNINDEXED,
  `family_id` UNINDEXED,
  `entity_type` UNINDEXED,
  `entity_id` UNINDEXED,
  `event_id` UNINDEXED,
  `visibility` UNINDEXED,
  `author_person_id` UNINDEXED,
  `child_person_id` UNINDEXED
);
