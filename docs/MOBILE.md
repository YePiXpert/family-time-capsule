# 原生 iOS / Android 客户端

> 当前候选版本：`1.0.0-rc.4`；Expo 商店展示版本保持 `1.0.0`，原生 iOS build / Android
> versionCode 为 `4`，以便从上一候选包升级安装。本地 Expo bundle 已通过；rc.4 APK/IPA
> 云构建与真实设备安装尚未执行。

`mobile/` 是 Expo SDK 57 + React Native 的原生客户端。它渲染 UIKit/Android View
对应的原生组件，使用原生 SQLite、Keychain/Keystore 和文件系统模块，**不是 PWA，
也没有 WebView**。App 首次启动直接进入本机档案，Next.js 家庭服务器是用户可选的同步
与协作目标，不是启动或本地记录的前置条件。

## 本机与服务器各自保存什么

| 数据 | 设备 | 家庭服务器 |
| --- | --- | --- |
| 本机记录、时间轴、人物、同步状态 | SQLite；本机记录独立保留 | 连接后同步的家庭档案 |
| 离线封面 | App 私有文件目录 | 权威原件/衍生物 |
| 刚拍摄/选择的照片、视频与直接录音 | 立即复制到 App 私有目录并进入本机时间轴；服务端确认后仍保留本机原件 | 开启同步后进入收件箱 |
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
- 收件箱 cursor 分页、标题/时间/人物/地点修改、单条确认、多选合并；确认后可直接阅读
  记忆并回到同步后的时间轴；Web 与原生共用并回填同一组人工草稿；
- 原生搜索；story 结果、首页故事/胶囊/问题打开准确 Web 路径并明确标注；
- 记忆页可新增文字讲述、选择允许的作者与可见性，并修改自己的讲述；封面不会与媒体列表重复；
- 自动/手动同步、失败状态与重试、保留数据断开服务器，以及二次确认的本机全量清除。
- 在线角色按服务端 capability 工作：viewer 可读但不能记录/review，且不会生成不可同步
  outbox；纯本机未连接模式仍允许记录。

本地 schema 向前兼容 rc.3：首次启动会原地补充 capture 生命周期与可选
`memory_event_id`，保留已有文字、照片、视频、音频、outbox、同步状态和原件。直接录音停止后
先复制到 `captures/` 私有目录，随后才入队；同步成功只删除 outbox 行，不删除该原件。单条
不受支持的素材不会阻塞后续待办和时间轴拉取。

移动端自动化现有 6 个测试文件 / 30 个场景，覆盖本机数据库启动、五项导航、四种记录 intent、
媒体时间来源、离线原件、草稿、分页整理、角色只读、capture 归档对账、合并、App 重启、响应
丢失后的幂等恢复、story 目标路由与 Contribution API。相机/相册系统权限、真实音频焦点、
系统杀进程后的文件行为、签名包安装与真实网络切换仍须按 `REAL_DEVICE_TEST.md` 在
iOS/Android 硬件上留档。

## 本地开发检查

```bash
cd mobile
npm ci
npm test
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform android --output-dir dist-android
npx expo export --platform ios --output-dir dist-ios
```

开发机有 Android SDK/Xcode 时，可用 `npm run android` / `npm run ios` 启动原生工程。
生产家庭服务器必须使用 HTTPS；Android debug 构建允许调试期连接本地 HTTP，release
配置和 iOS 网络策略不会把公网明文 HTTP 当作受支持部署方式。

## GitHub 云构建 IPA / APK

在 GitHub Actions 选择 **Native mobile packages** → **Run workflow**。也可推送
`mobile-v*` tag 触发。工作流先跑 Expo Doctor、TypeScript、ESLint 和 Android/iOS
Hermes bundle，再并行构建：

本轮按要求未 push、未打 tag，因此下面描述的是可执行流程，不代表 rc.4 已产生云端包。

- `FamilyTimeCapsule-android-apk`：Release 模式、ARM64、内置 Hermes bundle，并以临时
  debug key 签名的可直接侧载 APK；每次云运行的 key 可能不同，覆盖安装失败时先卸载
  旧测试包。正式分发应改接长期 release keystore。
- `FamilyTimeCapsule-ios-unsigned-ipa`：真实 iPhoneOS Release archive 打出的未签名 IPA。
  它不能直接装机；可用自己的 Apple Development/Distribution 证书与 provisioning
  profile 重签，或交给 AltStore/Sideloadly 等自签安装流程。无需把家庭数据或密码上传
  到 Actions。

Apple 证书属于个人/组织身份，仓库不会内置。要让 Actions 直接产出已签 IPA，需由所有者
把 `.p12`、密码、provisioning profile 和 Team ID 配为 GitHub Encrypted Secrets，再增加
签名导出步骤；未得到这些凭据前，工作流只产出安全的 unsigned IPA。

## 移动 API v1

- `GET /api/mobile/v1/sync?cursor=&limit=50`：Bearer 鉴权的最小化家庭/人物/时间轴 DTO；
  `Cache-Control: private, no-store`。
- `POST /api/mobile/v1/captures/text`：`{ id, text }`，按家庭和设备 UUID 幂等入箱。
- `/api/upload/image`、`/api/upload/media`：支持同一 Bearer session 的原生 multipart 补传；
  可携带设备 `captureId`，结合原件 SHA-256 提供重试幂等与冲突检测。
- `/api/media/:assetId`：同一权限/可见性检查下下载离线封面。
- `GET /api/mobile/v1/home`：集中 service 查询后的最小家庭首页 DTO。
- `GET /api/mobile/v1/inbox`、`PATCH /api/mobile/v1/inbox/:id`、
  `POST /api/mobile/v1/inbox/:id/confirm`、`POST /api/mobile/v1/inbox/merge`：收件箱分页与整理闭环。
- `GET|PATCH /api/mobile/v1/memories/:id`：按软删除、家庭和角色策略读取/修改记忆。
- `GET /api/mobile/v1/search`：cursor 分页搜索；索引残留也会以当前软删除与可见性状态二次过滤。
- `POST /api/mobile/v1/memories/:id/contributions`、
  `PATCH /api/mobile/v1/contributions/:id`：复用现有作者、visibility 与 capability 服务。

所有移动响应均为 `Cache-Control: private, no-store`。API 不接受客户端提供 `familyId`，
始终从实时 session → User binding 推导家庭、角色、Person 和 guardian 状态；viewer 只能读取，
editor/admin 才能整理收件箱和修改事件。跨家庭目标统一按不存在处理。
