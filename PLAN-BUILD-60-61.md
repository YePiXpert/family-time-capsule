# 桉桉成长记 · Build 60/61 执行方案（交接版）

> 给执行者：本文档自包含，无需其他上下文。所有路径相对仓库根 `C:\vibe-coding\family-time-capsule`。
> 覆盖迭代：**Build 60「时光的礼物」**（礼物感三件套 + 节奏提示）、**Build 61「记忆的秩序」**（人物标签、本机健康、足迹）。Build 58（性能与媒体）、59（数据安全）概要见附录。
> 前提：开工时已交付 59；构建号按实际递增（60、61）。

## 0. 项目速览

- React Native (Expo ~57) 本机优先应用「桉桉成长记」：父母记录女儿成长，书架首页（年度/月度/专题册），AI 可选（经 `server/` VPS 转发 DeepSeek），本机备份 `.xmb`。
- 主体在 `mobile/`；根命令转发：`npm test`、`npm run typecheck`、`npm run lint`（`server/` 内独立跑）。
- 设计规范 `DESIGN.md`：暖纸手账风；主题与公共组件集中在 `mobile/src/local/ui.tsx`，**不得在页面另建主题**。
- 发布纪律（`AGENTS.md`）：只从 `main` 工作、不建分支不开 PR、不 force-push；小提交直接推；每次交付递增 `mobile/app.json` 的 `ios.buildNumber`/`android.versionCode`；推后检查 CI（`ci.yml` 自动；`mobile-build.yml` 手动派发 `gh workflow run mobile-build.yml --ref main -f source_sha=<完整SHA>`，Android APK + iOS 未签名 IPA 双绿才算交付）。

## 1. 关键架构约束（改动前必读）

1. **全库严格校验**：给 `Library` 加字段必须同时做：类型 + `emptyLibrary()` 默认值 + `validateLibrary()` 校验 + `normalizeLibrary()` 兜底（参照 `model.ts` 的 `yearNotes`、`lastExportAt` 模式）。旧库/旧备份要能打开。
2. **单一写队列**：`store.ts` 的 `change()` 串行执行「克隆→校验→落盘→推进」。只读操作不要进 `change()`。
3. **备份自动随模型走**：模型字段过校验后自动进 `.xmb`；新集合记得测往返。
4. **可复用基建（先查再写）**：`NoteCard.tsx`（扉页寄语卡，支持 `assist` AI 起草）、`Shelf.tsx` 的 `Stamp`（双线印章圆环）、`keepsake.ts`/`KeepSakeCard.tsx`（纪念卡纯排版 + SVG→PNG 导出 + `prepareKeepSakePhoto` 降采样）、`places.ts`（坐标识别与地名标签）、`dates.ts`（年龄行/里程碑）、`ai/state.ts` 的 `localPlaceTags`（250 米坐标聚类）、`ui.tsx`（Page/Glass/Button/Field/Ornament/dateLabel）。
5. **原生代码先本地编译**：改 Kotlin/Swift 后，先下载独立 kotlinc 对 `$ANDROID_HOME/platforms/android-36/android.jar` 编译一份用法一致的 snippet，再提交（Build 56/57 两次打包红的教训：`getLatLong` 重载歧义）。Swift 无本地条件时至少让 CI 的 iOS 作业先行跑通再并 Android。
6. **原生回归/冒烟同步**：`mobile/scripts/smoke-android.py`、`mobile/scripts/ios-regression/NativeRegressionTests.swift`、`mobile/scripts/local_fixture.py`（fixture 日期在月中、形状测试与 `emptyLibrary()` 对齐）。

## 2. Build 60「时光的礼物」任务清单（按序，每组一提交）

### 任务 1：时光系列（同款时光对比）

**价值**：成熟亲子应用验证过的留存功能——同一姿势/场景每月一张，排成时间线，「看着她长大」。零网络零新依赖，直接复用纪念卡渲染。

**改法**：
- `model.ts`：`LocalSeries = { id, name, items: { recordId, mediaId, month }[], updatedAt }`（`month` 形如 `2026-09`，**每系列内唯一**）；`Library.series: Record<string, LocalSeries>`；按约束 1 补四处 + 往返测试。
- `services.ts`：`beginSeries(store)`、`addToSeries(store, seriesId, recordId, mediaId)`（month 取自该素材 `photoMetadata.capturedAt` 或记录日期；重复月份先确认替换）。
- 书架「专题册」区旁新增「时光系列」区：`Volume` 复用（封面取最新一张，stamp 用系列最新与最早月份跨度「12 个月」）。
- 新路由 `Series { id }`（`navigation.ts` 加类型）：时间线行 = 月份标签 + 照片 + 记录标题；首月至今的缺口月份渲染虚位卡「还缺这一张」；入口「把这个月的照片加进来」弹出该月图片平铺选择（相册换封面的现成写法在 `Albums.tsx`）。
- 导出：`keepsake.ts` 加纯函数 `layoutSeriesStrip(items)`（横排 3-4 张对比条，含月份标签），`KeepSakeCard.tsx` 加对应离屏组件，复用 `exportKeepSakeCard` 落盘分享。
- 测试：`local-core` 校验/往返/月份唯一；`keepsake.test` 布局（缺口不影响几何、张数上限截断）。

### 任务 2：每日一问（Day One 式 Writing Prompts）

**改法**：新 `mobile/src/local/prompts.ts`：内置 120+ 条中文小问题，按月龄段（0-6 月/6-12 月/1-2 岁/2-4 岁/4 岁+）分组；`promptOf(birthday, today, seed)` 纯函数按日期稳定选一条（同一天不换）。编辑器：新草稿且正文为空时，占位符下方显示一行 muted 提示「今天的小问题：……」+「换一个」+「不问了」（会话内记忆，不落库）。保持无设置项，会话内可关即可。
- 测试：`prompts.test`（同日稳定、月龄段切换、边界生日）。

### 任务 3：年度重放（Spotify Wrapped 式本机回忆）

**改法**：新纯函数 `replayPhotos(records, media): { mediaId, caption }[]`（每月封面一张 + 全部「第一次」封面，按日期排，上限 15，纯本地）；放 `dates.ts` 或新 `replay.ts`。`Year.tsx` 加「重放这一年」按钮 → 全屏 Modal：照片整屏淡入淡出（reanimated，尊重减少动画设置），自动 4 秒/点击前进，底部进度点，末页收年度统计与寄语。**v1 不做配乐**（本地选乐需要新权限与依赖，列入 61 可选）。
- 测试：选片纯函数（月覆盖、first 优先、上限、无照片年份返回空并禁用入口）。

### 任务 4：记录节奏温和提示卡

**改法**：`Shelf.tsx` 头部（备份提醒卡之后）：距最近一次记录 ≥3 天且已有过记录时显示「有 N 天没记啦」小卡（可关、当天不再出现，会话态即可）；有未保存草稿时提示优先于天数提示（与现有草稿入口不重复，仅当草稿数>0 但最近 3 天无新草稿编辑）。无推送、无弹窗。
- 测试：纯函数 `nudgeOf(lastRecordAt, lastDraftEditAt, draftsCount, today)`。

### 任务 5：文档与发布

- CHANGELOG/README/DESIGN（时光系列、每日一问、年度重放的视觉与措辞规则）；`app.json` 59→60；全套绿 → 推送 → CI 绿 → 派发 `mobile-build`（source_sha=最终 SHA）→ 双绿交付。

## 3. Build 61「记忆的秩序」任务清单

### 任务 1：人物标签

**改法**：`Library.persons: Record<string, { id, name }>` + `RecordContent.personIds?: string[]`（四件套模式：类型/默认/校验（存在且去重）/normalize `persons→{}`；`personIds` 可选）。编辑器「补充信息」区加人物 chips（多选 + 新建）；阅读页日期行下显示人物名 muted chips；选材 Picker 与年度册支持按人物过滤。**不做人脸识别**。
- 测试：校验/往返/旧库兼容；过滤纯函数。

### 任务 2：本机健康页

**改法**：新 `health.ts`：`xiaomei-v1/health.json` 原子写（复用 activation 的 part→move 思路）；记录：启动耗时、`change()` 平均/最大耗时、写盘失败次数与最近一次错误摘要、最近一次备份时间。采集点：`disk.ts` open 计时、`store.ts` change 计时与 catch。入口「我的 → 本机存储」页内新增区块「本机健康」。**不上报任何数据**。
- 测试：mock disk 下计数与摘要；失败不阻塞主流程。

### 任务 3：轻量足迹（+可选真地图）

**改法**：把 `ai/state.ts` 的 `localPlaceTags` 250 米聚类抽成共享纯函数 `places.ts: clusterPlaces(media)` → `[{ center, mediaIds, firstAt, lastAt }]`。新路由 `Footprint`：按到访次数排序的地点列表（次数、首末日期、封面照），点击进该组照片的记录列表。真地图（react-native-maps，新原生依赖）为**独立提交、可整体裁剪**，先跑轻量版验收再说。
- 测试：聚类纯函数（单点/重叠/无 GPS 媒体）。

### 任务 4：搜索筛选 chips（若 59 未顺手覆盖）

全局搜索结果页/选材页加筛选 chip：年份、第一次、含影音、相册内、（61 起）人物。纯过滤函数复用。

### 任务 5：文档与发布（61 号，同上验收纪律）

## 4. 已知坑（累计，别再踩）

- 原生 Kotlin 改动先本地 kotlinc 对平台 jar 编译验证；`ExifInterface.getLatLong` 重载组有歧义，用 `getAttribute`+DMS 解析。
- apksigner `--print-certs` 的行前缀随 build-tools 版本在 `Signer #1`/`V2 Signer` 之间变化，指纹钉住要匹配摘要值而非整行。
- `app.json` 含 `\uXXXX` 转义，定点编辑，别整文件重写。
- 同名 `.ts`/`.tsx` 会让 `./keepsake` 解析歧义——组件文件用大驼峰（`KeepSakeCard.tsx`）。
- 备份保留策略的「同分钟名字随机序」：给刚创建的文件预留保留位（`pruneBackups(keep, protect)` 语义）。
- 测试文件行尾混 CRLF/LF 时精确匹配编辑会失败，先 `cat -A` 看。
- 用 bash heredoc 写中文/转义内容到源文件时极易把 `\n` 写实——优先用专用编辑工具。
- XCUITest 中文 accessibilityLabel 精确匹配可用；复合 label 用 `CONTAINS` 谓词。
- 分享面板冒烟：导出在面板弹出前已完成，sleep 后返回键退出再断言。

## 5. 明确不做（与原则冲突）

云同步/家庭共享（要做需端到端加密走 owner 服务器，属战略立项）、推送通知（应用内温和提示已覆盖）、人脸自动识别与智能修图（隐私+气质）、广告与账号体系。

## 附录：Build 58 / 59 概要（已定，先行）

- **58 性能与媒体**：持久 512px 缩略图（expo-image-manipulator 已有）；expo-video-thumbnails 视频首帧（唯一新依赖）；`LocalMedia.width/height`；真实宽高比替换三处写死（`ui.tsx:309` 4:3、`Media.tsx:124` 3:4、`Shelf.tsx:99`）；编辑器击键防抖/失焦落盘、Picker 滚动节流（`Albums.tsx:296-305`）、AlbumDetails 本地态（`Albums.tsx:413-419`）；批量导入单次 attach；保存只校验新增素材+闲时巡检；`createBackup` 移出写队列；同记录多图连翻；Editor.tsx 拆 hooks；清理 Glass 未用 `intensity`。
- **59 数据安全与长期**：expo-local-authentication 应用锁；私有 release keystore 与签名流水线（钉指纹已就位，换自有证书）；全局搜索（+筛选 chips）；年度回顾页（60 任务 3 的重放可挂靠）。
