# v1.4.0 · AI Organizer

目标：从原始素材到可读家庭记忆。无 AI 可记录、阅读和同步；AI 只给有依据、
可修订的建议。原件、人工内容、权限与明确同意始终优先。

## 实施与验收账本

| 里程碑 | 范围 | 当前证据 |
| --- | --- | --- |
| M1 | Web / API / 本机统一命名、来源与版本 | 规则和迁移 0041 已实现；建议采用/撤销版本流程继续实施 |
| M2 | Compose 配置、ftc 配置/状态/能力测试/关闭 | 待实现与真实容器验证 |
| M3 | 文字、视觉、转写协议及有限失败处理 | 复用现有 Provider；待修正与验证 |
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
- 本机 Docker socket 当前无权限；GitHub Actions 可访问。未操作生产 VPS。
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
