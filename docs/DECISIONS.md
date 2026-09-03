# 决策记录（ADR）

> 规则（PRD §25）：如果 PRD 与现有代码冲突，先在这里写清楚，不自行扩大范围。

## D-001 产品层面最重要的十个决定（PRD §31）

1. **不要求通过本 App 产生媒体。**
2. **后续上传与直接记录同等重要。**
3. **capturedAt 和 importedAt 必须分离。**
4. **原件不可覆盖。**
5. **MVP 不依赖 AI。**
6. **MemoryEvent 是核心，Asset 是证据。**
7. **同一事件允许多个家人的独立视角。**
8. **完整导出是 MVP 功能。**
9. **第一阶段只服务一个家庭，不做 SaaS。**
10. **产品寿命按 18 年以上设计，而不是按“宝宝 App”设计。**

## D-002（Issue #001）技术选型与脚手架

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：采用 `create-next-app` 生成的 Next.js 16（App Router）+ TypeScript + Tailwind CSS v4 单体全栈作为起点；测试用 Vitest（单元）+ Playwright（端到端，生产构建 + 端口 3100）；Docker 镜像基于 `node:24-alpine` 多阶段构建 + Next standalone 产物，`ffmpeg` 随镜像安装（增强能力，非核心硬依赖）；CI（GitHub Actions）跑 lint → typecheck → unit → build → e2e。
- **后果**：
  - standalone 产物仅在 Docker 构建时启用（`BUILD_STANDALONE=1` 触发 `next.config.ts` 中的 `output: "standalone"`）；本地与 CI 用默认输出，`next start` 完全受支持（Next 16 对 standalone + `next start` 有不兼容警告）。
  - `typecheck` 脚本先执行 `next typegen` 再 `tsc --noEmit`（Next 16 路由类型是生成式的，全新 checkout 必须先生成）。
  - SQLite/Drizzle/Auth 库在 #002/#003 再引入，bootstrap 保持零业务依赖。
- **PRD 偏差**：无。

## D-003（Issue #001）数据目录约定

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：`lib/paths.ts` 定义 `DATA_DIR`（默认 `<cwd>/data`，环境变量 `DATA_DIR` 覆盖，Docker 内为 `/data`）与 `ensureDataDirs()`；`data/` 整体 gitignore；compose 用 named volume `capsule-data` 挂载 `/data`。
- **PRD 偏差**：无（对应 PRD §11）。

## D-004（Issue #002）认证库选择：better-auth

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：采用 **better-auth 1.7**（+ 官方 Drizzle 适配器）实现认证。
- **理由**：
  1. 框架无关、与 Next 16 App Router 无版本耦合（NextAuth v5 长期 beta，兼容性风险高）；
  2. 内置 email+password（scrypt 哈希）、数据库 session、cookie 管理（HttpOnly/SameSite/Secure）、Origin 校验（CSRF）、内建 rate-limit——全部满足 PRD §17“不自研协议”的要求；
  3. 一等 Drizzle/SQLite 支持，与既定技术栈一致；
  4. server-side API（`auth.api.*`）可在 Server Action / RSC 中直接调用。
- **映射**：better-auth 的 `user.name` 即需求中的 displayName；`role` 以自定义 additionalField 暂固定为 `admin`（#003 再完整建模角色与 User↔Person 关系）。
- **注意**：`database` 选项只接受适配器实例（不支持函数懒加载），因此 `lib/auth/auth.ts` 模块加载即打开数据库并执行迁移（幂等）；构建期可能触达一次默认 DATA_DIR（可写环境无害）。

## D-005（Issue #002）首次管理员初始化（first-run setup）

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：`/setup` 仅当「数据库无任何 User **且** 环境变量 `INITIAL_SETUP_TOKEN` 已配置」时可用；token 走表单 POST（Server Action）、SHA-256 等长化后 `timingSafeEqual` 比较、不入库不进 URL；初始化请求进程内串行化；成功后 `/setup` 以「存在用户」为闸门永久失效。威胁模型详见 `docs/SECURITY.md` §2。
- **关键教训（已修）**：`/setup` 必须 `export const dynamic = "force-dynamic"`——否则 Next 会在构建期执行 `getSetupState()` 并把结果（甚至重定向）静态冻结。

## D-006（Issue #002）数据库位置与迁移策略

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：SQLite 文件固定在 `$DATA_DIR/db/capsule.sqlite`（随 DATA_DIR 进 Docker volume）；better-sqlite3 + WAL + foreign_keys；Drizzle migration（`db/migrations/`，由 `drizzle-kit generate` 生成）在**首次连接时自动应用**（幂等，`db/index.ts`），dev/prod/Docker 行为一致；不使用内存数据库。
- **注意**：集成/e2e 测试必须通过独立 `DATA_DIR` 隔离；vitest 中环境变量须在**动态导入前**（模块顶层）设置，因为 `lib/paths` 在 import 时读取 `DATA_DIR`。

## D-007（Issue #003）User↔Person 绑定与 onboarding

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：不复制第二套认证 User。在 better-auth `user` 表上增加业务列 `family_id` / `person_id`（可空 FK），additionalFields 以 `input: false` 暴露（客户端不可写入，只能由服务端在 onboarding/绑定时更新）。`person.avatar_asset_id` 暂为普通列，#004 Asset 表落地后再升级 FK。
- **onboarding**：首次登录且未绑定家庭的用户被重定向到 `/onboarding`，一个事务里创建 Family + 女儿 Person（isChild，birthDate 必填）+ 管理员自己的 Person，并写回 user 的 familyId/personId。
- **路由结构**：认证守卫在 `app/(protected)/layout.tsx`（不变）；家庭守卫在嵌套路由组 `app/(protected)/(app)/layout.tsx`——因为服务端 layout 拿不到 pathname，无法在上级判断「当前是否就在 /onboarding」，用嵌套组比每页手写检查更可靠。`/onboarding` 本身位于 (protected) 内（需要登录）。
- **PRD 偏差**：无（PRD §10 的 User 型中 familyId 在 P0 阶段实际可空——管理员先于家庭存在）。

## D-008（Issue #004）Asset 存储与不可覆盖语义

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：
  1. storageKey = `originals/{familyId}/{yyyy}/{mm}/{assetId}.{ext}`（yyyy/mm 取 capturedAt，缺失用导入时间）；derivatives 同构但前缀为 `derivatives/{type}s/`。**上传原 filename 永不进入路径**，只作为展示名存 DB（清洗路径分隔符与控制字符）。
  2. 原件不可覆盖在**存储层强制**：`putOriginal` / `putOriginalStream` 对已存在 key 抛
     `OriginalExistsError`；普通写入走临时文件 + rename，流式写入走独占临时文件 + hard-link
     原子发布，竞争写入也不会替换目标。衍生物可再生、允许覆盖。
  3. key 安全是白名单而非黑名单：正则限定前缀与字符集、禁止 `..` 与 `//`，resolve 后必须仍在 DATA_DIR 内（纵深防御，主防御是 filename 根本不参与路径）。
  4. 去重以家庭为边界：unique `(familyId, sha256)`。跨家庭允许相同文件（隔离单位是 family，不是全局）。
  5. `person.avatar_asset_id` 在 P0 保持普通可空列（尚未使用）——SQLite 无法 ALTER 加 FK 约束，为未用功能重建 person 表不值得。
  6. LocalFilesystemStorage 的普通小对象 API 保持同步；大文件读取用 `createWebStream`，恢复写入
     用异步 `putOriginalStream`，边落盘边计算实际字节数与 SHA-256。
- **PRD 偏差**：无。

## D-009（Issue #006）EXIF 时间缺失时区的解释策略

- **日期**：2026-08-29
- **状态**：已接受
- **背景**：EXIF `DateTimeOriginal` 绝大多数是「拍摄地本地时间」，不带偏移。若凭空按 UTC 解释，时间轴会错 8 小时。
- **决策**：
  1. 有 `OffsetTimeOriginal` / `OffsetTime` → 按显式偏移折算 UTC；
  2. 无偏移 → 按 **Family.timezone** 解释为家庭所在地墙钟时间，两遍法（Intl longOffset）折算 UTC，正确处理 DST；
  3. 墙钟原始值 + 偏移字段完整快照进 `Asset.metadataJson.exif`，事后可重新解释；
  4. 时间优先级：EXIF(DateTimeOriginal > CreateDate) > 文件系统时间（浏览器 `File.lastModified`，本身 UTC ms）> 导入时间（`capturedAt=null` + `timeSource=import_time`，确认事件时用 importedAt 兜底）；
  5. 用户修正 → `timeSource=user_confirmed`，metadata 不动（`updateAssetCapturedAt`）。
- **理由**：单家庭自托管场景下「照片几乎都在家庭时区拍摄」是最佳可得假设；显式偏移存在时永远优先；原始值留档使策略可逆。
- **PRD 偏差**：无（PRD §1.2 只规定优先级，未规定无偏移语义）。

## D-010（Issue #011）音视频摄取与 FFmpeg 的关系

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：
  1. 音频/视频只做「后续上传已有文件」，不做 App 内录制（Capture Anywhere）；上传前先 SHA-256 查重再落盘。
  2. ffprobe 是**增强能力**：存在时提取 duration/creation_time/尺寸（creation_time → embedded_metadata），不存在或失败时返回 null，上传主流程完全不受影响（本机无 ffmpeg 已验证）。探测结果快照进 `metadataJson.ffprobe`。
  3. 浏览器原格式不兼容时未来生成 transcode 衍生物解决（P1），原件永不替换。
  4. 媒体端点实现 HTTP Range（206），音频/视频才能 seek 与流式播放。
  5. 文字条目无 Asset：kind=text 直接落 inbox_item.rawText，occurredAt 在确认时兜底条目创建时间。
- **PRD 偏差**：无。

## D-011（Issue #015）恢复设计与导出格式承诺

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：
  1. `exportVersion` 主版本=1；未来只做增量字段，旧导出按「缺失字段取默认值」读取，重大不兼容才升版本。
  2. P0 交付恢复**设计**与校验 CLI（`npm run verify:export`），不实现恢复 UI（P1）。
  3. 恢复四条铁律：先校验后恢复；合并导入不覆盖；原件只增不改；认证数据（user/session）不导入——Person/User 绑定恢复后手工重建。
  4. 重复判定沿用 `(familyId, sha256)` 唯一键：命中则复用 Asset 行但关系照常导入。
  5. 跨实例恢复：空实例保留原 UUID；已有家庭走 ID 重映射，冲突时新导入方换新 ID 并写入恢复报告。
  6. `stories/` 恢复为只读文件不建表——Story 永远可从 user_confirmed Fact + Contribution 再生（事实锁）。
- **PRD 偏差**：无。

## D-012（Issue #016）PWA 离线策略与图标

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：
  1. Service Worker 只做「离线提示壳」：缓存唯一的 `/offline.html`，导航请求失败时回退；**`/api/**` 一律直连，绝不做离线缓存**（私人媒体库离线存储被明确禁止，也避免把私人内容写进 Cache Storage）。
  2. SW 仅生产注册（`NODE_ENV=production`），开发不缓存。
  3. 图标由 `scripts/make-icons.mjs` 纯 Node 生成（内置 PNG 编码器）：暖纸底 + 皮革色胶囊图形，与 globals.css 的低饱和档案基调一致；无 emoji、无卡通元素。
  4. 移动端 viewport：`viewport-fit=cover` + body 的 safe-area padding；上传控件不带 `capture` 属性——相册/拍摄由用户在系统选择器决定（Capture Anywhere，不强制现场拍摄）。
- **PRD 偏差**：无（PRD §28 风格约束落实）。

## D-018（1.0 RC）原生伴侣客户端：设备本地副本 + 家庭服务器同步

- **日期**：2026-09-03
- **状态**：已接受
- **决策**：新增 Expo/React Native 原生伴侣客户端；设备使用 SQLite、私有文件目录与
  Keychain/Keystore，不使用 WebView。Next.js 单体仍是权威档案、媒体处理、导出恢复和
  AI worker 所在地。原生端通过 `/api/mobile/v1` 最小 DTO 与 Better Auth bearer session
  同步，不接受客户端指定 familyId。
- **同步**：读侧为完整 keyset 快照，全部分页成功后才清理设备旧行；写侧先落 durable
  outbox，文字以设备 UUID 幂等，媒体以设备 UUID + 原件 SHA-256 幂等；同 ID 不同内容
  返回冲突。安装包永不嵌入真实家庭数据。
- **构建**：GitHub Actions 产出 debug-signed APK 和 unsigned iPhoneOS IPA；Apple 身份
  凭据不进仓库，安装前由所有者自签/正式签名。
- **理由**：原生相册、设备级安全存储和可靠离线写入是 PWA 壳无法等价提供的；保留服务器
  权威层避免在手机中复制 better-sqlite3、ffmpeg、worker、恢复和权限状态机。
- **PRD 偏差**：用户明确扩展 1.0 交付范围；原“仅为分享而重写原生端”的非目标改为
  “不以设备端替换权威自托管档案”。

## D-013（RH-002）Live Photo 的 P0.1 语义：两个可合并的独立 Asset

- **日期**：2026-08-30
- **状态**：已接受
- **决策**：Apple Live Photo（及各厂商等效的「照片+动图」）在 v0.1.x 中**不做自动识别与配对**。静帧（HEIC/JPEG）与动帧（MOV）作为两个完全独立的 Asset 摄取：独立落盘、独立 SHA-256、各自进入收件箱；由用户多选合并到同一个 MemoryEvent（#010 既有能力），系统绝不自动删除其中任何一方，也不为预览把 HEIC 转换替换。
- **理由**：自动配对需要解析 Apple 的 asset identifier（`maker note` / `ContentIdentifier` atom），可靠实现依赖对多机型的样本验证；P0.1 目标是「两份文件都不丢、可合并」，用户手动勾选的成本可接受且零误判风险。
- **未来**：P1 可读取 MOV 的 `com.apple.quicktime.contentidentifier` 与 HEIC 的对应 metadata 自动建议配对（仍只建议，不自动合并/删除）。
- **测试**：tests/integration/live-photo.test.ts（HEIC+MOV、JPEG+MOV、废弃一方原件保留）。

## D-015（M3-A）AssetTranscript：独立表存储机器转录与用户修订

- **日期**：2026-08-31
- **状态**：已接受
- **决策**：
  1. 新增 `asset_transcript` 表作为音频/视频素材转录的权威存储；`contribution.transcript` 是未使用的占位列，不写入、不删除。
  2. 每 asset 一行 transcript，rerun 时 UPSERT；`rawTranscript`/`segmentsJson` 是可重建的机器输出，`editedTranscript` 是耐久家庭资料。
  3. AI rerun 只更新 `rawTranscript`、`segmentsJson`、`language`、`provider`、`model`、`sourceSha256`、`createdByJobId`、`updatedAt`，绝不触碰 `editedTranscript`；若已有 `editedTranscript`，保持 `status='user_edited'`。
  4. 只接受原始 asset（`originalAssetId IS NULL`），且 `mimeType` 必须在 provider 接受的音频列表内；超过 25 MiB 的素材以非重试安全错误拒绝。
  5. 转录结果进入家庭导出（`transcripts.json`），旧归档缺失该文件时恢复端按空数组处理。
- **后果**：UI 在记忆详情页为每个音频/视频原件展示转录状态；`ai:review` 角色可请求 AI 转录，`event:write` 角色可保存人工修订。
- **PRD 偏差**：无。

## D-016（M3-B）AssetAnalysis：图片视觉分析作为可再生衍生物

- **日期**：2026-08-31
- **状态**：已接受
- **决策**：
  1. 新增 `asset_analysis` 表存储图片素材的机器视觉分析；每条分析只对应一个原始图片 asset（`originalAssetId IS NULL`），rerun 时 UPSERT。
  2. 分析分为 `description`（客观可见内容描述）与 `ocrText`（图中文字），两者都是机器输出、可重建；UI 必须始终标注「AI 生成 · 未确认」，不得伪装成用户确认事实。
  3. 若原图 MIME（JPEG/PNG/WebP/GIF）被 vision provider 直接接受，则 `analyzedVia='original'`；否则查找同 asset 的 `thumbnail` 衍生物作为输入（`analyzedVia='thumbnail'`），以覆盖 HEIC/AVIF 等格式而不触碰原件。
  4. `sourceSha256` 永远记录原始 asset 的 SHA-256，用于漂移检测；thumbnail 的 SHA-256 不进入分析表。
  5. `asset_analysis` 是可再生衍生物：**不进入 portable family archive**，不写入导出 JSON，恢复端不重建该表；需要时重新运行 `analyze.asset_image.v1` 即可重建。
  6. 图片分析不会写入 `fact` 表，也不能自动确认事实；本切片不触碰事实锁。
- **后果**：记忆详情页为每个原始图片 asset 展示 AI 图像理解区块；具备 `ai:review` 能力的用户可逐项触发，触发前需要 vision capability 可用且（外部 provider 时）已同意。
- **PRD 偏差**：无。

## D-017（M3-C）Source-Linked AI Suggestions：事实来源、事件标签与建议工作流

- **日期**：2026-08-31
- **状态**：已接受
- **决策**：
  1. 新增三张表：`ai_suggestion`（待审建议与接受/拒绝墓碑）、`fact_source`（每条 fact 的来源追踪）、`memory_event_tag`（事件标签）。
  2. `ai_suggestion` 是运维/可重建状态：只保存当前待审建议与接受/拒绝记录，不进入 portable family archive；恢复后的新实例不会自动恢复旧建议。
  3. `fact_source` 与 `memory_event_tag` 是耐久家庭资料：必须随家庭 archive 完整导出/恢复。
  4. 建议类型限定为 `title|location|person|tag`，单推荐方案（每次 rerun 删除旧 pending 建议并插入新建议）；接受 title/location 时复用 `updateMemoryEvent` 的验证与修订快照逻辑。
  5. 标签存储规范化：小写、trim、长度 ≤50；`(memoryEventId, tag)` 唯一索引阻止重复。
  6. 事实来源类型限定为 `asset|contribution|transcript|user_text`；手工创建的 fact 来源类型为 `user_text`，sourceId 为 `null`。
  7. 建议 handler `suggest.event_metadata.v1` 只发送事件可见 contribution、家庭成员、已确认事实、转录与分析摘要等受限上下文；privacy contribution 不进入建议上下文。
  8. AI 建议产出 `ai_suggested` 事实与对应 `fact_source`，但永不自动确认；必须由具备编辑权限的用户逐项接受/拒绝。
- **后果**：记忆详情页出现「AI 建议」区块，可请求、接受、拒绝或重跑事件元数据建议；事实卡片展示来源 chips；导出/恢复保留事实来源与标签。
- **PRD 偏差**：无。

## D-014（RH-004）恢复目标与认证数据的处理

- **日期**：2026-08-30
- **状态**：已接受
- **决策**：
  1. 恢复目标限定为「**无 Family** 的实例」（family/person 表为空即保证全业务为空）；用户表允许且通常需要已有 1 个通过 `/setup` 新建的管理员——恢复内容的所有 `created_by` 指向该 operator。理由：`asset.created_by_user_id` 为 NOT NULL FK，指向备份中的旧用户会违反引用完整性；而先 setup 再 restore 让认证凭据永不来自备份（密码哈希/secret 不随归档流转）。
  2. 恢复后 `/onboarding` 自动检测「实例已有家庭」→ 进入**绑定流**（选择自己是哪位 Person；孩子档案不可作为登录身份）→ 写入 `user.familyId/personId`。
  3. 恢复写入顺序：结构/metadata/引用预验后，逐个 entry stream 经 `putOriginalStream`
     验字节与 SHA-256 并原子发布；key 冲突或任一原件异常即删除此前文件。全部原件通过后
     单事务写库，并在提交前做行数复核；DB/复核失败则事务回滚并删除已写文件。
  4. v0.1.1 明确禁止 merge restore（向已有数据的实例合并导入）。
  5. CLI 形态：`npm run restore -- backup.zip`（tsx 运行 TS、复用业务服务与校验；恢复是管理员运维操作，不需要 Web UI）。
- **PRD 偏差**：无（PRD §15/§18 允许；docs/RESTORE.md 已同步）。


## D-0xx（M5）口述史「请求即会话」
- **背景**：PRD 列出 InterviewPrompt/InterviewSession/Topic 三个模型。
- **决策**：精简为 `contribution_request`（含 recipientLabel/promptText/topicKey）
  + submission 关联收件箱条目；一次链接对应一位讲述人的一组问答。
- **理由**：InterviewSession 的全部语义（谁、问什么、收到的内容、审核状态）
  已由 request + inbox 条目完整承载；再建会话表会引入双写与状态漂移。
- **后果**：少两张表、少一条状态机；AI follow-up 建议留待真实使用反馈后评估。

## D-0xx（M6）PDF 生成的技术选型
- **决策**：手写 PDF 封装（页面 = sharp SVG 排版 → JPEG → DCTDecode 直嵌），
  不引入 PDF 库；EPUB 用 jszip 按 EPUB 3 规范生成。
- **理由**：书籍只需要「页图序列」一种能力；CJK 排版交给 librsvg + 系统
  Noto CJK（Docker 镜像已内置），避免几十 MB 的字体嵌入或新供应链依赖。
- **后果**：PDF 文字不可选中（以图像页呈现）；阅读优先走 EPUB（原生文本）。

## D-0xx（M7/M8）上传/恢复的内存形态
- **决策**：媒体回放、导出、WebDAV PUT/GET 哈希走流式；上传保持「上限内有界缓冲」
  （50/200/500MB 上限 + 所有入口 Content-Length 预检），不做手写 multipart 流解析。
  恢复 CLI 用 yauzl 从文件句柄读取 Central Directory，逐个打开 entry stream，经临时文件
  流式计算字节/SHA-256 后 hard-link 发布；不再把压缩 ZIP 或完整原件读入 JS heap。
- **理由**：手写多部分或 ZIP 解析器处理不可信输入会扩大攻击面；采用成熟 reader 并显式
  拒绝路径逃逸、重复、加密、未知压缩方法，同时限制条目数、单条/总解压量和 metadata 大小。
- **后果**：CLI 内存随受限的 Central Directory 和单个 ≤64MB metadata 文件增长，而不随
  压缩包或原件大小线性增长。`restoreFromZip(Buffer)` 仅保留给已经持有 Buffer 的测试/
  程序化调用方；完全零拷贝 multipart 仍是未来独立安全评审项。

## D-0xx（M4）搜索分词
- **决策**：FTS5 索引与查询两侧统一 CJK bigram 预分词（lib/search/tokenizer.ts），
  单字中文回退 LIKE。
- **理由**：unicode61 不切中文；trigram 对 2 字词不命中；bigram 在索引与查询
  两侧一致即可获得 ≥2 字词/词组/英文词的完整匹配。
- **后果**：索引体积约为原文 token 数的 2 倍以内；重建为全量操作（秒级）。
