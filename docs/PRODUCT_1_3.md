# 1.3 从部署到全家使用

状态：1.3.0-alpha.1 代码与测试已合入 main（M0–M7 代码侧完成；真实
VPS/真机端到端验收与镜像发布见 docs/RELEASE_1_3.md 的未验证清单）。
审查基线 `main@3cd4d19842fea9222ef64d6decea4c7d6ac046a7` / `1.2.0-alpha.4`。
发布版本 `1.3.0-alpha.1`（原生展示版本 1.3.0；构建号 11）。

本轮只交付一条真实使用链：

VPS 部署 → HTTPS 家庭空间 → App 内初始化管理员并建立家庭 → 本机照片即存即看 →
明确同意后向该家庭同步 → 家人扫码/粘贴邀请在 App 注册 → 不同账号共享同一家庭 →
一键备份、升级、失败可诊断与恢复。

产品定位不变：一套自托管家庭服务（Web + API + Auth + SQLite + 原件 + worker）+
支持本机记录与离线阅读的手机客户端。不提供、不暗示任何官方云服务。

## 实施边界

- 复用现有上传协议、Collection、BookProject、PDF/EPUB、周回顾、导出/WebDAV 与邀请服务；
  不重做、不平行实现。
- App 端新增：首次启动引导、实例识别、初始化/受邀注册/登录、本机内容详情阅读、
  首次同步授权、本机救援包。
- 服务端新增：bootstrap/setup/me/onboarding 与邀请 preview/accept 的移动 API；
  运维工具 `ftc` 与子脚本。
- 不做：语义搜索、地图、多家庭 SaaS、社交、育儿统计、自创加密格式、
  Passkey/TOTP、六位码找服务器、零停机升级承诺。
- AI 默认关闭；无 AI/SMTP 也能完成全部核心流程。

## M0 事实审计结论（2026-09-06，基线 3cd4d19）

以下为逐条核实结果，均为本轮需要修复或补齐的起点，不是臆测：

1. **首个账号**：`lib/auth/setup.ts` 的 `performSetup()` 只创建首个 User，
   不建立家庭；完成后 Web 端登录再走 `/onboarding`（`completeOnboarding` 一次事务建
   Family + 孩子 Person + 本人 Person 并绑定）。App 端没有等价路径。
2. **App 登录的“必须有家庭”假设**：所有 `/api/mobile/v1/*` 路由经
   `authorizeApiFamilyRequest` → `getApiFamilyContext`（`lib/family/context.ts:88`），
   `binding.familyId` 为空时返回 null → 401。移动端把 401 统一显示为
   “登录已过期，请重新登录”（`mobile/src/api/client.ts`），账号实际有效但未建家庭时
   被误判为凭据失效，形成“初始化完成却进不去”的死循环。
3. **本机记录点击只弹提示**：`mobile/src/screens/TimelineScreen.tsx:109` 对
   `source === "local"` 的条目仅 `Alert.alert("本机记录", ...)`；不存在本机详情/
   阅读页。已入档（archived）的本机媒体仅在对应 Memory 事件里可见。
4. **保存与同步的耦合**：`CaptureScreen.saveText()` → `queued()`（AppContext）
   会触发 `runSync()`；本地写入本身先行落库，但按钮 busy 与同步状态混在一起。
   网络恢复/AppState active/凭据建立都会自动 `runSync()` —— 凭据一建立整个
   outbox 即自动上传，没有“先授权再上传”的门（`mobile/src/state/AppContext.tsx:251-287`）。
5. **失败清理会删原件**：`SettingsScreen.discardFailed()` 删除 outbox 行时同时
   `removeLocalFile()` 删除本机媒体原件（AppContext `discardFailed`）；与
   “取消上传不删原件”的目标冲突，需要拆分为不同操作。
6. **收件箱“确认”不带未保存编辑**：`InboxScreen` 的 `saveEdit`（PATCH）与
   `confirm`（POST confirm）是两个独立按钮；行内“确认”不提交当前编辑卡未保存的
   标题/时间/人物/地点。日期为正则文本输入（`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`），
   无原生日期控件。
7. **邀请仅 Web 闭环**：`lib/invitations/service.ts` 的 preview
   （`inspectInvitationToken`，GET 语义不消耗 token）与 accept
   （`acceptFamilyInvitation`，原子 claim + 幂等恢复）只被 Web Server Action
   （`app/invite/[token]/actions.ts`）调用；App 无扫码/粘贴/受邀注册路径，
   `familytimecapsule://` scheme 已注册但无任何 handling 代码。
8. **Compose 端口**：`docker-compose.yml:7-8` app 映射 `${APP_PORT:-3000}:3000`
   默认 `0.0.0.0`；新部署模板必须确保最终解析配置只经代理或环回暴露。
9. **升级语义**：镜像首次连库自动跑迁移（`docker/Dockerfile` + drizzle）；
   升级失败后无条件切回旧镜像可能造成旧代码读新 schema，需要快照配对。
10. **救援/导出**：移动端仅有逐条 `exportOriginalCopy`；无成批本机救援包。
    缓存大多全局单账号（`meta` 表、`timeline_event` 等），跨账号混用风险需在
    M4 一并处理（`memory_detail` 已按 scope 隔离，可作范式）。
11. **worker 健康检查**：仅 `process.kill(1,0)` 级进程存在性探测；运维工具需
    补有界心跳/只读探针。
12. **版本基线**：根与 mobile `package.json` 均 `1.2.0-alpha.4`；`app.json`
    `version 1.2.0` / buildNumber 10 / versionCode 10。原生目录为 CNG
    （`expo prebuild`），无 ios/android 持久目录；Android 发行签名未固定
    （历史测试包为 debug 签名），iOS 无证书。

基线验证（2026-09-06，依赖完整安装后）：
- mobile：typecheck ✅、lint ✅、23 文件 / 112 测试全绿。
- 根：typecheck ✅、lint ✅、86 文件 / 597 测试中 588 通过；9 项失败均为
  本机 Windows 环境依赖（无 ffmpeg/ffprobe、symlink 需特权 EPERM、
  pdftotext CJK 提取差异），在 Linux CI 上为绿；不视为代码回归，
  以 push 后 GitHub Actions 为准。

## 需求 ↔ 测试对照

| # | 需求（GOAL 条目） | 主要验收测试 |
| --- | --- | --- |
| R1 | GET /api/bootstrap 最小实例识别（版本、setup 状态、instanceId），不泄露内部信息 | unit：新实例/已初始化/响应形状；集成：不返回邮箱、人数、token |
| R2 | POST /api/bootstrap/setup 复用 performSetup；Web/App 并发只有一个管理员；响应丢失可登录续走 | unit/integration：错误令牌、已初始化、并发提交、限流；e2e：setup 后登录 |
| R3 | GET /api/mobile/v1/me 区分 authenticated/needsOnboarding/ready/revoked；无家庭不再 401 | unit：session 解析；集成：未绑定账号、已绑定、过期 session |
| R4 | POST /api/mobile/v1/onboarding 复用 completeOnboarding，服务端控制 role/family | integration：重复提交一个家庭；中断后继续；非法输入 |
| R5 | App 首启四入口 + 地址校验（拒 userinfo/非 http/带 query token 等） | mobile unit：URL 校验、入口渲染、导航 |
| R6 | 邀请 API：preview 不消耗 token；accept 原子、幂等、一次失效 | integration：过期/撤销/重复/竞态 claim；unit：preview 形状 |
| R7 | App 扫码/粘贴完整邀请链接 → 确认目标 → 注册 → 自动登录绑定 | mobile unit：链接解析、深链白名单；e2e：两账号同家庭 |
| R8 | 本机图片/视频/音频/文字详情直接打开；文件缺失有真实错误 | mobile unit：详情数据装配、文件缺失分支；组件测试 |
| R9 | 保存(saved)/同步(queued...)/整理(pending_review) 状态分离；保存不等同步 | mobile unit：状态机；组件：保存按钮解除 busy |
| R10 | 收件箱“确认”携带当前未保存字段一次提交 | unit（服务端 confirm 幂等键）；mobile 组件：编辑后直接确认 |
| R11 | 首次连接上传需显式授权；切换账号/家庭后队列目的地隔离 | mobile unit：授权门、generation fence；集成：A→B 不外传 |
| R12 | 暂停/仅本机保留/删除记录互不混淆；取消上传不删原件 | mobile unit：各操作对 outbox 与文件的效应 |
| R13 | 本机救援包导出/恢复（staging 校验、无凭据、恢复默认不上传） | mobile unit：清单与哈希；集成：往返恢复 |
| R14 | ftc install/status/doctor/upgrade/backup/restore/rollback/logs/stop/start/cleanup | Bats/ShellCheck：参数、幂等、锁、失败阶段 |
| R15 | 两种网络模式（Caddy 自动 HTTPS / 已有反代环回）最终 Compose 无公开 3000 | Docker 集成：`docker compose config` 断言 |
| R16 | 升级流程：预检→停写→快照→迁移→验证→开放；四类失败分别处理 | 集成：注入下载/迁移/健康失败；旧数据升级 |
| R17 | 发行：manifest（版本、SHA、digest、SHA256SUMS）、同签名升级 | CI 产物核对；签名路径检查 |

## 版本与发布约定

- 版本 `1.3.0-alpha.1`（root/mobile/lock 一致）；原生展示版本 `1.3.0`，
  buildNumber/versionCode = 11（在当前 10 基础上递增）。
- 只在 main 开发；每个垂直切片 commit + push；CI 绿后才可发布 prerelease。
- 文档只描述已实现并验证的命令与端点；本文件随里程碑推进更新状态。
