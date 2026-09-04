# Changelog

本项目的版本路线：**P0 可信私人时间轴**（0.1.0）→ **Real-world Hardening**（0.1.1）→ **Verification Hardening**（0.1.2）→ **Performance & Audit Hardening**（0.1.3）→ **1.0 Family Archive**。

## 1.0.0-rc.4 — Cross-device correctness（2026-09-04）

本轮不增加产品领域、页面、AI、备份或导出格式；portable archive 继续使用 v1。重点修复
rc.3 审计中发现的跨端时间、草稿、媒体来源、本机生命周期与角色体验问题。

### 时间、素材来源与跨端草稿

- 原生 Inbox、Memory 编辑与合并统一发送家庭墙钟 `occurredAtWall`；服务端只按当前家庭的
  IANA timezone 转 UTC，客户端不再用裸 `toISOString().slice()` 或设备时区解释。
- 年龄差、出生当天 / 第 N 天 / 满月 / 百天统一按家庭本地日历日计算，覆盖上海、设备与
  家庭时区不一致、午夜边界及纽约 DST 跳变。
- 相机与相册来源分离；现场拍摄可使用现场时间，相册素材只有从 MediaLibrary 取得可靠创建
  时间时才上传 `lastModified`。无 EXIF、QuickTime creation_time 或可靠文件时间的导入保持
  `capturedAt=null`、`timeSource=import_time` 并进入 `needs_review`，不再以选择时间冒充拍摄时间。
- Web“先收进来”保存标题、家庭墙钟、地点和人物草稿；Web/native 打开与确认均回填同一组
  字段，人工草稿优先于 AI 建议和文件名 fallback。

### 本机对账、权限与入口稳定性

- `local_capture` 使用 `pending → inbox → archived` 生命周期并保存可选 `memoryEventId`；单条
  确认和多项合并后隐藏独立本机卡片、保留原件，并可继续作为正式事件的离线媒体。确认响应
  丢失后的重试会从同步快照恢复关联，不生成重复时间轴事件。
- Web 导航按 capability 过滤，同时保留全部服务端授权；已连接且无 capture 权限的原生账号
  进入明确只读状态，不创建注定失败的 outbox。Inbox 将查看与 review 分开，viewer 不显示
  修改、合并或确认动作；纯本机模式仍可记录。
- 原生首页四个记录入口分别聚焦文字、启动相机、定位录音和打开相册；故事、胶囊、问题及
  story 搜索结果打开准确内容或明确标注“在 Web 打开”。Memory 页支持文字讲述新增/本人编辑、
  作者和可见性，并避免封面重复。
- Web 移除未实现的 `⌘K` 提示，将伪“相关记忆”改名为“最近记忆”；默认记忆阅读不预取
  转录、AI 分析/jobs、建议、修订和审计来源，显式打开档案或编辑时才加载。

### 发布门禁

- 本地干净安装后通过 70 files / 491 个 Web 单元与集成测试、36 个 production Playwright、
  6 个 production disaster roundtrip，以及 6 files / 30 个移动端测试。
- Web lint/typecheck/Next 16.3.3 production build、mobile TypeScript/ESLint、Expo Doctor 21/21、
  Android/iOS Hermes bundle 与 Docker app/worker health + deployment smoke 均通过。
- 本轮未 push，因此没有 rc.4 GitHub CI 或原生 APK/IPA 云构建；真实设备项目仍全部待人工，
  不创建 stable tag。

## 1.0.0-rc.3 — Everyday family product（2026-09-04）

这一候选版不改变私人、自托管、单家庭优先的档案边界，重点把现有能力整理成可每天使用的
Web 与原生产品。portable archive 继续使用 v1，旧归档仍可恢复；AI 继续默认关闭且只提供
待人工确认的建议。

### 产品壳与家庭首页

- Web 受保护区域统一为首页、时间轴、记录、收件箱、更多五个一级入口；桌面使用响应式
  侧栏，小屏使用安全区底部导航，记录入口突出并显示收件箱数量。
- 静态介绍首页替换为集中 service 查询的真实家庭仪表盘：家庭/孩子年龄、快速记录、待整理
  预览、最近记忆、回顾、故事、胶囊、口述问题和首次使用引导均可操作。
- 建立 AppShell、PageHeader、导航、EmptyState、MemoryCard、MediaGrid、StatusBadge、
  QuickAction、SectionHeader、ConfirmDialog、InlineNotice 与 Skeleton 组件；使用本地 SVG、
  44px 点击目标、可见焦点和 reduced-motion。

### Web 核心流程与重新遇见

- 统一记录页支持文字、多文件照片/音频/视频、拖放、逐文件状态，以及“先收进来”和
  “整理并保存”；收件箱支持图片网格/列表、草稿字段、多选合并与确认进度。
- 时间轴增加图片优先卡片、年月跳转及人物/媒体/标签过滤；记忆详情默认阅读，编辑档案与
  来源、SHA-256、任务和历史等技术信息显式分层。
- migration 0029 保存收件箱标题/时间/地点/人物草稿；migration 0030 为 `MemoryEvent`
  增加可选成长节点类型与置顶，并让口述史请求可关联同家庭 Person。
- 新增家庭时区的“这一天 / 一个月前 / 百天前 / 一年前”，以及人物主页的参与记忆、
  亲口讲述、共同记忆、口述史和发起问题；软删除内容不会进入首页、回顾和搜索。

### 原生闭环与高级能力入口

- Expo SDK 57 客户端拆分为 React Navigation 7 页面与状态模块，五项原生底栏与 Web 对齐。
  原生端可离线写文字、拍照/视频、直接录音、相册多选；原件先复制到私有目录，单条失败
  不阻塞 outbox，同 `captureId` 重试保持幂等。
- 原生首页、分页收件箱、字段修改、单条确认、多选合并、可离线记忆详情、媒体播放、搜索
  和同步状态形成“记录 → 整理 → 入档 → 阅读 → 时间轴”闭环。
- 移动 API 全部使用实时 Bearer session 推导 family/role/Person，不接受 `familyId`，复用
  capability、Contribution visibility 与软删除规则，并统一返回 `private, no-store` 最小 DTO。
- 故事使用封面卡片与阅读模式，胶囊显示封存/倒计时/开启状态，口述史按处理状态分区；
  新增“书籍与备份”入口，把故事/年度 PDF、EPUB、完整导出和 WebDAV 放在自然路径中。

### 质量基线

- 68 个文件 / 472 个服务端 Vitest、34 个 Playwright 场景、14 个移动端 Vitest 与
  6 个 production disaster roundtrip；lint、typecheck、Next production build、Expo Doctor、
  Android/iOS bundle 与 Docker 持久化门禁纳入发布验收。
- 稳定 `1.0.0` 仍以 `docs/REAL_DEVICE_TEST.md` 的真实 iOS、Android 与桌面记录为外部门禁；
  本次不创建 stable tag。

## 1.0.0-rc.1 — Family Archive release candidate（2026-09-03）

稳定版唯一外部门禁是 `docs/REAL_DEVICE_TEST.md` 的 iOS、Android、Windows/PWA
实机记录；在该记录完成前不创建 `v1.0.0` tag。

### 原生 iOS / Android 与离线同步

- 新增 Expo SDK 57 + React Native 原生客户端（无 PWA/WebView）：设备 SQLite 保存
  时间轴/人物/同步状态，Keychain/Keystore 保存会话，私有文件目录保存离线封面和
  待补传原件。
- 离线文字、照片和视频使用持久 outbox；文字由设备 UUID 在服务器幂等入箱，媒体使用
  设备 `captureId` + 原件 SHA-256 幂等补传；完整分页快照成功前不清理旧离线行。
- Better Auth 官方 bearer transport 复用现有可撤销 session；新增最小化
  `/api/mobile/v1` 同步/文字捕获端点，所有家庭、角色和媒体可见性继续由服务器推导。
- `.github/workflows/mobile-build.yml` 在 GitHub macOS/Linux runner 构建 unsigned IPA
  和可侧载 APK；构建产物不包含真实家庭数据。

### 发布、安全与恢复硬化

- 上传改为 XHR 字节进度与失败重试；图片、音频、视频、Share Target 与匿名讲述媒体
  在 `formData()` 前强制有限 `Content-Length`，50/200/500MB 上限不能被 chunked 绕过。
- `/setup`（10 次/15 分钟/实例）与匿名讲述（5 次/小时/链接）使用 SQLite 原子持久化限流；
  bearer token 只以 scope + SHA-256 subject 参与 key。
- 新增全局 loading/error/not-found 恢复页、键盘焦点与 reduced-motion；移除构建期网络字体依赖。
- 修复 onboarding 后 Router Cache 重定向循环、收件箱无效嵌套 `<li>` 导致的重复卡片，
  以及 worker 继承 HTTP 探针而永久 unhealthy。
- Compose 强制配置 `BETTER_AUTH_URL`，支持 `APP_PORT`；真实 Docker build/boot/health、
  持久化、跨实例 restore 和从干净 0.1.3 镜像接管旧卷均已验证。
- WebDAV 上传与回读哈希改为流式；恢复 CLI 改用 yauzl 文件句柄 reader，压缩包不再整包
  载入 JS heap。原件以 entry stream 逐个验字节/SHA-256，经临时文件 + hard-link 原子发布；
  重复/加密/未知压缩方法、路径逃逸和解压限额在写入前拒绝，失败清理所有已写原件。
- 质量基线：455 个服务端 Vitest、32 个 Playwright、8 个移动端 Vitest、6 个生产
  roundtrip 全绿；
  lint/typecheck/webpack production build/audit/10k-event + 50k-asset benchmark 通过。

### 口述收集与胶囊对话（M5，migrations 0025/0026）

- 匿名讲述链接：256-bit token 只存 SHA-256、可过期可关闭、5 条/小时限流；
  访客页只显示称呼与问题；文字/录音/照片/视频提交进收件箱审核，绝不直接发布。
- 内置十主题口述问题库。
- 胶囊对话：未来问题在 draft 阶段固化；开启后家人可用文字/媒体回答；
  封存历史内容零改动；两表随 archive 导出/恢复。

### 书籍 / WebDAV 备份 / 分享目标（M6）

- PDF（sharp SVG 排版 → JPEG 页 → DCTDecode 直嵌）与 EPUB 3 生成器；
  已发布故事与年度事件可成书下载；媒体全部内嵌，绝无内部鉴权 URL。
- WebDAV BackupTarget（migration 0027）：verified export → 临时上传 → 回读
  SHA-256 → 原子 MOVE（降级路径如实记录）；凭据仅存 env，零泄漏（测试覆盖）；
  设置页历史与一键重试。
- PWA Share Target：系统分享的照片/视频/音频/文字/链接直达收件箱。

### 搜索与故事（M4）

### 全文搜索（M4-A，migration 0023）

- FTS5 `search_index`：事件标题、user_confirmed 事实、家人讲述、用户修订转录、已发布故事。
- 中文 bigram 预分词（≥2 字词/词组命中；单字回退 LIKE）；参与人/标签/媒介/日期过滤。
- 家庭隔离 + 可见性后过滤：private/parents/child_later 讲述只对策略允许的读者可见。
- `npm run search:rebuild` 全量重建；恢复完成后自动重建；完全离线、不依赖 AI。

### 故事（M4-C/D/E，migration 0024）

- story/story_paragraph/story_source：周记/月章/年章，draft→edited→published。
- Quote Lock 服务层强制；再生保护（未编辑草稿可替换，已编辑/已发布永不覆盖）。
- `generate.story.v1` AI 起草（F#/C#/T# 别名 + 逐条来源校验）+ 无 AI 的离线组装路径。
- 导出/恢复携带 edited/published 故事三件套；published 故事进入搜索索引。

### AI memory organizer（M3）

M3 全部四块（M3-D/E/F/G）落地。

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
- 当时的阶段基线为 381 个 Vitest、29 个 Playwright、6 个 roundtrip；当前发布基线见本节开头。

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
