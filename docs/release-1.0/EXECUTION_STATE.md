# 正式 1.0 连续执行状态（Astra / Codex）

## 基线与约束

- 起始及受测基线：`b67f51289ace8cb666c3ea52964de5b798d5dd28`；实际拉取无更新。
- 起始 CI：`34169185541`，同 SHA success（本轮用 gh 复核）。
- 开发版本保持 `1.0.0-dev.1`；仅 main，按纵向功能 commit/push 并核对新 SHA CI。
- 运行用户 dev，目录 `/home/dev/code/family-time-capsule`；起始工作树干净。检测到同目录 opencode 进程，已询问并发状态，未停止进程；持续检查未知改动。
- 开发 Agent 与产品密钥/模型隔离；未操作生产 VPS 或真实数据。

## 当前任务与复现

1. P0-A 已定位：CaptureScreen 把 Person.id 写入 readerUserIds；需最小登录成员 DTO 与手机实际保存测试。
2. P0-B 已复现：新增 capture-persistence 通过真实记录页、精度控件、保存 hook 和 SQLite，unknown 点保存仍为 editing。正在修复共同日期校验并补 HTTP/独立库重开/导出恢复。
3. P0-C 已定位：use-draft 仅对发布拦新私密附件；queueDraftOriginals 对私密文字也拒绝；sync 仍依赖 inbox_item_id。需复用续传实现作者控制的上传回执，不删除 guard 后走全家收件箱。
4. P0-D 独立只读审查确认：GET 自然检索与 CLI 诊断绕过配额；关闭限额不计数、音频向下取整/未知零秒、未预留成功仍放行。自然检索还误用管理员配置权限并替换人工筛选。后续统一 transport 出站边界与显式幂等动作。

## 修改范围与证据

- 手机/服务端/Web 共享 isDraftDateComplete；unknown 可无日期，其余五档仍须日期。
- mobile/tests/capture-persistence.test.ts：原失败 status=editing；修复后真实 hook 的 6 个场景通过（unknown 保存/重开，以及其余五档缺日期拒绝）。原生 UI/设备模块替身 + 真实 SQLite，不代表真机。
- tests/integration/persistent-draft.test.ts：补 unknown 经 Bearer HTTP 保存发布、独立 SQLite 重开、完整导出与新目录恢复后的精度/正文检查。
- 已通过既有 date-precision/persistent-draft 6 项；新增导出恢复通过；移动全量 47 文件/246 项、双端 typecheck/lint、Next production build 通过。根 lint 有 15 条既存 warning，无 error。新 SHA CI 将在本次 push 后核对。

## 接下来的动作

完成日期专项验证、审查与提交推送；随后接最小读者 API/手机账号选择器，复现停用/退出/异家庭/同名/无账号人物与第三人不可读。再实现私密续传回执及 AI 统一边界，持续推进 REQUIREMENTS 的认证、增量同步、adopt/升级/恢复协调、交接、手册和评测等内部项。

## 未完成门禁与外部阻塞

完整 P0 混合私密流程、production E2E、全量测试、Docker/升级恢复与候选产物均尚未完成，不能以此子里程碑宣称内部工程完成。
真实 Luna 文字/图片与 MiMo 语音、长期签名、双平台真机、生产授权与必要法律审核仍按 BLOCKERS 单列。基础许可/合成评测样本和 runner 属内部工作，不能全部推给外部。
