# 小美成长记 · 「从小本子到传家书」三阶段路线（Build 62 → 65）

> 依据 2026-09-18 对 AI/服务端、数据/媒体、交付工程三路的全库深读（行号证据见各条目）。
> 纪律不变：只从 main 工作、小提交直接推、推后看 Actions、每轮交付递增构建号并出 APK+IPA。

## 主题逻辑

**礼物面先行（用户立刻看得见）→ 耐久面筑底（让「记录十年」成立，并为共享备好机械）→ 战略面收口（决策门后再动宪法）。**

---

## Build 62「成长册」— 把一年装订成书（进行中）

| 任务 | 状态 |
| --- | --- |
| 年度成长册导出：`yearbook.ts` 纯布局（750 宽长卷：年份印章封面、寄语、十二月网格、第一次、落款）+ `YearBookCard.tsx` 离屏渲染 + 年度册「导出成长册」入口 + Android 冒烟与 iOS XCUITest 同步断言 | ✅ 已交付 `6842ef9`，canary 打包 run 35312957611 |
| 年度重放配乐：`settings.replayAudioId`（可选项，`referencedMedia` 保护不被清理）+ ReplayModal 选乐浮层（只从本机已有录音里挑）+ expo-audio 循环低音量、选乐时暂停自动前进、默认无声 | ✅ 已交付 `018c86a`（lint 豁免 `8649d33`） |
| 人物管理：`deletePerson`/`mergePersons` 纯函数（级联剥离 records/drafts/photoEvents 标记）+ `renamePerson` + `People` 页（改名/合并/删除 + 引用计数）+ 编辑器「整理人物」入口 | ✅ 代码已入库 `1b905a9`，**测试待补**（见下一步） |
| 发布：CHANGELOG/README/DESIGN + `PLAN-BUILD-62.md` 若有追加 + app.json 61→62 + 全套绿 + mobile-build 双绿交付 | ⏳ 待做 |

**下一轮会话的第一件事（按序）**：
1. 补 62-3 测试：deletePerson 剥离引用且 `personIds` 剥空删字段、mergePersons 去重合并且 source 消失、renamePerson 空名/超长边界、People 页入口可达（参照 `tests/local-core.test.ts` 的 person tags 组）。
2. 确认 canary run 35312957611 双绿（它验证成长册冒烟步：Android `yearbook-share-sheet` 截图 + iOS `yearbook-share-sheet`）；若红，按日志修冒烟步而非功能。
3. 走完 62-4 发布（含 HANDOFF.md 更新为 Build 62 交付态）。

**设计备忘**：成长册 v1 是单张可打印长图（expo-sharing 单文件约束下的稳妥形态）；分页 PDF 导出列入 Build 63 候选（需引 PDF 生成或自写 DCTDecode 嵌入，见 PLAN-BUILD-60-61 的工程调研）。

---

## Build 63–64「十年之库」— 消灭规模悬崖

目标：5 年 · 万条记录 · 万段媒体的库，编辑仍即时、备份不撞墙、恢复不锁死。**每步先扩 `scripts/local_fixture.py` 立大库基准（现有 122 条记录量级不够），给 `health.json` 已有的 `changeMaxMs` 加性能断言，再动刀。**

### Build 63：存储与备份演进
1. **快照写放大治理**：现状每次 `change` 全库 clone + validate + `JSON.stringify` 整行重写（`mobile/src/local/store.ts:42-47`、`disk.ts:25-32`），编辑器 400ms 防抖即全库写盘（`editorHooks.ts:61`）。把 media 元数据与 records/drafts 拆入独立 SQLite 表，`change()` 只重写脏分片；旧库启动自动迁移（沿用 `activation.ts` 的 append-only 切代，绝不原地覆盖）。
2. **备份 v2**：媒体按既有 sha256 内容寻址去重 + 增量清单，消灭 `HEADER_LIMIT 16MB` 悬崖（`backup-format.ts:3`，超限分支目前零测试）；v1 `.xmb` 保留只读兼容；恢复移出写队列、分批重建缩略图并给进度 UI（现状 restore 全程一个 `store.change`，`backup.ts:169-180`）。
3. **服务端 AI 闭环**（owner 侧，app 零风险）：结果缓存落 SQLite（现在纯内存 Map 10 分钟/200 条，重启即 `RESULT_EXPIRED` 迫使用户重复计费，`server/src/app.ts:9,60-61`）；requests 表 90 天保留裁剪（现在永不清理）；Editor AI 面板显示剩余额度（`/me` 已有）；`overview.recent` 30 天用量渲染（`types.ts:54-62` 已采集未展示）。

### Build 64：媒体治理
1. 导入策略：大图可选降采样存档、视频大小/时长上限与明确提示（现状 `quality:1` 且唯一约束是 `bytes>=1`，`Editor.tsx:220`、`model.ts:358`）。
2. 孤儿自动回收：删记录/弃稿后闲时自动清未引用媒体（复用 `collectUnusedMedia` + AppState 巡检）；巡检进度持久化（现状 `patrolled` 每次启动清零，`App.tsx:127`）。
3. 消除重复哈希 I/O：verify 状态落库（现状导入双哈希、备份双遍读、巡检永远从头来）。

---

## Build 65「家里的第二台设备」— 共享地基（决策门）

**先决策后动工**：家庭共享在 PLAN-BUILD-60-61 §5 被列为战略立项（端到端加密 + owner 服务器）；动工需明确拍板，并修订两处「宪法」：`scripts/verify-local-boundary.py` 的禁网边界（`mobile/src/local/` 仅 `ai/client.ts` 可 fetch）与 AGENTS 发布纪律。

技术路线（复用 Build 63 成果）：
1. 设备配对：邀请码体系现成（server 18 字节一次性码、24h），扩展为家庭空间密钥分发。
2. 同步语义：记录 last-writer-wins 合并 + 媒体按 sha256 内容寻址增量传输（= 备份 v2 机械直接复用）；端到端加密封装沿用 `.xmb` 块格式。
3. 明确不做：实时协作、云端搜索、第三方云盘、人脸识别（维持既有原则）。

---

## 旁路候选（未排期，按需插入）

- **真地图足迹**：react-native-maps + `plugins/with-maps.js`（Android 注入 `GOOGLE_MAPS_API_KEY` meta-data，Key 缺省空串保证构建绿）；接线模式照 `plugins/with-native-share-intake.js`；需持有者先在 Google Cloud 建 Key 存 GitHub Secret。数据侧 `places.clusterPlaces` 已就绪。
- **月度 AI 回顾**：RECAP 提示词管线已验证（`prompts.ts:33-40`），做本地通知 + 按需生成，不需要服务端定时任务。
- **设备自助撤销**：`/me` 加非 owner 的 `DELETE devices/:id` 分支（现在断开只删本地 token，服务端 device 仍有效）。
