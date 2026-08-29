# 核心数据模型

> 权威定义来自 `docs/PRD.md` §10；以 `db/schema/` 中的 Drizzle schema 为实现基准，两者必须保持一致。修改数据模型必须创建 migration（PRD §25）。

## 认证表（#002 已落地：`db/schema/auth.ts`）

better-auth 1.7 所需的四张表，字段名与 `getAuthTables()` 一致：

- **user**：`id, name(即 displayName), email(unique), emailVerified, image, role(暂固定 'admin'), createdAt, updatedAt`
- **session**：`id, token(unique), userId→user, expiresAt, ipAddress, userAgent, createdAt, updatedAt`
- **account**：`id, userId→user, accountId, providerId, issuer, accessToken…, password(scrypt 哈希, providerId='credential'), createdAt, updatedAt`
- **verification**：`id, identifier, value, expiresAt, createdAt, updatedAt`

约定：better-auth 的 `user.name` 即 PRD 语境的 displayName；`role` 在 #003 完整建模前由服务端固定写入 `admin`（`input: false`）。**#003 将在本目录加入 Family / Person 等业务表，并建立 User ↔ Person 关联；本 Issue 不预建。**

## 实体总览（业务模型，#003 起）

```text
Family ──┬── Person（真实家庭人物，不等于登录账号）
         ├── User（登录账号，role: admin | editor | contributor | viewer）
         ├── Asset（原始素材 + 衍生物）
         ├── InboxItem（收件箱待整理项）
         ├── MemoryEvent（核心：记忆事件）
         └── Capsule（时间胶囊）
```

## Family

```ts
type Family = {
  id: string
  name: string
  timezone: string
  createdAt: string
}
```

## Person

真实家庭人物，不等于登录账号。

```ts
type Person = {
  id: string
  familyId: string
  displayName: string
  relationToChild?: string
  avatarAssetId?: string
  isChild: boolean
  birthDate?: string
}
```

## User

```ts
type User = {
  id: string
  familyId: string
  personId?: string
  role: "admin" | "editor" | "contributor" | "viewer"
}
```

## Asset

```ts
type Asset = {
  id: string
  familyId: string
  type: "image" | "video" | "audio" | "document"

  originalFilename: string
  mimeType: string
  bytes: number
  sha256: string
  storageKey: string

  capturedAt?: string
  importedAt: string
  timeSource:
    | "user_confirmed"
    | "embedded_metadata"
    | "file_metadata"
    | "import_time"

  width?: number
  height?: number
  durationMs?: number
  metadataJson?: unknown

  originalAssetId?: string
  derivativeType?: "thumbnail" | "preview" | "transcode" | "waveform"
}
```

关键约束：

- `capturedAt`（真实发生时间）与 `importedAt`（导入时间）**永不混淆**；时间轴按 `capturedAt` / `occurredAt` 排序。
- `timeSource` 记录时间来源优先级：user_confirmed > embedded_metadata > file_metadata > import_time。
- `sha256` 用于原件去重与导出校验；原件写入后不可覆盖。
- 衍生物通过 `originalAssetId` + `derivativeType` 指回原件，可随时删除重建。

## InboxItem

```ts
type InboxItem = {
  id: string
  familyId: string
  kind: "text" | "asset" | "bundle"
  status: "new" | "processing" | "needs_review" | "confirmed" | "discarded"

  rawText?: string
  assetIds: string[]

  suggestedTitle?: string
  suggestedOccurredAt?: string
  suggestedPersonIds: string[]
  suggestedTags: string[]

  aiResultJson?: unknown
}
```

所有新素材先进 Inbox，确认后才生成 MemoryEvent；`suggested*` 字段只是建议（可全部为空，无 AI 也正常工作）。

## MemoryEvent

```ts
type MemoryEvent = {
  id: string
  familyId: string
  childPersonId: string

  title: string
  occurredAt: string
  occurredAtPrecision: "exact" | "approximate" | "date_only"

  locationText?: string
  ageDays?: number
  coverAssetId?: string

  status: "draft" | "confirmed" | "hidden"
  createdAt: string
  updatedAt: string
}
```

**关系表单独建立，不把核心关系塞 JSON**：Event-Asset、Event-Person、Event-Tag。

## Contribution

同一事件多个家人独立表达，互不覆盖：

```ts
type Contribution = {
  id: string
  memoryEventId: string
  authorPersonId: string

  rawText?: string
  audioAssetId?: string
  transcript?: string
  editedText?: string

  visibility: "private" | "parents" | "family" | "child_later"
  createdAt: string
}
```

## Fact

```ts
type Fact = {
  id: string
  memoryEventId: string
  statement: string
  status: "ai_suggested" | "user_confirmed" | "rejected"
  confidence?: number
}
```

Fact 与素材/Contribution 的来源另建引用表或结构化 sourceRefs。**AI 建议永远不会自动升级为 `user_confirmed`。**

## Capsule

```ts
type Capsule = {
  id: string
  familyId: string
  title: string
  unlockType: "date" | "age"
  unlockValue: string
  status: "draft" | "sealed" | "opened"
  sealedAt?: string
  openedAt?: string
}
```

胶囊内容（信/声音/照片/视频/事件/给未来的问题）通过单独的关联表挂载。

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
