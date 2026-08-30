# 核心数据模型

> 权威定义来自 `docs/PRD.md` §10；以 `db/schema/` 中的 Drizzle schema 为实现基准，两者必须保持一致。修改数据模型必须创建 migration（PRD §25）。

## 认证表（#002 已落地：`db/schema/auth.ts`）

better-auth 1.7 所需的四张表，字段名与 `getAuthTables()` 一致：

- **user**：`id, name(即 displayName), email(unique), emailVerified, image, role(暂固定 'admin'), createdAt, updatedAt`
- **session**：`id, token(unique), userId→user, expiresAt, ipAddress, userAgent, createdAt, updatedAt`
- **account**：`id, userId→user, accountId, providerId, issuer, accessToken…, password(scrypt 哈希, providerId='credential'), createdAt, updatedAt`
- **verification**：`id, identifier, value, expiresAt, createdAt, updatedAt`

约定：better-auth 的 `user.name` 即 PRD 语境的 displayName。**#003 已落地**：`user` 表增加业务列 `family_id` / `person_id`（可空 FK——管理员在 `/setup` 阶段尚无家庭，完成 `/onboarding` 后绑定），并以 additionalFields（`input: false`）暴露给会话读取；`role` 在多角色建模前仍由服务端固定写入 `admin`。

## 实体总览（业务模型）

```text
Family ──┬── Person（真实家庭人物，不等于登录账号）
         ├── User（登录账号，role: admin | editor | contributor | viewer）
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
  role: "admin" | "editor" | "contributor" | "viewer"  // P0 仅 admin
}
```

不复制第二套认证 User；业务关系全部是显式 FK。`bindUserToPerson` 校验目标 Person 属于同家庭，防跨家庭绑定。

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
- **封存不是物理加密**：sealed 且未解锁时普通查询只返回元信息与空内容，`getCapsuleDetail(..., { includeLocked: true })` 供管理员导出/备份完整读取（#014 依赖此语义）。

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
