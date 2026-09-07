# GLM 正式 1.0 连续交付接力（进行中）

> 本轮 GLM 为正式 1.0 主开发 Agent：连续实现、验证、提交、推送并核对 CI。
> 详细执行状态看 EXECUTION_STATE.md；需求矩阵看 REQUIREMENTS.md。

baseline:
59bf14c708a43431cc3f36e4807fac0c8ee7be1e（CI 34120571417 success）

pushed（本轮）：

- 3e00b37 §4 搜索正确性与隔离 —— CI 34140771474 success
- ddf93f2 §5 私密记忆核心（0057 读者模型）
- 3b1949f §6 六档日期精度
- 3a8ea18 §7 Web 播放文字按钮（本地 av e2e 2/2）
- b53b020 §8 FIND-9 回顾屏蔽（0058）—— CI 34147788372（待核对）

completed（摘要）：

- **§4**：投影式离线搜索（内部 JSON/路径/token 绝不参与匹配或摘要）；
  timeline/people 逐行 scope；SearchScreen 请求代际/错误分类（401/403/
  400/429/5xx 不伪装断网）/筛选分页防混页；服务端移动搜索 API 筛选
  参数+游标绑定筛选。
- **§5**：memory_event.visibility(family/members/private)+读者表+
  asset.visibility(private)；时间轴/详情/搜索/日历/回顾/同步/资料库/
  媒体全链路实时裁决（管理员非旁路，作者缺失 fail closed）；
  publishDraft 非 family 直接成事件（私密不进收件箱）；私密上传直传
  不入全家窗口；去重与授权分离（同字节私密原件并存，不可探测）。
  T07/T08/T09 集成 4/4。
- **§6**：exact/approximate/date_only/month/year/unknown 六档精度；
  unknown 可无时间保存（创建时刻仅作内部排序锚点）；日历天级视图不
  收编造日（月精度入 rough 待细化列表）；日期筛选排除 unknown；年龄
  按精度省略；Web 双端编辑器六档选择。单元+集成 9/9（T10）。
- **§7**：MediaReader 播放/暂停/重新播放文字按钮+进度滑条，状态只来自
  真实媒体事件，失败如实提示；av e2e T11 断言通过。
- **§8 FIND-9**：resurfacing_preference 四类屏蔽（事件/人物/日期范围/
  暂停）按用户；只影响自动推荐，不删源、不影响搜索、不跨用户；
  Web 回顾页偏好面板。集成 4/4（T13）。

migrations: 0057_private_memory_events、0058_resurfacing_preferences

known limitations / 下一步（按序）：

1. 核对 b53b020 CI，红则修复。
2. §8 剩余：dHash 相似特征持久缓存（来源哈希/算法版本/失效）+
   「加入相册」内嵌选择。
3. §9：AI 每日限额（AI-21）、Responses profile（AI-2）、换 BaseURL 的
   Key 确认流程。
4. §5 收尾：移动端私密 UI/私密上传通道；AI 上下文与阅读包对私密事件
   的引用策略；撤权后离线缓存失效（关联 §11 权限版本）。
5. §6 收尾：移动端时间输入 UI 适配月/年/未知；导出/书籍精度呈现；
   DST/跨年专项。
6. §10–§13 按 REQUIREMENTS 剩余项（两步认证原生、SYNC-7、adopt/
   恢复协调/交接包、手册/许可台账）。

环境备注：

- 本地 Windows 缺 ffmpeg/epubcheck/poppler-CJK，相关 9 个集成文件本地
  必红（干净 main 同样红）；CI Linux 通过，以 CI 为准。
- 本轮中段本机 HTTPS 中断约 1.5 小时，期间本地完成 §7/§8，恢复后已
  全部推送。
