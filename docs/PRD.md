# Family Time Capsule（家庭时间胶囊）产品计划书 v1.0

> 工作名：Family Time Capsule / 家庭时间胶囊
> 定位：一个私人、自托管、可迁移、面向 18 年以上生命周期的家庭成长档案系统。
> 核心原则：**Capture Anywhere, Archive Here —— 随处记录，统一归档。AI 负责整理，家人负责讲述。**

---

## 1. 最关键的产品决策

### 1.1 录音、视频、照片、文字不要求通过本 App 产生

必须支持“后续上传”，而且它与“App 内现场记录”同等重要。

内容可以来自：

- iPhone / Android 原生相机；
- 系统语音备忘录、录音机；
- 手机相册；
- 微信聊天截图或复制出来的文字；
- 电脑硬盘、NAS、文件管理器；
- 以后再接系统“分享给家庭时间胶囊”；
- 未来再做 ZIP、WebDAV、相册导出包等批量导入。

产品不能要求“人生必须在正确的 App 里发生”。

### 1.2 必须区分实际发生时间和导入时间

每个素材至少保存：

```text
capturedAt   内容真正产生/拍摄/录制的时间
importedAt   被导入系统的时间
```

例如：

```text
照片拍摄：2026-09-07 14:32
导入系统：2026-09-10 23:11
```

时间轴按照 `capturedAt` 排序，而不是 `importedAt`。

时间来源优先级：

```text
1. 用户手工确认
2. EXIF / QuickTime / 媒体内嵌 metadata
3. 文件系统时间
4. 导入时间兜底
```

同时保存：

```text
timeSource = user_confirmed | embedded_metadata | file_metadata | import_time
```

### 1.3 原件永远优先

原始照片、视频、音频、文档永远不被缩略图、转码文件、AI 输出覆盖。

```text
原件 = 不可替代证据
预览/缩略图/转码/转录/AI 摘要 = 可再生成衍生物
```

---

# 2. 产品愿景

普通相册保存的是文件，但往往丢掉文件背后的故事；聊天群保存的是片段，但几年后难以检索；AI 日记容易把没有发生过的细节写得像真的。

本产品保存的是：

```text
原始素材
  ↓
可确认事实
  ↓
不同家人的独立视角
  ↓
记忆事件 MemoryEvent
  ↓
成长时间轴
  ↓
周信 / 月章 / 年书 / 时间胶囊
```

十几年以后，女儿应该可以通过这个系统回答：

- 我出生那天发生了什么？
- 爸爸第一次抱我时说了什么？
- 妈妈当时最在意什么？
- 外公外婆年轻时的声音是什么样？
- 我小时候住的家是什么样？
- 我三岁时最常说什么？
- 我第一次上幼儿园那一天，一家人分别怎么看？
- 在我成长的同时，这个家庭发生了哪些变化？

---

# 3. 产品边界

这是一个独立产品，不是其他工具的模块。

本项目不做：

```text
❌ 待产包清单
❌ 喂奶/尿布专业照护统计
❌ 儿童积分商城
❌ 游戏机/电视控制
❌ 公开晒娃社区
❌ AI 医疗建议
❌ 自动逆向读取微信
❌ 第一版人脸识别
❌ 第一版全相册后台扫描
❌ 第一版多家庭 SaaS
```

第一阶段只做一件事：

> **让一个家庭长期、低负担、可信地留下真实成长记忆。**

---

# 4. 核心产品原则

## P1 原件优先

任何 AI 生成内容都不能替代原始资料。

## P2 AI 不拥有记忆

AI 可以：

- 语音转文字；
- OCR；
- 图片理解；
- 提取候选人物、时间、地点；
- 给候选标题；
- 建议几份素材合并为同一事件；
- 生成待确认摘要；
- 后续生成周信、月章、年书。

AI 不可以：

- 编造动作；
- 编造原话；
- 把推测情绪写成事实；
- 把“可能”写成“确定”；
- 把 AI 建议自动升级为用户确认事实。

## P3 先捕获，后整理

记录当下只需要：

```text
说一句
写一句
拍一张
录一段
选已有内容
```

复杂整理在“收件箱”里以后完成。

## P4 一件事允许多个视角

同一事件可以同时保留：

- 爸爸的说法；
- 妈妈的说法；
- 外公的声音；
- 外婆的回忆；
- 女儿长大后的补充。

系统不制造唯一“官方版本”。

## P5 数据必须能离开本系统

至少支持：

- 原始媒体导出；
- JSON；
- Markdown；
- 完整 ZIP；
- 后续 PDF / EPUB；
- 后续 WebDAV / S3 备份。

---

# 5. 第一阶段目标用户

第一阶段只服务一个家庭。

### 家庭管理员
管理家庭空间、成员、备份、权限、导出。

### 爸爸 / 妈妈
主要记录者，创建和编辑记忆事件。

### 祖辈 / 亲属
通过低门槛入口贡献照片、录音、文字，不要求掌握复杂后台。

### 女儿本人
早期是被记录者；未来逐步拥有查看、补充、隐藏、导出和管理自己的资料的权利。

---

# 6. 第一版真实使用场景

第一版以“出生前到出生后 100 天”为首个验证场景，但数据模型不得写死婴儿阶段。

核心验收：

> 即使家里非常忙，也能在 10 秒内保存一个值得留下的瞬间；几天后再整理也不会丢失真实时间和上下文。

---

# 7. 内容进入系统的方式

## 7.1 App / Web 内直接记录

支持：

- 写文字；
- 拍照；
- 选择照片；
- 录音；
- 选择音频；
- 选择视频；
- 上传文档。

“现场拍摄/录制”只是便利功能，不是强制流程。

## 7.2 事后上传（MVP 必须有）

场景：

```text
今天太忙，只用系统相机拍了照片。
三天后晚上再批量导入。
```

系统自动读取：

- 原始文件名；
- MIME；
- 文件大小；
- SHA-256；
- EXIF；
- 拍摄时间；
- 图片尺寸；
- 视频时长；
- 音频时长；
- 能获得的时区信息。

用户可以修正真实发生时间。

## 7.3 系统分享入口（P1）

未来支持：

```text
系统相册 → 分享 → 家庭时间胶囊
语音备忘录 → 分享 → 家庭时间胶囊
文件管理器 → 分享 → 家庭时间胶囊
浏览器/文字 → 分享 → 家庭时间胶囊
```

MVP 不依赖原生 Share Extension；后续可用 Capacitor、React Native/Expo 或独立移动壳实现。

## 7.4 桌面批量导入（P1/P2）

一次选择几十到几百个文件，系统完成：

```text
哈希去重
→ metadata 提取
→ 时间聚类
→ 生成待确认候选事件
```

---

# 8. 一级导航

建议固定 5 个入口：

```text
记录
收件箱
时光轴
家人
胶囊
```

设置、备份、导出放二级菜单。

---

# 9. 页面设计

## 9.1 记录

首页只解决低阻力输入：

```text
今天想留下什么？

[说一句话]
[拍一张]
[录声音]
[选照片/视频]
[写几句]

今天已经留下 3 个瞬间
还有 2 条待确认
```

## 9.2 收件箱

所有新导入内容先进入 Inbox：

```text
待整理 8

AI 已初步整理       3
缺少时间           1
缺少人物           1
可能属于同一事件   2
疑似重复文件       1
```

卡片示例：

```text
候选标题：第一次坐安全座椅回家
时间：2026-09-08 16:18
时间来源：照片 EXIF
人物：女儿、爸爸、妈妈

[修改] [合并] [确认进入时光轴]
```

没有 AI 时，候选标题为空也能正常工作。

## 9.3 时光轴

支持：

### 按日期
```text
2026年9月
2026年10月
```

### 按年龄
```text
出生前
出生当天
第1天
第7天
满月
第100天
1岁
```

### 按章节（P1）
```text
我们等你来
出生
回家
第一个月
第一个100天
```

## 9.4 事件详情

事件是整个产品的核心页面。

```text
第一次回家
2026-09-08 16:18
出生后第3天
北京

参与：爸爸 / 妈妈 / 外婆 / 女儿
```

页面分四块：

1. 原始资料；
2. 已确认事实；
3. 家人视角；
4. AI 整理稿（如果有）。

每条 AI 整理内容必须能查看来源。

## 9.5 家人

每位家人有自己的“声音档案”：

```text
外公
留下 16 条记忆
原始声音 2小时13分
照片 47 张
写给未来的信 3 封
```

## 9.6 胶囊

示例：

```text
写给一岁的你
2027-09-05 开启
爸爸、妈妈、外公、外婆共同留下
已封存

十八岁时打开
2044-09-05 开启
内容仍在收集中
```

MVP 解锁方式：

```text
date
age
```

里程碑解锁后续再做。

---

# 10. 核心数据模型

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

关系表单独建立：Event-Asset、Event-Person、Event-Tag，不把核心关系都塞 JSON。

## Contribution

同一事件多个家人独立表达：

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

Fact 与素材/Contribution 的来源另建引用表或结构化 sourceRefs。

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

---

# 11. 媒体存储

MVP 使用自托管本地文件系统：

```text
/data/
  originals/
    yyyy/mm/
  derivatives/
    thumbnails/
    previews/
    transcodes/
    waveforms/
  exports/
```

数据库只存元数据和 storageKey，不把大媒体作为 BLOB 塞数据库。

### 原件规则

- 不重新压缩后覆盖；
- 不修改原始 EXIF；
- 保存 SHA-256；
- 原件与预览永远分离。

### 衍生物规则

可以生成：

- 图片缩略图；
- Web 预览图；
- 视频封面；
- 音频波形；
- 必要的视频兼容预览。

全部可以删除后重建。

---

# 12. 去重

MVP：

```text
SHA-256 完全相同 → 明确重复原件
```

P1：

- 图片 perceptual hash；
- 视频首帧 + 时长等；
- 相同时间段相似素材提示。

系统只提示，不自动删原件。

---

# 13. AI 规划

AI 必须通过 Provider Adapter，不写死供应商：

```ts
interface MemoryAssistant {
  transcribeAudio(input: Asset): Promise<TranscriptResult>
  analyzeImage(input: Asset): Promise<ImageAnalysisResult>
  suggestMemory(input: MemoryInput): Promise<MemorySuggestion>
  draftStory(input: ConfirmedMemoryEvent[]): Promise<StoryDraft>
}
```

## P0

使用 `NullMemoryAssistant`，完全不接 AI 也能用。

## P1

加入：

- 音频转录；
- OCR/图片描述；
- 标题候选；
- 人物候选；
- 时间候选；
- 标签候选；
- 多素材聚类；
- 周成长信。

## P2

加入：

- 月度/年度章节；
- 家庭口述史问题；
- 语义检索；
- 胶囊回信；
- PDF/EPUB 年书。

---

# 14. 事实锁

AI 生成成长故事时必须遵守：

```text
1. 只使用 user_confirmed Facts 和明确的家人 Contribution。
2. 不加入没有来源的动作。
3. 不擅自推断情绪。
4. 不杜撰引号内原话。
5. 不确定时间必须保留“约”“可能”等限定。
6. 每个段落保存来源 ID。
7. UI 可一键查看“这句话来自哪里”。
```

Story 不只保存最终 Markdown，还应保留段落级来源：

```ts
type StoryParagraph = {
  text: string
  sourceFactIds: string[]
  sourceContributionIds: string[]
  generatedByAI: boolean
}
```

---

# 15. 时间胶囊

“封存”首先是仪式感，不是把家庭管理员自己锁死。

管理员始终可以：

- 备份；
- 恢复；
- 导出；
- 查看胶囊元信息。

未到开启条件，普通 UI 不展示正文。

胶囊可以包含：

- 信；
- 原始声音；
- 照片；
- 视频；
- 记忆事件；
- 给未来的问题。

P1/P2 可以增加：

> 女儿打开胶囊后，录一段“回答过去的家人”，形成跨时间对话。

---

# 16. 权限与隐私

MVP 角色：

| 角色 | 权限 |
|---|---|
| admin | 全部管理、邀请、备份、导出 |
| editor | 创建/编辑事件和故事 |
| contributor | 提交自己的素材和 Contribution |
| viewer | 仅查看允许内容 |

Contribution 可见级别：

```text
private
parents
family
child_later
```

默认不公开，不做搜索引擎索引，不做公开个人主页，不做社交关注。

---

# 17. 安全底线

MVP 至少做到：

- HTTPS；
- 成熟 Auth，不手写认证协议；
- 密码哈希和安全 session；
- 上传 MIME/大小校验；
- 用户文件名不直接作为磁盘路径；
- 媒体 URL 必须鉴权；
- 无公开注册默认开启；
- 关键删除操作二次确认；
- 导出/删除等操作审计。

P1/P2 再做：

- Passkey/TOTP；
- 备份加密；
- S3；
- WebDAV；
- 特殊私密胶囊客户端加密。

---

# 18. 导出与可迁移性

完整导出是 MVP，不是以后再做。

ZIP 建议：

```text
family-time-capsule-export/
├── manifest.json
├── family.json
├── people.json
├── memories.json
├── contributions.json
├── facts.json
├── capsules.json
├── timeline.md
├── originals/
│   ├── images/
│   ├── audio/
│   ├── video/
│   └── documents/
└── stories/
```

要求：

- 不启动本项目也能打开 JPG、MP4、音频、Markdown；
- manifest 记录每个原件的 SHA-256；
- Markdown 使用相对路径引用原件。

---

# 19. 技术架构建议

为了 Vibe Coding 简单可靠，MVP 先单体全栈，不上微服务。

```text
Next.js + TypeScript
Tailwind CSS
成熟组件库（如 shadcn/ui 或等价方案）
SQLite
Drizzle ORM
成熟 Auth 库
Sharp
FFmpeg / ffprobe（增强能力，非核心硬依赖）
Playwright
Vitest
Docker Compose
PWA
```

媒体处理未来复杂后再拆 Worker。

## Asset Storage 必须抽象

```ts
interface AssetStorage {
  putOriginal(...): Promise<StoredAsset>
  putDerivative(...): Promise<StoredAsset>
  open(...): Promise<ReadableStream>
  exists(...): Promise<boolean>
  delete(...): Promise<void>
}
```

MVP：

```text
LocalFilesystemStorage
```

未来：

```text
S3Storage
WebDAVStorage
```

业务层不得直接硬编码具体磁盘目录。

---

# 20. 推荐目录

```text
family-time-capsule/
├── app/
│   ├── capture/
│   ├── inbox/
│   ├── timeline/
│   ├── memories/[id]/
│   ├── family/
│   ├── capsules/
│   ├── settings/
│   └── api/
├── components/
├── db/
│   ├── schema/
│   └── migrations/
├── lib/
│   ├── auth/
│   ├── assets/
│   ├── metadata/
│   ├── memories/
│   ├── ai/
│   ├── export/
│   └── security/
├── jobs/
├── tests/
├── docs/
├── docker/
└── data/        # gitignore
```

---

# 21. MVP 必须有

### 家庭与人物
- 创建家庭；
- 创建女儿档案；
- 创建没有登录账号的家人；
- 登录成员角色管理。

### 内容输入
- 文字；
- 图片；
- 视频；
- 音频；
- 多文件上传；
- 自动读取 capturedAt；
- 手工修正发生时间。

### 原件管理
- SHA-256；
- 原件不覆盖；
- 衍生预览独立保存。

### 收件箱
- 新素材先进入 Inbox；
- 修改标题、时间、人物；
- 多条素材合并成一个 MemoryEvent；
- 确认进入时间轴。

### 记忆事件
- 标题；
- 日期/时间；
- 女儿年龄；
- 人物；
- 原始素材；
- 家人 Contribution；
- 标签；
- 封面。

### 时间轴
- 按真实发生时间排序；
- 显示事件发生时的年龄；
- 进入详情。

### 胶囊
- 创建；
- 加事件/素材/文字；
- 按日期或年龄设置开启条件；
- 封存和打开。

### 数据导出
- JSON；
- Markdown；
- 原件；
- 完整 ZIP。

---

# 22. 开发路线

## P0：可信私人时间轴

目标：**不接任何 AI 也值得用。**

完成顺序：

```text
Auth
→ Family / Person
→ Asset Upload
→ metadata / hash
→ Inbox
→ MemoryEvent
→ Contribution
→ Timeline
→ Capsule
→ Export
→ Docker
```

P0 发布条件：

> 手机/电脑产生的照片、系统录音、视频和文字都能事后导入，保持真实时间，并能合并成完整记忆事件。

## P1：AI 整理员

增加：

- STT；
- OCR/视觉描述；
- 事件标题/事实候选；
- 人物候选；
- 相似素材提示；
- 多素材事件聚类；
- 周成长信；
- 系统分享入口；
- WebDAV 备份。

P1 发布条件：

> 一周集中确认几分钟，就能把散落素材整理成可信的成长周记。

## P2：家庭口述史

增加：

- 给祖辈发送极简贡献链接；
- “今天问外公一个问题”；
- 长语音转写；
- 家庭采访主题；
- 月度/年度章节；
- 语义检索；
- 胶囊回信；
- PDF/EPUB 年书。

---

# 23. Vibe Coding 垂直切片

不要第一轮生成整个系统。

## Slice 1：一张旧照片跑通全链路

```text
登录
→ 创建 Family / Child
→ 上传一张已有照片
→ 保存原件
→ SHA-256
→ 读取 EXIF capturedAt
→ 创建 InboxItem
→ 收件箱显示
→ 用户确认
→ 创建 MemoryEvent
→ Timeline 出现
```

为整条路径写 Playwright。

## Slice 2：多素材合并

```text
上传 5 张照片
→ 勾选
→ 合并为一个 MemoryEvent
```

验收：5 个 Asset，1 个 Event。

## Slice 3：音频 / 视频 / 文字

要求：

- 原音频可播放；
- 原视频可播放或生成兼容 preview；
- FFmpeg 不可用时，原件上传仍可工作；
- 文字也先进入 Inbox。

## Slice 4：多人视角

```text
爸爸 Contribution
妈妈 Contribution
```

两份独立保存，不能覆盖。

## Slice 5：时间胶囊

```text
创建胶囊
→ 加 Event/Asset/Contribution
→ 设置日期
→ Seal
→ 到期 Open
```

## Slice 6：完整导出

导出后：

- 解压即可查看；
- manifest 校验所有 SHA-256；
- Markdown 通过相对路径引用媒体。

---

# 24. 第一批 GitHub Issues

```text
#001 Bootstrap Next.js + TypeScript + Docker + CI
#002 Authentication + private registration policy
#003 Family / User / Person schema
#004 AssetStorage abstraction + LocalFilesystemStorage
#005 Image upload + SHA-256
#006 EXIF capturedAt parser
#007 Inbox workflow + UI
#008 Confirm InboxItem to MemoryEvent
#009 Timeline + child age calculation
#010 Multi-select merge into one MemoryEvent
#011 Audio / video / text ingestion
#012 Contribution model + multi-view UI
#013 Capsule model + date/age unlock
#014 Full export ZIP
#015 Backup/restore design document
#016 PWA polish
#017 Security audit
#018 Playwright critical regression suite
```

---

# 25. Agent 固定执行提示词

把下面这段作为每个 Issue 的固定前缀：

```text
你正在开发 family-time-capsule。

这是一个私人、自托管、长期家庭记忆档案系统。

始终遵守：
- 媒体可以在外部产生后再上传；
- capturedAt 和 importedAt 不能混淆；
- 原始文件不可被覆盖或重新压缩后替换；
- MemoryEvent 是核心，Asset 是原始证据；
- MVP 不依赖 AI；
- AI 以后也只能建议，不能自动制造 user_confirmed Fact；
- 不加入 PRD 外功能；
- 每个重要行为必须有测试；
- 修改数据模型必须创建 migration；
- 保持移动端可用；
- 每次完成后运行 lint、typecheck、unit、e2e；
- 如果 PRD 与现有代码冲突，先在 docs/DECISIONS.md 写清楚，不自行扩大范围。

本次只实现下面 Issue：
<粘贴 Issue>

先阅读 docs/PRD.md、docs/ARCHITECTURE.md、docs/DATA_MODEL.md，
列出本次需要改动的文件、测试和 migration，
然后实现。不要顺手做下一阶段功能。
```

---

# 26. Agent 每次 PR 自检

```text
1. 是否误把 importedAt 当成 capturedAt / occurredAt？
2. 是否覆盖或修改了原始媒体？
3. 是否把关键关系偷懒塞进 JSON？
4. 是否引入了 PRD 没要求的 AI/复杂框架？
5. 是否让媒体只能通过本应用现场产生？
6. 是否存在无法导出的数据？
7. 是否有未鉴权媒体 URL？
8. 是否新增主路径却没有测试？
9. 移动端是否实际可操作？
10. Docker 重建后 volume 中数据是否还在？
```

---

# 27. P0 Definition of Done

以下全部完成才发布 0.1.0：

```text
[ ] 手机/电脑可创建私人家庭空间
[ ] 可创建女儿与家庭成员
[ ] 可后补上传旧照片
[ ] 可上传音频和视频
[ ] 可写文字
[ ] capturedAt / importedAt 分离
[ ] 相同原件可识别重复
[ ] 多素材可合为一个 MemoryEvent
[ ] 多家人可写独立 Contribution
[ ] 时间轴按真实发生时间展示
[ ] 显示事件发生时女儿年龄
[ ] 可创建并封存日期/年龄胶囊
[ ] 可完整 ZIP 导出
[ ] 原件 SHA-256 可验证
[ ] Docker 部署可持续保存数据
[ ] 无 AI key 也完整可用
[ ] 关键 E2E 全绿
[ ] docs 与代码一致
```

---

# 28. UI 风格

不要做成“宝宝 App”的高饱和卡通风格。

建议：

```text
温暖
克制
低饱和
留白
照片优先
纸张/相册/档案感
```

目标是女儿 18 岁再打开也不过时。

---

# 29. 产品成功标准

第一阶段不看 DAU，不看社交传播。

看这些：

```text
1. 保存一条原始记忆耗时 < 10 秒；
2. 80% 以上素材不要求记录当下填复杂字段；
3. 后补素材不会因 importedAt 错位；
4. AI 内容都能回到原始来源；
5. 每月至少形成一个值得长期保存的成品；
6. 完整导出简单可靠；
7. 使用 100 天后仍愿意继续记录。
```

---

# 30. README 首屏建议

```md
# Family Time Capsule

A private, self-hosted family memory archive.

随处记录，统一归档。

照片可以来自系统相机，声音可以来自语音备忘录，
视频可以几个月后再补录，文字可以从聊天里复制。

本项目不要求你在“正确的 App”里记录人生。
它只负责把散落在不同地方的真实素材，
整理成一条可以保存几十年的家庭成长时间线。

AI helps organize memories.
Family members tell the story.
Original sources always come first.
```

---

# 31. 最重要的十个决定

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

---

# 32. 1.1 Capture Anywhere & Family Rhythm（附录）

本附录扩展 1.0 家庭档案，不删除或改写前述历史需求。详细架构、状态机和逐里程碑证据见
[`PRODUCT_1_1.md`](./PRODUCT_1_1.md)。

## 32.1 产品承诺

1. 用户明确选择的照片、音频、视频、文字和安全文档可从 Web、系统分享或 Files 进入档案；
   不自动扫描整个系统相册。
2. Web 与原生使用持久 ImportSession 和顺序式断点续传；新大文件路径不得把完整文件物化到
   JS heap，失败、刷新、断网或进程重启后可以从服务器确认 offset 恢复。
3. 家人无需账号即可通过有期限、可撤销、有限额的投递链接贡献；所有访客内容先进入 Inbox，
   永不直接进入时间轴。
4. 高频家人、故事、胶囊、口述史、投递箱、导入与每周回顾在原生端可完成，服务器继续作为
   权威档案与安全策略执行者。
5. 每周回顾在无 AI 时完整可用并生成有来源的 Story 草稿；AI 默认关闭、显式同意后也只能
   优化表达，不确认事实、不自动发布、不覆盖人工编辑。

## 32.2 新耐久数据

- `UploadSession`：家庭/用户/capture 身份、声明文件信息、服务器确认 offset、随机临时存储键、
  状态、期限和最终 Asset/Inbox 结果。
- `ImportSession` / `ImportSessionItem`：来源、批次状态、计数、默认整理字段，以及每项与
  capture/upload/Asset/Inbox 的外键关系。
- `ContributionPortal` 及 submission 关系：复用 Contribution Request 的 256-bit token hash、
  过期/撤销/限流/no-store/noindex/no-referrer 安全基线。
- `ReviewPeriod`：家庭时区周界、流程状态、唯一 Story 草稿、开始/完成时间；同家庭同周期唯一。
- `Asset.type=document` 正式启用，最低支持 PDF、TXT、Markdown、RTF、DOCX；HTML/SVG 不作为
  可执行预览，Office 文件只保存和下载，纯文本预览与搜索有严格长度/类型边界。

核心关系使用外键或关系表。上述耐久数据、document 原件和新增关系现已进入 portable archive；
旧 v1/rc.4 归档缺失时使用安全默认值。原始 guest token、认证会话、通知权限、UploadSession
与临时上传文件不导出。

## 32.3 安全与原件边界

- 原件永不覆盖、重编码替换或静默删除；临时上传 complete 前不可经 HTTP 读取，失败不留下
  半成品 Asset，取消只清理未完成临时文件。
- `capturedAt`、`occurredAt` 与 `importedAt` 继续严格分离；系统分享或复制时刻不是可靠来源时间。
- 所有新 API 从实时 session/token scope 推导家庭和 capability，不接受客户端 familyId；
  跨家庭目标统一 404，viewer/contributor 遵守现有能力表。
- Share Extension 只向 App Group 复制文件与 manifest，不持有服务器 token、不直接复杂同步；
  Android 只读取 Intent 临时授权的 URI。任一端在另一份持久副本接管前不得删除唯一原件。
- 未到期胶囊正文不得经移动 API 泄露；通知默认不显示私人标题、照片或原话。

## 32.4 发布条件

`1.1.0-alpha.1` 只有在 #019–#025 的自动化、Docker、导出恢复、Android APK、含正式
Share Extension 的 unsigned IPA 和最终 main CI 全绿后才创建 prerelease tag。真实设备清单
必须如实保持独立状态；本轮不创建 stable `v1.0.0` 或 `v1.1.0` 标签。

# 33. 1.2 家庭记忆馆与成长年册（附录）

执行范围与证据见 [PRODUCT_1_2.md](./PRODUCT_1_2.md)。统一 Collection 组织已确认记忆，
提供日历、精确日历年龄与媒体阅读；持久 BookProject 区分选材/版式/出版版本，交付照片相册、
图文成长册、家人来信三模板。可搜索中文 PDF、有效 EPUB 和精选离线包均重验读者范围与来源。
原生实际提供整理、阅读和基础编辑；全部新增耐久编辑关系完整导出恢复，原件保持不可覆盖。
不重写 1.1 上传同步，不引入公开社交、S3、新加密协议或付费印刷。发布仅为 prerelease。

出版实现采用 PDFKit 独立进程与 OFL 嵌字，Web/原生均可保存后排队、取消、重试和导出。
34 页虚构图文册通过真实中文提取与逐页渲染，EPUBCheck 通过；实际进展见 RELEASE_1_2。
