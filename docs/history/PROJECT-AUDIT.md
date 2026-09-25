# 全项目审查（PROJECT-AUDIT）

> **历史记录**：2026-09-21（Build 72 期间）全项目审查：19 项修复，1 项撤回。结尾写成「未提交／未部署／未完成」的事项都已关闭，见历史索引。正文保留当时的状态、命令与待办，不代表现在。当前范围见 [PRODUCT](../../PRODUCT.md)，交付状态见 [HANDOFF](../../HANDOFF.md)，全部历史文档见 [索引](README.md)。

> 目的：暂停功能开发，对**整个项目**做一次以实际代码为依据的审查与验证，不限于最近提交或家庭同步模块。
> 文档本身（PRODUCT／DESIGN／AGENTS／README／CHANGELOG／HANDOFF／plans）也在审查范围内：矛盾与过时内容一并记录。
> 起点：`318274e`（Build 72 提交 10），工作区干净，`main` == `origin/main`。
> 开始时间：2026-09-21。本文件在审查过程中持续更新；**抽查结果不等于整个项目通过**，未覆盖项一律列在第五节。

## 〇、方法与分工

- 七个**只读**审查代理按模块并行，互不修改文件；所有验证、复现、修复由主审（主会话）亲自做，避免同时改同一文件。
- 每条发现要求：`file:line`、触发条件、影响、严重度、证据。区分**已确认缺陷**与**待验证风险**。
- 能复现的缺陷：先补回归测试（先红）再修，优先级 数据丢失／安全 > 核心功能 > 一般 > 小。
- 同时检查测试与假件（`tests/helpers/*`、各测试里的假服务端）是否忠实于真实实现；**不得弱化断言让测试变绿**。

四个只读审查代理在早期被中止，那四块由**主审亲自补做**（见下表「主审补做」列）。修复一律由主审拟定任务、交 Astra 执行、再由主审独立验收。

| # | 模块 | 代理回报 | 主审补做 / 复核 | 本轮产出 |
| --- | --- | --- | --- | --- |
| 1 | 本机数据与存储 | 代理被中止 | **主审补做**：写队列原子性、SQLite/WAL 换代、素材引用集与清理、空实体静默清理、六处删除的墓碑、草稿跨设备语义 | A-6、A-14；6 项核实无缺陷 |
| 2 | 备份・导出・归档・纸书 | 4 缺陷 + 6 风险 | 主审复核了 #1（= A-6）、#2（= A-14）、#3／#4（成立但轻微） | A-6、A-14 已修 |
| 3 | 同步（对抗性复审） | 代理被中止 | **主审补做**：合并链的素材完整性、`joinFamily` 的换钥匙路径、本机设备身份、claim 释放时机 | A-16；合并链核实无缺陷 |
| 4 | 界面・导航・状态 | 代理被中止 | **主审补做**：27 条路由声明/注册/可达性、死导出普查（67 个候选逐一 grep）、全部确认框文案 vs 真实行为 | A-7、A-13、A-16；路由与死代码核实干净 |
| 5 | AI 调用与提示词 | 8 缺陷 + 5 风险 | 主审复核：确认 A-4／A-5／A-13；**推翻 D5、D6、D8 与 D4 的一半**；**A-17 后来被主审自己推翻** | A-4、A-5、A-13、~~A-17~~ |
| 6 | 服务端 | 10 缺陷 + 6 风险 | 主审复核：确认 #1／#2／#3／#4／#6／#7／#8（部分）；**#5／#9／#10 判为不值得修**；27 条路由守卫逐条核过 | A-1／A-2／A-3／A-8／A-11／A-12／A-15、**A-18（主审在验收中发现，是修 A-8 时引入的）** |
| 7 | 构建・CI・发布・部署・文档 | 代理被中止 | **主审补做**：两个 workflow、`app.json`、两边 `package.json` 脚本、AGENTS/PRODUCT/AI-PROMPTS 三份文档 vs 代码 | A-9、A-10（均已修） |
| X | **跨模块（主审自己做）** | — | 手机↔服务端数据契约、错误码映射、Build 71↔72 备份兼容（用真的 Build 71 代码验的）、宪法边界、文档 vs 代码 | X-1…X-4 |

## 一、模块与关键用户流程清单

### 手机端页面（`navigation.ts` 的 `Routes`，27 条，全部已在 `App.tsx` 注册 ✓）

Shelf（书架/首页）· Search · Month · Year · Recap（年度回顾）· Firsts（第一次）· Footprint（足迹）· People（人物）·
Title（扉页）· Settings（我的）· Editor（编辑一段时光）· Record（阅读）· Album · Series · Picker（选照片）·
AlbumDetails · Media（单张照片）· Profile · Storage · Backup（备份与恢复）· Appearance（外观）· Signature（我的落款）·
AISettings · LetterEditor · Letter · Quotes（语录）· RecoveryCode（恢复码 show/join）

### 关键用户流程（审查时按真实调用链走）

1. 首次启动 → 激活/建库（`activation.ts`／`disk.ts`）→ 空库首页
2. 记一段时光：拍照/选照片 → `Picker` → `Editor`（草稿、自动保存、落款）→ 保存 → 书架出现
3. 阅读与浏览：Shelf（年份/月册/最近整宽卡/随便翻翻）→ Record → Media；Search；Year/Recap；Footprint；People
4. 相册・系列・信・语录・第一次：建立、编辑、删除（**六处删除是否都立墓碑**）
5. 纪念册/纸书/年度册：预览 → 装订 → 导出 PDF
6. 开放归档导出：`index.html` + Markdown + 照片
7. 本机备份：保留备份 `.xmbm` + blob 库 → 导出 `.xmb`（含分卷）→ 恢复（单卷/多卷/乱序）
8. 远端备份与家人一起写：登录 → 开始一起写/加入（12 词恢复码）→ 同步（拉清单→合并→下素材→写库→推送）→ 冲突留底 → 退出
9. AI：起个头/润色/年度寄语/分组 → 服务端 `/ai/*` → 上游模型 → 回填编辑器
10. 主人管理：`/admin/*` 成员、设备、配额、家庭备份用量
11. 换机：加入（= 全量拉取）；灾难恢复：启动救援 `recoverStartupBackup`

### 服务端端点（`server/src/app.ts`，27 个）

`/healthz`・`/`・`/api/v1/status`・`/setup`・`/login`・`/password`・`/me`・`/ai/config`・`/ai/group`・`/ai/write`・
`/backup/status`・`/backup/objects/have`・`PUT|GET /backup/objects/:id`・`PUT|GET /backup/manifest`・`GET /backup/manifests`・
`DELETE /backup/manifests/:deviceId`・`/backup/prune`・`DELETE /backup`・
`/admin/overview`・`POST /admin/members`・`PUT /admin/members/:id/login`・`PATCH /admin/members/:id`・
`DELETE /admin/members/:id/backup`・`DELETE /admin/backup`・`DELETE /admin/devices/:id`・`PUT /admin/settings`

## 二、检查清单（按用户要求的六个维度）

| 维度 | 覆盖到什么程度（诚实版） |
| --- | --- |
| 移动端：页面、入口、交互、导航、状态管理 | 导航与入口**已穷举**（27/27 路由声明=注册=可达；死导出 67 个候选逐一核过，无死代码）；确认框文案 vs 真实行为**已逐条读过**（查出 A-7／A-16）；状态管理只覆盖了写队列与 `NoteCard`／`RemoteBackupCard`／`Editor` 几处。**观感、手势、性能、无障碍需要真机**。 |
| 服务端：接口、鉴权、权限隔离、输入校验、错误处理 | **27 条路由的守卫逐条核过，无缺陷**；输入校验看了备份与 AI 两套 schema（一度以为口径不一致，记为 A-17，后被自己推翻）；错误处理核了统一错误处理器与手机端的映射（X-4）。限流逐行读过：`login`／`password` 走 `throttle(req,10,60)`（每 IP 10、全局 60，60 秒滚动窗），`setup` 20／60，登录失败走 `timingDummy` 防时序；**故意不信 `x-forwarded-for`**（没设 `trustProxy`），所以反代后所有请求同一个 IP，效果是全家合用每分钟 10 次登录——方向偏严，对一家人够用，**无缺陷**。**真实压力仍未测**。 |
| 数据：本地库、迁移、文件系统、备份、恢复、同步、冲突、清理 | 覆盖最深的一块：写队列原子性、SQLite 换代、blob 库回收、恢复失败的清理、素材引用集、墓碑、合并链完整性、prune 的保护语义。查出 A-1／A-2／A-3／A-6／A-14／A-16。**两台真机跑一次完整家庭同步仍未做**。 |
| AI：调用、提示词、配置、异常处理 | 送出去的 payload **逐字段核过**（查出 A-4）、取消与覆盖路径核过（A-13）、限制口径核过（**A-17 判错了又自己推翻**，见该条）、端点可达性核过。**没有对上游发过任何真实请求**；提示词本身的质量属于产品判断，不在本轮。 |
| 工程：构建、部署、CI、发布配置、新旧客户端兼容 | 两个 workflow、`app.json`、两边脚本**全读过**（查出 A-9／A-10，均已修）；Build 71↔72 兼容用**真的 Build 71 代码**验过（X-3）。**没有真跑过一次出包流水线**。 |
| 横切：安全、隐私、性能、资源泄漏、依赖兼容 | 安全：鉴权矩阵 + 对象覆盖（A-11）+ 撤销语义（A-8）。隐私：AI payload（A-4）。性能：**实测**了 `usage()`（A-15）。资源：句柄与 `.part` 泄漏（A-14 及其尾巴）。依赖：宪法禁用清单核过；`npm audit` 两边都跑过，**各 0 条漏洞**（服务端含 dev 也是 0）。**没有做逐包的版本兼容矩阵**，Expo 侧靠 CI 的 `expo-doctor`。 |

场景维度（空数据 · 超大数据 · 重复操作 · 并发 · 取消 · 断网 · 超时 · 应用重启 · 部分成功 · 重试）：
超大数据（50000 对象边界、20000 对象的 `usage()`）、并发（prune 与上传、配额超卖）、取消（A-13、`ensureBlob`）、
应用重启（claim 持久化、半份清单）、部分成功与重试（合并的 `INCOMPLETE` 回滚、claim TTL）都实际走过；
**断网与超时只读了代码路径，没有做故障注入**；空数据与重复操作靠现有测试覆盖，本轮没有专门加压。

场景维度（每个模块都要过）：空数据 · 超大数据 · 重复操作 · 并发 · 取消 · 断网 · 超时 · 应用重启 · 部分成功 · 重试。

## 三、发现（持续更新）

> 状态：`已确认` / `待验证` / `已修复` / `不修（理由）`。严重度：`数据丢失/安全` > `核心功能` > `一般` > `小`。

### X · 跨模块（主审自查，已用可运行的复现证明）

#### X-1 `已确认` · `数据丢失` · 服务端 prune 会删掉「没登记 objects 的清单」所指向的对象

- 位置：`server/src/app.ts:189-195`（prune 路由）、`server/src/store.ts:172-177`（`manifestObjects()`）、`server/src/backup-store.ts:125-137`（`prune`）
- 触发条件：家庭里存在一份**没有登记 objects 的清单行**，另一台手机随后正常 `POST /backup/prune`。三条真实路径会产生这种行：
  1. **Build 70 的手机**：`PUT /backup/manifest` 不带 `objects`，服务端存成 `[]`（`app.ts:171` 的 `input.objects??[]`）。
  2. **旧表迁移来的 `legacy:` 行**：首版 `backup_manifests` 没有 `objects_json` 列，迁移时写入 `NULL`（`store.ts:41-45`）。
  3. **超大库**：手机端超过 50000 个对象时故意不登记（`mobile/src/sync/engine.ts` 的 `registered = ids.length <= 50000 ? ids : []`）。
- 影响：那台手机的远端备份对象被删除，而它的清单行还在指着它们 → 该设备的远端备份不可恢复（本机资料不受影响，下次备份会重传）。
  `backup-store.ts:127` 的注释明确承诺「任一台手机给错、给漏 keep 也删不掉别人清单指向的东西」——**这条保证在上述情形下不成立**。
- 证据（复现脚本，非生产）：老手机传 1 个对象并发布不带 objects 的清单 → 越过 1 小时宽限 → 新手机 prune：

  ```text
  prune result: { removed: 1, bytes: 1000 }
  老手机的对象还在吗： false
  ```
- 生产现状：主人尚未用过远端备份，生产库里没有任何成员对象目录，也没有 legacy 行（HANDOFF 第一节），**目前未触发**。
- 建议修法（待定稿）：沿用本机 `collectBlobs()` 的哲学——只要有任何一份清单行「读不出它引用了什么」（`objects_json` 为 NULL 或空数组），这一轮就整个不收拾（`removed: 0`），宁可多占空间。

#### X-2 `已确认` · `数据丢失` · 首次加入慢速上传超过 1 小时宽限后，会被**别的手机**的 prune 删掉在传对象

- 位置：`server/src/backup-store.ts:129-137`（`graceMs = 3600000`）
- 触发条件：一台手机首次加入、几 GB 照片在慢网上传（清单要等全部传完才 `PUT`），早期上传的对象 mtime 超过 1 小时；
  期间另一台手机完成一次同步并调用 prune（Build 72 提交 12 的自动同步**默认开**：回前台 + 保存后 30 秒，所以这很容易发生）。
- 影响：在传的对象被删；该手机传完后发布的清单指向已不存在的对象 → 远端备份残缺，`verifyRemoteBackup` 报少照片；下次备份会重传（自愈），但期间备份不可用。
- 证据（复现脚本）：

  ```text
  prune result: { removed: 1, bytes: 1000 }
  在传的对象还在吗： false
  ```
- 建议修法（待定稿）：把「这台设备正在用的对象」变成服务端认得的东西——例如 `POST /backup/objects/have` 查询过的 id 记一条短期占位（claim，带 TTL），prune 时并进 keep；或至少大幅提高宽限并在文档写明。单纯调大 `graceMs` 不能根治。

#### X-3 `已核实·无缺陷` · Build 71 ↔ Build 72 备份兼容（用真的 Build 71 代码验的，不是推断）

- 做法：`git show 412f8e0:mobile/src/local/{model,backup-format,brand,dates,photo-metadata,places}.ts` 与 `ai/{types,state}.ts` 取出 Build 71 的真实代码，
  在隔离目录里用 Node 直接跑它的 `normalizeLibrary`／`validateLibrary`／`encodeEntities`／`rootOf`，喂 Build 72 形状的库（记录带 `by`、根带 `tombstones`）。
- 结果（**先跑对照组**，避免拿坏夹具得出错误结论——第一版夹具写错了记录形状，对照组也不过，已作废重做）：

  ```text
  ① 干净的 Build 71 库（对照）: 通过（by=undefined tombstones=undefined）
  ② 只加记录上的 by（落款）: 通过（by="爸爸" tombstones=undefined）
  ③ 只加根 tombstones（墓碑）: 通过（by=undefined tombstones={...}）
  ④ 两个都加（真实的 Build 72 库）: 通过（by="爸爸" tombstones={...}）
  ```
- 而且是**双向**的：Build 71 的 `encodeEntities` 整个实体原样 `JSON.stringify`（`e: library[kind][id]`），
  `rootOf` 是 `{...s}` 去掉实体集合的**展开**而不是白名单 —— 所以 Build 71 的手机重新写备份时，`by` 与 `tombstones` 也**不会被抹掉**。
- 结论：`docs/plans/PLAN-SHARING.md` 三.10 的兼容承诺成立（能打开、也能原样带走）。

#### X-4 `已核实·无缺陷` · 手机↔服务端错误契约

- 服务端 `app.ts:23-31` 的 `setErrorHandler` 对 `Problem`／`ZodError`／Fastify 4xx／未知异常一律回 `{code, message}`，消息都是中文，不泄漏堆栈与路径。
- 手机端 `transport.ts` 优先用服务端的 `code`；没有 `code`（网关 HTML 错误页）时按 401/413/507/429 兜底，消息优先用服务端的 `message`，再退到本地文案。
- 逐条比对：手机真正**按 code 分支**的只有 `AUTH_REQUIRED`／`NOT_FOUND`（`leaveFamily`）与几个纯客户端码（`CANCELED`／`CORRUPT`／`KEY_MISMATCH`／`WRONG_CODE`／`INCOMPLETE`），
  服务端这两个码的拼写一致。`RATE_LIMIT`／`QUOTA_EXCEEDED`／`OBJECT_CORRUPT`／`INTERNAL` 等没进 `MESSAGES` 的码会落到服务端消息，行为正确。
- 批量上限也对得上：`have` 手机 2000 ≤ 服务端 `idList(5000)`；`prune` 手机 ≤ 50000 = 服务端 `idList(50000)`。

### 主审已亲自复核确认的缺陷（按严重度排序）

#### A-1 `已确认` · `数据丢失·运维` · **文档里让人对生产跑的探测命令，会清空全家远端备份**

- 位置：`server/scripts/probe-upload-limit.py:34`、`deploy/README.md`「反代」一节、`server/src/app.ts:196-201`
- 主审复核：三处原文都亲自读过。脚本 `finally` 无条件 `if token: request('/backup', None, token, 'DELETE')`；
  而 Build 72 把 `DELETE /api/v1/backup` 从「只删本成员这一份清单」改成了 `store.deleteMemberManifests(member.id)`（**该成员名下全部设备**）+ `sweep()`（**全家 prune**）。
  `deploy/README.md` 明写「每次改反代或升级服务后用 `probe-upload-limit.py --username <成员> --password <密码> --mb 4 9 --container anan-ai-ai-1` 探一次」，`--base` 默认就是 `https://service.example.invalid/api/v1`（生产）。
- 影响：按文档办事的一次例行探测 = 删掉该成员全部清单 + 触发全家回收。主人是目前唯一发布过清单的人，因此保护名单会直接变空 → **全家对象库被扫空**。
- 现状：主人尚未用过远端备份，生产库里没有对象，所以**至今没有造成损失**；但这是一颗对着生产的定时雷，必须在任何人再次按文档探测之前拆掉。
- **未执行验证**：按规则不对生产做破坏性验证；仅凭三处源码与文档原文判定，且服务端审查代理在沙箱里用临时库复现过同一条（备份前 10 个对象 → `DELETE /backup` → 0 个对象、0 份清单）。
- 修法：脚本 `finally` 不再调 `DELETE /backup`（改为只删自己这台探测设备的清单，或什么都不删交给宽限）；README 那一行补一句风险说明。

#### A-2 `已确认` · `数据丢失` · prune 删掉「没登记 objects 的清单」指向的对象（= 本文件 X-1，服务端代理独立复现）

主审已自行复现（见 X-1）。服务端代理独立复现出三条路径（Build 70 形状 PUT、`objects_json = NULL` 的 legacy 行、`DELETE /backup` 的 sweep），结论一致。
补充：`migrateMemberSpaces()` 用 `renameSync` **不改 mtime**，所以迁移来的老对象一上来就没有一小时宽限。

#### A-3 `已确认` · `数据丢失` · 慢速首次上传超过一小时宽限会被别的手机 prune 掉（= 本文件 X-2）

主审已自行复现。

#### A-4 `已确认` · `隐私` · 年度寄语把**没有标题的记录的正文前 30 字**发给 AI，与同意书和手册都不符

- 位置：`mobile/src/ai/state.ts:302-303`（`titleOf` 回退到 `r.text.trim().split("\n")[0]?.slice(0, 30)`），经 `:305-311` 进 payload，由 `mobile/src/local/Year.tsx:100` 发出
- 主审复核：三处原文都读过。`Year.tsx:74` 的同意书只说「把这一年的**记录标题**和「第一次」清单（纯文字，不含照片与精确位置）…发送给 DeepSeek Flash High」；
  `docs/AI-PROMPTS.md` 的 RECAP 行把**正文**列在「从不送」。而编辑器里标题是「标题（可选）」，没起标题是常态。
- 同意书还漏说了：该年**已写的寄语**正文前 500 字也会一并送出（`state.ts:310`）。
- 测试把错误行为固化了：`mobile/tests/ai-state.test.ts:349` 用例名叫「builds the recap context from titles and firsts, **text only**」，却断言 `expect(context).toContain("公园里走了很远")` —— 那正是一条无标题记录的**正文首行**。
- **补充证据（主审后续查到，推翻了本条一半的判断）**：`docs/AI-PROMPTS.md:146` 的连线表把「已写寄语」明确列在 **RECAP 的「手机送」一列**，
  RECAP 提示词全文（`:73-84`）还专门写了约束「清单提供『已写的寄语』时，只作为语气与已覆盖内容的参考，不重复其句子」。
  所以送「已写寄语」是**手册里设计好的**，缺的只是同意书没提。三份文档（`Year.tsx:74` 同意书、`PRODUCT.md` 第五节「这一年的标题清单」、
  `AI-PROMPTS.md:146` 的「从不送：正文」）**一致禁止的只有记录正文**。
- **主人已拍板（2026-09-21，两次）：只删正文，寄语补进同意书。**
  `titleOf` 无标题时回退成「（无标题）· 日期」，正文一律不送；`existingNote` 按手册保留（前 500 字）；
  `Year.tsx` 的同意书补一句「以及你已经写下的寄语，让 AI 避开你说过的话」。
  顺带把 `mobile/tests/ai-state.test.ts:349` 那条自相矛盾的用例改成断言「正文不出现在 payload 里」。
- 另注：手册 RECAP 还写着要送「她说的话」，当前代码没有单独送（`quote` 记录只是混在标题清单里）。属于手册第四节标注的「微调」未落地，不是缺陷。

#### A-5 `已确认` · `数据丢失` · 采用 AI「分成几件事」会静默丢掉草稿上的人物标签

- 位置：`mobile/src/ai/state.ts:201-209`（`proposalEvents` 的 `mapped`）
- 主审复核：`mapped` 逐条新建 `RecordContent`，只写 `title/text/date/location/first/mediaIds/coverId`，**没有 `personIds`**。
  落款 `by` 有后路——`mobile/src/local/photo-metadata.ts:95-99` 的 `photoDayGroups` 会回填 `draft.content.by`——但它只回填 `by`，`personIds` 没有这条后路。
- 触发：新建草稿 → 选 ≥2 张照片 → 勾「这一刻有谁」→「分成几件事」→ 确认分组 → 保存 → 每条记录的 `personIds` 都是空。
  手动「调整照片归属」路径不受影响（走 `clone(draft.content)`）。
- 影响：静默丢数据，界面无任何提示。范围限于未保存草稿上的人物标签。

#### A-6 `已确认` · `数据丢失` · 恢复**失败**时会删掉当前库正在用的缩略图，违背「当前库一个字节都没动过」的承诺

- 位置：`mobile/src/local/backup.ts` —— `assignExtracted()`（:474-493）只重写 `file`，**不动 `thumb`**；
  `rebuildThumbs()`（:723-738）用 `renderThumb()` 覆盖 `thumb`，但 `renderThumb()`（`src/local/files.ts:82-115`）**吞掉一切异常返回 `undefined`**，
  这时 `state.media[id].thumb` 仍是**备份里记的旧缩略图名**；`restoreBackup()` 的 catch（:753-756）对 `restored.media` 逐条 `deleteMediaFiles(m)`，
  于是按那个旧名字把文件删掉。
- 触发条件：在**同一台手机**上恢复自己的保留备份（`.xmbm`／`.xmb` 都走 `assignExtracted`，见 :533），
  其中任一张图/视频重建缩略图失败（内存紧张、文件系统报错、`expo-image-manipulator` 原生侧失败都会落到那个 `catch {}`），
  且恢复后续任一步再失败（校验失败、空间不足、用户按「停止」）。
  ——旧缩略图名正是**当前库此刻仍在用的那个文件名**，所以删的是活库的缩略图。
- 影响：恢复失败后「当前库一个字节都没动过」不成立（这句承诺就写在 `restoreBackup` 上方的注释里，:740-743）；
  书架/相册的缩略图变成空白，且代码里没有按需重建缩略图的路径。素材原件与库数据不受影响。
- 从别的手机恢复不受影响（旧名字在本机不存在，`thumbFile()?.exists` 为假）。
- 同一处 catch 也在 `recoverStartupBackup()`（:784-798），但那条路径本来就是「库打不开」，影响小。
- 测试为何抓不到：`mobile/tests/local-backup.test.ts:30-51` 的 `manipulateAsync`／`getThumbnailAsync` 假件**永不失败**，
  `renderThumb` 因此永远返回结果，这条分支从未被执行。
- 修法：`assignExtracted` 给每条素材**先清掉 `thumb`**（或换成本次恢复的新名），让 `restored.media` 里只可能出现本次恢复写出的文件名。

#### A-7 `已确认` · `界面与真实行为不一致` · 按钮写着「从远端恢复」，按下去做的是「加入家庭并合并」

- 位置：`mobile/src/sync/RemoteBackupCard.tsx:252-258` 与 `:303-309`（两处 `title="从远端恢复"`，`testID="remote-restore"`），
  都 `nav.navigate("RecoveryCode", { mode: "join" })`。
- 落地页本身是诚实的：`mobile/src/sync/RecoveryCode.tsx:111-114` 写「加入家人一起写。本机已有的内容会与家人的内容合在一起。」，按钮叫「加入并同步」。
  但**入口按钮**仍是 Build 71 的旧文案。
- 与主人的 Build 72 决策直接冲突：「从远端恢复」应当**整个去掉**（`restoreFromRemote` 已在提交 10 删除，`RecoveryCode` 的模式已改成 `"show" | "join"`，
  唯独这两处按钮文案没改）。
- 影响：想「丢掉本机这摊、拿回远端那份干净的」的人，得到的是**合并**——本机内容不会被丢掉，且没有撤销。
  不是静默数据丢失（落地页有解释与二次确认），但属于「界面宣称的能力与真实行为不一致」。
- 修法：两处文案改成「加入家人一起写」（或「加入家庭」），`testID` 一并从 `remote-restore` 改掉，并核对引用该 testID 的测试。

#### A-8 `已确认` · `安全/隐私` · 撤销设备（丢手机、家人退出）不会撤下它已发布的清单

- 位置：`server/src/store.ts:135-137` 的 `revoke()`／`revokeOthers()`／`revokeAll()` **只写 `devices.revoked=1`**，都不碰 `backup_manifests_v2`；
  `manifests()`（:166）也没有对 `devices.revoked` 做任何过滤。
- 调用方：`DELETE /api/v1/admin/devices/:id`（`app.ts:235-239`，主人撤销某台设备）、
  `PUT /api/v1/admin/members/:id/login`（`app.ts:213-219`，重置登录 → `revokeAll`）、
  `PATCH /api/v1/admin/members/:id` 把成员 `enabled` 改成 false（`app.ts:220-224`，成员整个停用）。
- 影响：手机丢了／家人退出之后，那台设备**最后一份快照仍然挂在 `GET /api/v1/backup/manifests` 上**，
  全家每台手机继续把它合并进来——包括它的**墓碑（删除）**。已经合过的手机因为 `base.json` 的 `known` 不会反复受影响，
  但**此后新加入的手机会完整地把这份退场快照合进去**。
- 服务端已有两件对应工具（`DELETE /api/v1/backup/manifests/:deviceId`、`DELETE /api/v1/admin/members/:id/backup`），
  但撤销流程都不调用它们，`deploy/README.md` 也没提示要补这一步；**而且手机端一个都没有入口**
  （`mobile/src/ai/Settings.tsx` 只调 `/admin/members`、`/admin/members/:id`、`/admin/members/:id/login`、`/admin/devices/:id`）。
  也就是说主人**在 App 里根本没有办法撤下一位已退出家人发布的快照**，只能上服务器敲 curl。
- 修法：`revoke()`／`revokeAll()`／停用成员时一并 `deleteManifest(deviceId)` 并 `sweep()`；或至少在主人撤销设备的响应与文档里明确要求补删清单。
- **残留风险（设计层面，非缺陷）**：退出的家人手里那 12 个词仍然是家庭钥匙，服务端没有换钥匙的路径；
  他们已下载到本地的密文依旧能解开。撤销只能断掉他们继续取新内容的通道。

#### A-9 `已确认` · `文档自相矛盾` · `AGENTS.md` 要求的服务端 `npm run lint` 根本不存在

- 位置：`AGENTS.md:9` 要求推送前在 `mobile/` **和 `server/`** 跑 `npm test`、`npm run typecheck`、`npm run lint`。
- 实测：`cd server && npm run lint` → `npm error Missing script: "lint"`；`server/package.json` 的 scripts 只有
  `start / typecheck / test / password / backup`，目录下也**没有任何 eslint 配置**。
- 影响：这条门禁规则**照字面执行必然报错**；实际后果是服务端那几百行 TypeScript 从来没有被 lint 过——本机没有，CI 也没有
  （`.github/workflows/ci.yml` 的 `ai-quality` 只跑 `typecheck` 与 `test`）。
- **已修（2026-09-21，主审亲自改）**：`AGENTS.md:9` 现在写的是「`npm test` 与 `npm run typecheck` 两边都跑；`npm run lint` 只在 `mobile/`——服务端没有 lint 脚本」。
- 主人拍板：改 `AGENTS.md`，把门禁写成「`npm test`、`npm run typecheck` 两边都跑；`npm run lint` 只在 `mobile/`」。
  不在审查期给 server 引入 eslint（那会带来一批与审查无关的改动）。

#### A-10 `已确认` · `发布配置` · 出包流水线比日常 CI 少两道闸

- 位置：`.github/workflows/mobile-build.yml` 的 `quality` job 跑 typecheck／lint／`npm test`／doctor／两次 `expo export`，
  但**不跑** `ci.yml` 里的 `python3 mobile/scripts/verify-local-boundary.py`、`python3 -m unittest discover -s mobile/scripts`，
  也**不跑服务端的 `npm test`**（`ci.yml` 的 `ai-quality` 只在 push/dispatch 上跑，出包流水线不依赖它是否绿）。
- 触发条件：`mobile-build.yml` 只校验 `source_sha` 是 `origin/main` 的祖先，**不校验该提交的 CI 是否通过**，
  所以一个违反「本机边界」宪法或服务端测试为红的提交，照样能出安装包。
- 影响：发布路径的保障弱于日常路径。至今没有造成实际问题（日常门禁一直手工跑过），属于流程性风险。
- **已修（2026-09-21，主审亲自改）**：`mobile-build.yml` 的 `quality` job 在 `npm run doctor` 之后补上了
  `py_compile` + `unittest discover -s mobile/scripts` + `verify-local-boundary.py`，以及 `npm test`（`working-directory: server`）。
  「不校验该提交的 CI 是否绿」这一点写进了那段注释，暂不改（要查 CI 结论得调 GitHub API，超出本轮范围）。

#### A-11 `已确认` · `安全/数据完整性` · 任何一位家人都能用任意字节覆盖别人备份里的任意对象

- 位置：`server/src/backup-store.ts:57-93` 的 `receive()` —— 校验通过后无条件 `renameSync(temp, target)`，
  **对象已存在时直接覆盖**。服务端看不见钥匙，认不出「同一个 id 换了内容」（:53-57 的注释自己也这么写）。
- 触发：任何持有有效设备令牌的家庭成员（或被盗的令牌）`PUT /api/v1/backup/objects/<别人的对象 id>`，
  body 随便什么字节，只要 `X-Content-SHA256` 与自己发的字节一致即可 —— 服务端就把原来的密文换掉了。
- 影响：全家任何一份引用该对象的备份在恢复时解不开（AEAD 校验失败），而且**在有人真去恢复之前完全无声**。
  这不是「读」的问题（家人本来就共用一把钥匙、本就能解密），而是多给了一份**破坏**能力。
- 为什么这条能干净地修：对象 id 与 nonce **都是确定性派生**的
  （`mobile/src/sync/crypto.ts:18-23`、`:72-73`：`nonce = HKDF(K,"anan-nonce-v1/<内容 sha256>")‖u32be(块序)`），
  所以同一个 id 在任何一台手机上封出来的密文**逐字节相同**。手机端也只上传服务端回报「缺」的 id
  （`engine.ts` 的 `uploadContent` 按 `missing` 过滤），并发重传的两台手机发的也是同样的字节。
- 修法（改动很小）：内容寻址库按「先到为准」——`receive()` 里 `previous !== null` 时不 rename，
  删掉临时文件、照常返回 `{bytes, created:false}`。诚实的重传变成 no-op，恶意覆盖直接不可能。

#### A-12 `已确认` · `核心功能·文案` · KEY_MISMATCH 的自救指引在「一家人」模型下失效

- 位置：`mobile/src/sync/engine.ts:87-88` 的文案「服务上已有另一份恢复码的备份。**要换成这台手机的，先关闭并删除远端备份**；要拿回那份，请用它的恢复码恢复。」
- 已核实的行为变化（对比 Build 71 与现在的代码，不是推断）：
  - Build 71（`96f1b65~1:server/src/app.ts:116-119`）：`GET /backup/status` 取 `store.manifest(member.id)` —— keyId、用量、配额**都是这位成员自己的**。
  - 现在（`server/src/app.ts:125-129`）：取 `store.latestManifest()` —— **全家最新那份清单**的 keyId，用量与配额也都是全家的。
- 于是「关闭并删除远端备份」（`DELETE /api/v1/backup` → `store.deleteMemberManifests(member.id)`）**只删得掉自己这位成员的清单**。
  挡路的那份 keyId 属于**别的成员**时，删完 `latestManifest()` 依旧返回它，`assertSameKey` 继续抛 KEY_MISMATCH —— 指引让人做的事不解决问题，且没有别的出路。
  （同一成员的多台手机这条指引仍然有效，因为 `deleteMemberManifests` 会把这位成员名下全部清单删掉。）
- 现实影响：生产库里至今**没有任何成员做过远端备份**，所以现在不会有人撞上；Build 72 之后大家都用同一份家庭恢复码，也撞不上。
  真正会撞上的是「家人误按『开启远端备份』自己生成了一把新钥匙」——正确出路是「加入家人一起写」（输入家庭恢复码），而文案指向的是删备份。
- 修法：文案改成指向加入流程；顺带确认 `status` 返回的 `objects/bytes/limitBytes` 现在是**全家**口径，界面上不要当成「我的用量」展示。

#### A-13 `已确认` · `数据丢失` · 「AI 帮我起草」会无条件盖掉等待期间用户自己写的字，且「取消」取消不掉

- 位置：`mobile/src/local/NoteCard.tsx:52-61` 的 `draftWithAI()` —— `.then((text) => setDraft(text))`，
  **无条件整段替换编辑框内容**，既不比对用户这段时间写了什么，也不问一句。
- 请求链上**没有任何 AbortSignal**：`Year.tsx:95-104`（年度寄语）与相册扉页寄语都直接 `api("/ai/write", …)`，
  `mobile/src/ai/client.ts` 的 `api()` 也不接 signal。
- 卡上的「取消」按钮（`:91-100`）`disabled={busy}`，**不看 `assistBusy`**：起草途中可以按，按下只做 `setDraft(note)` + `setEditing(false)`，
  **请求照跑**。晚到的结果仍然 `setDraft(text)` 写进状态；用户再点「写下寄语」虽然会 `setDraft(note)` 重置（`:130-133`），
  但若结果恰在重置之后到达，编辑框又会被那段 AI 文字盖掉。
- 触发条件：点「AI 帮我起草」→ 等待期间继续打字（上游一次要几秒到几十秒）→ 结果到达 → **自己写的那几行没了，没有撤销**。
- 影响：丢的是用户刚写的原创文字，属于数据丢失；范围限于年度寄语／相册扉页寄语这类 NoteCard 编辑框。
- 修法：起草前记下 `draft` 快照，返回时若 `draft` 已被改动就改为「用 AI 这版替换 / 保留我写的」二选一；
  并给 `assist.generate()` 传 AbortSignal，「取消」时 abort 且忽略晚到结果。
- 附带核实：审查代理回报的 **D5「失败后『正在生成…』不消失」在这个组件上不成立** ——
  `.finally(() => setAssistBusy(false))` 会把按钮标题恢复（`:60`）。

#### A-14 `已确认` · `资源/可用性` · `.xmbm` 直接用正式名写，被杀进程会留下半份清单，blob 回收随之停摆

- 位置：`mobile/src/local/backup.ts:231-247` —— `writeManifest()` 直接 `new File(backupDirectory, backupFileName(..., "xmbm"))` +
  `out.create()` 后写 head 与 entities，**没有先写 `.part` 再 move**（`ensureBlob()` 对 blob 就是这么做的，:166-186，所以仓库里本来就有这个惯例）。
  只有**抛异常**那条路会 `out.delete()`；进程被杀（OOM、强退、断电）没有任何清理。
- 后果链：半份 `.xmbm` 仍匹配 `isRetainedBackup`（`/\.xmbm?$/`）→ 进 `retainedBackups()` →
  `collectBlobs()` 里 `manifestBlobs()` 读不出来就 `return null`（:391-399，「读不出就这一轮不删」）→ **blob 库从此一次都不回收**；
  同时它还会出现在「本机备份」列表里，点恢复报「备份文件长度不完整。」。
- 自愈边界：`pruneBackups(3)` 按名字只留最新 3 份，所以再成功备份 3 次它就会被轮换掉；
  也就是说影响面是「最多三个备份周期内 blob 库只增不减」，不是永久。
- 修法：写进 `<名字>.xmbm.part`，`verifyManifest()` 过了再 `move` 成正式名。
  `isRetainedBackup` 与 `restorePins()` 都不匹配 `.part`，所以是一处即可、无连带改动。

#### 两条轻微观察（记录在案，本轮不改，避免无关改动）

- `ensureBlob()` 的 `finally { output.close(); input.close(); }`（`backup.ts:180-183`）：`output.close()` 抛错会漏掉 `input.close()`。
  真实发生概率极低，且发生时进程本来就有更大的麻烦。（= 备份代理回报的 #4，**成立**。）
- `ensureBlob()` 不接 `AbortSignal`，`writeManifest()` 只在**两个 blob 之间**查 `signal?.aborted`（`backup.ts:226-230`）。
  于是「停止」的响应延迟 = 当前这一份素材复制完。`pumpBytes` 已有 `onChunk` 回调（`drainBlob` 就是这么用的），补上是一行的事。（= 备份代理回报的 #3，**成立**。）

#### A-15 `已确认·主审实测` · `usage()` 每次上传都全量 stat 整个对象库，首次大备份会把服务卡住二十多分钟

- 位置：`server/src/app.ts:122` 的 `quotaLeft()` = `store.familyLimitBytes() - backups().usage().bytes`，
  在 **每一次** `PUT /api/v1/backup/objects/:id` 里都算一遍（`:145` 附近）。
  `usage()`（`backup-store.ts:120-123`）调 `list()`，而 `list()` 是 `readdirSync` 全部前缀目录 + 对每个文件 `statSync`——**同步**的。
- **主审实测**（本机、缓存已热、20000 个对象）：

  ```
  warm-1: objects=20000 bytes=1280000 -> 70.3 ms
  warm-2: objects=20000 bytes=1280000 -> 67.6 ms
  warm-3: objects=20000 bytes=1280000 -> 69.5 ms
  ```

- 影响：20 GiB 配额 ≈ 20000 个对象，首次全量备份就是 **20000 × ~70 ms ≈ 23 分钟**纯 stat 开销；
  而且 `list()` 是同步的，这 23 分钟是**一段段 70 ms 地卡住整个事件循环**——期间家人的 AI 请求、另一台手机的上传、管理页全都跟着停。
  VPS 上目录缓存更冷，只会更慢。
- 修法：`BackupStore` 里维护一个增量的 `{objects, bytes}` 计数：构造时 `list()` 一次做种，
  `receive()` 按「比原来多出的字节」加、`prune()` 按删掉的减、`wipe()` 归零、`migrateMemberSpaces()` 之后重算一次。
  `GET /backup/status` 与配额都读这个计数。（= 服务端代理回报的 #6，**主审实测证实**。）

#### A-16 `已确认` · `数据丢失·界面与真实行为不一致` · 「同时删除远端」会连**同一账号另一台手机**的远端备份一起删掉，确认框只字未提

- 位置：`mobile/src/sync/RemoteBackupCard.tsx:177-204` 的 `disable()`。确认框写的是
  「关闭后**这台手机**不再往远端备份。远端已有的备份可以留着（凭恢复码随时能恢复），也可以一起删掉。」
- 真实行为：`transport.wipe()`（`transport.ts:336-338`）→ `DELETE /api/v1/backup` →
  `store.deleteMemberManifests(member.id)`（`app.ts:196-201`）= `DELETE FROM backup_manifests_v2 WHERE member_id=?`
  —— **这位成员名下全部设备的清单**，不是「这台手机」那一份；随后还会触发全家 `sweep()`。
- 为什么这在本项目里是真事：主人自己就是**一个账号两台手机**（PLAN-SHARING 第五节的验收计划、`GET /backup/manifest`
  的成员回退都是为这个场景写的）。在手机 B 上点一次「同时删除远端」，**手机 A 的家庭快照也一起没了**——
  家人从此看不到手机 A 的内容，而手机 A 自己的 `RemoteState` 还显示「已备份」，不会有任何提示。
  （手机 A 的本机资料不受影响，下次同步会重新发布，所以这是「远端备份消失 + 状态撒谎」，不是本机数据丢失。）
- 还有一处没说：这条路径会 `forgetKey()`，**这台手机从此不再持有那 12 个词**。如果家庭空间里还有别人的清单，
  想再回来就得找另一台手机要恢复码；确认框只在「保留远端」那一支提了「凭恢复码随时能恢复」。
- 这是 Build 71 单机模型的文案留在了 Build 72 的家庭语义上（服务端语义在提交 1／2 就改了）。与 A-7 同一类，但后果更实。
- 修法（按 Build 72 的语义分清两件事）：
  「只撤下这台手机」→ `deleteManifest(本机 deviceId)`（`transport.deleteManifest`，提交 10 已经有了）；
  「删掉全家的远端备份」→ 主人专属、走 `DELETE /admin/backup`，且要说清是全家的。
  确认框文案据此重写，并说明会不会忘掉恢复码。

#### A-17 ~~`已确认`~~ → **`推翻（主审自己的误判）`** · 照片张数「100 vs 20」并不矛盾：那是两个不同的量

**最初的判断（错的），原样留档：** 三处限制互不一致 —— `server/src/contracts.ts:8` 的 `photos.max(20)` 是服务端真上限，
而 `mobile/src/ai/plan.ts:43` 的前置校验写 100；据此认为 21–100 张会被服务端 Zod 拒掉、用户看到无用的 400 文案。

**推翻的证据（主审在验收第 3 批时逐行走完 `mobile/src/ai/Editor.tsx:183-300` 的真实调用链后发现）：**

```
assertGenerateInput(kind, mode, ids, …)          // 189 行，所有分支之前
  ├─ write + polish                              → perform("polish","write",[])                     0 张
  ├─ write + ids.length <= 20                    → perform("write","write",ids)                    ≤20 张
  └─ 否则（21 张以上，或 group）                   → planGroupDays 按天切、每批 ≤20 张
       perform(chunk.key,"group",chunk.photoIds)                                                   ≤20 张
       perform(day.mergeKey,"group",[],{mode:"merge",groups})                                       0 张
       write 时最后 perform("write","write",ids.slice(0,1))                                          1 张
```

- **没有任何一条路径会把 21 张以上塞进一个请求**，`photos.max(20)` 从来不会被撞到。最初判断里那句
  「`Editor.tsx:265` 把 `ids` 原样发出去」只在 `ids.length <= 20` 的分支成立，21 张以上走的是另一条分支。
- `assertGenerateInput` 里的 100 是**一份草稿一次 AI 作业最多啃多少张照片**（作业级），
  `photos.max(20)` 是**一次请求最多带几张**（请求级）。两个不同的量，原代码并不矛盾。
- 两条独立旁证：既有测试 `mobile/tests/ai-plan.test.ts:82` 用 **45 张**照片断言切成 `[[20,20,5]]`，
  说明 21–100 张走分批路径是设计好且有测试的正常流程；`README.md:65` 写明「一次最多分析 100 张照片，自动按日期分批」，
  100 是对外承诺。
- **代价**：按这条误判交出去的修法（把前置校验降到 20）**砍掉了 21–100 张的分批生成**，是功能回退。
  已在第 4 批 C-4 里回退，并补了一条钉住真实不变量的测试（21–100 张能过校验，且每个 chunk ≤ 20）。
- **留下的那点真东西**：`Editor.tsx:263` 与 `state.ts:259` 原来各写一个硬编码 `20`。提成共享常量
  `PHOTO_REQUEST_LIMIT`（请求级）并另立 `PHOTO_JOB_LIMIT = 100`（作业级）、把两者的区别写进注释，予以保留——
  正是这两个数字没有名字，才让主审把它们当成了同一个量。
- **教训（对本轮审查方法本身的）**：只比对「三处常量的数字」而没有把分支走完，就会把「两个不同的量」读成「同一个量的三处不一致」。
  凡是「数字对不上」的发现，必须先证明这几个数字量纲相同。

#### A-18 `已确认·已修` · `数据丢失` · 撤销设备顺手删掉了它的远端备份，丢手机的人再也恢复不回来（主审在验收第 3 批时发现）

- 这不是原始代码的缺陷，是**第 3 批为修 A-8 而引入的新缺陷**，由主审的验收复核查出。
- 第 3 批把 `DELETE /api/v1/admin/devices/:id` 改成 `store.revoke(id);store.deleteManifest(id);return {ok:true,pruned:sweep()};`，
  配套测试 `server/tests/backup.test.ts:414-418` 白纸黑字断言 `f.backups.stat(oid(202)) === null`。
- 为什么是数据丢失：`GET /api/v1/backup/manifest`（单数，恢复用）的取法是
  `store.manifestOf(member.deviceId!) ?? store.latestManifestOf(member.id)`，注释里明写这条回落是给换机恢复用的。
  于是「外婆手机丢了 → 主人在管理页撤销这台设备」会 ①删掉她名下唯一的清单行，换新机登录后 `GET /backup/manifest` 返回 404；
  ②只有她引用的对象从 `manifestObjects()` 的保护名单里掉出来，过了宽限被 `sweep()` 真删。
  **「丢手机」恰恰是最需要远端备份的那一刻。**
- A-8 原文报的危害只有合并那一侧（复数 `GET /backup/manifests` 让退场快照被新手机合并进来），对症的修法是
  **把已撤销设备从「全家合并清单」里摘掉**，不是删掉它的备份。
- 裁定与修法（第 4 批 C-1）：`DELETE /admin/devices/:id` 改回 `store.revoke(id);return {ok:true};`（响应体形状也复原）；
  新增 `store.activeManifests()`（`LEFT JOIN devices` + `d.revoked IS NULL OR d.revoked=0`，`legacy:` 行照留），
  **只给** `GET /api/v1/backup/manifests` 用；`GET /admin/overview` 继续用 `store.manifests()`，
  主人看得见那份还挂着的清单才有得决定；`manifestOf`／`latestManifestOf`／`manifestObjects` 一概不动。
  真要删那份备份，走已有的 `DELETE /api/v1/backup/manifests/:deviceId`。
- 附带收益：`revokeAll`（重置登录）与停用成员走的也是 `devices.revoked`，按这个修法一并生效，
  比只改 `DELETE /admin/devices/:id` 那一条路由覆盖得全。
- 已知副作用（可接受，已记入残留风险）：重置登录后手机拿到新设备 id，旧清单行留在已撤销设备名下、从合并清单里隐身，
  直到这台手机下一次发布（自动同步默认开：回前台 + 保存后 30 秒）。对象始终受保护，不丢字节。

#### A-19 `已确认·已修` · `文档` · `docs/AI-PROMPTS.md` 的「客户端送什么」一览分不清「已落地」和「还没写」

- 位置：`docs/AI-PROMPTS.md` 第四节那张表。AGENTS.md 规定「凡碰 AI 提示词follow `docs/AI-PROMPTS.md`（…**手机送什么**…）」，
  所以这张表被当成隐私契约读，但它实际混了两种行：已落地的四条与还没进代码的四条。
- 与代码的实际差异（逐条核过，方向全是「送得比表里少」，**没有隐私超送**）：
  - 只有 `GROUP`／`WRITE(generate)`／`POLISH`／`RECAP` 进了代码（`prompts.ts` 四条 `*_PROMPT`、`contracts.ts:10` 的
    `z.enum(['generate','polish','recap'])`）；`ASK`／`QUESTION`／`LETTER`／`EDITOR` 四行是草稿。
  - `WRITE` 与 `POLISH` 表里写「落款」，代码不送（`plan.ts` 的 `writeContext`、`state.ts` 的 `polishRequest` 只拼标题与正文）。
  - `RECAP` 表里写「她说的话」，代码不送（`recapContext` 只送标题清单、第一次清单、已写寄语）。
- **主审先改错了一版**：直接把 RECAP 行的「她说的话」挪进「从不送」。那等于**替主人改产品决定**
  （这张表是 2026-09-21 主人拍板的目标状态，AGENTS.md 要求「与产品定位冲突时先改 `PRODUCT.md`／找主人」）。已撤回。
- **实际修法**：表格一行不改，表下加一段说明，写清「这一栏是落地后的目标状态，不是今天的代码」，
  并把三处「今天还没送」逐条点名、附代码位置，最后提示补上时要同步改 `Year.tsx` 的起草同意书文案。
- 另核：`prompts.ts` 里的 `SHARED` 仍是旧版（含「成长相册」这类本文明令要去掉的旧词）。
  **这不是缺陷**——本文开头已写明「落地随「访谈者」那一版进代码」，属于 Build 73 的既定工作。

#### A-20 `已确认·已修` · `隐私·文档` · `README.md` 说年度寄语「只发送标题与第一次清单」，实际还发送已写寄语

- 位置：`README.md:65`「年度寄语起草**只发送标题与「第一次」清单**，计一次写作额度。」
- 实际：`mobile/src/ai/state.ts` 的 `recapContext(records, existingNote)` 一直还会把**已写的寄语前 500 字**拼进 context
  （`docs/AI-PROMPTS.md` 第四节 RECAP 行的「已写寄语」是对的，README 这一句是漏的）。**这是 A-4 之前就有的**，不是这轮改出来的。
- 与 A-4 的关系：A-4 处理的是「没有标题的记录会送正文前 30 字」，主人拍板「只删正文，寄语补进同意书」，
  App 内 `Year.tsx` 的起草同意书已经补上了「以及你已经写下的寄语」。**README 这一句当时没跟着改**，
  于是「App 里说的」和「README 里说的」互相矛盾，而 README 是对外那份。
- 修法：README 改成「只发送记录标题、「第一次」清单，以及你已经写下的寄语（让 AI 避开你说过的话），不发送记录正文与照片」，
  与 `Year.tsx` 的同意书、`docs/AI-PROMPTS.md` 的 RECAP 行三处口径一致。
- 同时核过 README 其余与备份／隐私有关的说法（第 13、22、24、42、43、47、51、53 行），其余**都与代码相符**；
  第 53 行「当前本机版：Build 71」也**不算过期**——Build 72 还没出过包。

### 三处「新行为与既有断言直接冲突」的裁定（2026-09-21）

第 3 批的工作者遇到三处既有断言与新行为直接冲突，**停下来交回主审裁定而没有擅自改**——做法正确，裁定权在主审。
逐条裁定与理由：

| # | 冲突的既有断言 | 裁定 | 理由 |
| --- | --- | --- | --- |
| 1 | `backup.test.ts:101-103`「同 id 换成更小的内容 → `stat` 变 300」 | **A-11 对，改断言** | 对象 id **与 nonce 都按内容 HKDF 确定性派生**（`crypto.ts`：`nonce=HKDF(K,"anan-nonce-v1/<内容 sha256>")‖u32be(块序)`），同 id 在每台手机封出来的密文逐字节相同；客户端只传 `have` 说缺的 id。「同 id 不同内容」诚实客户端产生不出来，能产生它的只有 bug 或被盗令牌覆盖别人的密文。堵死比记账更安全。改写时保住了该测试其余每一条断言（磁盘下限 507、全家共用配额、两条配额拒绝路径、`tmp` 不泄漏），把下游算术整体平移 500 字节保持同构。 |
| 2 | `backup.test.ts:281,284-285`「迁移时连不认识的文件一起递归删掉」 | **保留加固，改断言** | 旧 `rmSync(memberDir,{recursive:true})` 会连 `<root>/<成员 uuid>/` 下任何东西一起删；被过滤掉的还包括 `OBJECT_ID` 合法但放错前缀目录的文件——**那是真密文**。与「宁可多占空间，不可删掉还有人要的字节」一致。原有的幂等断言用「清掉垃圾后再跑第三次」补回。 |
| 3 | `ai-plan.test.ts:231`「上限 100 张」 | **旧断言对，回退代码** | 见上面 A-17：100 是作业级上限、20 是请求级上限，两个量。`README.md:65` 与 `ai-plan.test.ts:82`（45 张 → `[[20,20,5]]`）两条独立旁证。 |

说明：第 1、2 两条是主审**有意改写了编码旧契约的断言**，不是为了让测试变绿而放宽——
两条都补强了断言（新增「密文不被覆盖」「垃圾文件原地保留」「第三次调用回到零」），且原测试里每一条仍然成立的断言都原样保留。

### 其余各模块回报（主审**尚未**逐条复核，不得当作已确认）

- **服务端**（10 条）：#3 `GET /backup/status` 的 `keyId` 从「本成员的」改成「全家最新的」，会让家人的 Build 70/71 手机永久 `KEY_MISMATCH` 且无自愈路径（**兼容性，值得优先复核**）；
  #4 撤销设备不撤销其清单（被撤销手机的内容与墓碑继续传播给全家）；#5 配额并发可超卖（实测 2.4 倍）；#6 `usage()` 每次 PUT 全量 stat（40000 对象 117 ms，同步阻塞）；
  #7 任何成员可覆盖任意对象 id；#8 `migrateMemberSpaces()` 无 try/catch 且无条件 `rmSync` 成员目录，失败会让服务起不来；#9 错误码 `OWNER_ONLY` 语义错位；#10 撤销不存在的设备回 200。
  另：三个 admin 端点缺「家人调用应 403」的回归用例。
- **备份／导出／归档／纸书**（4 条）：#1 恢复失败时会删掉**当前库**的活缩略图（`assignExtracted` 不重写 `thumb`，`renderThumb` 失败后仍按旧名删）——破坏「一个字节都没动过」的承诺，且假件永不失败所以测试抓不到；
  #2 `.xmbm` 不走 `.part`+move，半份清单会长期停掉 blob 回收；#3 `ensureBlob` 不响应「停止」；#4 `ensureBlob` 的 `finally` 里 `output.close()` 抛错会漏 `input.close()`。
  该代理同时独立核实：归档网页**没有 XSS**（`esc()` + 用户正文走独立 `library.js`）、ZIP 无路径穿越、分卷长度校验在解包之前、Build 72 的 `by`／`tombstones` 不会让旧读取器整份拒绝（与主审 X-3 结论一致）。
- **AI**（8 条）：D1 线上提示词仍是「代笔」，与 PRODUCT.md 原则 5 冲突、与 `docs/AI-PROMPTS.md` 第三节四条全文不符（判定为**计划未实施**，按路线排在 Build 73 之后，但手册应标注「草稿，未进代码」）；
  D4 年度寄语起草无法取消，晚到结果会盖掉用户正在写的字；D5 失败后「正在生成…」不消失；D6「分成几件事」缺 100 张前置校验，会先烧配额再报错；D7 AI 测试的假上游只覆盖顺利路径；D8 `/api/v1/ai/config` 是死端点。

（模块 1／3／4／7 的审查代理被中止，**这四块基本未覆盖**，见第五节。）


### 主审对「各模块回报」的复核结果（逐条，只写已经查过的）

| 回报 | 主审复核 | 依据 |
| --- | --- | --- |
| 服务端 #3「`/backup/status` 的 keyId 改成全家最新」 | **成立**，但真正的缺陷是自救文案失效 → 已升级记为 **A-12** | `app.ts:125-129` vs `96f1b65~1:app.ts:116-119` |
| 服务端 #4「撤销设备不撤销其清单」 | **成立**，且比回报更糟：手机端没有任何补删入口 → 记为 **A-8** | `store.ts:135-137`、`app.ts:235-239`、`Settings.tsx` 调用面 |
| 服务端 #7「任何成员可覆盖任意对象」 | **成立**，且有干净修法（内容寻址 + 确定性 nonce ⇒ 先到为准）→ 记为 **A-11** | `backup-store.ts:57-93`、`crypto.ts:18-23,72-73` |
| AI D8「`/api/v1/ai/config` 是死端点」 | **不成立**：App 确实不调它，但 `server/scripts/verify-service.py:30` 的上线自检在用，`app.test.ts:140` 也覆盖了 | 两处调用点 |
| 「未接线的功能／占位实现／缺失入口」普查 | **mobile/src 里没有死导出**：67 个「别处没引用」的导出逐一核过，全是本文件内部使用（`writeArchive`／`xhrClient`／`downloadContent`／`GlassBackdrop` 等）| 机械扫描 + 逐条 grep |
| 路由可达性 | **全通过**：`navigation.ts` 声明 27 条，`App.tsx` 注册 27 条，一一对应，除首屏 `Shelf` 外每条都有 `navigate` 调用点 | 脚本比对 |
| 服务端端点可达性 | 24 条路由无真正死端点；`/`、`/healthz`、`/api/v1/ai/config` 属运维自检面 | `client.ts`＋`transport.ts` 的全部调用路径 |
| 服务端鉴权与权限隔离 | **无缺陷**：27 条路由逐条核过守卫——未鉴权的只有 `/`、`/healthz`、`/api/v1/status`（只回 `{initialized}`）；`/setup` 在事务里 `initialized()` 判重出 409；`/login`、`/setup`、`/password` 有按 IP + 全局限流；`/admin/*` 全部 `owner()`；`DELETE /backup/manifests/:deviceId` 额外做了「非主人只能删自己的」403 | `app.ts` 全量路由表 + `store.ts:54-63` |
| 家庭同步的合并链（数据完整性） | **无缺陷**：`wantedMedia` 的每个 blob 必须在远端清单里对得上（对不上抛 `CORRUPT`，不静默跳过）；下载在 `store.change` 之外完成；change 内**重跑一次合并**并逐条校验 `prepared`，缺一个就抛 `INCOMPLETE` 整笔回滚；失败时删掉本轮新建的文件。`repairReferences()` 的「剥掉悬空 mediaIds」因此只是兜底，不在正常路径上 | `family.ts:152-200`、`merge.ts:221-260` |
| 本机写队列（`LocalStore.change`） | **无缺陷**：apply／`validateChange`／`disk.write` 任一步抛出都不动 `this.state`，`queue.catch(()=>{})` 保证队列不卡死；SQLite 用 `WAL` + `synchronous=FULL`，换代写入在一个事务里先回读校验再删旧快照 | `store.ts:52-83`、`disk.ts:52-120` |
| 「清理未使用素材」的引用集 | **无缺陷**：`referencedMedia()` 覆盖头像、重放配乐、记录、草稿正文、信；`photoEvents` 的 mediaIds 由 `photoDayGroupsOf()` 过滤为 `content.mediaIds` 的子集，所以不会漏 | `model.ts:449-459`、`photo-metadata.ts:101-138` |
| 「点开就建」的静默清理 | **无缺陷**：`isEmptyDraft`／`isEmptyLetter`／`isEmptySeries` 只在标题、正文、地点、人物、附件、录音、分组事件全空时才清；漏检的只有 `first`／`quote` 两个一键开关，影响可忽略 | `empties.ts` |
| 服务端 #5「配额并发可超卖」 | **成立但可忽略**：`quotaLeft()` 每请求各算各的，并发确实会超。上限 = 并发上传数 × 8 MiB（每设备 2 条通道），几台手机也就几十 MiB，对 20 GiB 配额无意义。**不修**。 | `app.ts:122,145` |
| 服务端 #6「`usage()` 每次 PUT 全量 stat」 | **成立，主审实测 20000 对象 ~70 ms/次** → 记为 **A-15** | 见 A-15 的基准输出 |
| 服务端 #8「`migrateMemberSpaces()` 无 try/catch」 | **部分成立**：`renameSync` 确实没有 try/catch，一次 EACCES／ENOSPC 就会从 `index.ts:13` 抛到顶层、**服务起不动**（迁移本身幂等，但要人去修文件系统）。「无条件 `rmSync`」这半句不准——抛异常会先中断循环；真正的问题是 `rmSync(memberDir,{recursive:true})` 会把**没通过 `OBJECT_ID` 校验因而被跳过的文件**一并删掉。生产迁移已于 2026-09-21 02:20 跑过且当时没有成员目录，所以**此刻为空**；但从 `data.bak-20260921-0220` 回滚会让它重新生效。列入低优先级加固。 | `backup-store.ts` 的 `migrateMemberSpaces()`、`index.ts:13` |
| 服务端 #9「`OWNER_ONLY` 语义错位」 | **仅内部命名不精确，无用户可见影响**：`transport.ts:253-255` 是**服务端 message 优先**，`MESSAGES.OWNER_ONLY`（「只有主人能这么做。」）只在服务端没给 message 时兜底，而错误处理器永远会给；也没有任何客户端逻辑按 `code==='OWNER_ONLY'` 分支。**不修**。 | `app.ts:184`、`transport.ts:138-146,253-256` |
| 服务端 #10「撤销不存在的设备回 200」 | **成立，纯外观**：`store.revoke(id)` 是 0 行 UPDATE，管理页列的都是真实设备。**不修**。 | `store.ts:135`、`app.ts:235-239` |
| 「三个 admin 端点缺 403 回归用例」 | **成立且数目正好**：已有 403 用例覆盖 `/admin/overview`、`POST /admin/members`、`PATCH /admin/members/:id`、`DELETE /admin/members/:id/backup`、`DELETE /admin/backup`；缺的正是 `PUT /admin/members/:id/login`、`DELETE /admin/devices/:id`、`PUT /admin/settings`。列入补测。 | `app.test.ts:59-60`、`backup.test.ts:152,207,216,222` |
| AI D6「分成几件事缺 100 张校验，先烧配额再报错」 | **推翻**：group 路径按 20 张切块（`state.ts:250-253`），且 Zod 在配额记账之前就拒，不烧配额。主审当时改判为「三处限制不一致」记作 A-17，**这个改判后来也被主审自己推翻**（100 是作业级、20 是请求级，两个量）→ 见 A-17 | `contracts.ts:8`、`plan.ts:24-43`、`app.ts:76`、`Editor.tsx:183-300` |
| AI D4 的「无法取消」半句 | **部分推翻**：`api()` 第 4 个参数**本来就收 `signal`**（`client.ts:18-28`，并接 115 秒超时），`ai/Editor.tsx:236` 也确实在传。缺的只是 `NoteCard`／`Year.tsx` 这条寄语路径没传 → 已并入 **A-13** | `client.ts:18-28`、`Editor.tsx:233-239`、`Year.tsx:95-104` |
| 「六处删除是否都立墓碑」（流程 4） | **全部通过**：`deleteRecord`／`deleteAlbum`／`deleteSeries`／`deleteLetter`／`deletePerson` 五个删除函数都调 `tombstone()`，与 `TOMBSTONE_KINDS` 一一对应，没有漏网 | `model.ts:169-185,409,493,520,532,542` |
| 删记录会连带删掉它的草稿 | **不是缺陷**（记录在案免得日后重新争论）：`deleteRecord` 里 `if (d.recordId === id) delete s.drafts[key]`，而合并路径 `repairReferences` 反过来**保住**草稿（「正在改的那段被别人删了：草稿留着，改成一段新的时光，一个字不丢」）。两者不一致是**有道理的**——本机删除是用户自己的明确意图，合并删除是别人的动作。确认框「删了就找不回来」也说到位了。 | `model.ts:493-501`、`merge.ts:247-260`、`Record.tsx:464-466` |
| 草稿是否跨设备同步 | **不同步，且是对的**：`merge.ts:83` 的 `SHARED_KINDS = TOMBSTONE_KINDS`，不含 `drafts`；合并只**修**本机草稿的悬空引用，不搬别人的草稿。草稿＝「我这台手机现在正在写的东西」 | `merge.ts:83,247-260` |
| **Build 72 未接线（已知待办，非缺陷）** | `runFamilySync`／`syncFamily`／`leaveFamily` 目前**只有测试在调**，没有界面入口（提交 11 FamilyCard／12 自动同步未做）；`joinFamily` 已接（`RecoveryCode` 的 join 模式） | grep 调用面 |


## 四、实际执行的验证

| 时间 | 命令 | 结果 |
| --- | --- | --- |
| 审查前基线 | `mobile: npm test` | 35 文件 / 425 例 通过 |
| 审查前基线 | `mobile: npm run typecheck`／`npm run lint` | 通过 |
| 审查前基线 | `mobile: python3 scripts/verify-local-boundary.py` | 通过 |
| 审查前基线 | `mobile: python3 -m unittest discover -s scripts` | 9 例通过 |
| 审查前基线 | `server: node --test tests/*.test.ts` | 31 例通过 |
| A-1/2/3 修复后·主审复跑 | `server: node --test tests/*.test.ts` | **43 例通过 / 0 失败**（31 基线 + 12 新增，一条没少）|
| A-1/2/3 修复后·主审复跑 | `server: npm run typecheck` | 通过 |
| A-1/2/3 修复后·主审复跑 | `mobile: TMPDIR=/var/tmp/anan-tests npm test` | **35 文件 / 428 例通过**（425 基线 + 3 新增）|
| A-1/2/3 修复后·主审复跑 | `mobile: npm run typecheck`／`npm run lint`／`verify-local-boundary.py`／`unittest discover -s scripts` | 全部通过（边界脚本 9 例）|
| A-4…A-14 修复后·主审复跑 | `mobile: TMPDIR=/var/tmp/anan-tests npm test` | **37 文件 / 444 例通过** |
| A-4…A-14 修复后·主审复跑 | `mobile: typecheck／lint／verify-local-boundary.py／unittest` | 全部通过 |
| A-4…A-14 修复后·主审复跑 | `server: node --test tests/*.test.ts` | 43 例通过（未受影响）|
| A-15 佐证 | 本机基准：20000 个对象上 `BackupStore.usage()` ×3 | 70.3／67.6／69.5 ms |
| 第 3 批交回后·主审复跑 | `server: node --test tests/*.test.ts` | 54 例 / **52 过 2 败**（两条断言冲突，见裁定表）|
| 第 3 批交回后·主审复跑 | `mobile: TMPDIR=/var/tmp/anan-tests npx vitest run` | 38 文件 452 例 / **451 过 1 败**（A-17 那条冲突）|
| **第 4 批（订正）后·主审复跑** | `server: node --test tests/*.test.ts` | **58 例通过 / 0 失败** |
| **第 4 批（订正）后·主审复跑** | `mobile: TMPDIR=/var/tmp/anan-tests npx vitest run` | **38 文件 / 452 例通过 / 0 失败** |
| 第 4 批后·主审复跑 | `server: npm run typecheck`、`mobile: npm run typecheck`／`npm run lint` | 全部通过 |
| 第 4 批后·主审复跑 | `mobile: python3 scripts/verify-local-boundary.py`／`python3 -m unittest discover -s scripts` | 通过（边界脚本 9 例）|
| 第 4 批后·主审自测 | `npm audit`（server 含 dev、mobile） | 各 **0 条漏洞** |
| A-18 先红后绿·**主审自己动手** | 把 `app.ts` 的两行改回旧行为，只跑 `--test-name-pattern='A-8'` | **6 例 2 过 4 败**：`404 !== 200`（换机取不回清单）、`null !== 12`（对象被删）、响应契约；还原后 **6 例全过** |
| C-4 先红后绿·**主审自己动手** | 把 `plan.ts` 的作业上限强制成 20，只跑 `tests/ai-plan.test.ts` | **19 例 2 败**（旧的 100 张边界 + 新的 21～100 张）；还原后 **19 例全过** |

### 主审对 A-4／A-5／A-6／A-7／A-13／A-14 修复的独立验收（2026-09-21）

执行者：Astra。主审逐项复核：

1. **先红后绿，主审亲自 `git checkout` 源码复现**：
   - revert `mobile/src/local/backup.ts` → **5 条转红**：A-6 的四个变体（`.xmbm`／`.xmb`／v1／启动救援各一条）＋ A-14 的「先写 part 再改名」。
   - revert `mobile/src/ai/state.ts` → **3 条转红**：A-5 的「每组继承人物／引语／落款」、A-4 的两条（「不含正文」「无标题也不泄露敏感正文，同时保住已写寄语」）。
   - A-7 是对源码文本的静态断言（`tests/remote-backup-card.test.ts`），A-14 的「陈旧 part 不进列表/回收/导出」是契约锁定而非回归——两条都本来就该两边绿，Astra 的报告也没有把它们说成回归。
2. **沙箱外复跑全套门禁**：`mobile` **37 文件 / 444 例全绿**（Astra 在沙箱里报的 3 失败 1 跳过全是 `spawnSync python3 EPERM`／`listen EPERM`）；
   `server` **43/43**；两边 `typecheck`、`lint`、`verify-local-boundary.py`、`unittest discover -s scripts`（9 例）全绿。
3. **逐处读了 15 个改动文件 + 2 个新测试文件**，重点核对：
   - **A-4 的修法比要求更硬**：`recapContext` 的入参类型从 `{title,text,first}` 改成 `{title,date,first}`——
     函数**根本拿不到正文**，不是靠自觉不用它。同意书原文也改准了，`docs/AI-PROMPTS.md` 没动（结论就是代码向手册看齐）。
   - **`dateLabel` 从 `ui.tsx` 搬到 `dates.ts` 并在 `ui.tsx` 原地 re-export**：不是多余重构——
     `src/ai/state.ts` 若直接 import `ui.tsx` 会把 React Native 拖进纯逻辑模块。所有旧引用不受影响，边界脚本照常绿。
   - **A-6 覆盖面超出主审原判**：主审只指出了 `assignExtracted`，Astra 还发现 `inspectV1`（旧版 `.xmb` 恢复）有同一处，一并修了。
   - **A-13 的实现经得起细看**：`draftRef` 避开闭包取旧值；`active()` 同时挡住「被新一轮取代」「已 abort」「已卸载」三种情况；
     「用 AI 这版」的回调里**再查一次** `active()`（主审事先担心的那个竞态，测试里也专门有一条）。
   - `tests/note-card.test.ts` 是手写的 hook 夹具（仓库里没有 react-test-renderer），但它驱动的是**真正的 `NoteCard` 函数**
     并断言真正渲染出的 props，没有弱化任何东西；六条用例覆盖两种选择、直接填入、取消 abort、卸载 abort、取消后晚到的选择。
   - `remote-restore` 这个旧 testID 已全仓清干净（只剩新测试里那两条「不得再出现」的断言）。
4. **结论：接受。**

发现一处需要收尾的小尾巴（已并入下一轮）：`writeManifest` 现在写 `<名字>.xmbm.part`，
但进程被杀留下的那个 part **谁也不会清理**——`isRetainedBackup`（`/\.xmbm?$/`）不认它，
`isRestorePin`（`/^restoring-.*\.xmbm\.part$/`）也不认它（它以 `BACKUP_PREFIX` 开头）。
它不再拖住 blob 回收（这正是 A-14 要的），但每崩一次会漏一份实体段。

### 主审对 A-1／A-2／A-3 修复的独立验收（2026-09-21）

执行者：Astra（`gpt-6-astra`，high）。主审**没有**采信它的自述，逐项自己复核：

1. **先红后绿，主审亲自复现**：把 Astra 改过的**源码**（`server/src/{store,app,backup-store,manage}.ts`、`mobile/src/sync/{engine,transport}.ts`、
   `probe-upload-limit.py`）逐一 `git checkout` 回未修状态、只留新测试，再跑：
   - 服务端 12 条新用例中 **11 条转红**（A-1 静态断言、3 条 A-2 未知登记、3 条 A-2 删除 sweep、2 条 A-3 claim、A-3 重启、2 条 A-3 wipe）；
   - 唯一始终为绿的是 **A-2 的阳性对照**「全部登记明确时 prune 照常回收」——对照组本来就该两边都绿，正说明修复没有把功能修没。
   - 手机端 `sync-engine` 的 50000 边界用例转红（`expected [] to be undefined`）。
   - `sync-transport` 那条**没能转红**，主审查明原因：旧实现 `JSON.stringify({keyId,index,objects})` 在 `objects===undefined` 时本来就会省略这个键，
     真正的缺陷全在 `engine.ts` 送了 `[]`。所以它是**契约锁定测试**，不是回归测试——Astra 的报告里也如实写了 17 passed / 1 failed，没有夸大。
2. **沙箱阻塞的用例主审在沙箱外复跑**：Astra 报的「服务端 2 例 EPERM、手机 3 例 ZIP EPERM + 1 例端到端未运行」全部是沙箱产物，
   在沙箱外 `node --test tests/*.test.ts` 与 `npm test` 都是满绿（见上表）。
3. **逐处读了 12 个文件的 diff**，重点核对：
   - `putManifest(…, objects: readonly string[]|null=null)` 与 `input.objects??null` 配套，`objects_json` 真的存 `NULL`；
   - `sweep()` 在有未知清单时返回 `{removed:0,bytes:0}`，**返回形状没变**，`/backup/prune` 的空 keep 400 守卫仍在前面；
   - `wipe(store)` 的三个调用点（`app.ts`、`manage.ts`、测试）都跟着改了，`store.ts` **没有**反向 import `backup-store.ts`，没有引入循环依赖；
   - **claim 的释放时机是安全的**：`pushManifest` 先用一次 `missing()`（= `have`）把 **blobs + 清单分片的全部 id** 一次报给服务端（全部落 claim），
     再上传，最后 `putManifest` 登记的 `registered` 就是**同一个全集**——所以「发布成功即释放本设备 claim」中间没有空窗；
     Astra 的「A-3 claims survive SQLite reopen」用例还专门验了**别的设备**发布不会解除本设备的 claim。
   - 手机端 `registered = ids.length <= 50000 ? ids : undefined`，边界用例取 49999/50000（即 id 总数 50000/50001）正好卡在门槛两侧。
4. **结论：接受。** 不打回。

遗留的三条轻微观察（主审记录，未要求返工）：

- `PUT /backup/objects/:id` 里 `claimObjects` 调了**两次**（收前一次、收后一次）。收前那次其实多余：对象 rename 之前根本不在盘上，prune 看不见它。
  代价只是每个对象多一次事务与一次带索引的过期清理，量级可接受。
- `sweep()` 先算 `claimedObjects(now)` 再判断要不要整轮停收；停收时那次计算白做（但顺手清了过期行，不算浪费）。
- `POST /backup/objects/have` 没有配额：同一批 id 重复请求走 upsert 不增长，但一个家庭成员可以用**不断变化的 id** 把 `backup_object_claims` 撑大。
  只是磁盘占用，护不住任何不存在的对象。属于新增的低危面，建议日后给 claims 表加个每设备行数上限。
- Astra 正确地**拒绝猜测**历史上已存成 `'[]'` 的行（Build 70 手机打到旧服务端会产生这种行，与「明确登记空集」无法区分）。
  生产库目前**一份清单都没有**，所以这条对本项目为空；别的部署需要人工判断。

### 主审对第 3 批（A-8／A-11／A-12／A-15／A-16／A-17／迁移加固／`.part` 清理）的独立验收（2026-09-21）

执行者：Astra（`gpt-6-astra`，high）。17 个文件。主审同样没有采信自述，**先自己把整批 diff 逐处读完再看它的报告**。

**结果：打回。** 查出 1 条新的数据丢失缺陷（**A-18**）、1 条功能回退（A-17 的修法，源于主审自己的误判），
另有工作者交回的 3 处断言冲突需要裁定。四条一起写成第 4 批的订正任务发回。

主审自己跑的基线（沙箱外）：服务端 `node --test tests/*.test.ts` **54 例 52 过 2 败**；
手机端 `npx vitest run` **38 文件 452 例 451 过 1 败**。三条失败全部落在那三处断言冲突上，
工作者报告的沙箱 EPERM 失败在沙箱外都不复现。

逐条复核：

| 项 | 主审的独立判断 | 依据 |
| --- | --- | --- |
| **A-8 的修法** | **打回 → A-18**。删清单 + `sweep()` 把「丢手机」这一刻的远端备份整个删掉 | `app.ts:180-185` 的 `manifestOf(deviceId) ?? latestManifestOf(memberId)` 回落；它自己的测试 `backup.test.ts:418` 就断言 `stat(oid(202))===null` |
| **A-17 的修法** | **打回**。前置校验降到 20 砍掉了 21–100 张的分批生成 | `Editor.tsx:183-300` 分支走完；`ai-plan.test.ts:82`（45 张 →`[[20,20,5]]`）、`README.md:65` |
| **A-11 先到为准** | **接受**。`receive()` 里 `stat→quota→早返回→rename→计数` 是一段**没有 await 的同步代码**，单线程下不可能被另一个上传插进来，不会重复计数；重传只删临时文件，`tmp` 不泄漏 | 逐行读 `backup-store.ts:58-103`；Astra 的用例还比对了盘上字节 |
| **A-15 增量计数** | **接受**。`receive`＋／`prune`－／`wipe` 归零／构造与 `migrateMemberSpaces` 走 `recount()`；`prune` 的 `rmSync` 失败先 `recount()` 再抛，不留错账 | 同上；Astra 的 `assertUsage()` 每处都和重扫盘真值比对 |
| **A-12 文案** | **接受**。新文案指向「加入家人一起写」，与 A-7 改过的按钮名一致 | `engine.ts:87-88` |
| **A-16 手机端** | **接受**。`remote?.deviceId ?? (await transport.me(signal)).deviceId` —— 设备 id 来自 `/me`（`family.ts:217-223` 写入状态），**没有**从 `GET /backup/manifest` 猜（那会回落到同成员的另一台设备）；`NOT_FOUND` 被吞掉只清本机状态；`wipeFamily` 只在 `isOwner` 时露出 | 逐行读 `RemoteBackupCard.tsx` diff + `family.ts` 的写入点 |
| **`.part` 清理** | **接受**。`backupStamp()` 认不出名字时返回 `""`，被 `if (stamp && …)` 挡掉；`YYYYMMDD-HHMM` 字典序比较正确；`restoring-` 前缀排除，恢复钉子仍走 7 天 TTL；一小时 TTL 保证刚写的半成品不会被自己清掉 | `backup.ts:86,124-146` |
| **`remote-backup-actions.test.ts` 是否忠实** | **接受**。`env.slots` 的 6 个位置与组件里 `useState` 的声明顺序（`signedIn／remote／progress／message／error／isOwner`）一一对应，驱动的是**真的** `RemoteBackupCard` 函数与真的 Alert 按钮接线 | 比对 `RemoteBackupCard.tsx:48-56` |
| **claims 表的外键** | **无问题**。`foreign_keys=ON`，但 `revoke()` 只是 `UPDATE devices SET revoked=1`，全库**没有任何** `DELETE FROM devices`，不会被 claims 行挡住 | `store.ts:26,139-141`；`grep -rn "DELETE FROM devices" server/src` 为空 |
| **`hasUnknownManifestObjects` 会不会永久卡住回收** | **可接受**。一份永不升级的清单会让回收永远停摆，但主人有 `DELETE /backup/manifests/:deviceId` 可以摘掉它；这是「宁可多占空间」的既定取舍 | 已记入残留风险 |

### 主审对第 4 批（C-1 = A-18／C-2／C-3／C-4）的独立验收（2026-09-21）

执行者：Astra（`gpt-6-astra`，high）。7 个文件。**结论：接受。**

1. **A-18 的先红后绿是主审自己做的，不是采信报告**：把 `server/src/app.ts` 的两行改回第 3 批的写法
   （`store.revoke(id);store.deleteManifest(id);return {ok:true,pruned:sweep()};` 与 `GET /backup/manifests` 用回 `store.manifests()`），
   只跑 `--test-name-pattern='A-8'`：**6 例 2 过 4 败**，失败的正是三条数据丢失症状——
   `404 !== 200`（换新手机取不回清单）、`null !== 12`（那台设备独有的对象被删掉）、响应契约多了 `pruned`。
   还原后 6 例全过；`diff` 确认 `app.ts` 与还原前逐字节相同。两条阳性对照（legacy 清单可见、重置登录保留清单）两边都绿。
2. **C-4 的先红后绿也是主审自己做的**：把 `plan.ts` 的作业上限强制成 20，`tests/ai-plan.test.ts` **19 例 2 败**
   （旧的 `bounds generation between one and one hundred photos` + 新的 21～100 张不变量），还原后 19 例全过。
3. **逐处读了 7 个文件的 diff**：
   - `activeManifests()` 的 `WHERE d.revoked IS NULL OR d.revoked=0` 主审**另起一个内存库单独验过** LEFT JOIN 语义：
     未撤销与 legacy 两行留下、已撤销那行滤掉，与规格一致；
   - 只有 `GET /api/v1/backup/manifests` 改用它，`/admin/overview` 仍用 `manifests()`（测试断言管理页看到 2 份、合并列表只有 1 份）；
     `manifestOf`／`latestManifestOf`／`manifestObjects`／`hasUnknownManifestObjects`／`manifestCount` 一行未动；
   - `DELETE /admin/devices/:id` 回到 `store.revoke(id);return {ok:true};`，**响应体形状也复原**（`Settings.tsx:443` 那个调用方不受影响）；
   - `plan.ts` 用 `PHOTO_JOB_LIMIT`，模板串拼出的文案与原文**逐字相同**；`PHOTO_REQUEST_LIMIT`／`PHOTO_JOB_LIMIT` 两条注释写清了量纲差别；
   - `deploy/README.md` 只动了「清单与回收」与「反代」两处，与授权范围一致。
4. **被改的三条既有断言逐条核对，语义差别与裁定一致，且都补强而非放宽**：
   - 配额测试：保留 78–100 行**一字未动**（两条配额拒绝路径、`stat(oid(4))===null`、同内容重传 200、`stat(oid(5))===800`、`tmp` 为空），
     新增「重传后盘上仍是 800 + 已用仍是 800 + `tmp` 仍为空」；把上限调回 1000 让余量仍是 200，下游算术与原来**同构**，
     最终 `status().bytes` 从 410 变 910（差的 500 正是先到为准不肯释放的字节）；磁盘下限 507 那三行一字未动。
   - 迁移测试：`{…,failed:1}`，并断言 `M2` 下的残留**恰好只有那个垃圾文件**（逐层 `readdirSync`）；
     清掉垃圾后第三次调用回到 `{members:0,moved:0,duplicates:0,failed:0}` 且根目录回到 `[FAMILY_DIR,'tmp']`——原有的幂等断言补回来了。
   - `ai-plan`：旧的 100 张边界测试**逐字保留**并重新变绿；错的那条 A-17 测试删掉；
     新测试在 **21～100 全区间**、`write` 与 `group` 两种 kind 上断言「能过校验 + 每批 ≤ 20 + 分批覆盖等于原选择」，比主审要求的更严。
5. **`assertUsage()` 这个辅助是忠实的**：它先重扫盘算真值，再把 `backups.list` 换成抛异常的 mock，
   证明 `usage()` **确实没有偷扫盘**，而不是只比数字。
6. **门禁全部由主审在沙箱外复跑**（Astra 报的 `listen EPERM`、`spawnSync python3 EPERM`、`ENOENT` 全是沙箱产物）：
   服务端 **58 例全过**，手机端 **38 文件 452 例全过**，两边 typecheck、手机端 lint、边界脚本、`unittest discover` 全部通过。

## 五、未覆盖 / 被环境阻挡 / 需真机或双机验证

**必须由主人在真机上验的（本轮一条都没做，不要当成已通过）**

- 真机（安卓 + iOS）：界面观感与 `DESIGN.md` 的符合度、手势、滚动性能、相机与相册权限、后台/前台切换、键盘遮挡。
- **A-7 与 A-16 改的是按钮文案与确认框**，逻辑有单元测试覆盖，但「读起来对不对」得看真机。
- **A-13 的 Alert 二选一**：单元测试驱动的是回调，真机上弹窗时机与文案要看一眼。
- **A-6 的恢复失败路径**：单元测试用假件模拟了缩略图重建失败；真机上真发生一次（内存紧张）没法造。
- 双机：两台手机真跑一次家庭同步（合并、冲突卡、素材下载、退出）；主人两台 + 家人一台的验收（PLAN-SHARING 第五节）。
  **A-16 改完之后「只撤下这台手机」尤其需要双机验一次。**

**环境限制**

- 生产服务端：按规则**不做任何破坏性验证**，不部署、不改生产数据。A-1／A-2／A-3／A-8／A-11／A-15 全部只在本机临时库上验。
- 上游 AI 服务：不发真实请求；AI 相关全部用假上游。
- Astra 的沙箱挡掉了 `spawnSync python3` 与 `listen` 权限，相关用例一律由主审在沙箱外复跑（结果见第四节）。
- `.git` 在 Astra 的沙箱里只读，`git checkout main`／`git pull` 被挡；本机始终在 `main`，与 `origin/main` 同为 `318274e`。

**本轮没有深入的**

- 提示词本身的质量（属于产品判断，且 `PRODUCT.md` 已把「访谈者」那一版排在 Build 73）。
- 依赖：宪法禁用清单（`next`／`better-auth`／`drizzle-orm`／`expo-network`）核过，`npm audit` 两边**各 0 条漏洞**（服务端含 dev 也是 0）。**没有做逐包的版本兼容矩阵**。
- 断网与超时的**故障注入**：只读了代码路径，但**三层超时的层次是对的**——上游 `provider.ts:20` 用 `AbortSignal.timeout(100000)`，手机端两个客户端都是 115 秒（`src/ai/client.ts:29`、`src/sync/transport.ts:28,35` 的 `xhr.timeout`＋`ontimeout` → `SyncError('TIMEOUT')`）；服务端先于手机端超时，所以用户拿到的是明确的 502／业务错误而不是自己这头的超时。**没有真的断过网**。
- 出包流水线（`mobile-build.yml`）没有真跑过；A-10 的改动是静态校对 + YAML 解析验证。
- 纸书／PDF 的版面正确性、开放归档在浏览器里的实际观感。
- Astra 正确指出：历史上已存成 `'[]'` 的清单登记与「明确登记空集」无法区分。生产库目前一份清单都没有，所以为空；**别的部署需要人工判断**。

**本轮另外核过、结论为无缺陷的（记录在案，免得日后重查）**

- **AI 额度记账与「失败不计额度」**：`store.usage()` 的 SQL 明确 `status!='failed'`，`finish(…,error)` 写 `failed`，
  与 `README.md:65`「上游失败或超时的请求不消耗当日额度」一致；`finish` 的 `AND status!='completed'` 还挡住了「成功后授权失效」的晚到失败回写。
- **卡住的 `processing` 行不会永久锁死全家**：`index.ts` 启动即 `store.recover()`，把残留的 `processing` 一律改判 `SERVER_RESTARTED`；
  不重启的极端情况由上游 100 秒超时兜底（`active.n>=2` 的 BUSY 最多持续到那时）。
- **服务端自己也有一个 100 张的上限**：`app.ts:84` 的 `ids.length>100`（merge 模式下是 `groups[].photoIds` 的总数）。
  这与手机端 `assertGenerateInput` 的 100 是**同一个量**，两边本来就对齐——又一条 A-17 判错的旁证。
- **登录限流**：`throttle(req,10,60)`（`setup` 20／60）+ `timingDummy`，故意不信 `x-forwarded-for`。
- **部署配置无死项**：服务端只读这 6 个环境变量（`DB_FILE`／`BACKUP_DIR`／`PORT`／`SOURCE_SHA`／`CPA_BASE_URL`／`CPA_KEY_FILE`），
  逐个与 `deploy/compose.yaml` 对过：`SOURCE_SHA`／`CPA_BASE_URL` 显式传入，其余三项的默认值（`/data/ai.sqlite`、`/data/backup`、3000）
  正好落在 `${AI_DATA_DIR}:/data` 这个卷和 `:3000` 这个端口映射上，`CPA_KEY_FILE` 的默认值与 `${CPA_KEY_PATH}:/run/secrets/cpa-key:ro` 对齐。
  `healthcheck` 打的 `/healthz` 确实存在（`app.ts:33`）。容器 `read_only: true`，但上传临时文件走的是
  `<BACKUP_DIR>/tmp`（和对象同一个文件系统，`renameSync` 需要），不是那个 32 MiB 的 `/tmp` tmpfs——**对的**。

**一条轻微观察（记录在案，本轮不改）**

- `app.ts:16` 的 `const backups=()=>backupStore??=new BackupStore(mkdtempSync(join(tmpdir(),'anan-backup-')))`
  是给测试用的惰性兜底。生产里 `index.ts:12` 一定会把真的 `BackupStore` 传进来，所以现在不可达；
  但万一哪天有人调 `createApp(store,provider,sha)` 少传第四个参数，全家的密文备份会**悄悄写进那个 32 MiB 的 tmpfs**，重启即失。
  建议日后把这个兜底改成「只在 `NODE_ENV==='test'` 时允许」或干脆让第四个参数必填。

## 六、最终报告（2026-09-21，按模块）

> 一句话：**19 条缺陷已确认并修复，1 条（A-17）是主审自己判错、已推翻并回退**。
> 服务端 31 → **58 例**、手机端 425 → **452 例**，全部在沙箱外由主审复跑通过。
> **这不等于「整个项目没有错误」**：下面每一栏都写了这一轮到底验到了哪一步，第五节列了必须由主人在真机／双机上验的事。
> **本轮没有提交、没有推送、没有出包、没有碰生产。**

### 1 · 服务端（`server/`）

- **审查范围**：27 条路由逐条读守卫与输入校验；`store.ts` 全部 SQL；`backup-store.ts` 全部文件操作；
  `provider.ts` 的上游调用与超时；`manage.ts` 的破坏性子命令；两个运维脚本。
- **修好的缺陷**：A-1（`数据丢失·运维`，探测脚本会清空全家备份）、A-2（`数据丢失`，未知登记的清单被当成空集）、
  A-3（`数据丢失`，慢速首传被别人的 prune 删掉）、A-11（`安全`，任意家人可覆盖别人的密文）、
  A-12（`核心功能·文案`）、A-15（`性能`，`usage()` 每次上传全量 stat）、**A-18（`数据丢失`，撤销设备顺手删掉它的备份——这条是修 A-8 时引入的，由主审的验收查出）**。
  A-8 本身（`安全/隐私`，退场设备的快照继续被合并）按 A-18 的裁定改成 `activeManifests()`。
- **实际执行**：`node --test tests/*.test.ts` **58 例全绿**；`npm run typecheck`；`npm audit` 0 条；
  A-1/2/3 的 12 条新用例主审亲手验过 **11 条先红**；A-18 的 4 条主审亲手验过先红后绿；20000 对象上实测 `usage()`。
- **没做到的**：**限流与并发的真实压力没测**；没有对生产服务发过任何请求；没有做 SQLite 崩溃注入。
- **残留风险**：① 只要有一份「未知登记」的清单（Build 70 手机、旧版迁移行、>50000 对象的库），
  **全家的回收会一直停摆**、对象库只增不减——这是「宁可多占空间」的既定取舍，出路是主人删掉那份陈旧清单；
  ② `backup_object_claims` 没有每设备行数上限，家人用不断变化的 id 可以把它撑大（只占磁盘，护不住不存在的对象）；
  ③ 对象一旦落盘就**先到为准**，服务端不存每对象的 sha，日后位腐坏了没有自愈路径（本轮之前也没有）。

### 2 · 手机端备份与同步（`mobile/src/local/backup.ts`、`mobile/src/sync/`）

- **审查范围**：`LocalStore.change()` 写队列的原子性、`.xmbm`／`.xmb`／v1 三种备份格式、blob 库回收、
  恢复失败的清理与钉子、素材引用集、墓碑、三方合并链、`prune` 的保护语义、恢复码与钥匙的生命周期。
- **修好的缺陷**：A-6（`数据丢失`，恢复**失败**时删掉当前库在用的缩略图）、A-14（`资源`，`.xmbm` 直接用正式名写，
  被杀进程留下半份清单并卡住 blob 回收）、A-16（`数据丢失·界面不符`，「同时删除远端」会连同一账号另一台手机的备份一起删）、
  A-7（`界面不符`，「从远端恢复」其实是「加入并合并」）、A-2 的手机端配套（>50000 对象时省略 `objects` 而不是发空数组）。
- **实际执行**：`vitest run` **452 例全绿**；A-6／A-14 主审亲手回退源码验过 **5 条先红**；
  Build 71 ↔ Build 72 备份兼容**用真的 Build 71 代码**跑过（X-3）；边界脚本与其 9 条单测通过。
- **没做到的**：**两台真机跑一次完整家庭同步（合并、冲突卡、素材下载、退出）一次都没做**；没有做断网／杀进程的真实故障注入。
- **残留风险**：合并冲突的界面与文案只有单元测试覆盖，真机上「读起来对不对」没人看过。

### 3 · AI（`mobile/src/ai/`、`server/src/prompts.ts`、`contracts.ts`）

- **审查范围**：送出去的 payload **逐字段**核过；取消／覆盖／重试路径；额度记账；四条提示词与 `parseResult`；端点可达性。
- **修好的缺陷**：A-4（`隐私`，年度寄语把无标题记录的正文前 30 字发给 AI——主人拍板「只删正文，寄语补进同意书」）、
  A-5（`数据丢失`，采用「分成几件事」静默丢掉人物标签）、A-13（`数据丢失`，「AI 帮我起草」无条件盖掉用户等待时写的字，且取消无效）、
  A-20（`隐私·文档`，README 说寄语「只发送标题与第一次清单」，实际还发已写寄语）、A-19（`文档`，提示词手册分不清已落地与草稿）。
- **推翻**：**A-17**——主审误把「一次作业 100 张」和「一次请求 20 张」当成同一个量，交出去的修法砍掉了 21–100 张的分批生成，已回退并补了钉住真实不变量的测试。
  另推翻审查代理的 D5／D6／D8 与 D4 的一半。
- **实际执行**：452 例全绿；A-4／A-5 主审亲手回退源码验过 **3 条先红**；额度「失败不计」与三层超时（上游 100s < 手机 115s）逐行核过。
- **没做到的**：**没有对上游发过任何真实请求**；提示词本身的质量属于产品判断，不在本轮。
- **残留风险**：`prompts.ts` 的 `SHARED` 仍是旧版（含手册明令要去掉的「成长相册」等旧词）——
  这是 Build 73「访谈者」的既定工作，不是缺陷；补落款与「她说的话」时**必须同步改同意书文案**。

### 4 · 工程（CI、出包、部署、文档）

- **修好的缺陷**：A-9（`AGENTS.md` 要求服务端跑一个根本不存在的 `npm run lint`）、
  A-10（`mobile-build.yml` 比日常 CI 少两道闸：没跑服务端测试、没跑边界与脚本校验）。
- **实际执行**：两个 workflow、`app.json`、两边 `package.json` 脚本全读过；
  `deploy/compose.yaml` 的 6 个环境变量逐个与代码默认值对过（**无死配置**），`/healthz` 存在；`npm audit` 两边 0 条。
- **没做到的**：**出包流水线没有真跑过**；纸书／PDF 与开放归档的实际观感没看过。
- **一条轻微观察**：`app.ts:16` 给测试用的惰性 `BackupStore` 兜底，万一哪天被生产路径撞上，
  全家密文会写进 32 MiB 的 tmpfs，重启即失；建议日后让第四个参数必填。

### 5 · 跨模块（主审自己做，没有分给任何代理）

手机↔服务端数据契约、错误码映射、Build 71↔72 兼容（X-3，用真代码验的）、宪法边界、文档 vs 代码、
三处「新行为 vs 既有断言」的裁定，以及对两批修复的先红后绿复验。

### 后续建议（按主审建议的顺序）

1. **先在两台真机上跑一次完整的家庭同步**，重点是 A-16 的「只撤下这台手机」与 A-18 改过的撤销语义。
2. 这一批改动**还没有提交**。建议按 AGENTS.md 分成几个清晰的里程碑提交到 `main`（服务端一组、手机端一组、文档一组），
   **推之前跑一遍本节第四条的门禁**。
3. 服务端的改动要部署才生效（A-1／A-2／A-3／A-11／A-15／A-18 都在服务端）。**部署前先 `cp -a` 一份 data**。
4. 出包再说：Build 72 还有提交 11–15 没做，本轮只是把地基上的洞补上。

