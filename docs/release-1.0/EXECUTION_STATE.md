# 正式 1.0 连续执行状态（Astra / Codex）

## 基线与当前进度

- 起始：`b67f51289ace8cb666c3ea52964de5b798d5dd28`，CI `34169185541` success，已实际 pull/核对。
- 已推送：`045b5e2` 日期真实手机 hook 修复及 HTTP/独立库/导出恢复；其 CI `34182633511` 暴露旧配额测试日期碰撞。
- 已修复推送：`8a2c73efd0220785addc24b0808c4bb05797d35c` 测试账本按用例隔离；CI `34183060802` 四项全部 success（含 production E2E/恢复）。没有降低调用次数断言或靠 rerun。
- 当前修改：P0-A 完整读者选择与追加迁移，准备提交；其新 SHA CI 须 push 后单独核对。
- 开发版本保持 `1.0.0-dev.1`，只在 main；dev 用户；未操作生产。检测到同目录 opencode 后已询问并发状态，未停止进程，未发现并发文件修改。

## P0-A/B 实际证据

- P0-A：手机过去把 Person ID 作为 readerUserIds，已有 capture-screen 测试还固化该错误。现在参与人物保留 Person ID；最小 draft-readers API 仅返回有效同家庭账号 id/name，不授予账号管理权限。
- 新 HTTP 回归进一步发现 0052 draft CHECK 仍不接受 members。0061 追加重建迁移修复，保留旧正文、draft_item 与 import_session 引用、FK/索引，旧迁移不变。
- 双端显示已失效选择并可主动移除，手机可显式重新核对成员；断网不静默改读者。服务端在保存/发布复验停用/退出/其他家庭账号。
- P0-B：共享 isDraftDateComplete；unknown 无日期可保存，其余五档缺日期拒绝。真实手机保存重开与 Bearer API/新目录导出恢复已通过，时间仍不详且正文保留。
- 新 `native-capture` production E2E：启动真实 React Native 记录页控件/hook（平台组件替身），实际 SQLite→syncLocalDrafts→真实 fetch→Next 生产 API/SQLite；B 200，未选 C 管理员 404。不是手工重造手机 DTO；不是设备验收。

## 本地验证

- 根全量 122 文件 / 783 项通过（`/tmp/ftc-readers-root-isolated.log`）。
- 手机全量 47 文件 / 248 项与 typecheck/lint 通过；capture-persistence 8 项含联网重试/失效选择。
- Next production build、根 typecheck/lint 通过；lint 15 条既存 warning，无 error。
- native-capture production E2E 2/2：真实手机到 HTTP + Web 移除失效读者保持其他选择。
- 0060 有数据旧库升级/重开专项通过；真实 Docker 本里程碑尚未重跑，不引用过去结果冒充。
- 根全量暴露两个旧单测未隔离 DATA_DIR，触及开发目录但迁移保护拒绝并留快照。已用 tests/setup-isolated-data.ts 给每个测试文件独立临时目录，相关用例与全量通过；开发目录及保护快照未删改。

## 下一个动作：P0-C，再 P0-D

P0-C 已定点查明：Web members 曾走公开上传；小文件 private duplicate 可造 inbox；上传所有阶段仅传 familyId，批次还暴露 session ID；私密 sync 依赖 inbox_item_id。复用 upload_session.finalAssetId/import_session_item.assetId 作为受控回执，全部草稿新原件发布前作者私密，完整 actor/草稿校验贯穿 init/chunk/complete/retry/预览与批次。补跨进程完成竞争、暂停/换号/改读者、Live Photo 两组件、来源再分享限制。资料库关联事件须按读者过滤。

P0-D 已独立审查：GET 自然检索与 CLI 诊断绕过配额；限额关闭不计数；未知/亚秒时长、预留失败放行；请求前本地拒绝仍占额度；检索误用 ai:configure 且覆盖人工条件/月份边界。统一真实出站边界、显式幂等用户动作、授权复验与有界时长探测。

私密正文当前仅发布时索引，详情/重建/恢复仍须补；当前 CAP-1/ID-11/ID-12/AI-21 保留部分实现，全部内部工程远未完成。

## 后续与外部阻塞

继续现有 REQUIREMENTS 的认证生命周期、增量同步、adopt/升级/恢复协调、交接/加密副本、手册/许可/评测与性能；不重做既有系统。
真实 Luna 文字/图片、MiMo 语音、长期签名、双平台真机、生产授权和必要法律审核仍缺。基础许可/合成样本、runner、候选产物及当前可做工程属于内部工作；不得据此停止或声称正式 1.0 已发布。
