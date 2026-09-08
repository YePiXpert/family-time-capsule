# 正式 1.0 连续执行状态（Astra / Codex）

## 基线与当前进度

- 起始：`b67f51289ace8cb666c3ea52964de5b798d5dd28`，CI `34169185541` success，已实际 pull/核对。
- 已推送：`045b5e2` 日期真实手机 hook 修复及 HTTP/独立库/导出恢复；其 CI `34182633511` 暴露旧配额测试日期碰撞。
- 已修复推送：`8a2c73efd0220785addc24b0808c4bb05797d35c` 测试账本按用例隔离；CI `34183060802` 四项全部 success（含 production E2E/恢复）。没有降低调用次数断言或靠 rerun。
- 已推送：`7e9c264c651b53fd36a3323735b4d4d4933a5383` P0-A/B 完整读者选择与追加迁移；CI `34183826416` 四项全部 success，已核对同 SHA。
- 当前修改：P0-C 新附件私密续传完整纵向流程（准备提交；新 SHA CI push 后单独核对）。
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

## 下一个动作

P0-C 继续 Live Photo 成对原件、服务器恢复世代与全部再分享旁路。R08 私密正文持久来源与权限保真导出恢复仍有内部缺口，必须继续修复；不把该里程碑当作私密记忆全链路完成。

P0-D 已独立审查：GET 自然检索与 CLI 诊断绕过配额；限额关闭不计数；未知/亚秒时长、预留失败放行；请求前本地拒绝仍占额度；检索误用 ai:configure 且覆盖人工条件/月份边界。统一真实出站边界、显式幂等用户动作、授权复验与有界时长探测。

私密正文当前仅发布时索引，详情/重建/恢复仍须补；当前 CAP-1/ID-11/ID-12/AI-21 保留部分实现，全部内部工程远未完成。

## 后续与外部阻塞

继续现有 REQUIREMENTS 的认证生命周期、增量同步、adopt/升级/恢复协调、交接/加密副本、手册/许可/评测与性能；不重做既有系统。
真实 Luna 文字/图片、MiMo 语音、长期签名、双平台真机、生产授权和必要法律审核仍缺。基础许可/合成样本、runner、候选产物及当前可做工程属于内部工作；不得据此停止或声称正式 1.0 已发布。
