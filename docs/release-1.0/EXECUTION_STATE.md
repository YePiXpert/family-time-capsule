# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: d2c9e5b（origin/main，CI 34163836531 success——修复 verify-upgrade12
  快照断言后 CI 全绿）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: 即将提交 §8 剩余（FIND-5 持久缓存+内嵌加相册，0059）

## 当前任务

§8 剩余已完成实现与测试（clusters 集成 7/7、迁移敏感 5 文件 8/8、
collections/inbox 10/10、tsc/eslint 干净）。提交推送并核对 CI 后进入 §9。

## 已完成需求 ID

- §4（3e00b37）；§5 核心（ddf93f2）；§6（3b1949f）；§7（3a8ea18）；
  §8 FIND-9（b53b020）
- §8 剩余 FIND-5（本提交）：
  - 0059 cluster_feature_cache：dHash+清晰度按「来源 SHA+算法版本」落库，
    命中免读原件；损坏位串按未命中重算覆写；旧算法版本与孤儿行随写清理；
    缓存读写失败不影响扫描正确性（原件不可变故内容永不失效）
  - 候选卡内嵌「加入相册」：复用勾选成员，选已有相册或新建；
    相册只引用原件（CAP-11），不移出收件箱、建议保持待处理；
    resolveClusterAction 增加 add_album 分支 + 服务层
    addClusterMembersToCollection（含 not_found/already_resolved/items_changed/
    invalid_album/album_failed 错误路径）
  - journal when 需保持单调递增（0059=1788876000009），否则
    upgrade-v013/asset-library-migration 台账断言失败（已验证修复）

## 已跑命令与结果

- §8 剩余后：tsc clean、eslint clean、clusters 7/7、fresh-db/upgrade-1-2/
  upgrade-v013/asset-library-migration/intake-destination 8/8、
  collections+inbox 10/10

## 下一个具体动作

1. 提交推送 FIND-5，核对 CI
2. §9：AI-21 每日限额、AI-2 Responses profile、换 BaseURL 的 Key 确认流程
3. §5/§6 收尾项（移动端私密 UI、移动端时间输入精度适配等，见 GLM_HANDOFF）

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、
SEC-6 法律审核）
