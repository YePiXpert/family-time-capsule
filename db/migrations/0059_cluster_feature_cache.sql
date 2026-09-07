-- 相似照片特征持久缓存（正式 1.0 §8 / FIND-5）：
-- dHash 感知哈希与清晰度参考分按「来源字节哈希 + 算法版本」落库，
-- 重扫不再逐张解码原件。原件字节不可变（CAP-15），同一 SHA 永远同一画面，
-- 条目不会因内容变化而失效；算法升级换版本号即整体失效重算。
-- 纯运维可重建数据：不进家庭导出包，删表重建结果不变。
CREATE TABLE cluster_feature_cache (
  sha256 text NOT NULL,
  algorithm text NOT NULL,
  dhash text NOT NULL,
  focus_score real,
  created_at integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (sha256, algorithm)
);
--> statement-breakpoint
CREATE INDEX cluster_feature_cache_algorithm_idx ON cluster_feature_cache(algorithm);
