# 原生 iOS / Android 客户端

> 当前开发版本：`1.1.0-alpha.1`；Expo 商店展示版本为 `1.1.0`，原生 iOS build / Android
> versionCode 为 `5`。`v1.0.0-rc.4` 的包级证据保持冻结；1.1 Share Extension 与系统分享
> 正在按 alpha 里程碑重新构建验证，真实设备安装和分享验收尚未执行。

`mobile/` 是 Expo SDK 57 + React Native 的原生客户端。它渲染 UIKit/Android View
对应的原生组件，使用原生 SQLite、Keychain/Keystore 和文件系统模块，**不是 PWA，
也没有 WebView**。App 首次启动直接进入本机档案，Next.js 家庭服务器是用户可选的同步
与协作目标，不是启动或本地记录的前置条件。

## 本机与服务器各自保存什么

| 数据 | 设备 | 家庭服务器 |
| --- | --- | --- |
| 本机记录、时间轴、人物、同步状态 | SQLite；本机记录独立保留 | 连接后同步的家庭档案 |
| 离线封面 | App 私有文件目录 | 权威原件/衍生物 |
| 刚拍摄/选择/系统分享的照片、视频、录音与安全文档 | 立即复制到 App 私有目录并进入本机 ImportSession/outbox；服务端确认后仍保留本机原件 | 开启同步后进入收件箱 |
| 本机文字 | SQLite 本机时间轴 + outbox | 开启同步后进入收件箱 |
| 会话令牌 | Keychain/Keystore | 可撤销的 session 行 |
| 真实家庭数据 | 不写入 IPA/APK | 不写入源码或构建产物 |

同步采用完整快照分页：只有所有页面成功后才清理本机已从服务器删除的旧行，因此中途断网
不会把可用离线数据误删。文字和媒体 outbox 都使用设备预生成 UUID；媒体上传同时校验
原件 SHA-256，同一个 `captureId` 重试同一原件会返回成功，重用 ID 上传不同内容则返回
409。即使网络在服务器落盘后中断，下一次补传也会补建收件箱关联而不会产生第二条待办。
服务器确认后，本机 capture 从 `pending` 进入 `inbox`，再以同步返回的 `captureId` →
`memoryEventId` 关联进入 `archived`；它不再作为独立时间轴卡片显示，但私有目录原件不会删除，
正式事件离线时仍可复用。多项合并会把全部本机 capture 关联到同一个正式事件。

原生端所有可编辑发生时间都使用 `YYYY-MM-DDTHH:mm` 家庭墙钟契约，服务端按当前家庭的
IANA timezone 转 UTC；设备当前时区不参与解释。相册导入不会把选择时刻作为文件时间：只有
MediaLibrary 返回可靠创建时间时才上传 `lastModified`，权限受限、文件浏览或查询失败均传
`null`；服务端无内嵌/可靠文件时间时保留 `capturedAt=null` 并要求人工复核。

当前原生端使用 React Navigation 7 的 Native Stack + Bottom Tabs，一级入口固定为首页、
时间轴、记录、收件箱、更多。`App.tsx` 只负责本机数据库/凭据启动和根组合，页面、导航、
应用状态、API 与存储各自独立。原生端覆盖：

- 真实家庭首页、快速记录、待整理预览、最近记忆和回顾入口；
- 可离线浏览的时间轴与封面，卡片可进入记忆详情；详情缓存阅读数据，并用 Bearer Range
  请求播放图片、视频与音频；
- 离线文字、现场拍照/拍视频、直接录音、相册照片与视频多选；每份成功素材分别复制进
  App 私有目录并形成独立 outbox，某一份失败不会撤销其他已保全原件；
- Android 接收 `SEND`/`SEND_MULTIPLE`，逐项复制授权的 `content://`；iOS 正式 Share
  Extension 只向共享 App Group 写原件和原子 manifest，主 App 再接管，扩展不持服务器凭据；
- Files/iCloud Drive/DocumentsProvider 支持图片、音视频、PDF、TXT、Markdown、RTF、DOCX
  多选。来源时间不可靠时保持 `null`，HTML/SVG 不作为可执行文档接收；
- 系统分享和 Files 批次持久化为本地 ImportSession/Item，使用
  `received → copied → queued → uploading → inbox → archived` 状态；manifest id/item id 重放
  幂等，viewer 已连接时保全副本但不生成注定失败的 outbox；
- 收件箱 cursor 分页、标题/时间/人物/地点修改、单条确认、多选合并；确认后可直接阅读
  记忆并回到同步后的时间轴；Web 与原生共用并回填同一组人工草稿；
- 家人列表/详情、共同记忆、可见讲述与口述问题；管理员可新增、编辑人物；
- 故事列表/阅读/来源记忆跳转、无 AI 的本周草稿、标题/人工段落编辑与发布；
- 胶囊列表/倒计时/锁定安全详情、创建、添加记忆、封存与到期打开；未到期移动 DTO
  始终返回空 events/assets/contributions；
- 口述史问题创建、回答状态和关闭；创建成功当次以可选择文字和系统 Share 提供回答链接；
- 家庭投递箱创建、二维码、系统分享、提交计数、Inbox 跳转、暂停/开放/延长/撤销和 token
  换发；明文 token 不进入 SQLite，换发后旧 token 立即失效；
- 服务器与本机 ImportSession 进度；服务器批次支持暂停/继续/失败项重试/取消未完成项，
  本机 Share/Files 批次在无服务器时仍可见；
- 上述领域分别使用 cursor 页与详情 cache；打开时先呈现最后一次成功数据，单域刷新失败不会
  清空其他页面或完整时间轴；所有离线写操作明确提示需要联网，不伪装成功；
- 原生搜索；story 结果、首页故事/胶囊/问题直接进入对应原生页面；
- 记忆页可新增文字讲述、选择允许的作者与可见性，并修改自己的讲述；封面不会与媒体列表重复；
- 自动/手动同步、失败状态与重试、保留数据断开服务器，以及二次确认的本机全量清除。
- 在线角色按服务端 capability 工作：viewer 可读但不能记录/review，且不会生成不可同步
  outbox；纯本机未连接模式仍允许记录。

本地 schema 向前兼容 rc.4：首次启动会原地补充 document 与 ImportSession 生命周期，保留
已有文字、照片、视频、音频、outbox、同步状态和原件。直接录音停止后
先复制到 `captures/` 私有目录，随后才入队；同步成功只删除 outbox 行，不删除该原件。单条
不受支持的素材不会阻塞后续待办和时间轴拉取。

移动端自动化现有 8 个测试文件 / 44 个场景，覆盖本机数据库启动、原生详情导航、四种记录 intent、
媒体时间来源、离线原件、草稿、分页整理、角色只读、capture 归档对账、合并、App 重启、响应
丢失后的幂等恢复、story 目标路由与 Contribution API。相机/相册系统权限、真实音频焦点、
系统杀进程后的文件行为、签名包安装与真实网络切换仍须按 `REAL_DEVICE_TEST.md` 在
iOS/Android 硬件上留档。

## 每周回顾与本地提醒（1.1 M7）

- `WeeklyReviewScreen` 读取独立 `/api/mobile/v1/review` DTO 并持久缓存；一项同步失败不会清空
  时间轴或上次回顾。viewer 可离线阅读，但不会创建写操作或 outbox。
- 四步流程在原生端完成 Inbox/失败导入入口、重点选择、缺少家人声音提示、口述问题入口与
  来源周记生成；完成/重开/生成均复用服务端 Review service 和 capability。
- `expo-notifications` 只做本地一次性通知。默认关闭，用户在设备上明确开启时才请求系统权限；
  拒绝权限不阻断回顾。服务端按家庭时区与 DST 返回绝对提醒时刻，设备在启动、激活、同步、
  周期完成和偏好变化时核对已保存的通知 ID。
- Android channel 使用 secret 锁屏可见性、无声音/角标；iOS/Android notification content 均只
  使用固定正文“这周有几段家庭记忆等待整理”，不带家庭名称、人物、照片、标题或原话。

## 本地开发检查

```bash
cd mobile
npm ci
npm test
npm run typecheck
npm run lint
npm run doctor
npx expo export --platform android --output-dir dist-android
npx expo export --platform ios --output-dir dist-ios
```

开发机有 Android SDK/Xcode 时，可用 `npm run android` / `npm run ios` 启动原生工程。
生产家庭服务器必须使用 HTTPS；Android debug 构建允许调试期连接本地 HTTP，release
配置和 iOS 网络策略不会把公网明文 HTTP 当作受支持部署方式。

## GitHub 云构建 IPA / APK

在 GitHub Actions 选择 **Native mobile packages** → **Run workflow**，或执行
`gh workflow run mobile-build.yml --ref main`。手工构建只接受 `main`；`v*` tag 仅在
其 SHA 属于当前 `origin/main` 历史时可发布。所有 job checkout 触发时的准确 SHA，不创建
临时构建分支。工作流先跑 Expo Doctor、TypeScript、ESLint、44 tests 和 Android/iOS
Hermes bundle，再并行构建：

- `FamilyTimeCapsule-android-apk`：Release 模式、ARM64、内置 Hermes bundle，并以临时
  debug key 签名的可直接侧载 APK；工作流额外验证 SEND/SEND_MULTIPLE filters。每次云运行的 key 可能不同，覆盖安装失败时先卸载
  旧测试包。正式分发应改接长期 release keystore。
- `FamilyTimeCapsule-ios-unsigned-ipa`：真实 iPhoneOS Release archive 打出的未签名 IPA，内含
  独立 `app.familytimecapsule.mobile.share` Share Extension；主 App/扩展 App Group 与 ARM64
  device slice 均由工作流检查。
  它不能直接装机；可用自己的 Apple Development/Distribution 证书与 provisioning
  profile 重签，或交给 AltStore/Sideloadly 等自签安装流程。无需把家庭数据或密码上传
  到 Actions。

rc.4 云构建 run [`33868382857`](https://github.com/YePiXpert/family-time-capsule/actions/runs/33868382857)
来自 `main@f16bc3ac3d46599a946fc87e9021eceef711b7e1`，React Native quality、Android APK、
iOS unsigned IPA 三个 job 全绿，产物保留 30 天。下载后复验结果：

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `FamilyTimeCapsule-android.apk` | 35,584,431 | `67d2b4c3d3d1afa5b9c859801912d2432650a85721549558605f2858c0098345` |
| `FamilyTimeCapsule-ios-unsigned.ipa` | 9,196,386 | `c9e7f0d8d10982b5aca723f0ec7e5be930f2d6925bf58b64e7d4a404fc88989a` |

APK ZIP、v2 签名、package `app.familytimecapsule.mobile`、`versionCode=4` 与 Hermes HBC
均通过；IPA ZIP、bundle ID `app.familytimecapsule.mobile`、`buildNumber=4` 与 Hermes HBC
均通过。这里是自动化包证据，不代表真实 iOS/Android 安装或权限行为已经验收。

Apple 证书属于个人/组织身份，仓库不会内置。要让 Actions 直接产出已签 IPA，需由所有者
把 `.p12`、密码、provisioning profile 和 Team ID 配为 GitHub Encrypted Secrets，再增加
签名导出步骤；未得到这些凭据前，工作流只产出安全的 unsigned IPA。

## 移动 API v1

- `GET /api/mobile/v1/sync?cursor=&limit=50`：Bearer 鉴权的最小化家庭/人物/时间轴 DTO；
  `Cache-Control: private, no-store`。
- `POST /api/mobile/v1/captures/text`：`{ id, text }`，按家庭和设备 UUID 幂等入箱。
- `POST/HEAD/PATCH /api/uploads/*` 与 `complete/retry`：原生端优先采用 8MB 有界分块续传，
  每块后把服务端 offset 写回 SQLite；可携带设备 `captureId`，结合原件 SHA-256 提供重试
  幂等与冲突检测。旧 `/api/upload/image`、`/api/upload/media` 仅保留小文件兼容。
- `/api/media/:assetId`：同一权限/可见性检查下下载离线封面。
- `GET /api/mobile/v1/home`：集中 service 查询后的最小家庭首页 DTO。
- `GET /api/mobile/v1/inbox`、`PATCH /api/mobile/v1/inbox/:id`、
  `POST /api/mobile/v1/inbox/:id/confirm`、`POST /api/mobile/v1/inbox/merge`：收件箱分页与整理闭环。
- `GET|PATCH /api/mobile/v1/memories/:id`：按软删除、家庭和角色策略读取/修改记忆。
- `GET /api/mobile/v1/search`：cursor 分页搜索；索引残留也会以当前软删除与可见性状态二次过滤。
- `POST /api/mobile/v1/memories/:id/contributions`、
  `PATCH /api/mobile/v1/contributions/:id`：复用现有作者、visibility 与 capability 服务。
- `GET|POST /api/mobile/v1/library/:domain`、`GET|PATCH .../:id`：`people|stories|capsules|
  requests|portals|imports` 的最小 cursor DTO 和原生读写；所有领域复用现有 service，胶囊锁定、
  Contribution visibility、软删除与 family scope 不在 route 内另造规则。

所有移动响应均为 `Cache-Control: private, no-store`。API 不接受客户端提供 `familyId`，
始终从实时 session → User binding 推导家庭、角色、Person 和 guardian 状态；viewer 只能读取，
editor/admin 才能整理收件箱和修改事件。跨家庭目标统一按不存在处理。
