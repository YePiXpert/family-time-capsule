<!-- 2026-09-19 批准的 Build 68 计划原文，归档留证。实施中的几处偏离：

  · ZIP 改为「按需 ZIP64」而非「始终 ZIP64」（主流工具都是这么做的，macOS/Windows 自带解压兼容最好；测试用 forceZip64 把两条路径都走一遍）；
  · 提交 4（HANDOFF 重写）并入收尾提交，避免写两遍；
  · 编辑页本就没有「第一次」开关，「她说的话」只在阅读页切换；Quotes 路由随提交 13 一起加；
  · 归档文件留在应用缓存直到下次导出（Android 分享目标可能在面板关闭后才读文件，不能立刻删）；
  · 提交 16（release_tag → GitHub Release）未做，留给持有者决定。 -->

# 桉桉成长记 · Build 68「传家 · 上」实施计划（含 69/70 路线）

> **历史记录**：2026-09-19 批准的 Build 68 计划，已交付为 Build 68。时光系列已在 1.0.3 撤回。正文保留当时的状态、命令与待办，不代表现在。当前范围见 [PRODUCT](../../../PRODUCT.md)，交付状态见 [HANDOFF](../../../HANDOFF.md)，全部历史文档见 [索引](../README.md)。

## Context

这是一位家长给女儿做的成长记录与纪念 App：本机优先（Expo SDK 57 / RN 0.86），AI 为可选联网功能（VPS 上约 700 行 Fastify 服务）。Build 67 已交付（账号登录），服务端已上线并清库。

通读全库后的判断：工程基础明显高于同类项目（冻结实体 + 增量落盘、备份 v2 去重、禁网边界脚本、纯函数排版引擎、CI 真跑双端模拟器、私钥签名）。作为「传家」之物，真正的短板在两处：

1. **资料只在一部手机上，且 `.xmb` 是只有本 App 认识的私有二进制格式。** 多年后没有 App、或家长忘了怎么导出，女儿就打不开。
2. **仪式感只覆盖「回看」，没有「写给未来」。** 年度寄语是写给现在的读者的，缺一条把此刻寄往 18 岁的通道。

另有几笔工程债会拖累后续所有工作：HANDOFF.md 自相矛盾（AI 代理跨机接手会走偏）、密码哈希不带参数（无法升成本）、`.commandcode/` 仍被跟踪、三个死依赖、每次 change 让全部集合引用失效导致书架整库重排。

持有者已拍板（2026-09-19）：68 同时推进「资料永不丢失」「给女儿的仪式感」「先还工程债」；要做开放归档；时间胶囊信放进 68；粒度 = 68 可执行清单 + 69/70 路线。按依赖排序后：**68 = 工程债 + 时间胶囊信 + 开放归档 + 两个小仪式；69 = 本机 blob 备份库 + 分卷 + 加密远端单向备份；70 = 第二台设备同步。**

纪律不变（AGENTS.md）：只在 main 上小提交直推；每次推送前 mobile/ 与 server/ 三件套全绿（本机跑 mobile 测试需 `TMPDIR=/var/tmp/anan-tests`，因为 /tmp 是满的 tmpfs）；不建分支不发 PR；构建号只在收尾提交里改；UI 只用 `mobile/src/local/ui.tsx` 的基元并在 DESIGN.md 登记。

---

## 一、工程债（提交 1–4，先做，约一天）

### 提交 1 · 仓库卫生
- `git rm -r --cached .commandcode`（.gitignore 第 70 行已忽略）。
- `mobile/package.json` 删除零引用依赖：`@react-navigation/bottom-tabs`、`expo-blur`、`expo-camera`；devDeps 删 `react-test-renderer`、`@types/react-test-renderer`。保留 `expo-asset`（expo 传递依赖）、`react-native-screens`、`react-native-worklets`（peer）。之后 `npm install` 刷新 lock，`npm run doctor` 必须绿。两个 postinstall 补丁脚本保留（它们按精确版本守门，是有意的）。
- 新增 `.nvmrc` = `24`。
- `VERSIONING.md`：删去"No server image or deployment instructions are part of this product."，改为一句指向 `deploy/README.md`。
- `DESIGN.md`：删第 45 行重复的「相册内页」条（保留第 41 行带寄语的那条）。
- `git mv PLAN-BUILD-*.md docs/plans/`，HANDOFF/README 里的引用同步改。

### 提交 2 · 服务端密码哈希带参数 + 兜底命令按用户名找人
- `server/src/passwords.ts`：新格式 `scrypt2:<N>:<r>:<p>:<salthex>:<keyhex>`，N=32768、r=8、p=1（单次约 32MB，VPS mem_limit 768m 下并发 2 也安全）。`verifyPassword` 同时接受旧 `scrypt:` 三段式（固定 16384/8/1）与新六段式；新增 `needsRehash(stored)`。
- `server/src/app.ts`：`/login` 与 `/password` 验证通过后若 `needsRehash` 则 `store.setPassword(id, await hashPassword(password))`。
- `server/src/store.ts`：新增 `findByUsernameOrName(name)`：先 `username=?`，找不到再退回 `findExactByName`。`manage.ts password` 改用它（setLogin 改用户名但不改 name，旧命令会找不到人）。
- 测试：`passwords.test.ts` 新增「旧格式仍可验证 + needsRehash 为真」「新格式往返」；`app.test.ts` 新增「旧哈希登录后自动升级为 scrypt2」；deploy/README 的兜底命令说明补一句"成员名或登录名皆可"。

### 提交 3 · 未改动集合保持引用稳定 + 书架按集合记忆
- `mobile/src/local/store.ts` `change()`：`diffLibrary` 之后、写盘之前，对 `ENTITY_KINDS` 中无 changed/removed 的 kind 执行 `state[kind] = this.state[kind]`（fork 出的浅拷贝原样丢弃）。root 字段（yearNotes 等）保持现状。
- `mobile/src/local/Shelf.tsx:226` `useMemo(() => sortedRecords(state), [state])` → 依赖 `[state.records]`；`months/years/firsts/anniversaries/albums/seriesList` 也收进 useMemo，各按对应集合。`Year.tsx`、`SearchScreen.tsx` 同样把 `[state]` 依赖收窄。
- 测试 `tests/local-scale.test.ts` 新增：改一条 draft 后 `store.get().records === prev.records`；顺手记录 `sortedRecords(10k)` 耗时到「基线」注释。

### 提交 4 · HANDOFF.md 重写
- 结构：① 当前状态（Build 67 已交付 dfbf592 / run 35434384089，服务端 service.example.invalid 已上线并清库，下一版 68）② 恢复提示词（环境自检 + "继续 Build 68，见本文件第三节"）③ Build 68 清单（本计划摘要）④ 后续路线 69/70 ⑤ 踩坑清单（原样保留）⑥ 环境备忘（TMPDIR、Node 26、/tmp 满、根目录 Next.js 残留可删）。
- 删掉所有"继续 Build 65 / Build 66 AI 成册 / 下一步 Build 64"的旧编号叙述。

---

## 二、时间胶囊信（提交 5–8）

### 数据模型（提交 5）
`mobile/src/local/model.ts`
- `ENTITY_KINDS` 加 `"letters"`；`Library.letters: Record<string, Stored<LocalLetter>>`；`emptyLibrary()` 加 `letters: {}`；`normalizeLibrary` 补 `if (s.letters === undefined) s.letters = {}`；`forkLibrary` 加 `letters: { ...s.letters }`（它不是泛型的）。
- 类型：
  ```ts
  export type LocalLetter = {
    id: string; title: string; text: string; from: string;   // 落款，如「妈妈」
    openAt: string;        // "YYYY-MM-DD"，本地日历日
    writtenAt: string;     // ISO
    sealed: boolean; openedAt?: string;
    mediaIds: string[]; coverId: string | null; updatedAt: string;
  };
  ```
- `validEntity` 在 persons 兜底分支**之前**加 `kind === "letters"` 分支：title ≤100、text ≤5000、from ≤50、openAt 匹配 `^\d{4}-\d{2}-\d{2}$` 且可解析、writtenAt/updatedAt 可解析、sealed 布尔、openedAt 缺省或可解析、`isIds(mediaIds)` 且每个都在 `s.media`、coverId 为 null 或在 mediaIds 里。
- `referencedMedia` 加 `...Object.values(s.letters).flatMap(l => l.mediaIds)`（否则「清理未使用素材」会删掉信里的录音）。
- 新文件 `mobile/src/local/letters.ts`（纯函数）：`letterState(letter, today)` → `"draft" | "sealed" | "openable" | "opened"`；`defaultOpenAt(birthday, today)` = 18 岁生日，无生日则今天 +18 年；`openAtLabel("2039-03-01")` → 「2039年3月1日」；`sortLetters`（未拆的按 openAt 升序，已拆的按 openedAt 降序）。`dates.ts` 加 `nthBirthday(birthday, n): string | null`（闰日 2 月 29 → 2 月 28）。
- 备份 v2 与 SQLite 逐 kind 泛型处理，无需改；`tests/local-backup.test.ts` 加一例「信随备份往返」证明。
- 测试：`tests/letters.test.ts`（state 判定含边界日、默认 openAt、闰日、排序）；`tests/local-core.test.ts` 加 validate 正反例与 referencedMedia 保护。

### 书架与导航（提交 6）
- `navigation.ts` 加 `LetterEditor: { id: string }`、`Letter: { id: string }`、`Quotes: undefined`；`App.tsx` 注册对应 `Stack.Screen`（title 留空，与其他页一致）。
- `Shelf.tsx`：在「专题册」之后、「时光系列」之前加「时间胶囊」区：每封信一个 `Volume`（无封面走纸封面，`stamp` 用落款首字，`title` 为信名，`caption` 为「封存至 2039年3月1日 · 妈妈」/「草稿」/「可以拆了」/「已拆封」），`testID="letter-<id>"`；末尾占位 `Volume`「写一封信」（`fallbackIcon="plus"`，caption「写给多年后的她」，`testID="letter-new"`）→ `services.beginLetter(store)` 建草稿并跳 LetterEditor。区块只在有信或有生日时都显示（无生日也能写，openAt 默认今天 +18 年）。
- `services.ts` 加 `beginLetter(store, from?)`、`sealLetter(store, id)`（sealed=true，写入 writtenAt）、`openLetter(store, id)`（openedAt=now）、`deleteLetter(store, id)`。

### 编辑与阅读页（提交 7）
- 新文件 `mobile/src/local/LetterEditor.tsx`：`Page` + `Field`（标题、正文多行 ≤5000、落款）、拆封日期行（复用 Editor.tsx:306 的 DateTimePicker 模式，iOS spinner + 「日期选好了」）、可选录音（复用 `editorHooks.useRecorder`：只需把 `recordingFile`/mediaIds 的耦合改为接受 `{ recordingFile?, mediaIds }` 的通用 draft 形状；若改动过大，则在 LetterEditor 内直接调用 `start/finishAudio/discardAudio` 并把结果 media id 写入 letter）。底部两个按钮：「保存草稿」、「封存」（主按钮，弹确认「封存后就不能再改了，到 2039年3月1日 才能拆。」）。testID：`letter-title`、`letter-text`、`letter-from`、`letter-seal`。照片附件列为 stretch，不进本版。
- 新文件 `mobile/src/local/LetterScreen.tsx`：未到日子 → 印章圆环 + 「还没到日子」+ 「封存至 …」+ 辅助色文字按钮「提前拆封」（`testID="letter-open-early"`，确认后 `openLetter`）；到期或已拆 → 衬线标题、正文、落款、写信日期、录音播放（复用 Record.tsx 的音频条）。草稿态 → 直接进 LetterEditor。删除入口弱化在页尾（同 Record 的删除样式）。
- `DESIGN.md`「页面与操作」加三条：书架「时间胶囊」区、信件编辑页、信件阅读页（措辞见上）。

### 冒烟（提交 8）
- `smoke-android.py`：书架 `tap('letter-new')` → 写标题正文 → `tap('letter-seal')` → 确认 → 重启后 `find` 以 `letter-` 开头的 volume → 打开 → `find('还没到日子')` → 截图 `letter-sealed`。
- `NativeRegressionTests.swift`：同一流程，断言 `letter-open-early` 存在。
- `local_fixture.py` 的 seed 加一封已封存的信，便于 iOS 回归直接可见。

---

## 三、开放归档（提交 9–12）

### ZIP 写入器（提交 9）
新文件 `mobile/src/local/zip.ts`，零依赖，流式：
- `class ZipWriter { constructor(sink: (bytes: Uint8Array) => void) ; addText(path, text) ; async addStream(path, size, read: () => Uint8Array | null) ; finish() }`。
- 仅 store（不压缩）；本地头置 bit 3（数据描述符，边流边算 CRC，素材只读一遍）与 bit 11（UTF-8 文件名）；**始终 ZIP64**（本地头 extra 0x0001、中央目录、zip64 EOCD 与定位器），保证 >4GiB 与 >65535 条目；CRC32 查表实现；时间戳用归档时刻的 DOS 时间。
- 测试 `tests/zip.test.ts`：写含中文路径、0 字节、>64KiB 分块的 fixture 到磁盘临时目录；TS 侧校验签名/条目数；再 `child_process.spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("\n".join(z.namelist()))', path])` 校验可读与名单（CI ubuntu 与开发机都有 python3）。

### 归档布局（提交 10）
新文件 `mobile/src/local/archive-layout.ts`（纯函数，输入 Library + 可选年份，输出条目列表 `{ path, kind: "text" | "media", text?, mediaId? }`）：
- 根目录 `桉桉成长记归档-YYYYMMDD/`（名字取 `profile.name || CHILD_FALLBACK`）。
- `记录/YYYY/YYYY-MM-DD 标题/正文.md`：front matter（日期、地点、人物、第一次、她说的话）+ 正文 + 媒体相对链接；同目录内媒体命名 `照片1.jpg`、`视频1.mp4`、`录音1.m4a`、`文件1.pdf`（按 mediaIds 顺序编号；同一素材被多条记录引用则各自复制一份，简单胜过去重）。日期取本地日历日，与 `monthKey` 一致。
- `相册/<名>.md`（寄语 + 各记录相对链接）、`时光系列/<名>.md`、`寄语/YYYY.md`、`信/YYYY-MM-DD 落款 标题.md`（+ 录音）、`人物.md`。
- `library.json`（整库 JSON，媒体字段附归档内相对路径）与 `library.js`（`window.ANAN_LIBRARY = …`，让 index.html 从 file:// 打开不需 fetch）、`index.html`、`README.txt`（一段说明：这是普通文件，任何电脑都能看；index.html 用浏览器打开；.xmb 备份与本归档的区别）。
- 文件名净化：去 `/ \ : * ? " < > |` 与控制字符，trim，NFC，≤60 字符，重名加 ` (2)`。
- 年份筛选：只保留该年记录及其引用的相册/系列条目；寄语与信按年过滤；`全部` 不过滤。
- 测试 `tests/archive-layout.test.ts`：命名、净化、重名、front matter 内容、年份过滤、信与语录出现、每个 media 条目都能在 Library 找到。

### 离线网页（提交 11）
新文件 `mobile/src/local/archive-viewer.ts`：导出常量 `ARCHIVE_VIEWER_HTML`（模板字符串，纸色调色板内联 CSS，原生 JS，无任何外部 URL）：读 `library.js`，左侧年 → 月，右侧记录卡（照片 `<img>`、视频 `<video controls>`、录音 `<audio controls>` 都用相对路径），顶部「第一次」「她说的话」「时间胶囊」「相册」入口；时间胶囊按 openAt 在浏览器里判断，未到期只显示信封与日期（正文仍在文件里，见风险）；简单子串搜索。
- 测试 `tests/archive-viewer.test.ts`：不含 `http://`/`https://`；引用 `library.js`；抽出 `<script>` 内容用 `new Function` 验证语法；渲染函数对空库不抛。

### 编排与设置页入口（提交 12）
- 新文件 `mobile/src/local/archive.ts`：`createArchive(state, { year, includeSealedLetters }, onProgress, signal): Promise<File>`：先 `Paths.availableDiskSpace` 与预计大小（素材 bytes 之和 ×1.02）比较，不足直接报「本机剩余空间不够，先清理或分年归档」；输出到 `Paths.cache/archive/<根目录名>.zip`（复用 book-export 的 cache 子目录模式）；媒体通过 `mediaFile(m).open(FileMode.ReadOnly).readBytes(262144)` 分块 + `tick()` 让出（与 backup.ts 一致，顺手把 256KiB 常量收成 `files.ts` 导出）；`signal.aborted` 时关闭句柄、删掉半成品；完成后 `Sharing.shareAsync(uri, { mimeType: "application/zip", UTI: "public.zip-archive", dialogTitle: "保存开放归档" })`；分享结束删除 cache 文件。
- `Settings.tsx` 备份页新增 Card「开放归档」：一句说明（"导出成普通文件夹压缩包：原图、Markdown 文字与一个离线网页，没有这个 App 也能看。"）、年份 chips（全部 + 有记录的年份，复用 SearchScreen 的 chip 样式）、开关「包含未拆封的信」默认关、主按钮「导出开放归档」（`testID="archive-export"`），进行中在同一行显示「正在归档 n/N 份素材」+「停止」（沿用恢复的状态文字模式，不弹窗）。
- `DESIGN.md`「我的」条目补一句归档卡描述；README「使用」加一条。
- 冒烟：Android 在备份闭环之后 `tap('archive-export')`，用与 PDF 相同的 intentresolver 文本检查等待 `<根目录名>.zip` 出现（fixture 122 条记录几十 MB，300 秒足够）；iOS 断言分享面板文件名。

---

## 四、两个小仪式（提交 13–14）

### 「她说的话」（提交 13）
- `model.ts` `RecordContent` 加 `quote?: boolean`（validContent 里同 first 校验为缺省或布尔）；`search.ts` `SearchFilters.quote`、谓词一行；`SearchScreen.tsx` 静态 chip「她说的话」（`q-quote`）。
- `Record.tsx` 动作行「第一次」旁加「她说的话」切换（同一 editEntity 模式，`testID="record-quote"`）；`Editor.tsx` 补充信息区在「第一次」开关旁加同款开关。
- `Shelf.tsx`「第一次合集」Volume 旁加「语录」Volume（仅有内容时显示，`testID="volume-quotes"`）；新文件 `Quotes.tsx`：按日期升序的纸卡列表，衬线大字引正文首段，日期 + 月龄（`ageLine` 的月龄部分），点击进 Record。
- 归档 front matter 与离线网页的「她说的话」入口随之落地（提交 10/11 已预留字段）。
- 测试：`search.test.ts` 加 quote 过滤；`local-core.test.ts` 加校验用例。

### 「去年的纪念册可以装订了」（提交 14）
- `model.ts` 根字段 `yearBooksBoundAt?: Record<string, string>`（validRoot：四位年 → ISO），`normalizeLibrary` 无需补（可缺省）。
- `BookBinder.tsx` 在 `shareBook(file)` 之后 `store.change(s => { s.yearBooksBoundAt = { ...s.yearBooksBoundAt, [job.year]: now() } })`（BookJob 需带 `year`；Year.tsx 传入）。
- `nudge.ts` 加纯函数 `bookNudgeOf(today, yearsWithRecords, boundYears)`：1–2 月且去年有记录且未装订 → `{ year }`；`Shelf.tsx` 在节奏提示之后渲染纸卡「去年的纪念册可以装订了」+「去年度册」按钮 → `Year(prevYear)`，关闭用 `useState` 与 `nudgeClosed` 同款（会话态）。
- 测试 `tests/nudge.test.ts` 加 4 例（一月命中、三月不提、已装订不提、去年无记录不提）。

---

## 五、收尾（提交 15–16）
- 提交 15：`CHANGELOG.md`「Build 68 — 传家 · 上」；`README.md`（使用步骤加时间胶囊、开放归档、她说的话；「当前本机版」改 68）；`DESIGN.md` 各条已随功能提交；`HANDOFF.md` 更新交付实况；`mobile/app.json` versionCode 68 / buildNumber "68"（定点编辑，文件含 \uXXXX 转义）。
- 提交 16（可选）：`mobile-build.yml` 新增 `release_tag` 输入，为该 tag 创建 GitHub Release 并挂 APK、IPA 与 sha256（解决 30 天过期）。
- 派发：`gh workflow run mobile-build.yml --ref main -f source_sha=<40 位 SHA>`，全绿后把 APK/IPA 校验和记入 HANDOFF。

---

## 风险与取舍
- **ZIP64 + 数据描述符兼容性**：macOS 归档实用工具、Windows 资源管理器（Win10+）、Android Files、7-Zip 均支持；老旧 Windows 7 自带解压对 ZIP64 支持不稳，但目标读者是"多年后的电脑"，反而更需要 ZIP64。始终 ZIP64 而非条件启用，代码路径单一、测试一次覆盖。
- **多 GB 文件走系统分享面板**：iOS 分享到「文件」与 AirDrop 可行但慢；Android 多数目标应用能接。分年归档就是分卷的替代品，UI 上默认选中「全部」但说明可按年。69 的分卷机制落地后可复用。
- **cache 空间**：先查 `Paths.availableDiskSpace`；导出中断删半成品；分享后删 cache。
- **内存**：全程分块流式，任何时刻内存里只有一个 256KiB 块，与备份同级。
- **未拆封的信在归档里是明文**：默认不包含（开关默认关），文案说明"归档里的信会被明文保存"。要真正封存只能加密，那是 69 远端加密备份的题。
- **信的默认拆封日依赖生日**：无生日则今天 +18 年，编辑页可改；闰日退到 2 月 28。
- **新增 kind 忘记接线**：`validEntity` 兜底分支会把 letters 当 persons 校验并整库拒绝——提交 5 的测试先写正反例再动模型。

---

## 六、后续路线（只列目标与依赖）

### Build 69「传家 · 中」资料不灭
- 本机备份改 blob 库：`backups/blobs/<sha256>` + 清单 `.xmbm`（v2 头不带素材字节），引用计数回收，库 + 备份从约 4 倍降到约 2 倍；`.xmb` 分卷导出（阈值切多卷，v2 读取端支持多卷拼接）。
- 加密单向远端备份：客户端用 `@noble/hashes/scrypt`（已在依赖）派生密钥 + `@noble/ciphers`（新增，同作者、审计过）XChaCha20-Poly1305 逐块加密；服务端新增 `PUT /backup/blobs/:sha256`、`PUT /backup/manifest`、`GET /backup/manifest`，按成员配额存到 `AI_DATA_DIR/backup/`；需修订两条「宪法」：`verify-local-boundary.py` 允许 `src/sync/` 目录 fetch，AGENTS 加一条"备份传输只走 src/sync"。前置：blob 库（本机与远端共用内容寻址）。
- 决策点：口令丢失即不可恢复，要不要在 App 内生成并让家长抄写 12 词恢复码。

### Build 70「传家 · 下」家人一起记
- 第二台设备：登录同一家庭账号后从远端清单拉全量（含原图，持有者已拍板），记录 last-writer-wins 合并（revision + updatedAt），媒体按 sha256 增量；冲突只在同一记录两端都改时提示。
- 前置：69 的远端 blob 与清单；`Library` 增加设备 id 与向量时钟前先出 PLAN-SHARING.md。
- 明确不做：实时协作、云端搜索、第三方云盘、人脸识别。

---

## 验证清单
1. 每个提交前：`cd mobile && TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck && npm run lint && npm run doctor`；`cd server && npm test && npm run typecheck`；`python3 mobile/scripts/verify-local-boundary.py`；`python3 -m unittest discover -s mobile/scripts -p 'test_*.py'`。
2. 测试数量预期：mobile 223 → 约 275（letters ~10、zip ~8、archive-layout ~12、archive-viewer ~4、nudge +4、search +2、core +8、scale +1、backup +1）；server 18 → 21。
3. 真机/模拟器手工检查：写信 → 封存 → 重启仍在 → 提前拆封确认；备份页导出归档 → 在电脑解压 → 双击 index.html 能翻记录、播录音、看信封；Windows 解压中文名正常；「清理未使用素材」不删信里的录音；语录页与搜索 chip；一月份书架出现装订提醒（改系统日期验证）。
4. 打包：`gh workflow run mobile-build.yml --ref main -f source_sha=<SHA>`，quality / Android / iOS 三作业全绿，冒烟报告 result.json 含 `letterSealed`、`archiveSheet` 为 true。
