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
         ├── MemoryEvent（核心：记忆事件）
         └── Capsule（时间胶囊）
```

## Family（#003 已落地：`db/schema/family.ts`）

```ts
type Family = {
  id: string            // UUID
  name: string          // 1–50 字
  timezone: string      // IANA 时区，默认 Asia/Shanghai；#006 起解释无时区的 EXIF 时间
  createdAt: Date
  updatedAt: Date
}
```

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

## InboxItem（#007 已落地：`db/schema/inbox.ts`）

```ts
type InboxItem = {
  id: string
  familyId: string           // FK → family
  kind: "text" | "asset" | "bundle"   // bundle = 多 asset 合并项（#010）
  status: "new" | "processing" | "needs_review" | "confirmed" | "discarded"
  rawText?: string           // kind=text 的正文
  createdAt: Date
  updatedAt: Date
}
```

- Asset 关联走 **inbox_item_asset** 关联表（inboxItemId + assetId + familyId），不塞 JSON。
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
  createdAt: Date
  updatedAt: Date
}
```

**关系表**（不塞 JSON）：`memory_event_asset`（event↔asset）、`memory_event_participant`（event↔person，参与人默认含孩子本人）。确认收件箱条目 = 一个事务里建事件 + 建关系 + InboxItem 置 confirmed；Assets 只关联不复制。

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
  analyzedVia: "original" | "thumbnail"  // 实际送入 provider 的媒体来源
  createdByJobId?: string // 产生本次 machine 结果的 ai_job.id
  createdAt: Date
  updatedAt: Date
}
```

- 每 asset 最多一行 analysis；rerun 时 UPSERT 全字段。
- 只接受原始图片 asset（`originalAssetId IS NULL`）。
- 若原图 MIME（JPEG/PNG/WebP/GIF）直接被 vision provider 接受，则分析原图（`analyzedVia='original'`）；否则使用同 asset 的 thumbnail 衍生物（`analyzedVia='thumbnail'`）；既不接受又无 thumbnail 则拒绝。
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

## Fact（#012 已落地，P0 手工）

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

P0 只允许用户手工创建（直接 `user_confirmed`）；P1 起 AI 只能产出 `ai_suggested`，永不自动升级。P0 未建 FactSource 关系表（无来源关联需求），P1 需要时再加。

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
