# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: 59bf14c708a43431cc3f36e4807fac0c8ee7be1e（origin/main，CI 34120571417 success）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: clean（2026-09-07 起点）

## 当前任务

P0-§5 私密记忆（下一个）：对象读者模型（仅自己/指定成员/家庭）+ publishDraft
非 family 可见性 + 全链路隔离。

## 已完成需求 ID

- §4（FIND-2 正确性与隔离）代码完成待验证→自动化通过（本地）：
  - §4.1 请求代际：SearchScreen generation+卸载守卫+写回前复核 scope/连接；
    筛选变化不分页混页（T01/T02 场景有组件测试）。
  - §4.2 错误分类：ApiError.status 0/401/403/400/429/5xx 各自语义；
    仅 status 0 自动降级；429/5xx/401 提供显式「只搜本机」入口。
  - §4.3 投影式离线搜索：detail_json/payload_json/manifest 整串 LIKE 与
    excerpt 全部移除；只搜展示字段；损坏 JSON 单行跳过。
  - §4.4 归属边界：timeline_event/people 补逐行 scope 列（迁移先行于
    schema SQL,旧行回填 '' 不可见,由下次快照清理）；applySyncPage 写入
    scope；listTimeline/listCachedPeople/offlineSearch 按 scope 过滤；
    本机记录保持「本机记录」标注不并入家庭结果。
  - §4.5 离线筛选：person/dateFrom/dateTo/mediaType 与在线 API 语义一致
    （服务端移动搜索路由新增同款筛选参数,游标绑定筛选）；信息不足诚实
    不显示；查询/扫描/结果有界；去重+稳定排序；hasDetail=scope 内可读详情。

## 正在修改的文件

（§4 已收敛,见 git log）

## 已跑命令与结果

- mobile: vitest 236/236、tsc clean、eslint clean
- root: tsc clean、lint(仅既有 warning)、tests/unit 219/219、
  tests/integration/mobile-api 21/21（含新增筛选路由测试）、
  tests/integration/search 通过

## 未完成测试

- §4 真机飞行模式/设备级验收（继承 FIND-2 真实场景项）

## 下一个具体动作

开始 §5：读 lib/authz/*、contribution visibility、memory_event 读路径,
设计 memory_event 级 visibility + 读者模型与迁移 0057。

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、SEC-6 法律审核）
