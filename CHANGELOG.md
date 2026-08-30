# Changelog

本项目的版本路线：**P0 可信私人时间轴**（0.1.0）→ **Real-world Hardening**（0.1.1）→ **Verification Hardening**（0.1.2）→ P1 AI 整理员 → P2 家庭口述史。

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
