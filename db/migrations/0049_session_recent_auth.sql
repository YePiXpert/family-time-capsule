-- M2-c：step-up 认证（ID-10）。
-- 高敏操作（完整导出/所有权移交/重置认证）要求「近期重新认证」：
-- 会话行记录最近一次密码复核时间；超过窗口的操作必须重新输入密码。

ALTER TABLE `session` ADD `recent_auth_at` integer;
