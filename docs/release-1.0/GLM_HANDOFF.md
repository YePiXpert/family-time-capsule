# GLM temporary handoff

> 临时接力开发（GLM）交接说明。本轮不重构既有领域、不发版、不改版本号（保持 `1.0.0-dev.1`）。

baseline:
8388ecb7a58508996302d17f9aa4116665ef34a9

final:
9c7e3c8 (fix(tests): match timeout budget to real-database migration tests —— 第二次 CI 修复)

completed:

- **CI 修复**：M3-D 在 `BatchImportCenter.start()` 末尾新增的 `router.refresh()` 会因
  `ensureSession` 已把地址 replaceState 成 `/imports/[id]` 而重挂载组件，清掉「本轮可上传
  项已处理」提示与本地文件队列，imports e2e 确定性失败（c96377e）；同批修复 M3-D 自带
  e2e 未在 CI 验证过的 strict-mode 歧义（资料详情页两个同名「下载原件」链接，`.first()`）。
- **文档先行**：核实 M3-D intake destination 代码/测试确实存在后，更新 CAP-1（intake 选择
  已落地，仅剩私密事件读者与日期精度）、CAP-6 证据与 M3-D 补充说明（e2defda）。
- **GLM-A 长辈/简洁阅读模式（d55d2b6）**：
  - 设备级「标准显示 / 大字简洁显示」：Web 用 cookie（`ftc_display`，根布局 SSR 渲染
    `data-display-mode` 无闪烁），原生用 meta KV（`display_mode`）；不进账号 schema，
    切换账号不继承（它是设备偏好，非敏感状态）。
  - 简洁首页只保留四件事：最近的照片 / 最近的故事 / 听听家人的声音 / 我也说几句；数据
    按真实权限（新查询 `listRecentVoiceContributions` 仅聚合家庭可见带原声讲述），空状态
    如实说明，不造示例内容。
  - 隐藏复杂入口但路由与权限不变；顶部/侧栏常驻「返回标准显示」；`/more`、`/settings`
    提供切换。
  - 贡献向导收口为 问题→录音→重听→提交：可重听/重录/确认保留，文字与照片保持可选补充，
    成功后明确「已经收到」并可「再说一段」。
  - 原生：SimpleHomeScreen 大字首页、标签「说几句」与更大标签栏、简化「我的」+
    DisplayModeCard。
- **GLM-B 原生离线搜索（3d81ee6）**：
  - `mobile/src/search/offline-search.ts` 只搜本机已合法保存内容：时间轴缓存、记忆详情
    缓存（讲述/转录/素材标题深文本）、本机记录、已下载相册/作品（manifest 含转录与正文块）。
  - 隔离：记忆索引绑定 `memoryCacheScope(serverUrl+instanceId+token+userId+familyId)`，
    阅读包绑定阅读 scope；换目的地/账号走既有 `clearServerCaches()` 即失效（A 家庭结果
    不会出现在 B）；本机记录属设备主人始终可搜。
  - 联网优先服务器搜索；离线或不可达自动降级并显示「当前离线，仅搜索这台设备已保存的
    内容。」；只剩索引的记忆点开时提示需联网重新获取；结果区分 记忆/本机记录/相册/作品。
- **GLM-C 可访问性收口（90f91db）**：
  - 原生共享文字样式去掉固定 lineHeight（系统大字号不再裁剪），回归测试锁定；
  - 触控目标：chip/小操作 ≥48，Web 移除按钮 ≥44，底部导航 ≥44 有 e2e 断言；
  - 读屏：首页/我的/搜索/简洁首页全部 Pressable 补 accessibilityRole/Label，同步横幅可
    播报可收起；
  - reduced-motion：Web 全局压制已有，新增 e2e 断言过渡近零；原生无自定义动画（如实登记）；
  - 键盘：Tab/Enter 完成登录、主导航可达有 e2e；上移/下移沿用 collections/capture/book
    既有按钮；
  - Web 说明文字统一 ≥12px。
- **GLM-D 近似照片候选（8ac7208）**：
  - 相似候选理由可解释（感知哈希距离/拍摄时间差/尺寸方向/同一导入批次）；字节完全相同
    （SHA-256 一致）与画面相似严格分开，文案绝不叫「重复照片」；
  - 清晰度只是「哪张细节最多」提示（64×64 灰度焦点分），不自动选择；
  - Live Photo 组件明确说明且不当相似重复；
  - 操作：勾选成员合并成一段记忆（服务端校验 ≥2 且成员开放）、全部保留（不作处理）、
    去资料库加入相册；本轮无任何删除操作；成员显示缩略图。

migrations:
- none（GLM 各里程碑均未新增迁移；最新仍为 0056）

tests:
- 新增 e2e：`tests/e2e/simple-mode.spec.ts`、`contribute-wizard.spec.ts`（Chromium 虚拟
  麦克风真实 MediaRecorder）、`a11y.spec.ts`（键盘登录/减少动态/触控目标）
- 新增集成：`tests/integration/clusters.test.ts`（4 项）；`contribution.test.ts` 增加家人
  声音聚合（可见性/家庭隔离）
- 新增原生：`mobile/tests/display-mode.test.ts`(4)、`offline-search.test.ts`(4)、
  `search-offline-screen.test.ts`(3)、`a11y-regression.test.ts`(3)
- 修复：`tests/e2e/imports.spec.ts`（strict-mode `.first()`）
- 本地验证：root lint/typecheck/build、imports+simple-mode+contribute-wizard+a11y+av+
  merge+inbox-draft+contribution e2e、mobile 226 tests + lint/typecheck + expo doctor 21/21

CI:
- c96377e fix(imports) — success（被后续推送取代的一次运行显示 cancelled，最终以含该改动
  的 e2defda 运行为准）
- e2defda docs(release-1.0) — success
- d55d2b6 feat(accessibility) GLM-A — success
- 3d81ee6 feat(mobile) GLM-B — success
- 90f91db fix(a11y) GLM-C — success
- 8ac7208 feat(library) GLM-D — failure（见下）
- fae5206 fix(books) — success（修复 8ac7208 的 CI 失败）
- da25f14 docs(release-1.0) — success
- 7f63f1a fix(contribute) — success（本轮自查修复：贡献向导重录计数把新旧录音叠加，
  maxFiles=1 且已有录音时会错误拒绝重录；收件箱缩略图预取补上非首位图片原件）
- 5190a5f docs — failure→由 9c7e3c8 修复：三个真实数据库迁移测试（optional-anchor-
  migration、upgrade-1-2×2）在共享 runner 上超 vitest 默认 5s（本地 ~1.4s，同套件在
  7f63f1a 全绿），负载性超时暴露；按工作量给显式 60s（与 ops 配置既有做法一致），
  断言不变
- 9c7e3c8 fix(tests) — success

REQUIREMENTS changed:
- NAV-11 未实现 → 部分实现（双端简洁模式与贡献向导自动化通过，Web 播放文字按钮与真机
  长辈任务待补）
- NAV-9 补充 GLM-C 证据（仍为部分实现：真机读屏/系统大字号实测待验）
- FIND-2 补充 GLM-B（仍为部分实现：真机飞行模式与离线日期筛选待验）
- FIND-5 补充 GLM-D（仍为部分实现：感知哈希只在内存、真机大数据量待验）
- CAP-1/CAP-6 同步 M3-D intake 去向；ACCEPTANCE D/E 场景与场景 17 证据更新（均为自动化
  证据，未标真实场景通过）

CI 修复说明（8ac7208 → fae5206）：web-quality 的 book-publication「excessive pages」用例期望
`page_limit_exceeded` 却得到 `invalid_worker_output`。根因是 `pdf.on("pageAdded")` 监听器内直接
throw：回调落在 pdfkit 异步冲刷栈上时异常逃逸为 uncaughtException，长栈迹撑爆父进程 8KB
stderr 预算后错误码被误判。与 GLM-D 改动无代码交集（新增测试文件加大并行负载使潜在竞态显
形）。修复：两处渲染器改为记录溢出标志并由同步检查点统一抛出；render-book worker 增加
uncaughtException 兜底，任何逃逸异常都按单行协议输出。

known limitations:
- 简洁模式 Web 端音频/视频播放仍用浏览器原生控件（无「播放/暂停」文字按钮）；原生
  NativeMediaReader 已有文字按钮与倍速。
- 离线搜索是子串匹配（无 FTS/分词）；离线时人物/日期/媒体筛选未本地化。
- 简洁模式原生端未重设计记忆详情页（复用现有大按钮播放器），后台管理页保持标准界面。
- 字节级重复（SHA-256 一致）在家庭内原件因摄取去重几乎不可能同时存在；该分支为防御性
  表述，测试以单测覆盖。
- local capture 搜索结果属设备主人所有账号可见（产品边界：本机记录属于设备）。
- 相似照片「加入相册」为资料库入口直达，未在候选面板内嵌相册选择器。

not touched:
- ftc adopt / OPS-1、OPS-9
- 备份恢复重构（BKP-8 reconciliation、BKP-10 交接包、restic BKP-4）
- 升级迁移状态机、restore reconciliation
- 正式 Android 签名 / iOS 渠道（BLK-3/4）、真实 VPS（BLK-5）
- v1.0.0 tag / stable release / 版本号
- AI Provider 架构（仍为 CPA→gpt-5.6-luna + MiMo→mimo-v2.5-asr，未新增 provider/embedding）
- 人脸/声纹识别、E2EE、支付、SaaS

recommended next task for Codex:
1. 核查 8ac7208 CI（运行中）并在变红时按纪律修复。
2. NAV-11 收尾：Web 媒体播放文字按钮（可在 MediaReader 增加「播放/暂停/重新播放」文字
   控件）；真机长辈任务（ACCEPTANCE 场景 18/D）。
3. FIND-2 收尾：离线日期/人物筛选；真机飞行模式验收（场景 E）。
4. CAP-1 剩余：私密事件读者与完整日期精度（unknown/month/year）。
5. 大线项仍按 REQUIREMENTS：OPS-1 adopt、BKP-8 恢复 reconciliation、BKP-10 交接包。
