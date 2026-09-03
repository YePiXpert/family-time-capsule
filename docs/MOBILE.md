# 原生 iOS / Android 客户端

`mobile/` 是 Expo SDK 57 + React Native 的原生客户端。它渲染 UIKit/Android View
对应的原生组件，使用原生 SQLite、Keychain/Keystore 和文件系统模块，**不是 PWA，
也没有 WebView**。Next.js 仍是家庭档案的权威服务器和媒体处理端。

## 本机与服务器各自保存什么

| 数据 | 设备 | 家庭服务器 |
| --- | --- | --- |
| 时间轴、人物、同步状态 | SQLite 离线副本 | 权威 SQLite |
| 离线封面 | App 私有文件目录 | 权威原件/衍生物 |
| 刚选择的照片/视频 | 立即复制到 App 私有目录并进入 outbox；服务端确认后清理临时副本 | 联网补传后进入收件箱 |
| 离线文字 | SQLite outbox | 联网补传后进入收件箱 |
| 会话令牌 | Keychain/Keystore | 可撤销的 session 行 |
| 真实家庭数据 | 不写入 IPA/APK | 不写入源码或构建产物 |

同步采用完整快照分页：只有所有页面成功后才清理本机已从服务器删除的旧行，因此中途断网
不会把可用离线数据误删。文字和媒体 outbox 都使用设备预生成 UUID；媒体上传同时校验
原件 SHA-256，同一个 `captureId` 重试同一原件会返回成功，重用 ID 上传不同内容则返回
409。即使网络在服务器落盘后中断，下一次补传也会补建收件箱关联而不会产生第二条待办。

当前原生端覆盖：邮箱密码登录、权限感知、完整时间轴/人物离线副本、离线图片封面、
离线文字记录、现场拍照、相册照片/视频本地保全与补传、自动/手动同步、本机数据说明和
安全退出。设置页会列出失败待办与错误/尝试次数，可立即重试或在二次确认后放弃；单条
不受支持的素材不会阻塞后续待办和时间轴拉取。新记录仍进入现有服务器收件箱，由完整
Web 工作台完成校时、合并和确认入档。

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

API 不接受客户端提供 `familyId`，始终从实时 session → User binding 推导家庭和角色。
