# Changelog

本项目的版本路线：**P0 可信私人时间轴**（0.1.0）→ **Real-world Hardening**（0.1.1）→ **Verification Hardening**（0.1.2）→ **Performance & Audit Hardening**（0.1.3）→ P1 AI 整理员 → P2 家庭口述史。

## Unreleased（M3 — AI memory organizer 完成）

M3 全部四块（M3-D/E/F/G）落地，版本号仍保持 0.1.3（v1 发布时统一升 1.0.0）。

### 精确 FactSource locator（M3-D，migration 0021）

- `fact_source` 增加 `quote` / `start_ms` / `end_ms` 与新来源类型 `asset_analysis`。
- 建议协议改为**一次性别名**：prompt 只暴露 T#/A#/C#，内部行 id 绝不进入模型上下文；
  编造别名、非逐字引文一律丢弃，引用全部失效的 AI 事实整条不入库。
- transcript 时间段只由服务端从 segment 推导（模型自报毫秒被忽略）；OCR 引文落
  `asset_analysis` 且 `sourceId` 指向 durable 的 asset id（分析行可重建）。
- locator 在确认时固化：STT rerun / 转录编辑不改写已确认事实的来源。
- 导出/恢复携带全部 locator 字段（旧档缺字段按 null 恢复）。

### occurredAt 建议（M3-E）

- `ai_suggestion` 新增 `occurred_at` 类型（带 `exact|approximate|date_only` 精度，
  不确定的时间绝不 exact）与 `inbox_item` 实体（migration 0020 一并落地）。
- 事件侧接受即走 `updateMemoryEvent`（修订快照、时间轴重排、年龄重算）；
  **AI 永远不触碰 `asset.capturedAt/importedAt`**。
- 收件箱建议（`suggest.inbox_item.v1`）产出标题/时间/人物/标签并**只做确认表单预填**；
  确认/丢弃时 pending 建议随之落定。

### 本地分簇建议（M3-F）

- `cluster_suggestion`（时间邻近 / dHash 感知相似 / Live Photo 同名配对），完全本地、
  无 AI、可解释理由；accept 走既有合并流程，绝不自动合并/删除，dismiss 留墓碑防复活。
- 收件箱 UI：扫描按钮 + 分簇面板 + 建议预填条。

### 视频理解（M3-G，migration 0022）

- `analyze.asset_video.v1`：ffmpeg 抽代表帧（≤30s 取 3 帧、最长 6 帧、单边 ≤1280px、
  合计 ≤12 MiB）→ 逐帧 vision → 汇总为 `analyzedVia='video_frames'` 的可重建 derivative。
  整段视频绝不发送给 provider；ffmpeg 缺失优雅降级（`ffmpeg_unavailable` 非重试失败）。

### 测试与稳定性

- 修复 CI Playwright 失败：转录/图像分析卡片文件名不再用 heading（与事件标题子串撞名）；
  e2e 断言预算在 CI 负载下放宽到 10s（断言内容不变）。
- roundtrip 导出计数断言与当前 12 非媒体文件格式对齐（此前 roundtrip 在 CI 从未跑到）。
- 生产 roundtrip 现在覆盖 edited transcript、确认事实 locator（quote + 时间段）、
  接受的标签与 date_only 精度的完整往返。
- 单元/集成测试 381 通过，Playwright 29 通过，roundtrip 6 通过。

## 0.1.3 — Performance & Audit Hardening（2026-08-30）

落地四项在 PRD §21 / SECURITY.md / RH-003 中明确记录、且不进入 P1 的既有缺口。无 AI。

### 缩略图衍生物（PRD §21「衍生预览独立保存」落地）

- 上传图片时经 **sharp** 自动生成 ≤640px、遵循 EXIF 方向的 **WebP 缩略图**，存于 `derivatives/thumbnails/`（独立文件，原件字节零改动）。
- 时间轴 / 收件箱 / 事件详情的图片展示一律优先缩略图（真实照片下不再加载全尺寸原件）；缩略图加载失败自动回退原件，再失败才显示占位。
- **HEIC 等 sharp 不支持的格式优雅跳过**（预构建 libvips 无 HEIF 解码），沿用「原件已安全保存」占位；生成失败只留 console 痕迹、绝不让上传失败。
- 导出仍只含原件（衍生物可再生，`getThumbnailMap` 批量查询按家庭隔离）。

### 事件编辑历史（RH-003 backlog 落地）

- `memory_event_revision`（migration 0008）：每次编辑在**同一事务**内写入「编辑前快照」（标题/时间/精度/地点/封面/孩子/参与人/年龄）。
- 事件页新增「编辑历史（N）」折叠区：时间 · 编辑者 · 之前的内容；跨家庭不可读；不随导出/恢复流转（实例本地审计）。

### 操作审计（SECURITY.md backlog 落地）

- `audit_log`（migration 0009）：导出完成（文件名/字节数/原件数）与恢复完成（来源大小/各实体计数）留痕，best-effort 不阻断主操作。
- 设置页新增「最近操作」列表；跨家庭隔离。

### 限流持久化（SECURITY.md §5 backlog 落地）

- better-auth `rateLimit.storage: "database"` + `enabled: true`：登录限流计数落 SQLite `rate_limit` 表（migration 0010），**重启不清零**。
- 在真实生产服务器上验证（roundtrip 测试）：窗口内第 4 次登录 429、计数可从另一连接读到。
- 已知边界：限流挂在 HTTP 请求层，服务端内部 `auth.api.*`（如 /setup）不经过限流，属预期。

### 版本与质量基线

- 197 单元/集成 + 24 Playwright + 6 roundtrip 全绿；lint/typecheck/build 通过；数据库 21 张表、10 个 migration 从零可建。

## 0.1.2 — Verification Hardening（2026-08-30）

关闭 v0.1.1 报告中的两项「未在本机验证」残留与基础设施缺口。无新产品功能、无 AI。

### 真实 ffprobe 元数据提取（关闭 v0.1.1 已知风险 5）

- `FFPROBE_PATH` 环境变量：显式指定 ffprobe 二进制（Docker 镜像走 PATH 默认；Windows 宿主/测试可注入）。
- 以 `ffprobe-static`（devDependency，跨平台二进制）在测试中注入真实 ffprobe，实证提取链路：MOV 的 `duration=1s`、`creation_time`（QuickTime 纪元 mvhd）→ `timeSource=embedded_metadata`；WAV `duration=1s`。
- 修复 fixture bug：mvhd timescale/duration 字段偏移错误（旧值会被真实 ffprobe 报 "time scale 0" 并读出 600 秒）。
- probeMedia 新增 **rotation** 提取（tkhd matrix → side_data_list；旧文件 tags.rotate），写入 `metadataJson.container.rotation`。

### HEIC EXIF 读取实证（关闭 v0.1.1 已知风险 2）

- 新增 `sample-exif.heic`：完整 HEIF 结构（iinf 声明 Exif item + iloc 指向 TIFF 块），exifr 实际读出 `DateTimeOriginal`。
- 摄取链路实证：带 EXIF 的 HEIC → `embedded_metadata` + 无偏移按家庭时区折算（09:00 上海 → 01:00Z）+ EXIF 快照完整保留；无 EXIF 的 HEIC 仍优雅 null。

### CI 修复

- 触发分支由 `main` 改为 `[master, main]`——此前仓库实际默认分支为 master，**CI 从未运行过**。
- e2e 任务纳入灾难恢复 roundtrip（`vitest.roundtrip.config.ts`）。

### 其他

- README 文档索引补充 DEPLOYMENT_CHECKLIST / REAL_DEVICE_TEST；`.env.example` 增补 FFPROBE_PATH 与测试限流变量说明。
- 勘误：0.1.1 记录的端到端测试数 23 → 实为 24（新增公开注册闸门 e2e 后未同步）。

## 0.1.1 — Real-world Hardening（2026-08-30）

目标不是加功能，而是在保存真实家庭资料之前完成真实媒体兼容、事件纠错、灾难恢复与部署可靠性验证。

### RH-001 真实媒体格式兼容

- 支持矩阵明确并全测：JPEG/PNG/WebP/**HEIC/HEIF**；M4A（m4a/x-m4a/mp4 三种声明）/MP3/WAV（wav/x-wav）；MP4/**MOV(quicktime)**——判定始终是 MIME 白名单 + 魔数 + 容器嗅探组合，不信任扩展名。
- HEIC/HEIF：原件必存、SHA-256 正常、EXIF 可读则读；**绝不因无法生成缩略图而拒收**，也绝不为预览把 HEIC 替换成 JPEG；嗅探精确区分 heic/heif 品牌（同族互表放行）。
- MOV：原件保留；ffprobe 存在时提取 duration/creation_time（本机缺失时优雅降级）；浏览器不能直接播放时显示「原件已安全保存」+ 鉴权下载入口（`components/media-view.tsx`，解码失败 onError 自动降级）。
- 无内嵌时间媒体：fallback 链路与 `timeSource` 语义有专项测试（import_time / file_metadata）。
- fixtures 升级为结构合规的真实容器样本（含 ISO-BMFF/QuickTime/ID3 结构），不再是无意义占位字节。

### RH-002 Live Photo 安全摄取基础

- HEIC/JPEG 静帧 + MOV 动帧：同时上传、独立原件、独立 SHA-256、都进收件箱、用户合并为同一 MemoryEvent；绝不自动删除任何一方（决策 D-013：P0.1 视作两个可合并 Asset，未来按 contentidentifier 自动建议配对）。

### RH-003 MemoryEvent 编辑

- `/memories/[id]` 新增编辑：标题 / occurredAt / 时间精度 / 地点 / 封面 / 参与人 / 孩子档案（限同家庭孩子）。
- 修改 occurredAt → 时间轴自动重排、年龄按 birthDate 现算重算；`importedAt` 不可改；**Asset.capturedAt 与事件编辑完全解耦**。
- 全部 mutation 先校验 session / family / event / person / cover 所有权（防 IDOR）；记录 `lastEditedByUserId`（migration 0007；完整修订历史在 backlog）。
- E2E：8/10 事件改 8/11 → 时间轴移动、年龄「出生当天」→「第 1 天」。

### RH-004 真正的 Restore（CLI）

- `DATA_DIR=/data npm run restore -- backup.zip`：验证（exportVersion / manifest 结构 / 引用完整性 / 全部原件 SHA-256 / **ZIP path traversal** / **zip bomb 三重限额**）→ 先落盘文件 → 单事务恢复 Family/Person/Asset/Event/关系/Contribution/Fact/Capsule → 行数复核；任何一步失败删除已写文件、无半恢复数据库。
- 只允许恢复到「无 Family」实例（merge 明确禁止）；认证数据永不来自备份——先 `/setup` 建管理员，恢复后 `/onboarding` 自动进入**绑定流**选择「你是谁」（决策 D-014）。
- manifest 增量字段（type/originalFilename/timeSource/尺寸/时长/metadataJson），exportVersion 仍为 1，旧导出按默认值恢复。
- 集成测试：A 建档（照片+音频+视频+文字+3 事件+讲述+事实+封存胶囊）→ 导出 → 空实例 B 恢复 → sha256 字节级一致、occurredAt 一致、关系/胶囊完整 + 7 个恶意输入用例。

### RH-005 灾难恢复 roundtrip（`npm run test:e2e` 内置）

- A 建档 → 导出 → **销毁 A** → 干净 B → restore → **启动真实生产服务器** → 登录（按恢复设计）→ 时间轴/详情核对 → 媒体字节 SHA-256 一致 + Range 206 + 匿名 401 → 导出 B → verify:export CLI 全绿。

### RH-006 E2E 独立性

- 每 spec 一个 Playwright project：独立端口 + 独立 `data/e2e-<project>` DATA_DIR，自行 bootstrap（`tests/e2e/helpers.ts`）；`npx playwright test timeline.spec.ts` 等单独执行全部通过；完整旅程保留在 `full-journey.spec.ts`。v0.1.0 的文件名顺序依赖（zz-export/zzz-final）已消除。

### RH-007/008/009 部署可靠性

- `scripts/smoke-deployment.mjs` + `/api/health`：login/health/匿名 401/ffmpeg/ffprobe/导出依赖/DATA_DIR 可写，可选凭据后追加登录/上传/媒体 Range/导出检查（本机实测通过）。
- `docs/DEPLOYMENT_CHECKLIST.md`：compose 构建/启动/日志、首次 setup、冒烟、数据持久性验证（down → up → 数据仍在）、升级流程。
- 备份安全：README 与清单明确 **`/data` 中 sqlite 与 originals 缺一不可**；给出停容器 tar volume、应用内导出、`VACUUM INTO` 在线快照（已实测包含未 checkpoint 的 WAL 写入）三种**经验证**的方案与 3-2-1 建议；明确「只复制 sqlite 不够」。
- `docs/REAL_DEVICE_TEST.md`：iOS/Android/桌面 × JPEG/HEIC/PNG/MOV(H.265)/MP4/M4A/MP3/WAV/微信图/大视频/竖屏/Live Photo 组合的手工验收清单（capturedAt/orientation/duration/playback/merge/export）。

### RH-010 安全回归

- **发现并修复 High 级漏洞**：better-auth `/sign-up/email` 端点默认公开暴露，初始化后任何人可经 HTTP 创建账号（等于公开注册）。现仅零用户时放行（与 /setup 同闸门），此后一律 403；集成 + e2e 双层回归。
- Restore 加固如上（traversal/bomb/manifest/hash/目标校验）；跨家庭事件编辑、participant/cover IDOR、media/export/capsule IDOR 全部回归覆盖。

### 版本与质量基线

- 179 个单元/集成测试 + 23 个端到端测试 + 5 个 roundtrip 测试全绿；lint / typecheck / build 通过。
- 仍无任何 AI 代码路径；未进入 P1。

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
