# v1.4.0 · AI Organizer

目标：从原始素材到可读家庭记忆。无 AI 可记录、阅读和同步；AI 只给有依据、
可修订的建议。原件、人工内容、权限与明确同意始终优先。

## 实施与验收账本

| 里程碑 | 范围 | 当前证据 |
| --- | --- | --- |
| M1 | Web / API / 本机统一命名、来源与版本 | 规则和迁移 0041 已实现；建议采用/撤销版本流程继续实施 |
| M2 | Compose 配置、ftc 配置/状态/能力测试/关闭 | CLI、双端状态/同意、0042 配置身份已实现；两模板真实 app/worker 验证通过 |
| M3 | 文字、视觉、转写协议及有限失败处理 | 有限协议、严格校验、真实 HTTP/队列退避已验证；live 未执行 |
| M4 | 持久多媒体依赖队列、命名、选中素材整理 | 复用现有 jobs / handlers / AiSuggestion |
| M5 | 双端采用/修改/忽略/重试/取消与离线保护 | 待贯通 |
| M6 | 默认关闭的自动策略、明确历史选择、原子限额 | 待实现 |
| M7 | 升级、portable archive、救援包、完整门禁 | 待验证 |
| M8 | 文档、1.4.0 固定版本及配套发行 | 全部门禁后发行 |

## 基线与数据变化

- 基线 `31f5e454578a82f941af8b68e3c4f96dc9146414`，包 `1.3.0-alpha.1`，
  原生 `1.3.0` / build 11；只在 main 开发和发布。
- 复用图片/视频分析、转录修订、人工建议审核、consent、lease 和恢复服务。
- 命名新增耐久来源与递增 revision；旧标题默认 `legacy_unknown`，不根据文件名猜来源。
- 原件名称/字节/storageKey/SHA 不参与改名；正文独立保存；未知拍摄时间不取导入时间。
- AI Provider 密钥、租约与设备授权不进入家庭 portable archive；恢复不自动外发。

## 验证边界

- 普通 CI 使用确定性 Provider，不产生外部费用；实际 DB / HTTP / worker / 容器另记。
- live smoke 只接受明确授权的专用凭据与非私人样本。当前未提供，未执行。
- 真机相机、录音、覆盖安装与系统分享尚未验证；Expo export 不代替真机证据。
- 普通账号无 Docker socket 权限，已确认可用 sudo 执行隔离容器验证。
  GitHub Actions 可访问。未操作已有项目容器或生产 VPS。
- 保留工作树原有未跟踪的调试 ZIP、pnpm-lock.yaml、pnpm-workspace.yaml。

### 命名基础切片（2026-09-06）

- Web 收件箱、首页、移动 API 和原生新记录共用 `mobile/src/utils/naming.ts`。
- 迁移 0041 添加事件/草稿/素材名称来源与版本；portable archive 带上新字段，
  老档缺字段安全默认为 legacy_unknown / 0。未按旧文件名模式重写任何标题。
- 本机记录独立保存完整载荷，上传完成/仅保留本机不会丢失全文和原文件名。
- root typecheck、lint（既有 invitation-flow 未使用变量 warning）、production build 通过。
- root 全量 622 项首次运行 619 通过；3 项旧标题/新列契约断言已修正并在相关
  48 项回归全部通过。真实旧 SQLite 升级、快照和导出恢复包括在回归内。
- mobile typecheck / lint、151 项测试通过。当前不宣称 M1 全部完成或 1.4 已发布。

### 配置与协议切片（2026-09-06）

- `741c3c6` 协议修正、`151bf6d` 收件箱重复显示修复已推送；CI
  [34025318806](https://github.com/YePiXpert/family-time-capsule/actions/runs/34025318806) 跟踪中。
- 0042 添加非秘密 configurationId；endpoint/模型/配置变化后旧 consent 与任务
  失效。双端授权提交校验用户看到的配置版本。
- ftc AI 命令已实现，0600 原子更新/回滚、修补有效模板，仅重建 app/worker。
  两模板分别通过三项语义检测及一次 401 失败（各 4 次本地 fixture HTTP 请求），
  验证状态不请求模型、隐藏输入、环境一致、重启与关闭后的核心健康。
  未启动公网 Caddy、未请求真实 Provider。
- 81 项 AI/移动 API 专项、18 项 ops、2 项原生 AI API 测试通过；root/mobile
  typecheck 与 mobile lint 通过。复现脚本 `scripts/verify-ai-containers.py`。
- 原生按连接/账号/家庭读取缓存，区分断网与 401/403，丢弃过期异步结果。
  设置与 CLI 说明见 [AI_SETUP.md](AI_SETUP.md)。多媒体编排、采用/撤销、自动
  策略、用量控制及最终恢复/发行门禁继续实施，尚未完成全部 v1.4.0。

### 标题审核切片（2026-09-06）

- `1309868` 的 CI [34027341367](https://github.com/YePiXpert/family-time-capsule/actions/runs/34027341367)
  全部通过，覆盖 web/mobile/ops 与 production E2E、灾难往返、旧库升级。
- 0043 保存建议 revision、目标版本、采用前名称、采用版本与撤销墓碑；Web 与
  原生复用同一名称 API，支持人工改名、采用、修改后采用、忽略与撤销。
- 采用事务重新核对真实账号、目标版本、任务完成状态、来源、外部配置与同意；
  私密上下文不进入全家可见标题。人工保存与确认使用版本检查，冲突保留输入。
- 归档或合并不是批量采用 AI 字段，不再把未审核建议一并标为已采用。
- 55 项服务/API 专项通过，原生全量 157 项通过（含离线缓存、403 清理、
  连接切换后的旧结果丢弃、冲突输入保留）。production build 通过。
- 待续：已采用/忽略墓碑进入 portable archive、本机编辑救援、多媒体持久编排、
  自动策略与用量。完整 M1/M4–M8 尚未宣称完成；没有创建 v1.4.0 标签。

### 名称导出恢复切片（2026-09-06）

- `name-reviews.json` 随模块声明保存版本化标题采用、忽略和撤销；恢复前验证
  目标/版本，排除未处理任务、consent 与 Key。旧档缺字段保留 canonical 标题。
- 21 项真实导出/恢复专项通过；新实例再次导出后的审核记录和事件逐项一致，
  原件 bytes/SHA/storageKey/文件名不变。恢复后撤销仍执行版本校验。
- production build、运维工具 bundle、真实灾难 roundtrip 7 项通过。
  root typecheck/lint 通过（保留已有 invitation-flow warning）。
- 尚需完成本机编辑救援和后续整理数据的导出恢复；此处不是 M7 最终验收。

### 短视频音轨切片（2026-09-06）

- 既有转录队列现在支持 MP4/MOV/WebM 视频音轨，使用本地受限 WAV 提取，
  正确 MIME/扩展名；图像与音轨分别授权。视频处理仅手动，最长 120 秒、
  原件 128 MiB，外发 WAV 至多 4 MiB。原件不修改。
- ffmpeg/ffprobe 限制输入格式与协议，拒绝素材内播放列表；ffprobe 输出有界。
  空转录显示“未识别到清晰语音”；人工修订不显示未经对齐的机器分段时间戳。
- 21 项专项（6 文件）、root 全量 660 项（95 文件）、typecheck、lint、
  production build 通过。含真实 120 秒 ffmpeg 音轨、真实 DB/worker 和本地
  HTTP 陷阱零请求验证。没有 live Provider 调用。
- 视频逐帧检查点、前置分析→命名衔接和双端批量整理仍在后续 M4/M5 范围内。
