# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: 59bf14c708a43431cc3f36e4807fac0c8ee7be1e（origin/main，CI 34120571417 success）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: clean（2026-09-07 起点）

## 当前任务

推送 §5+§6（网络中断重试中）；随后 §7 Web 播放器文字按钮。

## 已完成需求 ID

- §4（FIND-2 正确性与隔离，3e00b37，CI 绿）
- §5 核心（ddf93f2）：读者模型/资产私密/全链路裁决（详见上一版记录）
- §6（本提交）：六档日期精度。共享 mobile/src/utils/occurred-precision.ts
  （formatOccurredLabel/anchorFromPrecisionInput/precisionHasDay 等）；
  draft 模型+publishDraft 支持 unknown 无时间保存；日历天级视图排除
  非到日精度、月精度入 rough 列表；时间轴/搜索日期筛选排除 unknown；
  年龄按精度省略；Web 捕获编辑器+编辑表单六档选择；移动 dateLabel
  精度感知。tests/unit/date-precision 4 + tests/integration/date-precision 5。

## 已跑命令与结果

- §6 后：root tsc clean、unit+drafts+calendar 228 通过、mobile 236 通过
- §5 提交前全量见上一版记录

## 未完成测试

- §6 剩余：移动端时间输入 UI、导出/书籍/回顾精度呈现、DST/跨年专项
- §5 剩余：移动端私密 UI/上传、AI 上下文与阅读包派生面、撤权后离线
  缓存失效（待 §11 同步权限版本）
- 本地环境失败件（ffmpeg/epubcheck/poppler-CJK 等）待 CI 验证

## 下一个具体动作

1. git push（网络恢复后）并核对 ddf93f2+§6 SHA 的 CI
2. §7：MediaReader 文字播放按钮（真实事件驱动状态）

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、SEC-6 法律审核）
