# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: 59bf14c708a43431cc3f36e4807fac0c8ee7be1e（origin/main，CI 34120571417 success）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: clean（2026-09-07 起点）

## 当前任务

推送全部本地提交（网络中断持续重试中）并核对 CI。随后 §8 剩余
（相似照片特征持久缓存 FIND-5）与 §9。

## 外部阻塞（当前）

- 本机网络 HTTPS 全面中断（GitHub 与 example.com 均 TLS 握手失败），
  push 与 CI 检查被阻塞；本地提交如下，网络恢复后按序推送：
  - ddf93f2 §5 私密记忆核心
  - 3b1949f §6 日期精度
  - 3a8ea18 §7 播放文字按钮（本地 av e2e 2/2）
  - （本提交）§8 FIND-9 回顾屏蔽

## 已完成需求 ID

- §4（3e00b37，CI 绿）；§5 核心（ddf93f2）；§6（3b1949f）；§7（3a8ea18）
- §8 FIND-9（本提交）：0058 resurfacing_preference（event/person/
  date_range/pause 按用户）；getResurfacing 按当前用户过滤自动推荐
  （含 on_this_day），hasHistory 不受暂停影响；Web 回顾页偏好面板
  （暂停/恢复/屏蔽人物/屏蔽日期/逐卡暂不推荐/取消屏蔽）；
  resurfacing-preferences 服务（实时用户校验+家庭归属+日期合法性）。
  tests/integration/resurfacing-blocks.test.ts 4/4（T13）。

## 已跑命令与结果

- §8 后：tsc clean、resurfacing-blocks 4/4；此前 unit 223、mobile 236、
  av e2e 2/2、private-memory 4/4、date-precision 9/9 全绿

## 下一个具体动作

1. git push（网络恢复）→ 核对 ddf93f2/3b1949f/3a8ea18/本提交 的 CI，
   红则按纪律修复
2. §8 剩余：dHash 特征持久缓存（clusters）
3. §9 AI 限额与双路由配置

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、SEC-6 法律审核）
