# 小美成长记 · Build 56 执行方案（交接版）

> 给执行者：本文档自包含，无需其他上下文。所有文件路径相对仓库根目录 `C:\vibe-coding\family-time-capsule`。
> 目标迭代：**Build 56 —— 数据底线与确定性缺陷修复**。文末附 Build 57/58  backlog 概要。

## 0. 项目速览

- React Native (Expo ~57) 本机优先应用「小美成长记」：父母记录女儿成长（文字/照片/视频/声音），书架首页（年度册/月度册/专题册），AI 辅助（可选，经 `server/` 的 VPS 转发 DeepSeek），本机备份 `.xmb`。
- 应用主体在 `mobile/`；根目录命令转发到移动端：`npm test`、`npm run typecheck`、`npm run lint`（也可在 `mobile/` 内直接跑）。
- 设计规范 `DESIGN.md`：暖纸手账风；主题与公共组件全部集中在 `mobile/src/local/ui.tsx`，**不得在页面另建主题**。
- 发布纪律（`AGENTS.md`）：只从 `main` 工作，不建分支、不开 PR、不 force-push；小而清晰的提交直接推 `origin main`；每次交付递增 `mobile/app.json` 的 `ios.buildNumber` 与 `android.versionCode`（当前 55 → 本轮 56）；推后检查 GitHub Actions（`ci.yml` 自动跑；`mobile-build.yml` 需手动派发 `gh workflow run mobile-build.yml --ref main -f source_sha=<完整SHA>`，产出 Android APK 与 iOS 未签名 IPA 并验证两者都绿）。

## 1. 关键架构约束（改动前必读）

1. **全库严格校验**：`mobile/src/local/model.ts` 的 `validateLibrary()` 在校验失败时拒绝一切写入。给 `Library` 加字段时必须：改类型 + `emptyLibrary()` 默认值 + `validateLibrary()` 校验 + `normalizeLibrary()` 兜底（Build 55 已建立此模式，参照 `yearNotes` 的实现）。`normalizeLibrary` 在 `store.ts` 的 `open()` 与 `backup-format.ts` 的 `decodeManifest()` 中、校验之前调用，保证旧库/旧备份可打开。
2. **单一写队列**：`store.ts` 的 `LocalStore.change()` 串行执行所有修改，克隆 → 校验 → 落盘 → 推进状态。读操作不要塞进 `change()`（见任务 6）。
3. **备份格式**：`backup-format.ts` 头部为整库 JSON（含 mediaOrder），其后按序拼接素材字节流，逐素材 SHA-256。模型字段校验通过后自动随备份走。
4. **测试**：vitest，`mobile/tests/` 下 `local-core.test.ts`（模型/校验）、`local-backup.test.ts`（真实 SQLite 备份往返）、`photo-metadata.test.ts`、`ai-state.test.ts`。新逻辑必须补测试。
5. **原生回归/冒烟**：`mobile/scripts/ios-regression/NativeRegressionTests.swift`（XCUITest）、`mobile/scripts/smoke-android.py`、`smoke-ios-startup.py` 在 `mobile-build.yml` 里跑，改 UI 结构时同步更新。
6. **当前状态**：Build 55（年度册+年度寄语）代码已推送 main；`mobile-build.yml` 已对 `d133f03` 派发（若失败先看 iOS 回归日志，两个测试的书架路径问题刚修过，可能还有遗留失配）。

## 2. Build 56 任务清单（按序执行，每组一个提交）

### 任务 1：分享接收管道加固（`mobile/src/local/services.ts` 的 `receiveShares`，约 89-143 行）

**问题**：`manifest.items` 中 `kind: "error"` 或路径非法的条目直接 `throw` → 该 manifest 永远不被 ack，每次启动/前台重放整批；已 `preserveMedia` 复制成功的文件因 `store.change` 未执行而不入库，`collectUnusedMedia` 看不到 → **每次重试都再复制一遍，磁盘静默膨胀**；且 `for` 循环中断会让排在其后的所有分享永远进不来。

**改法**：
- 抽出 `receiveOneShare(store, manifest)`，`receiveShares` 逐个 try/catch，收集各批错误，全部处理完后若有错误再抛聚合中文错误（保持 `App.tsx` 错误横幅机制可用）。
- 单条坏条目（error 类型、路径校验失败、preserveMedia 失败）**跳过并计数**，不再毒死整批。
- `preserveMedia` 成功但 `store.change` 失败时，删除已复制的文件（`mediaFile(m).delete()`）再抛错。
- 草稿创建仍在一个 `store.change` 内完成；成功批正常 `acknowledgeNativeShare`。
- 全部条目都坏（无文本无素材）时不建空草稿，直接 ack 并计入错误。
- 有跳过时抛出「有 N 份分享素材未能保存，其余已存为草稿」——此时该批已 ack，重试不会重复导入（`receivedShares` 去重）。

### 任务 2：分享草稿补齐拍摄信息（services.ts + 原生 share-intake 模块）

**问题**：编辑器导入会读 EXIF 并给草稿 `autoDate/autoLocation/groupPhotosByDay` 三个标记（`services.ts` 的 `beginDraft`，约 36-38 行），分享草稿两者都没有 → 从微信分享去年的照片，落成记录的日期是今天、地点为空、分组失效。

**改法**：
- `receiveShares` 建草稿时补 `autoDate: true, autoLocation: true, groupPhotosByDay: true`，并用 `photo-metadata.ts` 的 `applyPhotoMetadata` 逐素材套用元数据（与 `Editor.tsx` 的 `attach` 一致）。
- 原生侧在复制完成后抽取 EXIF 写进 manifest 条目（可选字段，向后兼容）：
  - `mobile/modules/share-intake/src/index.ts`：`NativeShareItem` 加 `capturedAt?: string; latitude?: number; longitude?: number`。
  - Android `FamilyShareIntakeModule.kt` 的 `copyUri`：`renameTo` 成功后，若 `mediaType == "image"`，用框架类 `android.media.ExifInterface`（无需新 gradle 依赖）读 `TAG_DATETIME_ORIGINAL`（`yyyy:MM:dd HH:mm:ss` → 转成 `yyyy-MM-ddTHH:mm:ss` 再放入 `capturedAt`）与 `latLong`（已含正负号）。整段包 `runCatching`，失败静默。
  - iOS `FamilyShareIntakeModule.swift` 的 `takeOverSharedManifests`：文件复制到 `capturesDirectory()` 后，用 ImageIO（`CGImageSourceCopyPropertiesAtIndex`）读 Exif 字典 `DateTimeOriginal` 与 GPS 字典（注意按 `LatitudeRef`/`LongitudeRef` 的 S/W 取负），写入 `localItem`。
  - JS 侧：构造 `LocalMedia` 后若条目带这些字段，校验（`Date.parse` 有效、坐标范围合法）后写入 `m.photoMetadata`。
- 测试：`photo-metadata.test.ts` 补「分享草稿经 applyPhotoMetadata 后日期/地点取自拍攝信息」的纯函数用例；services 层的 receiveShares 目前无单测（`local-backup.test.ts` 里原生模块是 mock 的），可在 `local-core.test.ts` 风格下给 `receiveOneShare` 级别的逻辑补用例（mock `consumePendingNativeShares`）。

### 任务 3：按天分组的两处修正（`mobile/src/local/photo-metadata.ts` 的 `photoDayGroups`）

**问题 A**：先写文字再导入多天照片时，`{...clone(draft.content)}` 把标题/正文复制进**每一组**（约 119-135 行），保存后多条记录挂同一段话。
**改法**：建组时仅第一组保留 `title`/`text`，其余组置空（`photoEvents` 分支不动，AI 分组已有各自标题）。

**问题 B**：视频/录音没有 `photoMetadata.capturedAt`，会落进 `undated` 组被单独拆出（如生日聚会的 5 照片+1 视频被拆成两条）。
**改法**：两遍扫描——先按 `capturedAt` 建组；对无拍摄时间的素材，按 `mediaIds` 顺序取**最近的有日期邻居**（优先前一个，再后一个）归入同组；全批都无日期时保持 `undated`。组日期取该组首个有 `capturedAt` 素材的值（用 day→capturedAt 映射在建组后统一回填）。
**不做**：不引入 `expo-media-library`（新原生依赖+权限摩擦，本轮不值）。
**测试**：更新 `photo-metadata.test.ts` 现有用例（`["a","b"],["c"],["unknown"]` 的 undated 行为会变：相邻归入），新增「文本只进第一组」「视频归入相邻拍摄日」用例。

### 任务 4：Android 照片定位权限（`mobile/app.json`）

`android.permissions` 数组加 `"android.permission.ACCESS_MEDIA_LOCATION"`（不要加进 `blockedPermissions`）。作用：Android 10+ 不声明此权限时系统静默剥离相册照片的 GPS EXIF，地点自动填入（`photo-metadata.ts` 的 `applyPhotoMetadata`）从不生效。无需代码改动；同步在 CHANGELOG 说明。

### 任务 5：编辑器三个确定性缺陷（`mobile/src/local/Editor.tsx`）

1. **iOS 分组日期选择器一闪即关**（约 418-428 行）：分组内嵌 `DateTimePicker` 缺 iOS 处理——滚轮每动一格触发 `onChange` 而回调第一句 `setEventDate(null)` 直接卸载选择器。照抄主日期选择器的写法（约 361-376 行）：`display={Platform.OS === "ios" ? "spinner" : "default"}`、`onChange` 里 `if (Platform.OS !== "ios") setEventDate(null)`、iOS 下补一个「日期选好了」按钮。
2. **废弃录音文件泄漏**（`discardAudio` 约 225-239 行；`finishAudioImpl` 约 160-183 行）：原始录音写在 `Paths.document` 下，`preserveMedia` 是 copy 不是 move（`files.ts`），保存后原文件残留；放弃时只清字段不删文件。改法：两处都在 `persist` 成功后 `new File(Paths.document, 旧路径).delete()`（先判 `exists`）。`backup-format.ts` 的录音草稿检查依赖 `recordingFile` 字段，字段清理逻辑不变。
3. **保存/忙碌时返回手势被静默吞掉**（约 240-241 行 `if (operation.current) return;`）：改为给出轻提示（如 `setError("正在保存，请稍候。")` 或 Alert 其一，与现有错误呈现一致），不要无反馈。

### 任务 6：AI 额度公平性（`server/src/store.ts` + `mobile/src/ai/Editor.tsx`）

1. **服务端**：`server/src/store.ts` 的 `usage()`（约 64-65 行）汇总当日请求时排除 `status='failed'`（或在 `finish` 标记失败时冲销预留）。用户无责的失败（上游乱码 `INVALID_RESULT`、超时）不应烧每日额度。
2. **客户端**：`mobile/src/ai/Editor.tsx`（约 553-571 行）——失败后「重试原请求」复用同一 `requestId` 必然命中 409 `RESULT_EXPIRED`。收到 `RESULT_EXPIRED` 时隐藏「重试原请求」，只留「重新生成」，文案说明「这次重新生成才会计入额度」。
3. 测试：`server/tests/` 补「失败请求不计入当日额度」用例；移动端 `ai-state.test.ts` 补 RESULT_EXPIRED 分支。

### 任务 7：备份守护（model.ts / Settings.tsx / Shelf.tsx / backup.ts / App.tsx）

1. **lastExportAt**：`Library` 加 `lastExportAt?: string`（可选字段，无需 normalize；或必填+normalize，参照 `yearNotes` 模式任选其一，保持全仓风格一致即可）。`Settings.tsx` 导出备份 `shareBackup` 成功后经 `store.change` 写入当前时间。
2. **书架提醒**：`Shelf.tsx` 在有记录且（从未导出 或 距 `lastExportAt` 超 30 天）时，顶部显示温和 Glass 提示卡「已经 N 天没有备份了」+「去备份」按钮跳 `Backup` 页。不弹窗、可常驻。
3. **备份页**：`Settings.tsx` 的 Backup 页顶部显示「上次导出：x 天前 / 尚未导出过」。
4. **保留策略与可读文件名**：`backup.ts` 的 `createBackup` 文件名改为 `xiaomei-YYYYMMDD-HHmm-<短id>.xmb`；导出/恢复前自动留存成功后，清理 `backupDirectory` 里超出最近 3 份的旧 `.xmb`；备份列表加「删除」按钮（`Alert.alert` 确认）。注意 `App.tsx`（约 336-344 行）按文件名排序取最新备份——改文件名格式后确认排序仍正确（新格式字典序=时间序，正确）。
5. **启动恢复推荐位加固**：`App.tsx` 取最新 `.xmb` 前先 `inspectBackup` 试校验，失败的文件不进推荐位。
6. 测试：`local-core.test.ts` 补 lastExportAt 校验；`local-backup.test.ts` 补保留策略（造 4 份备份文件断言清理）；文件名解析/超期判定抽纯函数补单测。

### 任务 8：测试与发布流水线补齐

1. **Android 冒烟备份闭环**（`mobile/scripts/smoke-android.py` 末尾）：点 `备份与恢复` → `backup-export`（处理系统分享面板的退出）→ 删一条记录 → `backup-restore` → 断言记录文本还原。UI testID 已齐备（`backup-export`/`backup-restore`）。
2. **年度册进原生回归**：`NativeRegressionTests.swift` 第一个测试里加：书架断言 `volume-year-2026` → 点开 → `year-note-edit` 写寄语 `year-note-input` → `year-note-save` → 重启后仍在。`smoke-android.py` 同步加 `volume-year-` 断言（注意： fixture 记录都在 2026 年，应出现 `volume-year-2026`）。
3. **fixture-vs-model 形状 diff**（`ci.yml` 加一步）：node 打印 `emptyLibrary()` 顶层键，与 `mobile/scripts/local_fixture.py` 的 `empty()` 键 diff，不一致即红。顺手把 `local_fixture.py` 的 fixture 日期挪到月中（如 `2026-08-15`）避免时区边界假失败。
4. **APK 签名指纹钉住**：`mobile-build.yml` 的 APK 验证步骤加 `apksigner verify --print-certs`，把当前指纹钉进脚本比对（先跑一次拿到现有 debug 签名指纹再钉）。防模板 keystore 漂移导致无法覆盖安装（覆盖安装失败 = 用户只能卸载重装 = 未导出记录全丢）。

### 任务 9：小修快改（可合并为一个提交）

1. `mobile/src/local/App.tsx` 的 `Boundary` 兜底页（约 261-273 行）：显式浅色底 `#FAF5EC` + 深字 `#3B3129`（它在 `LocalTheme` 之外，深色模式黑字黑底不可读；参照同文件启动错误页 362 行附近的既有做法）。
2. `ui.tsx` 浅色 `muted` `#8C7C6A` → `#7A6A58`（在纸底/纸卡上对比度约 3.7-3.9:1，低于 DESIGN.md 自己的 4.5:1 条款）；同步改 `DESIGN.md` 色表。
3. `Month`（Home.tsx:245）、`Year`（Year.tsx:172）、`Settings`（Settings.tsx:32）三页去掉多余的 `Page top`（它们有原生导航头，top 会多出一个状态栏高度的留白；`Shelf`/欢迎页无头，保留 top）。改完在模拟器肉眼确认无跳动。
4. 三处空态补 `Ornament` 收尾（`Shelf.tsx` 书架空态与 Firsts 空态、`Home.tsx` 月册空态；DESIGN.md 规定「空态可用 Ornament 收尾」）。
5. `mobile/plugins/share-extension/FamilyShareExtension-Info.plist` 的 `CFBundleDisplayName` 从「存入家庭时间胶囊」改为「小美成长记」。
6. `Record.tsx` 正文 `Text` 加 `selectable`（约 96 行），多年后可摘抄。

### 任务 10：文档与发布

- `CHANGELOG.md` 顶部加 Build 56 条目（分组列出：分享接收、编辑器修复、AI 额度、备份守护、测试与流水线、细节修正）。
- `README.md`：「当前本机版：Build 55」→ 56；如分享/备份行为有用户可见变化，同步「使用」与「数据与结构」段。
- `DESIGN.md`：色表 muted 变更、书架备份提示卡规则（温和、不弹窗）。
- `mobile/app.json`：`buildNumber`/`versionCode` 55 → 56（用精确字符串编辑，不要整文件重写，保留 `\uXXXX` 转义风格）。
- 验收：`npm test`、`npm run typecheck`、`npm run lint` 全绿 → 提交推送 → `ci.yml` 绿 → 派发 `mobile-build.yml`（source_sha=最新 main 完整 SHA）→ Android APK 与 iOS IPA 双绿 → 提供两个构建产物的下载（Actions artifacts）。

## 3. 已知坑（已核实，别再踩）

- 本地 `mobile/node_modules` 曾缺 `react-native-reanimated`/`react-native-worklets` 导致 typecheck 报 TS2307；如遇到先在 `mobile/` 跑 `npm install`。
- iOS 原生回归的两个测试要走书架路径：记录册收在月册内，断言 `record-fixture` 前先 `tap("volume-2026-09")`（Build 55 已修，回归再红先查这类 UI 结构失配）。
- XCTest 里 `matching(identifier:)` 对中文 accessibilityLabel 精确匹配可用；相册卷标是「名称，N 段记录」复合 label，要用 `label CONTAINS` 谓词（参照 `NativeRegressionTests.swift` 现有写法）。
- `app.json` 含 `\uXXXX` 中文转义；编辑用定点替换，别用 json.dump 整写。
- `Settings.tsx` 的 `createBackup` 目前包在 `store.change` 里（只读操作占写队列、revision 虚增）——本轮先不动，列入 Build 58 重构。

## 4. Backlog 概要（Build 57/58，本轮不做）

**Build 57 礼物感**：书架头部年龄行（「2 岁 3 个月 · 来到世界第 487 天」）；「那年今日」从 `records.find` 单条升级为全部往年同日可逐条翻看；生日/百天/周岁特别卡；年度册纸封面印章化（复用扉页印章画法）；`LocalAlbum` 加 `note` 扉页寄语（仿 `yearNotes` 模式）；导入时 `expo-location` 逆地理编码把裸坐标变地名（离线退回坐标）；年度寄语 AI 起草（`contracts.ts` 的 `writingMode` 加 `recap`，服务端加 RECAP_PROMPT，输入全年标题+第一次清单、输出 200 字内草稿、纯文字无照片，`Year.tsx` 的 YearNote 编辑态加「AI 帮我起草」）；编辑器「移除」素材加确认弹窗。

**Build 58 性能与媒体重构**：编辑器文本输入防抖/失焦落盘（现在每击键一次全库克隆+校验+写盘，`store.ts` 的 change 队列）；多选照片导入改批量（循环内只 `preserveMedia`，循环外一次 `attach`）；保存时全量 sha256 改只校验新增素材+闲时巡检；`createBackup` 移出写队列；`preserveMedia` 生成 512px 持久化缩略图与视频首帧封面（`expo-image-manipulator` 已有，加 `expo-video-thumbnails`），`LocalMedia` 记 width/height，列表用缩略图详情用原图；照片/视频按真实宽高比渲染（去掉 `ui.tsx` 写死的 4:3 与 Media.tsx 写死的 3:4）；同记录多图连续翻看。

**明确暂缓**：记录提醒通知（需 expo-notifications 新原生依赖）；相册导出 PDF/zip（独立里程碑）；身高体重曲线；私有 release keystore（中期，先钉指纹）。
