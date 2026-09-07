# 正式 1.0 连续执行状态（GLM 主开发轮）

> 只记录当前基线、任务、命令与结果、外部阻塞。历史里程碑看 GLM_HANDOFF.md 与 git log。

## 基线

- baseline: 59bf14c708a43431cc3f36e4807fac0c8ee7be1e（origin/main，CI 34120571417 success）
- 开发版本: 1.0.0-dev.1（不变）
- 工作树: clean（2026-09-07 起点）

## 当前任务

P1-§6 日期精度（下一个）：unknown/year/month/date/instant 全链路。

## 已完成需求 ID

- §4（FIND-2 正确性与隔离，3e00b37，CI 绿）：请求代际/错误分类/投影式
  离线搜索/timeline+people 逐行 scope/离线筛选+去重+稳定排序。
- §5 核心（本提交）：0057 读者模型——memory_event.visibility(family/members/
  private)+created_by_user_id+memory_event_reader 表；asset.visibility
  (family/private)+去重索引只约束 family 原件；policy canViewMemoryEvent/
  canManageEventVisibility（管理员非旁路，作者缺失 fail closed）；
  event-access SQL 谓词+事务内活性复核；getTimelinePage/ByIds/Milestones/
  详情/搜索/日历/回顾/resurfacing/移动同步按读者裁决；updateMemoryEvent
  编辑前置可读；updateMemoryEventVisibility（titleRevision 并发令牌）；
  draft 模型 members+readerUserIds；publishDraft 非 family 直接成事件
  （私密不进收件箱）；上传路由 visibility=private（无收件箱窗口）；
  findOriginalBySha256 按查看者过滤（重复上传不能探测私密原件）；
  Web 捕获编辑器三档读者+成员选择+私密直传。T07/T08/T09 集成测试 4/4。

## 已跑命令与结果

- root: tsc clean、lint 仅既有 warning、tests/unit 219/219、
  integration 76/85 文件通过（9 个失败文件均为本地环境缺 ffmpeg/
  epubcheck/poppler-CJK/symlink/chmod/EPERM——干净 main 同样失败，
  CI Linux 有工具链；其中 migration/assets/upgrade-v013/review 的
  真回归已修复）
- mobile: 236/236、tsc/eslint clean

## 未完成测试

- §5 移动端：私密/指定成员 UI 入口、私密原件上传通道（本轮移动端
  非 family 草稿的原件保留本机，如实提示）；大文件私密断点续传。
- §5 派生面收尾：AI 上下文来源（organizer/story 生成的事件级过滤待
  逐个核验）、阅读包/作品对私密事件的引用策略、导出文案说明。
- 本地环境失败件待 CI 验证。

## 下一个具体动作

P1-§6：Draft 模型允许 occurredAt 精度 unknown/year/month（不再强填
发生时刻），事件查询/排序/日历/年龄按精度语义处理，迁移兼容旧行。

## 外部阻塞

（继承 BLOCKERS.md：BLK-1/2 真实 AI 凭据、BLK-3/4 签名、BLK-5 真实 VPS、SEC-6 法律审核）
