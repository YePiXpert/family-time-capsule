# 1.1 Capture Anywhere & Family Rhythm

> 版本基线：`1.1.0-alpha.1`
> 状态：大版本开发中；`v1.0.0-rc.4` 已在 `main@c7347cd2cacb9b5151ee372302c3bdd1f5c365b8`
> 固化为 prerelease，1.1 的功能与真实设备验收必须按下表逐项取得证据。

## 产品承诺

Family Time Capsule 1.1 让真实素材从系统相册、语音备忘录、Files、浏览器和亲友手中低阻力地
进入同一个私人家庭档案，并把“收到素材”变成每周可完成的整理节奏。它不自动扫描相册，
不要求亲友注册，不把 AI 建议当事实，也不以导入时间冒充素材或事件的真实时间。

无家庭服务器、无网络、无 AI 或无外部服务时，原生端仍能先把用户明确选择的内容复制到
本机私有目录并持久排队。服务器收到内容后，原件只增不改，访客内容只进 Inbox；任何自动
整理都必须停在可解释、待人工确认的建议或草稿。

## 用户故事

1. 家长可从系统相册、语音备忘录、Files 或浏览器分享一项或多项素材到原生 App；来源文件
   不被修改，断网或 App 被杀后已复制内容仍在。
2. 家长可在 Web 或原生端导入几十到几百个文件，暂停、续传、刷新后恢复进度，并只重试
   失败项；成功原件不会重复上传或因取消整批而回滚。
3. 家人可用一个有期限、可撤销、有限额的链接提交文字、照片、录音、视频和安全文档，
   无需账号，也无法读取家庭内部内容。
4. 家长可直接在原生端查看和处理家人、故事、胶囊、口述问题、投递箱和导入会话；仅恢复、
   高级备份、安全管理、复杂审计和大型成书排版继续进入 Web。
5. 每周回顾把 Inbox、访客提交、失败导入、确认事件和待回答问题串成四步流程；无 AI 时也能
   生成逐段保留来源的周记草稿。
6. 家长可启用只显示通用隐私文案的本地提醒，也可完全关闭；拒绝通知权限不影响主路径。

## 数据边界

- `MemoryEvent` 仍是核心记忆对象，`Asset` 仍是不可替代的原始证据；document 是 Asset 的
  正式类型，不另建脱离事件与收件箱的附件孤岛。
- `capturedAt`、`occurredAt`、`importedAt` 分别表示素材产生、事件发生和进入档案的时间，
  未知来源时间保持 `null`，不得以复制、分享或导入时刻补造。
- `UploadSession` 只描述有期限的临时传输；`ImportSession` 与 `ImportSessionItem` 描述一批
  用户可恢复的导入工作及每项关系。核心关系使用外键/关系表，不把整张关系图塞进 JSON。
- 分享扩展、本地 intake 与 outbox 永远先保全唯一副本；只有确认另一份持久副本已接管后，
  才能清理临时副本。服务器 complete 前的临时文件不是 Asset，也不能经媒体端点读取。
- 访客提交保存 portal/request 来源和“访客自填、未经确认”的称呼；目标人物只是建议，
  不自动建立事实或直接进入时间轴。
- `ReviewPeriod` 是家庭时区下的每周流程状态；Story 草稿仍遵守 Fact/Contribution/Transcript
  来源锁，AI 只能在明确同意后优化表达，不能自动发布或覆盖人工编辑。
- ImportSession、ReviewPeriod、投递箱配置/提交、document 原件与新增关系全部进入 portable
  archive；原始 guest token、会话凭据、Share Extension 临时文件和通知授权不导出。

## 页面地图

| 目的 | Web | 原生 | 说明 |
| --- | --- | --- | --- |
| 批量导入 | `/imports`、`/imports/[id]` | ImportSessions、ImportSessionDetail | 持久进度、并发 3、暂停/继续/取消/重试 |
| 系统与文件接收 | 浏览器选择器、PWA share | 系统 Share Extension / Intent、Files picker | 先复制到私有目录，再进入本地会话/outbox |
| 家庭投递箱 | 管理入口、`/contribute/[token]` | ContributionPortals、PortalDetail | 匿名提交与管理严格分离 |
| 家人 | `/family`、`/family/[id]` | People、PersonDetail | 列表、关系、共同记忆、讲述和问题 |
| 故事 | `/stories`、`/stories/[id]` | Stories、StoryDetail | 阅读缓存、来源跳转、周记草稿 |
| 胶囊 | `/capsules`、`/capsules/[id]` | Capsules、CapsuleDetail | 未到期正文不经移动 API 泄露 |
| 口述史 | `/requests` | Requests、RequestCreate | 等待/收到、创建、分享和关闭 |
| 每周回顾 | `/review`、`/review/[period]` | WeeklyReview | 四步整理与有来源周记草稿 |

记录页和更多页都必须能进入批量导入；首页必须显示本周留下数量、待整理数量、周记草稿以及
开始/继续回顾动作。

## 原生扩展架构

```text
Android SEND / SEND_MULTIPLE       iOS Share Extension
content:// URI                     NSItemProvider
        │                                  │
        ├─ 逐项复制到 App 私有目录         └─ 逐项复制到 App Group
        │                                  │
        └──────── durable manifest / receipt ────────┐
                                                      ▼
主 App 启动或激活 → 原子认领 → 本地 ImportSession → outbox → 可续传上传 → Inbox
```

- Android 只读取用户通过 Intent 授予的 URI，不扩大到整个相册；立即复制并释放 URI 权限。
- iOS Extension 使用独立 bundle id 和与主 App 相同的 App Group，只写文件与 manifest；扩展
  不持有服务器 token、不直接同步、不执行复杂媒体处理。
- 主 App 以 manifest id 和 item id 幂等接管；部分复制、扩展中止、重复激活和进程被杀均可
  重放。接管成功之前不删共享容器副本。
- 仓库内 config plugin 生成不可由 Expo 配置表达的 target、entitlement、Intent filter 和
  最小原生桥接代码；不依赖未提交的临时 `ios/`、`android/` 目录。

## 导入会话状态机

```text
ImportSession
collecting → uploading ⇄ reviewing → completed
     │           │             │
     └───────────┴─────────────┴→ cancelled

ImportSessionItem
received → copied → queued → uploading → inbox → archived
                │         └──── failed ──→ queued
                └──────────── cancelled

UploadSession
created → receiving → completing → completed
    │          │             ├── failed（可安全重试 complete）
    └──────────┴─────────────┴── cancelled / expired
```

- 上传只允许从服务器确认 offset 顺序追加；offset 冲突返回 `409` 和正确 offset。磁盘长度是
  崩溃恢复的事实来源，数据库在加锁后向安全值对齐。
- `captureId` 绑定不可变的文件身份；同 id/同内容重试幂等，同 id/不同内容冲突。complete
  响应丢失后重试返回同一 Asset/InboxItem。
- 浏览器刷新后从服务器恢复会话。若浏览器已失去 File handle，用户重新选择后按文件名、
  大小、lastModified 与局部特征匹配；已完成项不会重传。
- 默认最多三项并发；暂停不删临时文件，取消只清理未完成临时文件，完成原件不回滚。

## 访客投递安全模型

- 通用投递入口扩展现有 Contribution Request 能力，不建立第二套弱 token：使用 256-bit
  随机 token，只存 SHA-256 hash，支持过期、暂停、撤销、提交/文件限额和持久限流。
- 访客 token 是 URL bearer capability；页面与响应使用 `no-store`、`noindex`、
  `no-referrer`，token 不进入日志、审计详情、导出、分析资源或第三方请求。
- 匿名页面只返回标题、说明和安全表单配置，不返回 Person ID、Family ID、User ID，也没有
  读取、搜索、枚举或下载家庭内容的端点。
- 大文件使用同一流式续传内核，但授权来自当前 portal token 的受限 scope；完成项进入一个
  guest ImportSession 和 Inbox bundle。访客不能读取已上传原件。
- portal 配置随 archive 恢复后强制 `closed`；原 token 永不恢复，管理员必须主动重新生成。

## 每周回顾流程

周期由 `Family.timezone`、家庭周开始日和当前墙钟计算，同家庭同一 `periodStart` 唯一，创建
幂等。完成后仍可只读重开，不创建第二份周期或第二篇周记草稿。

1. **整理本周素材**：显示 Inbox、待校时、疑似重复、分簇、访客提交和导入失败项。
2. **选择本周重点**：只从已确认 MemoryEvent 选择，人工补标题、地点、人物和成长节点；
   建议不能自动确认事实。
3. **补上家人的声音**：指出缺少 Contribution 的重点事件，可向指定家人创建问题，但不强制。
4. **生成周记草稿**：无 AI 时按真实标题、日期、人物与原话组装；每段保存 Event/Fact/
   Contribution/Transcript 来源。AI 仅在同意后优化表达，结果仍是草稿且不覆盖人工编辑。

原生端按缓存的偏好调度本地通知。默认锁屏文案只有“这周有几段家庭记忆等待整理”；家庭
时区变化、App 重启和周期完成时重新核对或取消，不引入外部推送或遥测。

## 里程碑与真实验收状态

| 里程碑 | 自动化/包级状态 | 真实设备状态 |
| --- | --- | --- |
| M0 固化 rc.4 | ✅ run `33874450257` 三 job 全绿；APK/IPA 独立复验；prerelease 已发布 | ⏳ 未执行，绝不据此宣称真机通过 |
| M1 1.1 计划与版本基线 | ✅ 建立 `1.1.0-alpha.1`、路线与动态包版本验证 | 不适用 |
| M2 可续传上传/持久导入模型 | ✅ 13 项协议/重启集成场景；main CI run `33878541261` 全绿 | 不适用 |
| M3 Web 批量导入/document | ✅ 三并发池、持久批次、document 原件/预览/检索自动化已实现 | ⏳ 浏览器 500MB/刷新重选仍需人工补验 |
| M4 Android/iOS 系统分享与 Files | ✅ main CI `33886783602` 全绿；云包 run `33886793964` 三 job 全绿。独立复验 APK v2/versionCode 5/Hermes/SEND/SEND_MULTIPLE 与 IPA build 5/ARM64/appex/App Group；SHA-256：APK `8ae8304d…1ff11bf`、IPA `837e211e…131ffc` | ⏳ 必须用真实 Android/iPhone 验证，未宣称通过 |
| M5 家庭投递箱 | ✅ 复用 Contribution Request token、匿名续传、guest ImportSession/Inbox bundle、管理/本机 QR、暂停/撤销/换 token 与 rc.4 升级回归已实现 | ⏳ 真实浏览器录音/多文件及扫码需人工补验 |
| M6 原生日常能力 | ✅ 原生 People/Stories/Capsules/Requests/ContributionPortals/ImportSessions 页面、最小移动 API、独立 cursor 缓存和 capability/锁定/隔离自动化已实现；CI `33891377198` 与云包 `33891401232` 全绿 | ⏳ 页面操作、离线重开、扫码和系统分享链接仍需真机人工补验 |
| M7 每周回顾与本地提醒 | ✅ ReviewPeriod/重点关系、Web/原生四步流程、无 AI 来源草稿、显式同意 AI 优化与一次性本地隐私提醒已实现；上海/纽约 DST/幂等/viewer/拒权/重排自动化通过 | ⏳ 通知授权、锁屏显示、时区变化与系统调度仍需真机人工补验 |
| M8 hardening 与 alpha release | 🟡 portable 关系图、旧档默认值、二次导出、500 MiB RSS、依赖审计、Docker health/volume 门禁已通过；最终 main/tag CI 待发布步骤完成 | ⏳ 系统分享、Files/iCloud 与本地通知仍待人工；不创建 stable 标签 |

每个里程碑只有在实现、自动化、包级检查与适用的真实设备证据分别记录后才可改变对应状态；
“编译通过”“bundle 生成”或模拟器行为不能写成真实设备已验证。
