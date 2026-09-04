# 1.1 alpha 发布验收报告

> 候选版本：`1.1.0-alpha.1`
> 验收日期：2026-09-04
> 发布类型：GitHub prerelease；不是 stable `1.0.0` 或 `1.1.0`
> 真实设备结论：未执行。系统分享、Files/iCloud/DocumentsProvider、安装、离线杀进程和
> 锁屏通知只能在 `REAL_DEVICE_TEST.md` 获得人工证据，云构建与自动化不能替代。

## 发布范围

本 alpha 将 Capture Anywhere 与 Family Rhythm 建立在既有私人、自托管、单家庭档案上：

- Web/原生/匿名访客使用持久 ImportSession 和顺序式断点续传；大文件路径不把完整原件放进
  JS heap，完成前临时文件不可读取，完成后只生成一个 Asset 与一个 InboxItem。
- Web 批量导入固定最多三项并发；PDF、TXT、Markdown、RTF、DOCX 是安全 document Asset，
  原件 SHA-256、Inbox/MemoryEvent 关系、导出恢复和引用清除守卫与其他素材一致。
- Android 声明 SEND/SEND_MULTIPLE；iOS 包含正式 Share Extension 与共享 App Group；Files、
  iCloud Drive 和 DocumentsProvider 选中的内容先复制到 App 私有存储，无服务器也可持久排队。
- 家庭投递箱复用 Contribution Request 的 256-bit token/hash、过期、撤销、限流与审核模型；
  无账号访客只能提交，不能读取家庭资料，内容始终先进入 Inbox。
- 原生 People、Stories、Capsules、Requests、Contribution Portals、Import Sessions 与 Weekly
  Review 使用最小移动 API、cursor 与独立离线缓存，高频日常路径不再以浏览器为主入口。
- Web/原生每周回顾按家庭时区整理 Inbox、人工重点和家人声音；无 AI 也能生成逐段有来源的
  Story 草稿。通知默认关闭、可拒绝，正文固定且不含私人内容。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| Web Vitest | 76 files / 525 tests，通过 |
| Playwright production E2E | 38 tests，通过 |
| Production disaster roundtrip | 6 tests，通过 |
| Next.js production build | Next 16 webpack production build，通过 |
| Mobile | 8 files / 44 tests；TypeScript、ESLint、Expo Doctor 21/21，通过 |
| Expo export | Android/iOS Hermes bundle，通过 |
| Dependency audit | Web production dependencies 0；mobile production dependencies 0 |
| Benchmark | 10k events / 50k asset metadata；500 MiB resumable 生成流 0.3s，峰值 RSS 增量 0.1 MiB |
| Docker | 镜像 build；app/worker health；deployment smoke；worker once；volume down/up 持久化，通过 |
| Archive/restore | document SHA、1.1 全关系图、token 排除、入口 closed、旧 v1 默认值与二次导出，通过 |

最终 main push 后仍以 GitHub Actions 的 `web-quality`、`mobile-quality` 与
`e2e-restore-roundtrip` 全绿为 tag 前门禁；tag workflow 的 React Native quality、Android、
iOS 与 release job 全绿为 prerelease 完成门禁。具体 run、tag SHA 与最终产物 SHA-256 以
GitHub prerelease 附件和本轮交付记录为准，不能在运行前预填。

## Portable archive 与升级

`exportVersion` 保持 1，当前归档为 25 个非媒体文件加原件。新增八份关系文件：

- `import-sessions.json`
- `import-session-default-participants.json`
- `import-session-items.json`
- `contribution-requests.json`
- `contribution-request-submissions.json`
- `contribution-portal-submissions.json`
- `review-periods.json`
- `review-period-events.json`

这八份文件必须全有或全无；部分关系图在任何原件写入前拒绝。旧 v1/rc.4 全部缺失时按空关系
恢复，家庭周设置使用安全默认值。UploadSession、临时文件、User/session、guest token/hash 与
设备通知授权不导出。request/portal 恢复后强制 closed 且没有 token，只有家庭成员主动换发后
才可重新开放。恢复事务逐表复核，失败不会留下半恢复数据库或原件。

## 性能与安全边界

- `/api/uploads` 以原始二进制 `PATCH` 顺序追加 8 MiB chunk；offset 不一致返回服务器事实，
  重复 chunk、断线续传、重启磁盘对账、超量、MIME 伪装与 complete 响应丢失均有回归测试。
- Web worker pool 固定三项；100 项不会创建 100 个并发上传。旧 multipart 端点只为小文件
  兼容，继续受 Content-Length 与单文件上限约束。
- 临时路径完全由服务器生成；active session、家庭临时空间、文件大小、清理批次均有限制；
  complete 流式哈希/嗅探后原子发布，过期清理不删除已完成原件。
- 所有新鉴权 API 从 session 或匿名 token scope 推导 family/capability，不接受客户端 familyId；
  跨家庭统一 404。未到期胶囊不通过移动 DTO 暴露内容。
- Share Extension 不持服务器凭据；Android 只读取 Intent 临时授权 URI；通知不含标题、照片、
  人物或家人原话；HTML/SVG/Office 宏不执行。

## 原生 prerelease 自动化

`.github/workflows/mobile-build.yml`：

- 手工运行只接受 `main`；`v*` tag 还必须匹配语义版本格式且 tag SHA 属于 `origin/main` 历史；
- 从 `mobile/app.json` 动态验证展示版本、Android versionCode 与 iOS buildNumber；
- APK 必须有 Hermes、SEND/SEND_MULTIPLE intent filters、正确 package 与 v2 签名；
- unsigned IPA 必须有 ARM64 主 App、`PlugIns/*.appex` ARM64 Share Extension、独立 bundle id
  与主 App 相同的 App Group；
- tag 的 Android/iOS job 成功后生成 `SHA256SUMS.txt`，用最小 `contents: write` 权限创建 GitHub
  prerelease，并上传 APK、unsigned IPA 与校验文件。构建产物不含证书或家庭数据。

## Tag 前后检查

1. 最终提交 push `origin main`，等待完整 main CI 全绿。
2. 确认本地 `HEAD == origin/main`，且将要标记的 SHA 是 `origin/main` 历史。
3. 创建 annotated tag `v1.1.0-alpha.1` 并普通 push；禁止 force push、分支或 PR。
4. 等待 tag workflow 四个 job 全绿并确认 GitHub release 标记为 prerelease。
5. 下载 APK、unsigned IPA 与 `SHA256SUMS.txt`，独立复验 ZIP、SHA、版本、package/bundle id、
   Hermes、Android share filters、iOS appex/App Group/ARM64。
6. Release notes 必须明确真实设备未验证；不得创建或暗示 stable 标签。

## 未完成的真实设备门禁

以下项目在本报告中全部保持未验证：真实 Android/iPhone 安装与签名、系统分享菜单呈现、
Android 冷启动和 `content://` 授权生命周期、iOS Extension 中断/重放、iCloud/Files provider、
杀进程后的离线原件、真实 500MB 网络续传、浏览器录音/扫码、通知授权/时区变化/锁屏文案。
它们必须逐项记录设备、OS、签名方式、日期和结果；不影响 alpha prerelease，但阻止 stable。
