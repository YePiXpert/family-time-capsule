# 导出格式（EXPORT_FORMAT）

> 本文档定义 `GET /api/export` 产出的 ZIP 结构（Issue #014 实现）与兼容性承诺。
> 恢复流程见 [RESTORE.md](./RESTORE.md)。离开本系统后，ZIP 内的媒体、
> Markdown、JSON 都必须可直接打开/解析（PRD §18）。

## 版本

- 当前 `exportVersion: 1`。
- **兼容承诺**：未来版本只做增量演进——新增字段不删旧字段、不改变既有字段语义；
  任何 `exportVersion: 1` 的导出永远可以被当时的 `verify:export` 校验、
  并被「同大版本」的恢复工具读取。重大不兼容变更将提升主版本号并提供迁移说明。

## 目录结构

```text
family-time-capsule-export/
├── manifest.json          导出清单与每个原件的哈希（见下）
├── family.json            家庭元信息（单对象）
├── people.json            Person 数组（现实家庭成员，含无账号者）
├── memories.json          MemoryEvent 数组（含 assetIds / participantPersonIds / tags 关系）
├── inbox-items.json       InboxItem 全量数组（含所有状态与完整原始文字）
├── inbox-item-assets.json InboxItem ↔ Asset 关联行全量数组
├── import-sessions.json / import-session-default-participants.json / import-session-items.json
│                           耐久导入批次、默认人物与逐项最终关系
├── contribution-requests.json / contribution-request-submissions.json
│                           口述问题/投递箱配置与普通请求提交关系（不含 token）
├── contribution-portal-submissions.json
│                           访客投递 bundle ↔ guest ImportSession
├── review-periods.json / review-period-events.json
│                           每周回顾周期与人工选择的重点事件
├── contributions.json     Contribution 数组（按家人的独立讲述）
├── facts.json             Fact 数组（已确认/否决的事实）
├── fact-sources.json      Fact 来源关联数组（每条 fact 必须有来源）
├── stories.json / story-paragraphs.json / story-sources.json   M4 故事三件套
├── transcripts.json       AssetTranscript 数组（机器转录 + 用户修订）
├── capsules.json          Capsule 数组（含封存胶囊的完整内容引用）
├── timeline.md            人类可读时间轴（相对路径引用原媒体）
├── originals/
│   ├── images/            <assetId>.<ext>
│   ├── audio/
│   ├── video/
│   └── documents/
└── stories/               P1 起存放生成的章节；P0 为空
```

空目录以 `.keep` 占位，保证「没有内容的目录也存在」。

认证、临时传输与 capability 不属于家庭档案，明确不导出：`user`、`account`、`session`、
`verification`、`rate_limit`、`family_invitation`、邀请 token/hash/claim、密码哈希与
setup token、`UploadSession`、临时上传文件、Share Extension 暂存与设备通知状态均不进入 ZIP。
恢复后管理员通过新的邀请重新建立账号与 Person 绑定。

## manifest.json

```jsonc
{
  "exportVersion": 1,
  "appVersion": "1.1.0-alpha.1",  // 产生导出的应用版本（package.json version）
  "exportedAt": "2026-08-29T12:00:00.000Z",
  "familyId": "<uuid>",
  "familyName": "我们一家",
  "fileCount": 32,                 // 固定 25 个非媒体文件 + 7 个原件（不含 .keep）
  "assetCount": 7,
  "assets": [
    {
      "assetId": "<uuid>",
      "relativePath": "originals/images/<uuid>.jpg",
      "sha256": "<hex>",
      "bytes": 123456,
      "mimeType": "image/jpeg",
      "capturedAt": "2026-08-10T01:30:00.000Z",  // null = 未知
      "importedAt": "2026-08-29T04:00:00.000Z",
      // ↓ v0.1.1 增量字段（exportVersion 仍为 1；旧导出缺失时恢复端取默认值）
      "type": "image",
      "originalFilename": "IMG_0001.HEIC",
      "timeSource": "embedded_metadata",
      "width": 4032,
      "height": 3024,
      "durationMs": null,
      "metadataJson": "{...}"        // EXIF/ffprobe 快照原样带回
    }
  ]
}
```

规则：

- `assets` 只包含**原件**（derivativeType=null）；衍生物可再生，不入档。
- 1.1 当前格式固定包含上图 25 个非媒体文件；因此
  `fileCount = assetCount + 25`，`.keep` 不计数。旧 v1 会根据实际成组文件数校验，不能
  伪造当前格式的计数。
- `capturedAt`/`importedAt` 为 UTC ISO-8601。
- 增量字段缺失时的恢复端默认：`type` 按目录名（images/audio/video/documents）推断；
  `timeSource` 按 capturedAt 有无推断（有→embedded_metadata，无→import_time）；
  `originalFilename` 回退 `<assetId>.<ext>`。

## 实体 JSON 语义

- `family.json`：`{ id, name, timezone, childLaterUnlockAge, weekStartsOn,
  reviewReminderWeekday, reviewReminderLocalTime, remindPendingInbox,
  remindPendingRequests, remindUpcomingCapsules, createdAt, updatedAt }`。
  `childLaterUnlockAge` 是 `child_later` 讲述的家庭自动解锁年龄；旧 v1 档案缺失时恢复为 18。
  周设置旧档默认：周一开周、周日 19:30、三类提醒偏好开启；设备通知权限不在归档中。
- `people.json`：`{ id, displayName, relationToChild, isChild, isGuardian,
  birthDate(YYYY-MM-DD|null), childLaterUnlockedAt, createdAt, updatedAt }`。
  `isGuardian` 是显式权限事实，绝不从称谓推断；`childLaterUnlockedAt` 是孩子档案不可逆的
  手工解锁时间。旧 v1 档案缺失两个字段时分别恢复为 `false` / `null`。
  `id` 即 `personId`，被 memories/contributions 引用。
- `memories.json`：按 `occurredAt` 升序；每个事件含
  `assetIds: string[]`、`participantPersonIds: string[]` 与 `tags: string[]`（关系以数组表达，
  对应库内关联表，不丢结构）。标签已做小写/trim/≤50 字符规范化，导出为字符串数组。
- `inbox-items.json`：`{ id, familyId, kind, status, rawText, memoryEventId, createdAt, updatedAt }`。
  导出家庭下的**每一行**，不按状态过滤；`status` 原样保留 `new`（待处理）、
  `processing`、`needs_review`、`confirmed`、`discarded`，`rawText` 保留完整正文，
  不做 100 字截断。`memoryEventId` 可为 `null`；确认或合并后的条目用它指向消费该条目的
  MemoryEvent。
- `inbox-item-assets.json`：`{ id, inboxItemId, assetId, familyId, createdAt }`。
  导出家庭下的**每一条关联行**，包括仍待处理、需复核、已确认或已丢弃条目的素材关系；
  行 ID 与两端引用均原样保留。
- `contributions.json`：`{ id, memoryEventId, authorPersonId, recordedByPersonId,
  recordedByNameSnapshot, recordingMode, rawText, transcript, editedText, audioAssetId,
  visibility, createdAt, updatedAt }`。完整灾难导出不套用日常行可见性过滤，因而
  `private` 与尚未解锁的 `child_later` 都会完整进入归档。`recordedByUserId` 属于本地认证
  身份，明确不导出；Person、姓名快照和记录模式构成可迁移的长期来源信息。
- `facts.json`：`{ id, memoryEventId, statement, status, createdAt }`。
- `fact-sources.json`：`{ id, factId, sourceType, sourceId, quote, startMs, endMs, createdAt }`。
  `sourceType` ∈ `asset | asset_analysis | contribution | transcript | user_text`；
  `asset_analysis` 的 sourceId 指向 durable Asset。`quote`（≤300）及 transcript 的
  `startMs/endMs` 在事实确认时固化；旧归档缺 locator 时按 null 恢复。
- `stories.json` / `story-paragraphs.json` / `story-sources.json`（M4 起，additive）：
  只含 durable 故事（`status='published'` 或 `editedAt != null`；纯 draft 不导出）。
  段落 `{ id, storyId, position, kind: narrative|quote, text }`；来源
  `{ id, paragraphId, sourceType: fact|contribution|transcript|user_text|memory_event,
  sourceId, quote }`。`memory_event` 是无 AI 周记结构化事件段的可追溯来源。
  恢复端校验来源引用存在、quote ≤300、user_text 无 sourceId；三件套必须同时存在或缺失。
- `transcripts.json`：`{ id, familyId, assetId, language, provider, model,
  rawTranscript, editedTranscript, segmentsJson, status, sourceSha256,
  createdByJobId, createdAt, updatedAt }`。同时导出机器原文与用户修订文本；
  恢复后的新实例不会自动恢复 AI 处理同意，因此 rawTranscript 可作为可重建
  衍生，而 editedTranscript 是耐久家庭资料。
- `capsules.json`：`{ id, title, unlockType, unlockValue, status, sealedAt, openedAt,
  memoryEventIds, assetIds, contributionIds }`。**无论是否到期/封存，内容引用始终完整**——
  封存是 UI 仪式，不是加密（PRD §15）。
- `import-sessions.json` 保存来源、状态、计数、批次默认标题/发生时间/地点与时间戳；创建者
  User ID 不导出。`import-session-default-participants.json` 保存同家庭 Person 关系；
  `import-session-items.json` 保存不可变文件声明、captureId、排序、状态/错误以及最终
  Asset/Inbox 引用。临时 `uploadSessionId` 不导出。
- `contribution-requests.json` 保存 request/portal 的展示配置、目标 Person、有效期和限额开关，
  但明确不含 token/hash、creator/closer User ID 或 live status。
  `contribution-request-submissions.json` 保存普通回答与 Inbox 的关系；
  `contribution-portal-submissions.json` 保存 portal、guest ImportSession、访客自填未确认称呼
  和 bundle 状态。恢复时所有 request/portal 强制 closed，必须人工换发新 token。
- `review-periods.json` 保存家庭周界、流程状态与可选 Story；`review-period-events.json` 保存
  人工选择的 MemoryEvent。`selectedByUserId` 不导出，恢复后为空。

确认文字条目的正文仍属于 `inbox-items.json`，并通过可空的 `memoryEventId` 关联到事件。
事件详情把这些 `rawText` 显示为**无作者的原始文字记录**；系统不会为了显示正文而虚构
Contribution 或讲述者。合并到同一事件的多条文字也各自保留为独立行。

### 收件箱与转录文件的增量兼容

- 当前导出始终同时写入 `inbox-items.json` 与 `inbox-item-assets.json`，即使数组为空。
- 两个文件是在 `exportVersion: 1` 上的增量扩展。较早的 v1 归档可能两者都不存在；恢复端
  将其解释为“空收件箱”，仍可恢复。
- 若归档只缺其中一个文件，条目与素材关系可能不完整，恢复端会拒绝，而不会静默丢行。
- `transcripts.json` 是 `exportVersion: 1` 上的另一项增量扩展。较早的 v1 归档可能不存在
  该文件；恢复端将其解释为“空转录”，仍可恢复。若归档存在该文件，必须是数组，且每行
  `assetId` 必须引用 manifest 中的原件。
- `fact-sources.json` 是 `exportVersion: 1` 上的另一项增量扩展。较早的 v1 归档可能不存在
  该文件；恢复端将其解释为“空来源”，仍可恢复。若归档存在该文件，必须是数组，每行
  `factId` 必须引用 `facts.json` 中的事实，`sourceType` 必须在限定白名单内。
- 八份 1.1 关系文件（3 份 Import、3 份 Request/Portal、2 份 Review）是一个原子兼容组：
  旧 v1/rc.4 归档八份都没有时恢复为空关系并采用安全默认值；当前归档八份都存在（可为空数组）。
  只缺任意一份表示关系图不完整，恢复端必须在写原件前拒绝。

## timeline.md

- 一级标题 = 家庭名；按家庭时区年月分组；事件含日期、孩子年龄（由
  `people.json` 的 child `birthDate` 现算）、参与人。
- 媒体引用一律是**相对路径**（`originals/images/xxx.jpg`），解压后在本目录内有效。
- 图片内联为 Markdown 图片；音频/视频为链接（Markdown 阅读器外直接双击文件播放）。

## 校验

- 导出时：服务端**重读磁盘重算 SHA-256** 并与数据库比对，不符则整个导出失败（HTTP 409）。
- 导出后：`npm run verify:export <zip路径>` 独立校验 manifest 与 ZIP 内容（见 RESTORE.md）。

## 1.2 相册模块（增量）

新增 `collections.json`、`collection-sections.json`、`collection-items.json`，manifest 声明
`modules.collections=1`。相册切片非媒体文件数为 28（原 25 + 相册 3；年册模块见下节）；三份文件始终成组存在，
数组为空也保留。旧 1.1 档没有模块声明且三文件全无时，恢复为空相册。

完整保存 Collection 的类型、标题、说明、封面、日期范围、排序方式、revision、时间戳/墓碑，
Section 的名称/顺序，以及 Item 的事件 FK、小节 FK、手写说明/顺序。包含被删除相册的编辑。
被相册引用的软删除事件连同 `deletedAt` 进入完整备份，恢复后仍不可日常阅读；不会把丢失来源
静默变成新的已确认记忆。不存在认证 User、登录/分享 token 或临时任务。

## 1.2 BookProject 持久编辑模块

新增六文件：`book-projects.json`、`book-chapters.json`、`book-blocks.json`、
`book-source-refs.json`、`book-block-sources.json`、`book-revisions.json`。
manifest 声明 `modules.bookProjects=1`，当前非媒体文件共 **34**（原 28 + 年册 6）。
文件组始终完整，空家庭也导出空数组。原件、排序、说明、layoutJson、来源与历史快照保留；
不导出渲染/转换任务、登录 token、设备授权或本机下载缓存。

被年册来源引用的软删除记忆/讲述/故事，以及故事引用的讲述与事实所属事件，会以删除时间
一并导出，以闭合关系图。未被耐久编辑引用的回收站内容沿用既有排除语义。
永久清除的来源以 SourceRef 的空 FK 为墓碑；历史 JSON 可保留当时的来源标识，但阅读以
持久 FK 为准。每个历史来源必须仍对应同一作品的 SourceRef，不能凭空放入缺失关系。

## 1.2 作品出版（PDF / EPUB）

作品页的出版任务输出选定 BookRevision 与读者范围，区别于完整管理员备份：
PDFKit + OFL Noto CJK 字体产生可选择/搜索中文的 A4/A5 PDF，含封面、目录、章分页和页码；
正文不栅格化。图片由原件适配版面，不放大缩略图，不承诺 CMYK/PDF-X 或专业印刷质量。
EPUB 3 优先可重排，含语义标题、正文、导航、图片/替代文字与内嵌样式，EPUBCheck 校验。
音视频只作明确阅读提示；PDF 内不能播放。精选 ZIP 阅读包待离线里程碑。

旧 `/api/books/year/[year]` 和 `/api/books/story/[id]` 保留成功时二进制下载行为，PDF 正文改为
真实文本；忙碌/来源变化返回明确错误。旧路径同样使用当前 FamilyContext 和家庭读者过滤。
出版任务、租约、临时产物与下载凭据不进入家庭档案，BookRevision 则完整保留，恢复后可再排版。

回顾年册不增加新档案模块：人工精选沿用 ReviewPeriodEvent，草稿幂等键/完成状态与独立复制
编辑图使用既有 BookProject 模块导出。章节空月份保持空章，不生成虚构经历。
