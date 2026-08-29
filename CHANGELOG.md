# Changelog

本项目的版本路线：**P0 可信私人时间轴**（0.1.0）→ P1 AI 整理员 → P2 家庭口述史。

## 0.1.0 — P0 · Trusted Private Timeline（2026-08-29）

第一个完整可用版本。不接任何 AI Provider 也完整工作（`NullMemoryAssistant` 原则：P0 根本没有 AI 代码路径）。

### 私人认证（#001–#002）

- better-auth 1.7 + 数据库 session + scrypt 密码哈希；无公开注册。
- 首次部署 `/setup` + `INITIAL_SETUP_TOKEN` 一次性初始化，成功后永久失效。
- `(protected)` 布局层会话守卫；生产 Secure cookie。

### 家庭与人物（#003）

- Family / Person 模型；Person ≠ User——祖辈、孩子没有账号也完整存在。
- `/onboarding` 一次性建家（家庭 + 女儿档案 + 自己 + 绑定）；`/family` 添加无账号成员。

### 原件媒体档案（#004–#006）

- `AssetStorage` 抽象 + `LocalFilesystemStorage`：storageKey 白名单、原子写入、**原件永不覆盖**（存储层强制）。
- 上传：MIME 白名单 + 魔数嗅探 + 大小限制（图 50MB / 音 200MB / 视 500MB）；恶意文件名不进入磁盘路径。
- SHA-256 家庭内精确查重：重复明确提示，不静默复制。
- EXIF（exifr）：DateTimeOriginal > CreateDate > 文件时间 > 导入时间；无偏移按家庭时区解释（D-009）；用户修正后 `timeSource=user_confirmed` 且原始 metadata 永不删除。
- 音频/视频后续上传（不要求 App 内录制）；ffprobe 增强（缺失时优雅降级）。

### 收件箱与记忆事件（#007–#010）

- 一切新内容先进收件箱；缺时间自动 `needs_review`；可改时间/废弃（Asset 永不删除）。
- 单项确认或多选合并 → `MemoryEvent`（Asset 只关联不复制；occurredAt 默认最早可信 capturedAt，绝不是 importedAt）。
- 事件详情页：真实时间、女儿年龄、参与人、素材、档案信息。

### 时间轴（#009）

- 按 `occurredAt` 排序 + 家庭时区年月分组；年龄从 `child.birthDate` 现算（出生前/出生当天/第 N 天/满月/百天/岁与月）。
- 旧照片晚上传不会跑到上传日期（关键 E2E 覆盖）。

### 多人视角（#012）

- Contribution 按 Person 独立成行：妈妈编辑永远不会覆盖爸爸的文本；爸爸登录可替外婆记录「外婆说」。
- Fact 基础表：P0 仅用户手工确认（AI 将来也只能建议，事实锁）。

### 时间胶囊（#013）

- date / age 两种解锁（家庭时区当日零点 / 满周岁）；封存后 UI 隐藏正文但**不是物理加密**——导出永远完整。

### 可迁移性（#014–#015）

- 完整 ZIP 导出：manifest（每个原件 SHA-256/字节数/时间）+ 7 个 JSON + timeline.md（相对路径引用媒体）+ 原件目录。
- 导出时重验所有原件哈希，不符明确失败（409）；`npm run verify:export` 独立校验。
- `docs/EXPORT_FORMAT.md` + `docs/RESTORE.md` 定义兼容承诺与恢复设计。

### PWA（#016）

- manifest + 生成式暖色图标；standalone 可安装；safe-area；离线提示壳（SW 绝不缓存 `/api/**`——私人媒体不做离线存储）。

### 安全（#017）

- 唯一鉴权媒体端点（`private, no-store` + `nosniff` + Range）；上传端点同源校验。
- 家庭隔离专项审计：双家庭全资源互访测试；**发现并修复 High 级 IDOR 写入**（contribution/fact 先写后校验 → 先校验后写）。
- 登录限流（better-auth 默认 3/10s，环境变量可调）。

### 质量基线

- 126 个单元/集成测试 + 19 个端到端测试全绿；lint / typecheck / build 通过。
- 空数据库冷启动：首次连接自动应用全部 7 个 migration（集成测试 + 每次 e2e 运行验证）。
