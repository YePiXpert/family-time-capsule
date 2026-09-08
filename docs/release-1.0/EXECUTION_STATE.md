# 正式 1.0 连续执行状态（Astra / Codex）

## 基线与当前进度

- 起始：`b67f51289ace8cb666c3ea52964de5b798d5dd28`，CI `34169185541` success，已实际 pull/核对。
- 已推送：`045b5e2` 日期真实手机 hook 修复及 HTTP/独立库/导出恢复；其 CI `34182633511` 暴露旧配额测试日期碰撞。
- 已修复推送：`8a2c73efd0220785addc24b0808c4bb05797d35c` 测试账本按用例隔离；CI `34183060802` 四项全部 success（含 production E2E/恢复）。没有降低调用次数断言或靠 rerun。
- 已推送：`7e9c264c651b53fd36a3323735b4d4d4933a5383` P0-A/B 完整读者选择与追加迁移；CI `34183826416` 四项全部 success，已核对同 SHA。
- 已推送：`3b87b6417ae6e545c6688277b567f5154aa030ce` P0-C 私密续传；CI `34185777483` web/mobile/ops success，E2E失败：旧用例把“保留草稿”当作家庭投递。保留隐私边界，改用明确的“交给家人整理”，全部原断言保留。
- 已推送：`52f58ae6af5f52065120be71189da333db895940` P0-C Live Photo 与明确整理修订；CI `34188472925` 四项全部 success。
- 当前修改：P0-D 统一 AI 派发、配额、授权、出站检查与显式幂等检索，正在完成最终门禁后提交。
- 开发版本保持 `1.0.0-dev.1`，只在 main；dev 用户；未操作生产。检测到同目录 opencode 后已询问并发状态，未停止进程，未发现并发文件修改。

## P0-A/B 实际证据

- P0-A：手机过去把 Person ID 作为 readerUserIds，已有 capture-screen 测试还固化该错误。现在参与人物保留 Person ID；最小 draft-readers API 仅返回有效同家庭账号 id/name，不授予账号管理权限。
- 新 HTTP 回归进一步发现 0052 draft CHECK 仍不接受 members。0061 追加重建迁移修复，保留旧正文、draft_item 与 import_session 引用、FK/索引，旧迁移不变。
- 双端显示已失效选择并可主动移除，手机可显式重新核对成员；断网不静默改读者。服务端在保存/发布复验停用/退出/其他家庭账号。
- P0-B：共享 isDraftDateComplete；unknown 无日期可保存，其余五档缺日期拒绝。真实手机保存重开与 Bearer API/新目录导出恢复已通过，时间仍不详且正文保留。
- 新 `native-capture` production E2E：启动真实 React Native 记录页控件/hook（平台组件替身），实际 SQLite→syncLocalDrafts→真实 fetch→Next 生产 API/SQLite；B 200，未选 C 管理员 404。不是手工重造手机 DTO；不是设备验收。

## P0-C 上传里程碑与验证

- 0062 追加 upload_session.draft_id/instance_id 与索引；绑定不随草稿删除置空。所有新草稿原件在发布前保持作者私密，返回 finalAssetId 而不造家庭 inbox。每次操作校验账号/家庭/草稿；公共旧回执保持既有共享，未完成旧传输可收紧到私密。
- Web/手机先保存服务器草稿再上传；手机保留真实 Files/分享批次，不再经普通 outbox 公开投递。分块前/complete 前检查连接代际与草稿版本，重复原件对账同步修正封面而不删除本机原件。
- owner/admin 不能通过其他作者的上传 ID/批次详情读取或改写。小文件重复上传不再误造私密 inbox；明确交给家人整理才授权实际媒体读取；单纯可读的私密来源不能再次发布。
- Linux flock 文件描述符锁保护跨进程临时写入与 complete；独立进程 SIGKILL 后自动释放，不删锁绕过。不存在 ID 不创建锁文件；删除草稿/停用作者不阻断过期暂存清理。
- 独立只读审查提出的六个反例已修正：孤立暂存清理、重复引用、旧公开回执、显式整理读取、Files 批次、随机 ID 锁文件。
- 根全量 124 文件 / 788 项通过：`/tmp/ftc-private-root-final.log`。root typecheck/build/lint 通过（14 条既存 warning，无 error）。
- 手机全量 47 文件 / 250 项通过，另新增重复照片/封面对账 1 项单独通过（draft-sync 4/4）；typecheck/lint 通过。
- production E2E native-capture 3/3：真实手机控件/hook/SQLite/fetch → Next生产HTTP，照片 + Files照片 + 9 MiB合成PCM WAV；分别丢弃complete与8MiB分块响应，重开再同步，最终3私密原件且零inbox关联；Web私密附件只同步/重开/发布；失效读者移除。平台设备组件为替身，不是真机验收。
- 真 Docker 镜像 `sha256:904eedffd7b3fd7b88379610756ef7ab38acb3c431eb455b619b27f7f180ff7b`，包含 util-linux；`scripts/verify-private-upload-container.py --image ftc-local-check:private-upload-20260908` 新建带唯一标记的容器/卷，两次真实重启验证分块和complete恢复、原件hash一致、其他管理员404，测试资源已清理。日志 `/tmp/ftc-private-docker-smoke.log`。这是当前上传实现冒烟，不是正式候选或生产部署。
- 旧 reader里程碑根测试误触开发目录所留保护快照仍未删改；后续所有测试 DATA_DIR 均隔离。

## P0-C Live Photo 与整理修订

- 0063 追加 draft_item/memory_event_asset 的组与组件角色；0064 追加 reviewed_revision，旧整理草稿回填当前 revision。旧客户端省略配对字段会保留已有关系；移除单侧明确拒绝。
- 手机相册读取原生 pairedVideoAsset；静态与动态原件使用既有摄取回执，在同一 SQLite 事务写草稿引用。复制中断恢复到原账号，缺失组件明确标记并阻止同步/发布；目标已关闭、改变或满容量则留独立私密恢复草稿。完整组移除不删原件。
- Web/手机允许用户明确把分别导入的照片与视频配对，不猜文件名。网页预览等待 IndexedDB 事务提交，避免读取空预览；保存失败继续显示未落盘，重试成功后重新读取。
- 草稿、发布、明确整理/合并、阅读、家庭归档和新目录恢复都保留双组件引用、说明与用户顺序。恢复测试包含真实 202 份原件的合并事件，不能误套 200 份草稿上限；归档附加伪造关系 ID 不会覆盖目标引用。
- 已交整理的草稿后续普通同步保持新增正文/原件私密；明确重提才更新家庭收件箱。确认/修改/合并/废弃均拒绝尚未重新提交的版本，旧确认快照不能关闭新草稿。手机保存与确认传递输入所属修订号，409 保留输入。
- 独立只读审查发现的恢复容量、超大合并恢复、归档字段覆盖、缺失组件堵塞同步、整理快照竞态及手机旧编辑版本问题均已加回归修复。
- 根全量 124 文件 / 790 项通过（`/tmp/ftc-livephoto-root-final.log`）；最后整理冲突及顺序修改的 3 文件 / 30 项集成回归通过（`/tmp/ftc-livephoto-review-final-pass.log`）。手机全量 49 文件 / 266 项通过，build/typecheck/lint 通过（根 14 条既存 warning），日志 `/tmp/ftc-livephoto-*-final-pass.log`。
- production 全量 E2E 67/67、disaster roundtrip 7/7 通过：`/tmp/ftc-livephoto-e2e-verified.log`、`/tmp/ftc-livephoto-roundtrip-verified.log`。包括真实手机 UI/hook/SQLite/fetch→生产 Next 的相册 Live Photo、动态组件分块/complete 丢响应，以及 Web 分别导入后手动配对/发布/重开。最后整理修订增量已重建，native-capture/inbox-draft/merge 10/10 通过（`/tmp/ftc-livephoto-final-production.log`）。
- 以上是平台组件替身与实际本地存储/HTTP 的自动化，不是真机相册、录音或音频焦点验收。Live Photo 新迁移 Docker 镜像 `sha256:eb705b4f91217888efbec330bd6545b129c27c5c57e8fccc38e9e986ea12924a` 两次真实重启续传/complete 验证通过，测试资源已清理；日志 `/tmp/ftc-livephoto-docker-smoke.log`。

## 下一个动作

P0-C 原件与 Live Photo 已贯通自动化；继续服务器恢复世代与全部再分享旁路。R08 私密正文持久来源与权限保真导出恢复仍有内部缺口，必须继续修复；不把该里程碑当作私密记忆全链路完成。

P0-D 实现与证据：

- 0065 追加 `ai_dispatch` 和 `ai_search_operation`（实例/账号/配置/同意版本绑定），原迁移不变；只存派生状态，家庭 archive 不包含这些表。
- 真实发送工厂覆盖 worker、搜索、诊断；预留先持久提交，再在 SQLite immediate 事务内重新授权并开始发送。跨进程撤权已用独立 Node 进程复现与验证；确认未发送退回额度，发送状态不确定仍计数。
- 关闭限额仍计数；音频实际字节经有界 ffprobe，亚秒向上取整，未知拒绝。六个独立进程竞争 SQLite 配额、UTC 日界、重启不重复不确定操作均通过。
- 自然检索为显式 POST；结果按账号/同意版本短期存储。普通作者无须账号配置权限；撤权再启用不复活旧结果。严格计划拒绝非法/被截断条件，人物未解析不放宽，人工筛选优先，包含式月末一致。
- 新生产浏览器回归实际发现 no-referrer 下原生 POST 的 Origin:null 被拒绝；改为同源 fetch 按钮，未放松 CSRF。浏览器验证真实保存/发布二月末与三月初记忆、转换、刷新/预取/重复提交、手动日期媒体及配额耗尽，1/1 通过（`/tmp/ftc-ai-search-e2e-third.log`）。
- MiMo Base64 10 MB 和非 stop 截断响应拒绝；真实 601 秒音频回归先复现静默截断，再修复为明确 too_long。Luna Responses 设置 store:false；官方文档链接已写入 AI_PROVIDERS/AI_PRIVACY，三项真实模型仍未验收。
- 最后根全量 128 文件/809 项通过（`/tmp/ftc-ai-reviewed-root-full.log`）。手机全量 49 文件/266 项及最后 quota DTO 3 项通过；root/mobile typecheck/lint、production build、build:ops、ops 4 文件/34 项通过。root lint 为 13 个既存 warning，无 error。root/mobile 生产依赖 npm audit 均为 0 漏洞。
- 审查新增上游 HTTP 600 导致未捕获异常退出、`.localhost` 合法 loopback 配置被误拒绝两项反例，均以真实 HTTP/独立进程测试先失败后修复；检查地址固定，非 loopback 解析仍拒绝。最后 5 文件/24 项回归通过（`/tmp/ftc-ai-reviewed-regressions.log`）。
- 最终 production 全量 E2E 68/68 通过（`/tmp/ftc-ai-e2e-reviewed-full.log`），disaster roundtrip 7/7 通过（`/tmp/ftc-ai-roundtrip.log`）。前一次出版失败为最后 Web build 清除了旧 build:ops 产物，已按 build→build:ops 顺序重建并重跑全量；未改原测试或断言。
- 真 Docker 镜像 `sha256:62aecbf04a6e86a4adbf3b68054830f337cd9564e4f210f6df8580d543779e53` 的 loopback/Caddy 双模板均通过 app-worker 启动、隐藏配置、三能力真实 HTTP fixture、status 零调用、401 脱敏、第五次诊断被共享配额拒绝、重启与关闭；每模式实际 4 次 fixture 请求，测试资源已清理。日志 `/tmp/ftc-ai-docker-reviewed-smoke.log`。未启动公网代理、调用真实模型或操作生产。

私密正文当前仅发布时索引，详情/重建/恢复仍须补；当前 CAP-1/ID-11/ID-12 保留部分实现，全部内部工程远未完成。

## 后续与外部阻塞

继续现有 REQUIREMENTS 的认证生命周期、增量同步、adopt/升级/恢复协调、交接/加密副本、手册/许可/评测与性能；不重做既有系统。
真实 Luna 文字/图片、MiMo 语音、长期签名、双平台真机和生产授权仍缺。用户 2026-09-08 明确为私人自用，法律审核不作为本次交付门禁。基础许可/合成样本、runner、候选产物及当前可做工程属于内部工作；不得据此停止或声称正式 1.0 已发布。
