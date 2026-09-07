# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: 1c73955（origin/main，移动端三档读者选择；CI 运行中）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: §6 呈现收尾（导出/书籍/回顾按精度呈现），待提交

## 当前任务

§9 三件套已实现并本地验证完毕，提交推送核对 CI。随后按 GLM_HANDOFF
顺序进入 §5/§6 收尾或 §10–§13。

## 已完成需求 ID

- §4（3e00b37）；§5 核心（ddf93f2）；§6（3b1949f）；§7（3a8ea18）；
  §8 FIND-9（b53b020）；§8 FIND-5 剩余（87137a0+7970009：dHash 持久缓存
  0059 + 候选卡内嵌加相册）
- §9（本提交）：
  - AI-21 每日限额：AI_DAILY_MAX_REQUESTS/_IMAGES/_AUDIO_SECONDS（0=不限），
    0060 ai_daily_usage 单条条件 UPDATE 原子裁决；worker 请求前预扣，
    超限 ai_quota_exceeded + retryAfterMs 到 UTC 日界自动顺延；
    音频时长仅已知时计入（durationSeconds 由 transcribe-asset 传入）
  - AI-2 Responses profile：AI_TEXT_PROFILE/AI_VISION_PROFILE
    （responses|chat_completions），/responses 端点+output_text 解析+
    refusal/incomplete 如实拒绝；配置进 configurationId 与 diagnostics
  - 换 BaseURL Key 确认：ops configure 主机变更时须输入 confirm，
    未确认零更改；新变量进 AI_KEYS/模板/env.example/校验

## 已跑命令与结果

- §9 后：tsc（根+mobile）clean、eslint clean、ai-quota 8/8、
  ai-openai-compatible 28/28、ai-jobs+inbox-suggestions 18/18、
  迁移敏感 4 文件 6/6、ops 套件 31 过 3 跳（docker 用例本机跳过，CI 跑）
- §6 收尾后：mobile tsc clean、capture-screen 14/14（含精度切换两用例）、
  mobile 全量 238/238
- §5 收尾后：mobile tsc clean、capture-screen 16/16（含读者选择两用例）、
  mobile 全量 240/240
- §6 呈现收尾后：tsc clean、export 2/2（月精度不带日/unknown 单独成节）、
  review 7/7；books 本地 2 例为已知环境失败（干净 main 同样失败，
  CI 有 poppler 工具链）

## 下一个具体动作

1. 核对 1c73955 与本提交 CI，红则修
2. §5 剩余：大文件私密上传通道（双端）；AI 上下文与阅读包对私密事件引用
3. §6 剩余小项：DST/跨年专项测试
4. §10–§13 按 REQUIREMENTS 剩余项

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、
SEC-6 法律审核）
