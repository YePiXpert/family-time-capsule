# 核心数据模型

> 权威定义来自 `docs/PRD.md` §10；以 `db/schema/` 中的 Drizzle schema 为实现基准，两者必须保持一致。修改数据模型必须创建 migration（PRD §25）。

## 认证表（#002 已落地：`db/schema/auth.ts`）

better-auth 1.7 所需的四张表，字段名与 `getAuthTables()` 一致：

- **user**：`id, name(即 displayName), email(unique), emailVerified, image, role, familyId, personId, createdAt, updatedAt`
- **session**：`id, token(unique), userId→user, expiresAt, ipAddress, userAgent, createdAt, updatedAt`
- **account**：`id, userId→user, accountId, providerId, issuer, accessToken…, password(scrypt 哈希, providerId='credential'), createdAt, updatedAt`
- **verification**：`id, identifier, value, expiresAt, createdAt, updatedAt`

约定：better-auth 的 `user.name` 即 PRD 语境的 displayName。`user.family_id` / `person_id` 是可空业务 FK；首次管理员在 `/setup` 后由 `/onboarding` 绑定，受邀账号由已验证邀请绑定。`role/familyId/personId` 的 additionalFields 均为 `input: false`，浏览器注册体不能赋权。

## 实体总览（业务模型）

```text
Family ──┬── Person（真实家庭人物，不等于登录账号）
         ├── User（登录账号，role: admin | editor | contributor | viewer）
         ├── FamilyInvitation（邀请账号的短期 bearer capability）
         ├── Asset（原始素材 + 衍生物）
         ├── InboxItem（收件箱待整理项）
         ├── UploadSession（有期限的临时传输状态）
         ├── ImportSession / Item（耐久批量导入与来源关系）
         ├── MemoryEvent（核心：记忆事件）
         ├── ContributionRequest / PortalSubmission（受限访客投递）
         ├── ReviewPeriod / Event（每周回顾与人工重点）
         └── Capsule（时间胶囊）
```

## Family（#003 已落地：`db/schema/family.ts`）

```ts
type Family = {
  id: string            // UUID
  name: string          // 1–50 字
  timezone: string      // IANA 时区，默认 Asia/Shanghai；#006 起解释无时区的 EXIF 时间
  childLaterUnlockAge: number
  weekStartsOn: number              // 0=Sunday … 6=Saturday
  reviewReminderWeekday: number     // 家庭时区中的提醒星期
  reviewReminderLocalTime: string   // HH:mm 家庭墙钟
  remindPendingInbox: boolean
  remindPendingRequests: boolean
  remindUpcomingCapsules: boolean
  createdAt: Date
  updatedAt: Date
}
```

周设置随 portable archive 往返；旧 v1/rc.4 归档缺失时安全默认成周一开周、周日 19:30，
三类提醒偏好开启。系统通知权限与已调度 notification ID 只属于具体设备，不在 Family 中。

## Person（#003 已落地）

```ts
type Person = {
  id: string            // UUID
  familyId: string      // FK → family，cascade delete
  displayName: string   // 1–50 字
  relationToChild?: string  // 对孩子的称谓，如「外婆」
  isChild: boolean      // P0 每个家庭至少一个 child Person（onboarding 创建）
  birthDate?: string    // YYYY-MM-DD 本地日历日；child 必填（时间轴年龄基准）
  avatarAssetId?: string    // 暂为普通列，#004 Asset 表落地后升级为 FK
  createdAt: Date
  updatedAt: Date
}
```

Person 不要求有 User：祖辈、孩子都可以先建档参加事件，以后再开账号绑定。`avatarAssetId` 在 P0 保持普通可空列（尚未使用；避免为未用功能做表重建迁移，见 DECISIONS D-008）。

## User（#003 已落地：better-auth user 表 + 业务 FK 列）

```ts
type User = {
  id: string
  familyId?: string   // user.family_id → family.id（onboarding 时写入）
  personId?: string   // user.person_id → person.id（绑定到现实中的自己）
  role: "admin" | "editor" | "contributor" | "viewer"
}
```

不复制第二套认证 User；业务关系全部是显式 FK。`bindUserToPerson` 校验目标 Person 属于同家庭，防跨家庭绑定。migration 0014 增加 `user_person_uidx` partial UNIQUE（仅 `person_id IS NOT NULL`），从数据库边界保证一个现实 Person 最多绑定一个登录账号，同时允许任意数量尚未绑定 Person 的 provisional/恢复账号。

## FamilyInvitation（migration 0014）

```ts
type FamilyInvitation = {
  id: string
  tokenHash: string       // SHA-256 hex；原 token 永不入库
  familyId: string        // FK → family
  role: "admin" | "editor" | "contributor" | "viewer"
  email?: string          // 可选的规范化邮箱约束
  personId?: string       // 可选；必须是同家庭且尚未绑定账号的 Person
  expiresAt: Date
  claimNonce?: string     // 仅服务端内部的短期原子 claim
  claimExpiresAt?: Date
  provisionedUserId?: string // INSERT 前预留的精确 crash-cleanup receipt（故意无 FK）
  usedAt?: Date
  usedByUserId?: string
  revokedAt?: Date
  revokedByUserId?: string
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}
```

`tokenHash` 唯一且固定 64 个十六进制字符；role 有数据库 CHECK。claim nonce 与过期时间必须成对出现。`provisionedUserId` 故意不设 FK：它必须能在 User INSERT 之前落库，并在 claim 重领/撤销后继续作为稳定的 primary-key fencing tombstone；只有邀请成功使用才清空。这样崩溃发生在 INSERT 两侧都能按准确 id 做幂等清理，迟到 writer 也不会生成不同 id 的无追踪账号。邀请不进入灾备导出：它是短期访问凭据而不是家庭记忆；恢复后由管理员重新邀请/绑定账号。

## Asset（#004 已落地：`db/schema/asset.ts`）

```ts
type Asset = {
  id: string                 // UUID
  familyId: string           // FK → family，cascade delete
  type: "image" | "video" | "audio" | "document"

  originalFilename: string   // 上传时的文件名，仅作展示；绝不参与磁盘路径
  mimeType: string
  bytes: number
  sha256: string             // 家庭内唯一（unique(familyId, sha256)），导出时重验
  storageKey: string         // originals/{familyId}/{yyyy}/{mm}/{assetId}.{ext}

  capturedAt?: Date          // 真实发生时间（按 capturedAt 年月分层存放）
  importedAt: Date
  timeSource: "user_confirmed" | "embedded_metadata" | "file_metadata" | "import_time"

  width?: number
  height?: number
  durationMs?: number
  metadataJson?: unknown     // EXIF/容器 metadata 的 JSON 快照，只增不改

  createdByUserId: string    // FK → user
  originalAssetId?: string   // 自引用 FK：衍生物 → 原件（cascade）
  derivativeType?: "thumbnail" | "preview" | "transcode" | "waveform"
  createdAt: Date
}
```

关键约束：

- `capturedAt`（真实发生时间）与 `importedAt`（导入时间）**永不混淆**；时间轴按 `capturedAt` / `occurredAt` 排序。
- `timeSource` 记录时间来源优先级：user_confirmed > embedded_metadata > file_metadata > import_time。
- `sha256` 用于原件去重与导出校验；原件写入后不可覆盖。
- 衍生物通过 `originalAssetId` + `derivativeType` 指回原件，可随时删除重建。

## UploadSession / ImportSession（1.1 M2，migration 0031）

```ts
type UploadSession = {
  id: string
  familyId: string
  userId?: string | null
  captureId: string
  filename: string
  declaredMime: string
  totalBytes: number
  receivedBytes: number
  lastModified?: Date | null
  source: "web" | "native" | "share" | "guest"
  importSessionId?: string | null
  tempStorageKey: string
  status: "created" | "uploading" | "completed" | "cancelled" | "failed" | "expired"
  expiresAt: Date
  finalAssetId?: string | null
  finalInboxItemId?: string | null
}

type ImportSession = {
  id: string
  familyId: string
  source: "web" | "native" | "share" | "guest"
  status: "collecting" | "uploading" | "reviewing" | "completed" | "cancelled"
  totalCount: number
  completedCount: number
  failedCount: number
  defaultTitle?: string | null
  defaultOccurredAt?: Date | null
  defaultLocationText?: string | null
  createdByUserId?: string | null
}

type ImportSessionItem = {
  id: string
  familyId: string
  importSessionId: string
  captureId: string
  filename?: string | null
  declaredMime?: string | null
  totalBytes?: number | null
  lastModified?: Date | null
  clientFingerprint?: string | null
  uploadSessionId?: string | null
  assetId?: string | null
  inboxItemId?: string | null
  status: "pending" | "uploading" | "completed" | "failed" | "cancelled"
  errorCode?: string | null
  sortOrder: number
}
```

- `UploadSession` 是服务器拥有的临时状态：路径使用随机 `tempStorageKey`，不接受客户端路径；
  磁盘实际长度与数据库 offset 在加锁后安全对账。它会过期清理，不进入 portable archive。
- `ImportSession` 是用户可见的耐久批次；默认人物使用
  `import_session_default_participant` 关系表，item 通过外键关联 transfer、Asset 与 InboxItem。
- 恢复时保留批次、声明、排序、最终 Asset/Inbox 关系和单项结果，但不恢复临时 transfer；
  `uploadSessionId` 置空，创建者映射为恢复 operator。document 与其他完成原件保持原 SHA-256。

## InboxItem（#007 已落地：`db/schema/inbox.ts`）

```ts
type InboxItem = {
  id: string
  familyId: string           // FK → family
  kind: "text" | "asset" | "bundle"   // bundle = 多 asset 合并项（#010）
  status: "new" | "processing" | "needs_review" | "confirmed" | "discarded"
  rawText?: string           // kind=text 的正文
  draftTitle?: string        // 用户整理中的标题草稿
  draftOccurredAt?: Date     // 用户整理中的发生时间；不改写 Asset.capturedAt/importedAt
  draftLocationText?: string // 用户整理中的地点草稿
  createdAt: Date
  updatedAt: Date
}
```

- Asset 关联走 **inbox_item_asset** 关联表（inboxItemId + assetId + familyId），不塞 JSON。
- migration 0029 增加 **inbox_item_participant** 关系表；标题、发生时间、人物和地点的快速
  修改会耐久保存为收件箱草稿，确认或合并时仍统一调用现有记忆 service 完成验证与入档。
- 上传后一律先进收件箱；`timeSource=import_time`（缺少真实时间）的条目自动标 `needs_review`。
- 废弃（discarded）只改条目状态，**Asset 原件永远保留**。
- PRD 中的 `suggested*` / `aiResultJson` 是 AI 时代字段，P0 未建列（NullMemoryAssistant 不产出建议），P1 接 AI 时再迁移加入。

## MemoryEvent（#008 已落地：`db/schema/memory.ts`）

```ts
type MemoryEvent = {
  id: string
  familyId: string            // FK → family
  childPersonId: string       // FK → person（isChild）
  title: string               // 1–100 字
  occurredAt: Date            // 默认取最早可信 capturedAt，绝不是 importedAt
  occurredAtPrecision: "exact" | "approximate" | "date_only"
  locationText?: string
  coverAssetId?: string       // FK → asset（set null）
  status: "draft" | "confirmed" | "hidden"   // 确认后默认 confirmed
  ageDays?: number            // 满天数快照（展示永远现算，见 lib/memories/age.ts）
  milestoneType?: "first_time" | "growth" | "family" | "learning" | "celebration" | "other"
  isPinned: boolean           // 仅影响节点/首页展示，不改变事件身份或档案语义
  createdAt: Date
  updatedAt: Date
}
```

**关系表**（不塞 JSON）：`memory_event_asset`（event↔asset）、`memory_event_participant`（event↔person，参与人默认含孩子本人）。确认收件箱条目 = 一个事务里建事件 + 建关系 + InboxItem 置 confirmed；Assets 只关联不复制。

### 重新遇见与成长节点（migration 0030）

成长节点仍是普通 `MemoryEvent`，只增加可选展示分类 `milestoneType` 和 `isPinned`；内置模板
不会创建第二套事件，也不承载喂奶、睡眠等高频照护数据。家庭回顾按 Family IANA 时区从
confirmed、`deletedAt IS NULL` 的事件计算同月同日、一个月前、百天前与一年前，不新增持久表。
portable archive v1 以可选字段携带节点信息；旧归档缺字段时恢复为 `null / false`。

### memory_event_revision（v0.1.3 已落地）

```ts
type MemoryEventRevision = {
  id: string
  familyId: string           // FK → family（隔离）
  memoryEventId: string      // FK → memory_event（cascade）
  editedByUserId?: string    // FK → user（set null）
  snapshotJson: string       // 编辑前快照：title/occurredAt/precision/locationText/cover/child/participants/ageDays
  createdAt: Date
}
```

每次 `updateMemoryEvent` 在同一事务写入「编辑前快照」；事件页「编辑历史」折叠区展示；不随导出/恢复流转（实例本地审计）。

### audit_log（v0.1.3 已落地）

```ts
type AuditLog = {
  id: string
  familyId: string           // FK → family（隔离）
  kind: "export.created" | "restore.completed"
  actorUserId?: string       // FK → user（set null；CLI 恢复时为 operator）
  detailJson: string         // { fileName?, bytes?, assetCount? } / { zipBytes?, people?, assets?, events?… }
  createdAt: Date
}
```

best-effort 写入（审计失败不阻断导出/恢复）；设置页「最近操作」消费。

## AssetTranscript（M3-A 已落地：`db/schema/transcript.ts`）

```ts
type AssetTranscript = {
  id: string
  familyId: string        // FK → family，cascade delete
  assetId: string         // FK → asset，cascade delete；unique(assetId)
  language?: string       // 转录语言（如 'zh'），nullable
  provider: string        // providerId（如 'openai-compatible'）
  model: string           // 实际使用的模型
  rawTranscript: string   // 机器转录原文，可重建
  editedTranscript?: string // 用户修订后的耐久文本
  segmentsJson?: string   // JSON [{startSeconds,endSeconds,text}]
  status: "machine" | "user_edited"
  sourceSha256: string    // 处理时 asset.sha256 的快照
  createdByJobId?: string // 产生本次 machine 结果的 ai_job.id
  createdAt: Date
  updatedAt: Date
}
```

- 每 asset 最多一行 transcript；rerun 时 UPSERT，但永不覆盖 `editedTranscript`。
- `status='machine'` 表示当前显示的是机器文本；一旦用户保存修订，`status='user_edited'` 且后续 AI rerun 保持该状态。
- 旧 `contribution.transcript` 列是占位且未使用的，新表是权威来源。

## AssetAnalysis（M3-B 已落地：`db/schema/analysis.ts`）

```ts
type AssetAnalysis = {
  id: string
  familyId: string        // FK → family，cascade delete
  assetId: string         // FK → asset，cascade delete；unique(assetId)
  description: string     // 机器生成的图片描述（客观可见内容）
  ocrText?: string        // 图中文字（无则为 null）
  provider: string        // providerId
  model: string           // 实际使用的模型
  sourceSha256: string    // 处理时原始 asset.sha256 的快照
  analyzedVia: "original" | "thumbnail" | "video_frames"  // 实际送入 provider 的输入形态
  createdByJobId?: string // 产生本次 machine 结果的 ai_job.id
  createdAt: Date
  updatedAt: Date
}
```

- 每 asset 最多一行 analysis；rerun 时 UPSERT 全字段。
- 只接受原始图片 asset（`originalAssetId IS NULL`）。
- 若原图 MIME（JPEG/PNG/WebP/GIF）直接被 vision provider 接受，则分析原图（`analyzedVia='original'`）；否则使用同 asset 的 thumbnail 衍生物（`analyzedVia='thumbnail'`）；既不接受又无 thumbnail 则拒绝。
- M3-G 视频理解：`analyze.asset_video.v1` 用 ffmpeg 抽代表帧（≤30s 取 3 帧、更长最多
  6 帧，单帧最大边 1280px、合计 ≤12 MiB），逐帧 vision 后汇总为一行
  `analyzedVia='video_frames'` 的 analysis。整段视频绝不发送给 provider；帧是内存中
  的临时输入，不落成 asset 行。ffmpeg 缺失 → `ffmpeg_unavailable` 非重试失败，原件不受影响。
- 结果是可再生衍生物：**不进入 portable family archive**，不写入 `facts.json`，恢复端不会重建该表；UI 必须始终标注「AI 生成 · 未确认」。

## Contribution（#012 已落地：`db/schema/contribution.ts`）

```ts
type Contribution = {
  id: string
  memoryEventId: string     // FK → memory_event
  authorPersonId: string    // FK → person（作者是 Person，不要求有 User）

  rawText?: string          // 原稿
  audioAssetId?: string     // FK → asset（set null）
  transcript?: string       // P1 转录
  editedText?: string       // 定稿（编辑只改自己的行，原稿保留）

  visibility: "private" | "parents" | "family" | "child_later"
  createdAt: Date
  updatedAt: Date
}
```

行级独立：妈妈编辑自己的 contribution 永远不会覆盖爸爸的行。爸爸登录也可以替外婆记录「外婆说」（authorPersonId=外婆）。

## Fact（#012 已落地，P0 手工；M3-C 增加来源）

```ts
type Fact = {
  id: string
  memoryEventId: string    // FK → memory_event
  statement: string        // 1–500 字
  status: "ai_suggested" | "user_confirmed" | "rejected"
  confidence?: number
  createdAt: Date
  updatedAt: Date
}
```

P0 只允许用户手工创建（直接 `user_confirmed`）；M3-C 起 AI 产出 `ai_suggested`，
永不自动升级。每张 fact 必须有且仅有一行 `fact_source`（见下），手工创建时
`sourceType='user_text'`、`sourceId=null`。

## FactSource（M3-C 落地，M3-D 扩展精确 locator：`db/schema/suggestion.ts`）

```ts
type FactSource = {
  id: string
  familyId: string         // FK → family，cascade delete
  factId: string           // FK → fact，cascade delete
  sourceType: "asset" | "asset_analysis" | "contribution" | "transcript" | "user_text"
  sourceId?: string | null // asset/asset_analysis→asset id；contribution/transcript→行 id；user_text 为 null
  quote?: string | null    // ≤300 字；创建时逐字验证于来源文本（引文锁）
  startMs?: number | null  // transcript segment 起始毫秒（服务端推导，不信任模型自报）
  endMs?: number | null    // transcript segment 结束毫秒
  createdAt: Date
}
```

- 每条 fact 必须有来源；引用全部失效的 AI 事实在 handler 内整条丢弃。
- AI prompt 只暴露 T#/A#/C# 一次性别名（`lib/facts/source-refs.ts`），内部行 id
  绝不进入模型上下文；编造别名/非逐字引文一律拒绝。
- `asset_analysis` 的 `sourceId` 指向 durable 的 asset id（分析行是可重建 derivative，
  灾难恢复后引用仍可解析）；OCR/视觉描述引文逐字验证于该素材最新分析。
- locator 在事实创建时固化：STT rerun / transcript 编辑不会改写已确认事实的来源。
- 随家庭 archive 完整导出（`fact-sources.json` 含 quote/startMs/endMs）/恢复。

## MemoryEventTag（M3-C 已落地：`db/schema/suggestion.ts`）

```ts
type MemoryEventTag = {
  id: string
  familyId: string         // FK → family，cascade delete
  memoryEventId: string    // FK → memory_event，cascade delete
  tag: string              // 小写、trim、1–50 字符
  createdAt: Date
}
```

- `(memoryEventId, tag)` 唯一索引阻止同一事件重复标签。
- 标签随 `memories.json` 的 `tags` 数组导出/恢复。

## AiSuggestion（M3-C 落地；M3-E 扩展：`db/schema/suggestion.ts`）

```ts
type AiSuggestion = {
  id: string
  familyId: string         // FK → family，cascade delete
  entityType: "memory_event" | "inbox_item"
  entityId: string         // memoryEventId 或 inboxItemId
  suggestionType: "title" | "location" | "occurred_at" | "person" | "tag"
  valueJson: string        // 结构化建议值；occurred_at 为 { occurredAt, precision }
  provider: string
  model: string
  status: "pending" | "accepted" | "rejected"
  createdByJobId?: string  // ai_job.id
  sourceFingerprint: string// 入队时来源内容指纹
  createdAt: Date
  resolvedAt?: Date
  resolvedByUserId?: string
}
```

- 运维/可重建状态：只保存当前待审建议与接受/拒绝墓碑，不进入 portable family archive。
- 同一实体的 rerun 会删除旧 pending 建议并插入新建议（单推荐方案）。
- 接受 title/location/occurred_at（memory_event）时复用 `updateMemoryEvent` 的验证与
  修订快照逻辑——时间轴自动重排、child age 重算；`occurred_at` 附带精度
  `exact|approximate|date_only`，不确定的时间绝不写成 exact。AI 永远不触碰
  `asset.capturedAt/importedAt`。
- inbox_item 建议（`suggest.inbox_item.v1`）只做确认表单预填；接受仅记录采用审计，
  条目确认/丢弃时 pending 建议随之落定（accepted/rejected）。

## ClusterSuggestion（M3-F 已落地：`db/schema/clusters.ts`）

```ts
type ClusterSuggestion = {
  id: string
  familyId: string         // FK → family，cascade delete
  kind: "time_proximity" | "similar_media" | "live_photo_pair"
  inboxItemIdsJson: string // 成员 inbox item id 的 JSON 数组（排序后作为去重 key）
  reasonText: string       // 可解释理由（如“拍摄于 N 分钟内”“感知哈希距离 ≤5”）
  status: "pending" | "accepted" | "dismissed"
  createdAt: Date
  resolvedAt?: Date
  resolvedByUserId?: string
}
```

- 完全本地、无 AI 的收件箱分簇（时间邻近 45 分钟窗 / dHash 感知相似 / Live Photo
  同名配对 3 秒窗）；扫描上限 200 条目、500 张待哈希图片。
- 非破坏性：accept 走既有 `mergeInboxEntries`；dismiss 留墓碑，同组成员组合不会在
  重扫时复活；成员离开收件箱后 pending 建议被清理。
- 运维状态，不进入 portable family archive。

## AI Processing Consent 与 Job Queue（migration 0016）

AI foundation 新增 5 张运维表：

- `ai_processing_consent`：family + capability 唯一；保存启用状态、是否允许自动
  处理 family-visible 内容、Provider/model、披露版本、递增 consent version 与
  approve/revoke actor。只有当前家庭未禁用 admin 可改变；配置变化不会继承同意。
- `ai_job`：family-scoped 状态机（pending/running/completed/failed/cancelled），
  保存 job/entity/capability、服务器派生的 Provider/model、trigger mode、聚合
  visibility、幂等键、attempt/lease、取消请求和安全错误 code。
- `ai_job_source`：受控 source kind（Asset/Contribution/MemoryEvent）、source id 与
  enqueue 时内容 SHA-256/fingerprint；行不可单独修改或删除。
- `ai_job_attempt`：每次 fenced lease 的 worker、generation、Provider/model、结果
  状态和安全错误 code；terminal attempt 不可变。
- `ai_worker_heartbeat`：仅保存 worker id/version/status/timestamps，不保存主机路径、
  命令行或环境变量。

关键约束：

- `payload_json` 永远是 `{}`，`output_json` 只能为 `NULL`/`{}`；家庭正文、媒体、
  secret 与 Provider response 不得放入 queue。
- automatic job 只允许完全 `family` 可见来源；其他 visibility 必须逐项手工触发，
  并在 claim/renew/finalize 再次通过当前查看者策略。
- 外部 job 绑定 Provider/model、disclosure version 和 consent version；账号、角色、
  guardian、visibility、source fingerprint、配置或同意漂移时原子取消。
- job 完成与衍生结果写入必须共享一个 IMMEDIATE transaction；lease generation
  fencing 阻止已过期 worker 迟到提交。
- failed/cancelled 的“重试”创建新 job，旧 terminal job 保留；幂等键防止双击重复。

这些表是实例运维衍生状态，不进入 portable family archive；恢复后的新实例不会
自动恢复外部处理同意，管理员必须按新实例的 Provider/model 重新确认。将来的用户
编辑 transcript、confirmed Fact、published Story 等仍是 durable family data，必须
由各自模型和 export/restore 版本完整保存。

## Capsule（#013 已落地：`db/schema/capsule.ts`）

```ts
type Capsule = {
  id: string
  familyId: string          // FK → family
  title: string
  unlockType: "date" | "age"
  unlockValue: string       // date: YYYY-MM-DD（严格日历日）；age: 岁数
  status: "draft" | "sealed" | "opened"
  sealedAt?: Date
  openedAt?: Date
  createdAt: Date
  updatedAt: Date
}
```

- 解锁判定：date = 家庭时区当日零点起；age = `calendarDiff(child.birthDate, now).years >= N`。
- 内容通过 **capsule_asset / capsule_event / capsule_contribution** 关联表挂载；draft 可增删，sealed 后锁定。
- **封存不是物理加密**：sealed 且未解锁时普通查询只返回元信息与空内容；普通查询必须携带实时查看者快照并过滤 Contribution visibility。唯一完整读取入口 `getCompleteCapsuleDetailForDisasterExport(...)` 只供已验证管理员权限的灾难导出/备份使用（#014 依赖此语义）。

## Story（P1，事实锁 PRD §14）

```ts
type StoryParagraph = {
  text: string
  sourceFactIds: string[]
  sourceContributionIds: string[]
  generatedByAI: boolean
}
```

Story 保留段落级来源，UI 可一键查看“这句话来自哪里”。

## Story / StoryParagraph / StorySource（M4 已落地：`db/schema/story.ts`，migration 0024）

```ts
type Story = {
  id: string
  familyId: string          // FK → family
  kind: "weekly" | "monthly" | "yearly"
  periodStart: Date         // 覆盖窗口 [start, end)
  periodEnd: Date
  title: string             // 1–100 字
  status: "draft" | "edited" | "published"
  editedAt?: Date | null    // 首次用户编辑时间：非空即受再生保护
  publishedAt?: Date | null
  publishedByUserId?: string | null
  createdByJobId?: string | null
  createdAt: Date
  updatedAt: Date
}

type StoryParagraph = {
  id: string
  familyId: string
  storyId: string           // FK → story，cascade
  position: number          // 0 起有序
  kind: "narrative" | "quote"
  text: string              // ≤2000 字
  createdAt: Date
  updatedAt: Date
}

type StorySource = {
  id: string
  familyId: string
  paragraphId: string       // FK → story_paragraph，cascade
  sourceType: "fact" | "contribution" | "transcript" | "user_text"
  sourceId?: string | null  // fact/contribution/transcript 行 id；user_text 为 null
  quote?: string | null     // quote 段落的逐字引文（与段落文本一致）
  createdAt: Date
}
```

- 状态机：draft →（任何用户编辑）→ editedAt 落库 → published；published 后整篇不可改。
- 再生保护：regenerate 替换「未编辑」草稿；已编辑/已发布版本另立新草稿，永不覆盖。
- Quote Lock（服务层强制，不靠 prompt）：quote 段落创建时文本必须能在其
  contribution/transcript 来源当前文本中逐字找到，且创建后不可编辑（只能删除）；
  narrative 与手写段落禁止出现引号字符「」“”。
- 生成输入白名单：user_confirmed Fact + family 可见 Contribution + 用户修订 Transcript
  + 手写文字；ai_suggested 事实与 private/parents/child_later 讲述永不进入故事。
- 导出/恢复：edited/published（用户产出的）故事随 `stories.json`/`story-paragraphs.json`/
  `story-sources.json` 往返；纯 draft 是可重建 derivative，不导出。published 故事进入
  全文搜索索引。

## SearchIndex（M4 已落地：migration 0023，FTS5 虚拟表）

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
  tokens,                    -- CJK bigram + 拉丁词的预分词列（索引列）
  original_text UNINDEXED,   -- 原文（高亮/单字 LIKE 回退）
  family_id UNINDEXED,       -- 家庭隔离
  entity_type UNINDEXED,     -- memory_event | fact | contribution | transcript | story
  entity_id UNINDEXED,
  event_id UNINDEXED,        -- 非事件行指向其 memory_event（过滤/跳转）
  visibility UNINDEXED,      -- contribution 可见性（查询后过滤）
  author_person_id UNINDEXED,
  child_person_id UNINDEXED
);
```

- 完全离线的 derivative：`npm run search:rebuild` 全量重建；恢复完成后自动重建。
- 只索引 user_confirmed Fact（rejected/ai_suggested 不入索引）、family 域事件标题、
  全部 Contribution（查询时按可见性策略后过滤，绝不泄漏）、用户修订 Transcript、
  published Story（标题 + 段落）。
- 中文支持：索引与查询两侧 bigram 预分词（`lib/search/tokenizer.ts`），≥2 字词/词组/
  英文单词走 FTS MATCH，单字中文回退 LIKE。

## ContributionRequest / Submission（M5 已落地：`db/schema/oral-history.ts`，migration 0025）

```ts
type ContributionRequest = {
  id: string
  familyId: string          // FK → family
  tokenHash: string | null  // 256-bit token 的 SHA-256；恢复后的 closed portal 为 null
  kind: "request" | "portal"
  title?: string | null     // portal 展示标题
  recipientLabel: string    // 展示给访客的称呼（1–50 字），不暴露家庭数据
  recipientPersonId?: string | null // migration 0030；可选同家庭 Person，用于人物主页聚合
  promptText: string        // 问题正文（1–500 字，来自问题库或自拟）
  topicKey?: string | null  // 内置十主题 key；自拟为 null
  status: "open" | "paused" | "closed"
  maxSubmissions: number
  maxFilesPerSubmission: number
  allowImages / allowAudio / allowVideo / allowDocuments: boolean
  allowText / allowBrowserRecording / allowGuestName / allowReuse: boolean
  expiresAt: Date           // 过期即时失效
  closedAt?: Date | null
  closedByUserId?: string | null
  createdByUserId: string
  createdAt / updatedAt: Date
}

type ContributionRequestSubmission = {
  id: string
  familyId: string
  requestId: string          // FK → contribution_request
  inboxItemId: string        // FK → inbox_item：审核状态由收件箱派生，不冗余
  createdAt: Date
}
```

- 访客只能看到 recipientLabel + promptText；提交（文字/音频/照片/视频）落收件箱
  审核队列，绝不直接发布。
- 限流：每链接 5 条/小时；每家庭打开链接上限 20。
- 1.1 已将 request/portal 配置及 submission bundle 纳入 portable archive；原 token/hash、
  creator/closer User ID 与 live 状态不导出，恢复后一律 `closed` 且 `tokenHash=null`。
- `recipientPersonId` 写入前必须验证 Person 属于请求的 family；它只关联邀请和人物主页，
  不改变匿名访客可见字段，也不把 Person 数据暴露给访客。

### ContributionPortalSubmission（1.1 M5，migration 0033）

```ts
type ContributionPortalSubmission = {
  id: string
  familyId: string
  requestId: string          // FK → kind=portal 的 contribution_request
  importSessionId: string    // UNIQUE FK → guest ImportSession
  guestDisplayName?: string | null // 访客填写、未经确认，不是 Person FK
  status: "collecting" | "completed"
  completedAt?: Date | null
  createdAt: Date
}
```

- 一个 submission 是一次多素材 bundle；文字与文件通过 `ImportSessionItem` 关系表关联，
  每份原件仍各自进入 Inbox。
- `ImportSessionItem` 为文件声明保留 filename、declaredMime、totalBytes、lastModified 与可选
  clientFingerprint；即使 transfer 建立失败也能在同一 captureId 下验证重试，声明变化返回冲突。
- migration 0033 在重建 `contribution_request` 前显式保存并恢复既有
  `contribution_request_submission`；真实 rc.4 前缀升级测试同时执行 integrity/FK check，
  防止 SQLite 事务内 `PRAGMA foreign_keys=OFF` 无效导致级联丢行。

## FutureQuestion / CapsuleReply（M5 已落地：`db/schema/capsule.ts`，migration 0026）

```ts
type FutureQuestion = {
  id: string
  familyId: string
  capsuleId: string          // FK → capsule，cascade
  questionText: string       // 1–500 字；draft 阶段可增删，封存即固化
  createdByUserId: string
  createdAt: Date
}

type CapsuleReply = {
  id: string
  familyId: string
  questionId: string         // FK → future_question，cascade
  capsuleId: string
  authorPersonId?: string | null
  text?: string | null       // ≤10000 字；与 assetId 至少其一
  assetId?: string | null    // 可选录音/照片/视频原件
  createdAt: Date
}
```

- 回答仅在胶囊解锁后接受；回答是增量行，封存历史内容永不改变。
- durable：`capsule-questions.json` / `capsule-replies.json` 随 archive 导出/恢复。

## BackupRun（M6 已落地：`db/schema/backup.ts`，migration 0027）

```ts
type BackupRun = {
  id: string
  familyId: string
  status: "pending" | "running" | "succeeded" | "failed"
  remotePath: string         // 仅 host+path 会展示；凭据只存 env
  bytes?: number | null
  sha256?: string | null
  strategy?: "verified-upload" | "direct-upload" | null
  error?: string | null
  attempts: number
  triggeredByUserId?: string | null
  startedAt: Date
  finishedAt?: Date | null
}
```

- WebDAV 凭据（WEBDAV_URL/USERNAME/PASSWORD）只从环境变量读取，不入库、
  不导出、不下发客户端；错误信息经测试验证不含凭据。
- 流程：verified export → 临时上传 → 回读 SHA-256 → 原子 MOVE（降级直传如实记录）。

## 原生领域离线缓存（1.1 M6，本机 SQLite）

人物、故事、胶囊、口述问题、家庭投递箱和服务器 ImportSession 不复制一套本机领域模型；它们
以有版本的最小列表/详情 DTO 存入 `meta` key，由服务器关系表继续作为权威来源。各领域独立更新，
失败不会清空已有 DTO 或时间轴完整快照。口述史/portal 的原始 token 不写入缓存；本机持久
`local_import_session` / `local_import_item` 仍负责无服务器时的 Share/Files 原件生命周期。

## ReviewPeriod（1.1 M7，migration 0035）

```ts
type ReviewPeriod = {
  id: string
  familyId: string
  periodStart: Date
  periodEnd: Date
  status: "open" | "in_progress" | "completed"
  storyId?: string | null
  startedAt?: Date | null
  completedAt?: Date | null
}

type ReviewPeriodEvent = {
  id: string
  familyId: string
  reviewPeriodId: string
  memoryEventId: string
  selectedByUserId?: string | null
}
```

- `(familyId, periodStart, periodEnd)` 唯一；周期由 `Family.timezone + weekStartsOn` 的本地日历
  计算，DST 周允许是 167/169 个真实小时。
- `ReviewPeriodEvent` 是人工重点关系，`(reviewPeriodId, memoryEventId)` 唯一；服务层只允许同
  家庭、同周期的 confirmed MemoryEvent。
- `Family` 保存周开始日、提醒日/本地时间与三类提醒开关。设备权限和已调度 notification ID
  不是家庭数据，只存原生本机 meta，也不导出。
- `ReviewPeriod.storyId` 指向同周期唯一来源周记。`story_source.sourceType=memory_event` 让结构化
  事件段即使没有 Fact/Contribution 也可追溯；portable archive 已保存 period、人工重点关系
  与 Story 来源，恢复前会拒绝悬空图。

## Trash（M7 已落地：migration 0028）

`memory_event`、`contribution`、`story` 各加可空 `deleted_at`：

- 软删除行在列表/详情/导出/搜索/故事素材/胶囊引用中一律过滤（deletedAt IS NULL）；
- 恢复 = 清除 deleted_at 并重建搜索索引；清除 = 硬删除（事件清除连带其讲述）；
- 素材不因清除被连带物理删除：`purgeAssetIfUnreferenced` 仅在完全无引用
  （事件/收件箱/胶囊/讲述音频/衍生物）时删除文件与行。
