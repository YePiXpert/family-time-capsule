# 正式 1.0 连续执行状态（Astra / Codex）

## 基线与当前进度

- 起始：`b67f51289ace8cb666c3ea52964de5b798d5dd28`，CI `34169185541` success，已实际 pull/核对。
- 已推送：`045b5e2` 日期真实手机 hook 修复及 HTTP/独立库/导出恢复；其 CI `34182633511` 暴露旧配额测试日期碰撞。
- 已修复推送：`8a2c73efd0220785addc24b0808c4bb05797d35c` 测试账本按用例隔离；CI `34183060802` 四项全部 success（含 production E2E/恢复）。没有降低调用次数断言或靠 rerun。
- 已推送：`7e9c264c651b53fd36a3323735b4d4d4933a5383` P0-A/B 完整读者选择与追加迁移；CI `34183826416` 四项全部 success，已核对同 SHA。
- 已推送：`3b87b6417ae6e545c6688277b567f5154aa030ce` P0-C 私密续传；CI `34185777483` web/mobile/ops success，E2E失败：旧用例把“保留草稿”当作家庭投递。保留隐私边界，改用明确的“交给家人整理”，全部原断言保留。
- 已推送：`52f58ae6af5f52065120be71189da333db895940` P0-C Live Photo 与明确整理修订；CI `34188472925` 四项全部 success。
- 已推送：`ffe9562bc05adc94514215897c3eb6365cb4895c` P0-D 统一 AI 派发；CI `34191966044` 四项全部 success，已核对同 SHA。
- 已推送：`9b23344cccabe9ed4258310c7d40c1427cd1cce4` R08 正文及权限归档；CI `34196205302` Web/mobile/ops 和 production E2E/恢复通过，最后历史升级脚本预期缺少新增 body_text 字段而失败。
- 已推送修复：`4b7b752d675d51d4b7abaf640d73799e54dca14a` 补齐完整旧行迁移预期；实际 `verify-upgrade12.mts` 的历史建库、正常升级、失败回滚、旧归档恢复/再导出及五份原件 hash 全部通过（`/tmp/ftc-r08-upgrade-ci-fixed.log`）；CI `34197311786` 四项全部 success，已核对同 SHA。
- 已推送：`d1f0d6c12430490955838271bc8b64932944c6c0` R09 资料库/命名作者权限；CI `34198425767` 四项全部 success，已核对同 SHA。
- 已推送：`d67c62b1ecc387684fa2449baa58b263d6ab2b29`（含 `789fef3` 讲述及 `d67c62b` 访客相册）；CI `34199522610` 四项全部 success，已核对同 SHA。
- 已推送：`b23c3409ec160270c6d4e13db9d44ce0ccb1c26e` R10 故事/任务来源与 v3 归档；CI `34202975077` 四项全部 success，已核对同 SHA。
- 已推送：`c6f32be5fb7ce89870d31b15bf816471c97ca286` R09 阅读包最终响应授权；CI `34204259752` 四项全部 success，已核对同 SHA。
- 已推送：`9db3cdb4b692b4af6863a8e223981800babf5ab2` R09 事实/回收站管理；CI `34205380014` 四项全部 success，已核对同 SHA。
- 当前里程碑：R09 详情/事实来源与最终响应；下一步已有事件双端分享/撤销和受控缓存。
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

继续 R09/R10 的作品、派生缓存与撤权旁路，再完成账号生命周期、增量同步及恢复协调。旧快照无法证明最新撤权状态的问题仍属内部待实现；不把 R08 当作整个私密记忆链路完成。

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

私密正文已在下述 R08 持久化；CAP-1/ID-11/ID-12 因全派生和缓存尚未闭合而保留部分实现，全部内部工程尚未完成。

## 后续与外部阻塞

继续现有 REQUIREMENTS 的认证生命周期、增量同步、adopt/升级/恢复协调、交接/加密副本、手册/许可/评测与性能；不重做既有系统。
真实 Luna 文字/图片、MiMo 语音、长期签名、双平台真机和生产授权仍缺。用户 2026-09-08 明确为私人自用，法律审核不作为本次交付门禁。基础许可/合成样本、runner、候选产物及当前可做工程属于内部工作；不得据此停止或声称正式 1.0 已发布。


## R08 私密正文与归档恢复

- 0066 追加 `memory_event.body_text`：从有序旧收件正文或已发布草稿回填，不重复镜像；后续直接持久化正文。删除已发布草稿、清空及重建索引后，详情和作品仍读到正文；显式空正文不从旧草稿复活。
- 归档格式 v2 必须携带 `privacy.json`；普通导出与 WebDAV 仅包含当前账号可读的事件、原件与完整来源可读的关联作品/事实/历史版本。主机灾难导出单独使用 `buildDisasterExport`。哈希期间并发撤权会使导出失败且删除未交付 ZIP；真实独立 SQLite 进程回归通过。
- 0067 恢复身份使用禁用占位账号，不按同名或 Person 自动授予私密正文、原件、草稿、个人书籍。维护者显式通过 `restore:principals` 或首次 `restore --bind-self` 绑定；实际 CLI 子进程验证作者/读者重定向、幂等、禁止普通启用与改绑。归档不带密码、会话或 API Key。
- 0068 个人书籍改以 User 归属；旧库只迁移已经存在的明确 User/Person 绑定，之后创建同名/同人物账号不会接管未知作者作品。个人回顾查找、主页与打开均核对账号；无 Person 的作者也能使用个人书籍。
- v1 兼容恢复按草稿中的限制性证据隔离私密/指定成员正文及尚未发布的原件；缺少历史权限证据的旧归档无法推断原读者，文档如实说明。已提交的家庭整理收件保留当时说明和原件回执，不泄露随后未重新提交的修改。合集事件正文摘要、日期、封面与计数实时复验读者；撤权留下不可读占位，不能通过猜 ID 新增。
- 根全量 131 文件/815 项通过（`/tmp/ftc-r08-root-final.log`），身份 CLI 增量 1 项通过（`/tmp/ftc-r08-cli-test.log`）；root typecheck/build/build:ops/lint 通过，13 条既存 lint warning，无 error。手机 49 文件/267 项、typecheck/lint 通过，Expo Doctor 21/21。ops 4 文件/34 项、disaster roundtrip 7/7 通过。
- 真 Docker 镜像 `sha256:0da9390accffec1a764c6a0e59228ce27564dfe6ebbe8af675bb90f58d194722`：三次容器重启，私密续传/complete 对账、删已发布草稿后 HTTP 正文仍可读、实际下载 ZIP、容器内 verify/新目录 restore/显式身份绑定均通过；第三账号始终 404，合成原件 SHA256 一致。测试容器/卷均核对唯一标记后清理。日志 `/tmp/ftc-r08-docker-smoke.log`；不是生产部署或正式候选。
- 完整 production E2E 68/68 通过（`/tmp/ftc-r08-e2e-final.log`）；修复历史升级预期后的 `4b7b752` 同 SHA CI 全绿，包含 Android/iOS export。最终正式候选整套门禁在后续内部功能完成后复验。


## R09 资料库与命名权限

- 公开原件加入私密事件后，原件仍可阅读；资料库关联列表和已引用状态只包含当前账号可读事件。向已有事件添加原件时，在同一事务内重新检查事件读者、编辑权限及原件再分享权限。
- 草稿摄取、资料库元数据和命名使用同一原件管理检查：私密原件的指定读者不会因此得到改名、改时间、删除或转投其他事件的权限；作者和明确交付家庭整理的来源继续可整理。个人事件的命名预览/修改也重新检查读者与作者权限。
- 真实 API/SQLite 失败用例先暴露关联标题和命名入口泄漏，修复后通过。根全量 132 文件/817 项通过（`/tmp/ftc-r09-library-root.log`，命名增量前）；最终命名、草稿、私密恢复等 5 文件/17 项回归通过（`/tmp/ftc-r09-library-final-regression.log`）。最终 production build/build:ops、类型检查、lint 通过（13 条既存 warning）；最后资料库/命名及 native-capture 组合生产 E2E 5/5 通过（`/tmp/ftc-r09-library-e2e-final.log`）。
- 独立只读审查确认后续内部任务：讲述的父事件读者、访客相册原件授权、在线故事来源撤权，以及阅读包文件响应前的最终范围核查；这些仍待修复，不计入已完成范围。


## R09 家人讲述与媒体父事件授权

- 讲述读取、编辑及新增同时核对父事件当前读者；“讲述作者”和“family 讲述”均不能绕过事件撤权。人物档案、家庭最近讲述/声音摘要不泄露私人事件。
- 私密原件经讲述引用读取时，单个媒体与批量封面/索引查询都复验父事件。已独立全家共享的原件保持可读，但私人事件上下文不再允许自动 AI 处理。原件、衍生图与 Range 均有实际 HTTP 验证。
- 三个失败用例先复现读取/媒体/新增旁路（`/tmp/ftc-r09-contribution-red.log`）；修复后根全量 133 文件/821 项通过（`/tmp/ftc-r09-contribution-root.log`），最后新增独立共享原件正向对照后该文件 4/4 通过（`/tmp/ftc-r09-contribution-final-test.log`）。类型检查、lint、production build/build:ops 通过，13 条既存 lint warning。
- production native-capture 4/4 通过（`/tmp/ftc-r09-contribution-e2e2.log`）：真实手机记录/同步上传的私密 WAV 被同家庭讲述引用后，指定 B Range 206，未选 C 404，C 也不能改写/新增讲述。此段分享状态由隔离测试库设置；已有事件的 Web/原生分享编辑入口尚须接通，不宣称已完成用户 A 分享再撤销的全流程。
- 独立只读审查完成；访客相册、在线故事、阅读包最终响应与受控缓存撤权继续处理，ID-11/ID-12 保持部分实现。


## R09 访客相册与私密原件

- 相册成员关系不再作为原件公开授权。访客条目仅展示当前全家可见事件；原件/衍生物须有独立家庭共享、明确整理回执或当前家庭发布的事件引用。家庭发布的 private-root 媒体仍可播放，事件收紧后旧链接立即重新检查。
- 每次解析、列条目、读媒体都复验签发账号仍属于该家庭、启用且持有管理权限；缓存的 ResolvedReadGrant 也不能绕过停用、撤销或过期。创建在事务内拒绝失效账号上下文。
- 三个真实 SQLite/HTTP 用例先失败（`/tmp/ftc-r09-guest-red.log`），修复后访客、旧链接及讲述 3 文件/11 项通过。根全量 134 文件/825 项通过（`/tmp/ftc-r09-guest-root.log`）；production build/build:ops、类型检查、lint 通过，13 条既存 warning；最终新增文件 lint 0。独立只读审查未发现新旁路。
- production collections 4/4 通过（`/tmp/ftc-r09-guest-e2e-fixed.log`）：实际 Web 私密新照片上传/发布、选择相册、生成访客链接，无账号浏览器先无法发现标题/媒体，家庭范围后 Range 206，撤回后标题消失且 Range 拒绝。范围变更仍由隔离测试库设置，已有事件双端编辑入口另行实现。首跑新测试误用不存在的日期控件标签，修正为实际“时间记得多清楚”，未改应用行为。


## R10 故事来源与生成提交

- 故事组装只收集当前家庭可读、已确认且时间有依据的事件；确认事实还要核对其底层引用。旧故事的列表、正文、搜索、作品引用和回收站都复验来源。未知时间不混入按周期自动生成。
- 模型结果先准备，在任务最终复验事务中才写入；素材指纹变化拒绝写入，重新生成失败不先删除旧草稿。中央 AI 事件/讲述来源同时复验父事件权限、正文、读者及源版本，撤权/修改使旧任务失效。
- 0069 追加故事级完整输入依赖，删除段落不能抹去模型标题或其他段落的来源。优化周记也持久保留全部输入依赖，核对目标和素材指纹；有界批次之外的段落保持原文及位置。真实 70 段回归先复现尾部 10 段丢失，再修复。
- 独立只读审查找出的首段依赖删除、旧恢复抹去任务来源、standalone verifier 漏查引用、回收站标题旁路均已处理。0069 不猜旧行的模型来源，全部保留原文并置未证实状态。
- 新归档协议 v3（产品版本不变）；兼容读取 v1/v2，旧稿缺少完整清单保持未证实。v3 故事字段必须存在，四类引用在 standalone verify/restore 均校验，个人导出和年册来源均包含故事级依赖。未编辑的生成草稿不进入耐久归档时，回顾保留且清除悬空草稿链接。
- 失败证据：`/tmp/ftc-r10-story-red2.log`、`/tmp/ftc-r10-story-dependency-red.log`、`/tmp/ftc-r10-event-job-red.log`、`/tmp/ftc-r10-story-trash-red.log`、`/tmp/ftc-r10-optimize-batch-red.log`。最终故事/回顾 2 文件/16 项已通过（`/tmp/ftc-r10-optimize-batch-fixed.log`）；v3 导出/恢复等 3 文件/29 项、旧库真实迁移 1 项通过。新增 private-story 内含真实 ZIP、standalone verifier 子进程、非法引用预检和新目录恢复。
- 独立复审发现中央 hash 把处理输出当成输入：新 ai_suggested 事实令标题自失效、新 ASR 转录令后续事件整理无法领取。只记录已确认事实/人工转录，实际原始依赖输出仍由 handler 指纹保护；已确认事实的底层来源在 prompt、中央任务和结果指纹都复验。两项新失败回归见 `/tmp/ftc-r10-story-review-red.log`，最终相关 4 文件/49 项通过（`/tmp/ftc-r10-story-review-fixed.log`），包含实际 WAV、worker、重开 SQLite、跨事件引用撤权与进行中拒交。
- 最终根全量 136 文件/837 项通过（`/tmp/ftc-r10-story-root-reviewed.log`）；typecheck/lint/build/build:ops 通过，13 条既存 lint warning，无 error。完整 production E2E 70/70 通过（`/tmp/ftc-r10-story-e2e-final.log`）；新增故事用例实际 Web 私密创建/事实编辑/组装/发布、手机 HTTP 200→404、网页无正文和搜索无入口。范围修改仍为隔离库设置，未宣称已有事件双端分享入口完成。Next 流式 notFound 可先返回 200，故网页验收读取响应确认无私密正文并验证拒绝页面，API 仍断言 404。
- disaster roundtrip 7/7 通过（`/tmp/ftc-r10-story-roundtrip-fixed.log`）；旧测试硬编码 admin 与实际初始化 owner 不符，改读真实绑定角色并保留全部恢复断言。历史 `verify-upgrade12.mts` 正常升级、迁移失败回滚、旧归档恢复/再导出及五份原件 hash 均通过（`/tmp/ftc-r10-story-upgrade.log`）。
- 最终真 Docker 镜像 `sha256:24978c1e604cd8edee54b342434aefd5550b7d19131be06b7059964ce46db3a7`；三次容器重启、私密续传、v3 ZIP 校验、随镜像 CLI 新目录恢复及显式身份绑定通过，第三账号 404，原件 hash 不变，唯一标记资源核对后清理（`/tmp/ftc-r10-story-docker-smoke-reviewed.log`）。此为隔离开发验证，不是生产部署或正式发行物。
- 同 SHA CI 待 push 后核实。R09 已有事件双端分享入口/受控缓存、回收站事件和讲述管理权限、阅读包文件交付前范围核查仍属下一步内部工作，相关需求保持部分实现。


## R09 阅读包与出版下载最终授权

- 阅读媒体在实际 readMedia 完成后重新构建当前作品清单，核对 digest 和媒体成员；独立全家共享原件仍可读，不代表它仍属于旧阅读包。拒绝交付时取消已准备的响应流。
- 已渲染 ZIP/PDF/EPUB 在 filesystem stat 后及 HTTP 服务返回后同步复验当前账号、作品、任务版本和完整来源指纹，确认后才打开下载流。响应头先构造；异常时销毁已打开的流。
- 两条真实竞态先失败（`/tmp/ftc-r09-reading-race-red2.log`）：第二 SQLite 连接撤销来源后，旧媒体仍 206、旧 ZIP 仍 200。修复后额外验证 service→HTTP 间撤权，三处边界均拒绝；实际原件 Range 和 worker ZIP 没有用假内容代替。
- 根全量 136 文件/840 项通过（`/tmp/ftc-r09-reading-root.log`，最后 Unicode 标题增量前）；最终阅读包/实际出版 2 文件/12 项通过（`/tmp/ftc-r09-reading-final-regression.log`），包含 PDF 中文提取/逐页渲染、EPUBCheck 与断网 file:// 阅读。最终 typecheck/lint/build/build:ops 通过，13 条既存 lint warning；production book-projects/collections 7/7 通过（`/tmp/ftc-r09-reading-e2e-final.log`）。
- 独立只读审查完成。孤立代理字符的正常创建/保存/真实ZIP下载本来就能通过（SQLite 标题规范化），不把防御性响应头处理宣称为已复现用户漏洞。产品版本、schema 与 archive 协议未新增变化。
- 继续处理已有事件双端分享/撤销、回收站事件/讲述管理授权与受控缓存；当前不是 R09 全用户流程完成，也不是正式发行。


## R09 事实与回收站管理

- 添加/确认事实改为必须传入账号上下文，在写事务中按实际父事件检查当前作者/管理权；表单 eventId 不能替代事实真正的父事件。事实及索引一起提交。
- 回收站读取、删除、恢复和永久清除复验当前账号、事件读者与讲述本人身份；角色为 admin 不再意味着可读写其他人的私密记录。恢复/清除必须已在回收站，普通入口默认仍排除软删行。
- SQL 在每类 100 条限额前应用可见性与管理过滤，其他作者的较新私密记录不会挤掉本人的恢复入口。永久清除父事件会先检查全部讲述，拒绝连带删除其他作者内容；失败无部分删除，原件不会级联清除。
- 真实 Server Actions/SQLite 五项先失败（`/tmp/ftc-r09-management-red.log`），另复现 101 条分页遮挡和跨作者级联删除（`/tmp/ftc-r09-trash-limit-red.log`、`/tmp/ftc-r09-trash-cascade-red.log`）。修复后回收站两文件 13 项通过，根全量 137 文件/848 项通过（`/tmp/ftc-r09-management-root.log`）。
- production edit 3/3 通过（`/tmp/ftc-r09-management-e2e-final.log`）：Web 私密 unknown 创建、实际添加事实、删除、另一个真实管理员会话无标题/API 404、作者恢复保留正文/事实/unknown，再永久清除。首跑只是测试错用页面日期文案，已按实际“时间不确定”并额外断言 HTTP precision=unknown 修正。
- 类型、lint、production build/build:ops 通过（`/tmp/ftc-r09-management-*.log`），13 条既存 lint warning；独立只读复审未发现本批剩余授权缺陷。无新 schema/归档协议，产品版本不变。最后添加事实索引移入事务后，相关 3 文件/19 项、typecheck/build/build:ops 与 production edit 3/3 再次通过（`/tmp/ftc-r09-management-final.log`、`/tmp/ftc-r09-management-*-final2.log`）。
- 当前只是管理路径闭合；详情聚合与事实来源读取、已有事件双端分享撤销、原生授权缓存仍在内部待办，不提升 ID-11/ID-12 为完成。


## R09 详情和事实来源

- 详情事件、可读素材及 Live Photo 对应关系改为同一 SQLite 事务快照。事实必须由当前调用者可读的父事件和全部来源共同允许；讲述来源复用完整 live User/Person/guardian/事件政策，资产和转录复用原件权限。未知、跨家庭或失效来源拒绝整条事实，作者自己的私密事实仍保留。
- Web 阅读/编辑使用同步正文、讲述、可读音频、事实和来源集合；另一个私密讲述保护的音频不会因可见讲述再暴露文件名、播放器路径或归档转录。异步归档加载后检查内容版本；相关记忆卡片独立刷新其读者、素材和数量，待审 AI 建议在最后同步复验任务/同意/来源。
- 手机服务在最后异步依赖后读取当前内容集合，GET/PATCH 在服务返回后再检查内部版本并立即生成 HTTP 响应。内部 Symbol 不进入 JSON DTO。网页编辑按钮改按实际事件管理权显示，指定读者不能借角色看到作者编辑入口。
- 搜索事实从当前已确认主记录返回文本，且检查全部来源；不再直接将旧索引文本当作可读事实。添加确认事实同样要求其来源当前可读。
- 真 SQLite/HTTP 先复现详情文件名泄漏、异步读取期间撤权仍返回 200、私密讲述派生事实仍命中（`/tmp/ftc-r09-detail-facts-red.log`）。复审另复现服务返回后撤权仍交付（`/tmp/ftc-r09-detail-handoff-red.log`），均已修复；最终新增五项覆盖实际原声文件、第二 SQLite 连接、HTTP、引用引文、独立音频权限及相关卡片。
- production edit 4/4 通过（`/tmp/ftc-r09-detail-e2e.log`）：实际 Web 创建家庭记忆/添加事实，隔离库绑定讲述来源并撤权后，另一管理员的阅读、编辑响应原文和搜索均无事实/引文，作者仍能阅读。此处讲述范围变更由隔离测试库触发，不冒称已有事件分享入口完成。
- 首轮根全量发现两处测试适配：同步读取后旧 `.resolves` 断言需改直接检查；隔离恢复维护者没有家庭读权限，恢复字节/关系测试应直接比较库内事实，不能伪造新管理员上下文绕过边界。保留所有数据与拒绝断言，未修改恢复授权。
- typecheck/lint/build/build:ops 已通过，13 条既存 lint warning；disaster roundtrip 7/7 通过（`/tmp/ftc-r09-detail-roundtrip.log`）。独立只读增量复审未发现本批剩余具体缺陷。最终根全量 138 文件/853 项通过（`/tmp/ftc-r09-detail-root-reviewed.log`）；完整 production E2E 首跑 71/72，唯一失败为导入页交互就绪前选择文件的窗口；真实延迟脚本回归修复后最终全量 73/73 通过（`/tmp/ftc-r09-detail-e2e-final.log`）。无新增 schema/归档协议，产品版本仍为 1.0.0-dev.1。
- 已有事件双端分享/撤销、普通编辑提交复验与并发控制、原生授权缓存/增量同步仍是内部工作；不得以本批门禁代替 R09/R17 完整验收。


## 导入页交互就绪

- 完整 production E2E 在资料库场景的文件选择后等待“开始导入”超时，页面没有记录所选 30 份文件（`/tmp/ftc-r09-detail-e2e-full.log`）。读取当前 Next 本地 client/hydration 指南后，新增真实浏览器延迟全部脚本加载的用例，确认交互未就绪时文件输入仍启用（`/tmp/ftc-import-hydration-red.log`）。
- 文件输入现在在服务器 HTML/交互绑定前禁用，就绪及没有上传作业时才开放；浏览器自动化按真实可用状态选择文件，不扩大等待时间或降低原件数量断言。延迟加载测试放行脚本后只选择一次，必须出现文件和导入按钮。typecheck、该文件 lint、production build/build:ops 通过；production asset-library 2/2 与最终完整浏览器 73/73 通过（`/tmp/ftc-import-hydration-fixed.log`、`/tmp/ftc-r09-detail-e2e-final.log`）。
