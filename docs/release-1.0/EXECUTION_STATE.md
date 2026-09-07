# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: 8ce3edc（origin/main，CI 34168440785 success——本轮全绿收口）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: clean

## 本轮已推送（按序）

- d2c9e5b CI 修复：verify-upgrade12 快照断言补 0057 读者模型列（CI 绿）
- 87137a0 §8 FIND-5 剩余：0059 dHash 持久缓存 + 候选卡内嵌加相册
  （7970009 补测试收窄）
- 11c54db §9：AI-21 每日限额（0060 原子日计数+worker 预扣）、
  AI-2 Responses/Chat Completions 按能力 profile、换 BaseURL Key 确认
- d297171 §6 收尾：移动端六档精度时间输入（PrecisionDateTimeField）
- 1c73955 §5 收尾：移动端三档读者选择（切档清空/成员多选/发布守卫）
- 8347eee §6 呈现收尾：导出 timeline.md/书籍/回顾按精度呈现
- 61c41f8 §6 专项：DST 时区锚点与跨年排序单测
- 8ce3edc 测试修复：AI 限额校验用例补全 dual 协议字段（CI 绿）

## 已跑命令与结果

- 根：tsc clean、eslint clean、unit 相关面全绿
  （clusters 7/7、ai-quota 8/8、ai-openai-compatible 28/28、
  ai-jobs+inbox-suggestions 18/18、迁移敏感 8/8、export 2/2、review 7/7、
  date-precision 单元 7/7）
- 移动端：tsc clean、全量 240/240（capture-screen 16/16）
- ops：套件 31 过 3 跳（docker 用例本机跳过，CI 跑）；Python 新增
  换址确认/校验 5 用例本地通过
- 本地已知环境失败（干净 main 同样失败，以 CI 为准）：books 2 例
  （缺 poppler-CJK）

## 下一个具体动作

2. §5 剩余：大文件私密上传通道（双端）；AI 上下文与阅读包对私密事件引用
3. §10–§13 按 REQUIREMENTS 剩余项（两步认证原生、SYNC-7、adopt/恢复
   协调/交接包、手册/许可台账）

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、
SEC-6 法律审核）
