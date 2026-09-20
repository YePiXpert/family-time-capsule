<!-- 2026-09-19 批准的 Build 69「界面整顿」计划原文（含 Build 70 路线与约束），归档留证。2026-09-20 实施完毕，18 个小提交直推 main。实施中的偏离：
  · 提交 8：直接加入相册的助手放在 model.ts（纯函数 appendToAlbum／newAlbumFrom，services 只做薄包装）——services 引了 react-native，vitest 进不去；
  · 提交 1：查看素材页标题按种类（查看照片／听录音／看视频／打开文件）在第一笔就改了，不等提交 16；
  · 提交 12：写信页顺手改成与编辑页同款的「拦截全部退出」（保存中按返回记下来、本轮结束再放行），封存／删除／保存草稿都走同一条 leave；
  · 提交 13：「AI 设置」副题只看本机令牌（已登录／未登录），不显示名字——打开「我的」不该联网；
  · 提交 14：备份页的状态行平时兼作「上次导出」一句，导出与恢复的进度都在这一行播报；
  · 提交 16：备份内部的技术错误（「备份素材清单无效」「备份素材校验失败」等）保留原词，测试与恢复失败提示都盯着它们；对比卡按钮的 heart 保留（对比卡属纪念卡）；
  · 测试 275 → 299（计划约 295）；
  · 第四节列出的产品行为改动全部按默认执行，主人未划掉任何一条。 -->

# 桉桉成长记 · Build 69「界面整顿」实施计划 + Build 70「传家 · 中」路线与约束

## Context

- **前提**：capsule.yep.li 的服务端已按 `deploy/README.md` 部署到 main 最新（含 scrypt2 哈希升级），HANDOFF 里唯一挂着的「服务端尚未部署」已闭环。上一次 main CI（9bd192a）全绿，工作区干净。
- **主人拍板（2026-09-19）**：
  1. 先单出一版 **Build 69 = 界面与交互整顿**（纯手机端，几天可交付）；**Build 70 = 传家 · 中「资料不灭」**（本机 blob 备份库 + 分卷 + 加密远端备份，一个包）；**Build 71 = 家人一起记**。
  2. 界面四处都怪：书架首页、二级页双页头、阅读页／相册页、「我的」系列页；首页**保留书架身份但重排版**；二级页改为**页内自绘一行「‹ 返回 + 标题」**。
  3. 远端备份密钥 = **12 词恢复码即密钥**（无口令、无 scrypt）；VPS 可用磁盘 50–200 GB；手机资料 < 5 GB。
- **证据**：上次打包 run 35450404867 的双端真机截图已下载到 `/var/tmp/anan-tests/evidence-35450404867/{android,ios/screenshots}/`（安卓 `home-390.png`、`record-reading.png`、`editor.png`、`backup-roundtrip.png`…；iOS 按 `manifest.json` 的 `suggestedHumanReadableName` 对应）。代码审计确认的怪点见下「一、问题清单」。
- **纪律不变**（AGENTS.md）：只在 main 小提交直推；每次推送前 mobile 三件套（`TMPDIR=/var/tmp/anan-tests npm test`、`typecheck`、`lint`）+ server 两件套 + `python3 mobile/scripts/verify-local-boundary.py` + `python3 -m unittest discover -s mobile/scripts -p 'test_*.py'` 全绿；构建号只在收尾提交里定点改；UI 只用 `mobile/src/local/ui.tsx` 基元并同步 DESIGN.md。

---

# 第一部分 · Build 69「界面整顿」

## 一、问题清单（截图 + 代码审计，按家长日常碰到的频率排）

| # | 现象 | 证据 |
| --- | --- | --- |
| 1 | 首页顶部备份提醒、「有 N 天没记啦」等**最多五张卡叠在一起且无间距**，内容被顶出首屏；备份卡无法关闭 | `Shelf.tsx:313-320` 自建 ScrollView 没有 `gap`；`358-548` 五张卡；`400-429` 无 ✕ |
| 2 | 每区双列**大封面**，封面按原图比例导致参差；空区全是「+」虚位册（新建相册／写一封信／新建时光系列），空库首屏有四个「+」；两年记录的书架约 5–6 屏长 | `Shelf.tsx:101-218,156-157,595-601,696-708,733-745,782-794`；`Media.tsx:84-88` |
| 3 | 二级页 **双页头**：原生页头 `title: ""` 只剩「返回」胶囊，页内再画衬线大标题；iOS 26 上页头一大条且与页面有色差；`BookPreview` 标题压在状态栏时钟上 | `App.tsx:253-405`（25 个 `title: ""`）；iOS 截图 `yearbook-preview` |
| 4 | 阅读页 **五个等权按钮堆在正文和照片前面**，开关（第一次／她说的话）和动作长得一样，`sparkle` 图标在这里表示「她说的话」、别处都是 AI；录音显示成「录音.m4a」；「加入相册」要绕进全库多选页 | `Record.tsx:171-256,201,136-140` |
| 5 | 相册页寄语卡与三个按钮挡在记录前；年度册页 6 个按钮无主次，「这一年没有照片」是个禁用按钮，「导出成长册」用系统 Alert 当菜单 | `Albums.tsx:101-160`；`Year.tsx:332-374,350-360` |
| 6 | 编辑器：**加第一张照片后正文框消失**、变成「事情 1」分组卡（新草稿默认 `groupPhotosByDay: true`）；「放弃这份草稿」是整宽按钮；「保存这一刻」与实际的自动保存互相矛盾（文案说「明确保存后才生效」，其实已落盘） | `Editor.tsx:422,330-421,795,623,803`；`services.ts:51`；`editorHooks.ts:45-86` |
| 7 | 点一下 FAB／「新建」就**永久留下空草稿、空「新时光系列」、空信**，三天后还会被催 | `services.ts:33-56,103-114,141-158`；`nudge.ts:38-43` |
| 8 | 「我的」是一张卡五个等宽按钮、无箭头无分组；入口是无标签的双环「印章」，读屏叫「打开设置」，页面叫「我的」 | `Settings.tsx:52-78`；`Shelf.tsx:351-356`；`JournalIcon.tsx:100-104` |
| 9 | 备份页：三段说明 + 两个主按钮 + 每份备份**三个整宽按钮** + 文件名 `anan-….xmb` + 「开放归档」第二个主按钮，最多约 18 个按钮一页 | `Settings.tsx:301-461,399-460,557` |
| 10 | 外观页用三个整宽按钮选主题、看不出选中；AI 页以「DeepSeek Flash High」开头，离线报错「重试会沿用原请求，避免重复提交」；AI 面板底部有编辑页底栏透出来 | `Settings.tsx:154-232`；`ai/Settings.tsx`；iOS 截图 `ai-panel` |
| 11 | 文案：记录的单位有 段时光／段记录／条记录／份素材／回忆／事情 六种；你／她混用；「右下角的笔」但按钮是「+」；`.xmb`、素材、校验等术语外露 | `Shelf.tsx:335,816`；`Editor.tsx:428` vs `prompts.ts`；`Settings.tsx:342,346` |
| 12 | 组件层面：只有主／次两级按钮，没有文字级与危险级；卡套卡、iOS 玻璃套玻璃（`Card` 里的 `Button`）；7 个图标从未使用（`arrow-left`、`check`、`chevron-right`、`trash`…），`heart` 承担五种含义 | `ui.tsx:566-609,302-314`；`JournalIcon.tsx:3-8` |

## 二、设计原则（本版写进 DESIGN.md「统一规则」的新条款）

1. **页头统一由 `Page` 绘制**：隐藏原生页头；表单与设置类页面（编辑、写信、我的、备份与恢复、外观、AI 设置、搜索、选材）标题在顶栏一行「‹ 标题 ［右侧动作］」；内容类页面（阅读、相册、年度册、系列、读信）顶栏只有返回，标题随内容。iOS 侧滑返回与安卓硬件返回照旧。
2. **按钮四级**：主（实底，每页至多一个）／次（纸面胶囊）／文字（辅助色文字，44pt 触控：新建、更多、另存、停止）／危险文字（错误色：删除、放弃、关闭）。开关类（第一次、她说的话、主题、筛选 chips）选中时带 `check` 勾。禁用态统一 40% 透明，不再泛粉。
3. **内容先于动作**：阅读类页面先照片／正文，动作收进底栏或页尾；提示卡同屏至多一张、都可关。
4. **卡不套卡、玻璃不套玻璃**：`Card` 内的 `Button` 渲染为纸面平胶囊（`GlassDepth` 上下文）。
5. **书架**：区块为横向小封面条（封面固定 4:3 裁切，宽 140／大字 200），区标题右侧文字级「新建」入口，空区一行说明，不再放「+」虚位册；「最近」在最上面。
6. **称呼与单位**：写给她的（信、寄语）用「你」，写关于她的（记录、提示、占位）用「她」；记录一律「N 段时光」，附件按种类「N 张照片／N 段录音」，混合时「N 个附件」；术语「素材／校验／清单／.xmb」不进正文，只允许在脚注。
7. **图标一义**：`sparkle` 只表示 AI；新增 `quote` 表示「她说的话」；`heart` 只表示纪念卡；那年今日用 `calendar`。

## 三、提交清单（18 个小提交，全部在 main）

### 一、地基（提交 1–3）

**提交 1 · `Page` 顶栏与原生页头下线**
- `mobile/src/local/ui.tsx` `Page`（现有 props 仅 `children/scroll/top/tab`，`ui.tsx:515-546`）：新增 `title?: string; back?: boolean; right?: ReactNode; testID?`；有 `back`（默认：非首页即 true）时在 SafeArea 顶部固定渲染一行 52pt：`IconButton label="返回" icon="arrow-left"`（启用未用过的 `arrow-left`）+ 衬线标题 22/600（可换行）+ `right` 插槽；顶栏在 ScrollView 之外，`scroll={false}` 的页面同样可用；`top` 默认随 `back` 为 true。顺手删掉无人使用的 `tab` prop 与 `s.tabContent`（底部 tab 时代残留）。
- `mobile/src/local/App.tsx:253-405`：`screenOptions` 加 `headerShown: false`，删 25 处 `title: ""` 与 `Search`/`Media` 的标题（改由 Page 传）；保留 `animation`、`contentStyle`；`gestureEnabled` 不动。
- 本提交只接入 3 个页面验证模式（`Search`、`Media`、`Backup`），其余页面在提交 7 迁移；其间其它页面暂时无页头但仍可硬件／手势返回 → 与提交 7 同日推送，避免留下无返回按钮的中间态过夜。
- DESIGN.md 「统一规则」段落改写页头一句（原第 28 行「页头两个平台都是实色纸面…」整句替换为原则 1）。
- 验收：iOS 模拟器侧滑返回可用（react-native-screens 在 `headerShown:false` 下仍启用返回手势，首次 iOS 冒烟顺带确认）；安卓硬件返回照旧；`Editor` 的 `usePreventRemove` 不受影响。

**提交 2 · 按钮四级、开关勾、玻璃深度、区标题**
- `ui.tsx` `Button`：新增 `kind?: "pill" | "text"`、`danger?: boolean`；`selected` 为真时前置 `check` 图标；`disabled` 统一 `opacity: 0.4`。`Glass` 读取新 `GlassDepth` 上下文，深度 ≥ 1 时渲染实色纸面（不再嵌套液态玻璃）；`Card` 提供深度 +1。
- 新增 `SectionHeader({ title, action?: { label, onPress, testID } })`：无衬线 13 辅助色标题 + 右侧文字级动作（替换书架五处 13px 衬线区标题 `Shelf.tsx:594,630,682,712,749`）。
- 新增 `SettingsRow({ icon, label, subtitle?, onPress, testID? })`：图标 + 标签 + 副题 + `chevron-right`，供「我的」使用。
- `components/JournalIcon.tsx`：新增 `quote` 与 `pin` 两个 glyph；删除确认零引用的 `growth`、`lock`、`users`；删除无引用资源 `mobile/assets/illustrations/growing-album.webp`、`keepsake-box.webp`、`PROMPTS.md`。
- 测试：`ui.tsx` 无组件测试基建（react-test-renderer 已移除），靠 typecheck + lint + 冒烟；DESIGN.md 追加原则 2、4、7。

**提交 3 · 提醒策略与关闭状态（纯函数 + 模型根字段）**
- `mobile/src/local/nudge.ts` 新增 `pickNudge(candidates: NudgeCandidate[], closed: Record<string,string>, today): Nudge | null`：候选 = 里程碑 > 装订 > 备份 > 节奏（记录／草稿），返回优先级最高且未被关闭的一张；关闭有效期：里程碑当天、节奏当天、备份 7 天、装订本季。
- `model.ts` 根字段 `nudgeClosedAt?: Record<string, string>`（`validRoot`：键 ≤ 32 字符 → ISO 可解析）；`normalizeLibrary` 可缺省。
- 测试 `tests/nudge.test.ts` +6（优先级、每种关闭期限、过期后重新出现、空候选）；`local-core.test.ts` +2（根字段校验正反例）。

### 二、书架（提交 4–6）

**提交 4 · 书架头部与单张提醒**
- `Shelf.tsx:313-320` 改用 `s.content`（恢复 20pt gap）；头部：衬线标题 + 小 `chevron-right`（提示可点开扉页）+ 一行元信息（有生日显示年龄行，否则「N 段时光」；删掉「N 册」，`Shelf.tsx:248,335`）；右上 搜索 + **「我的」入口**：带名字首字的小圆章（复用 `Stamp` 缩小到 32），`accessibilityLabel="我的"`，`testID="open-settings"` 不变。
- 五张卡替换为 `pickNudge` 的一张，统一 ✕ 关闭并写 `nudgeClosedAt`；备份提醒不再是「卡整体可点 + 按钮」双目标（`Shelf.tsx:402-425`），只留按钮；那年今日条保留（是内容不是催促）但移到「最近」之后。
- 冒烟：`smoke-android.py:85,88,105` 的 `tap('打开设置')` 改 `tap('我的')`（iOS 用 testID 不用改）。
- DESIGN.md「书架」条目重写头部与提醒规则（同屏至多一张、都可关）。

**提交 5 · 书架区块改横向条 + 「最近」**
- 新组件 `Shelf.tsx` 内 `Strip`（横向 ScrollView，`contentContainerStyle` gap 12，右侧留白）与 `RecentStrip`（最近 6 条记录：有图为正方形缩略图 104pt + 日期，无图为纸卡首行文字；点击进阅读；空库时显示「把今天的小事留下来」+ 主按钮「记一刻」→ `beginDraft` 同 FAB）。草稿入口改为「最近」下方一行 `SettingsRow` 风格的「继续写：…」，**文字仍为「继续编辑」**（安卓冒烟 `tap('继续编辑')`）。
- 区块顺序：最近 → 那年今日 → 年度册 → 月度册（最近 6 个月；更早的在年度册里）→ 合集（第一次合集、她说的话、足迹，仅存在时）→ 专题册（动作「新建相册」`album-new`）→ 时间胶囊（「写一封信」`letter-new`）→ 时光系列（「新建系列」`series-new`）。空区：条内一行辅助色说明（如「还没有相册。把几段回忆放在一起。」），下一步就是标题右侧的动作。
- `Volume`：固定 `aspectRatio: 4/3` + `resizeMode: "cover"`，宽 140（大字 200，`useVolumeWidth` 改为返回条宽）；纸封面保留书脊条，照片封面不加装饰（DESIGN 原则）；testID 全部不变（`volume-year-YYYY`、`volume-<month>`、`volume-quotes`、`letter-<id>`）。
- 派生数据按集合记忆（沿用 Build 68 提交 3 的 `useMemo` 依赖收窄模式），横条用 `ScrollView`（每区 ≤ 30 项，不必 FlatList）。
- 底部空态（`Shelf.tsx:812-820`）删除（已由「最近」承担）；FAB 图标改 `edit`（笔），`accessibilityLabel="记一刻"`，`testID="capture-new"` 不变。
- 冒烟核对：安卓 `find(f'volume-{month}')`／`find('volume-year-…')`／`tap('Our days')` 都是各条第一项，首屏可见；`tap_seek('letter-new')` 纵向寻找区标题动作即可。
- DESIGN.md「书架」条目按原则 5 重写。

**提交 6 · 书架收尾：里程碑／装订／那年今日卡紧凑化与文案**
- 三张内容卡改 `Card compact`；「右下角的笔」→「右下角的『记一刻』」（`Shelf.tsx:816` 删、`Year.tsx:452` 改）；年度册页无 FAB 的提示删掉。
- 扉页（`Shelf.tsx:891-940`）无资料时不再把「桉桉成长记」当作名字显示，改为「还没填名字」+「完善资料」按钮。

### 三、二级页与阅读（提交 7–10）

**提交 7 · 全部页面迁移到 `Page title`**
- 机械迁移：`Settings.tsx`（我的／宝宝资料／外观／本机存储／备份）、`SearchScreen.tsx`、`Media.tsx`、`People.tsx`、`Quotes.tsx`、`Footprint.tsx`、`Home.tsx`（月册：顶栏只返回，衬线月份标题随内容）、`Year.tsx`、`Albums.tsx`（含 Picker「选择回忆」→ 顶栏标题「选记录」）、`Series.tsx`、`Record.tsx`、`LetterScreen.tsx`、`LetterEditor.tsx`（顶栏标题「写一封信」）、`Editor.tsx`（顶栏标题「记下这一刻／编辑这一刻」，`right` = 日期胶囊）、`ai/Settings.tsx`、`RecapScreen.tsx`。删除各页自己的 `<Text style={s.title}>`。
- `BookPreview.tsx`（Modal）：顶部加 `useSafeAreaInsets().top`，顶栏同样式（返回为 `IconButton`），修掉标题压时钟；`rgba(0,0,0,0.12)` 硬编码改用主题色（DESIGN 第 13 行违规）。
- `RecapScreen.tsx:450-464` 的「✕」文字改 `IconButton icon="close"`；选乐浮层加同款关闭。

**提交 8 · 阅读页：内容先行 + 底栏动作 + 直接加入相册**
- `Record.tsx` 顺序：照片（多张改横向分页 ScrollView + 进度点，保留上一张／下一张为 `IconButton` 供读屏）→ 日期条 + 人物 chips → 衬线标题 → 正文 → 录音行（`mic` 图标 +「听录音」，不再显示文件名）→ 「把地点换成地名」文字级 → 开关行「第一次」「她说的话」（`selected` + 勾，图标 `star`／`quote`）→ 页尾「删除记录」危险文字级（安卓冒烟 `tap('删除记录')` 文本不变）。
- `BottomBar`：「编辑」主按钮（`record-edit`）+「加入相册」+「纪念卡」（`keepsake-make`，进行中标题「正在生成…」沿用）。
- 「加入相册」改为就地选择：展开现有相册列表卡 + 「新建相册」；新增 `services.addRecordsToAlbum(store, albumId, recordIds)`（从 `Albums.tsx` Picker 的「加入此相册」提交逻辑抽出并复用），新建时用当前记录直接建册，不再进 Picker。
- 测试：`tests/local-core.test.ts` 或新 `tests/services.test.ts` +3（加入已有相册去重、新建相册含该记录、相册不存在时报错）。
- DESIGN.md「阅读」条目重写。

**提交 9 · 相册、年度册、系列页的动作与主次**
- `Albums.tsx` 相册页：封面 → 名称／数量 → 动作行（「添加记录」主、「换封面」文字级、「整理」文字级）→ 记录列表 → 寄语卡在**末尾**（空时一行「写下这本相册的话」文字级）。
- `Year.tsx`：标题 + 统计（删「共 N 字」）→ 动作行：「这一年回顾」次级、「重放这一年」次级（无照片时不渲染按钮，改一行辅助色说明「这一年还没有照片」）、「导出成长册」（`year-yearbook`）点开**就地展开**两个次级按钮「长图」「纪念册 PDF」（不再用 Alert 菜单；安卓冒烟 `tap('year-yearbook'); tap('长图')` 序列不变）→ 月册网格（正方形封面）→ 「这一年的第一次」→ 寄语卡在末尾；装订进行中的「正在装订 N/M 页」卡与「停止装订」沿用。
- `Series.tsx`：同样「动作行一行、整理为文字级」。
- DESIGN.md 相册／年度册／系列条目对应改写。

**提交 10 · 空态与残余模态**
- `Firsts`（`Shelf.tsx:891-899`）、`Quotes.tsx:68-76`、`Footprint.tsx:115-123`、`Home.tsx:273-285` 的空态各补一个明确下一步按钮（「记一刻」或「回书架」）。
- `Editor` 返回拦截（`Editor.tsx:185-215`）：保存中按返回改为「等 flush 完成后放行」，删掉远在页中的「正在保存，请稍候再返回」错误行，状态只在底栏标题「正在保存…」体现；`Albums.tsx:438-452` 同样处理。

### 四、编辑器（提交 11–12）

**提交 11 · 编辑器：正文永不消失、分组改为按需、次要动作降级**
- `services.ts:51` `beginDraft`：`groupPhotosByDay: !record` → `false`（FAB 新草稿默认不分组）；`services.ts:308` `receiveShares`（分享进来）仅当照片跨 ≥ 2 个拍摄日时为 true（用 `photo-metadata.ts` 的分日逻辑判定）。
- `Editor.tsx:422,438,661` 去掉正文框／小问题／补充信息的隐藏条件：正文框始终在最上；分组卡（`330-421`）只在 `groupPhotosByDay` 为真时**追加在正文之后**；现有的分组开关（`Editor.tsx:336-345`）从卡内移出成为照片区下方一行开关「按拍摄日期分成几件事」（`Switch`，同 Build 68 归档卡样式），有 ≥ 2 张照片时才显示；分组卡内「事情 1」→「第 1 件事」。日期按钮（`308-310`）在分组开启时不再静默禁用，改为下方一行说明「分成几件事后，日期各自在每件事里改」。
- 正文下方一行辅助色「草稿会自动保留」；`Editor.tsx:623` 文案改「已从这份草稿移出」；`803` 改「这份草稿将被删除」。
- `649-658` 的「补充标题、地点」／误标为「从文件添加素材」的展开按钮 → 文字级「更多：标题、地点、人物」；`795` 「放弃这份草稿」→ 页尾危险文字级（Alert 确认保留）。
- `ai/Editor.tsx` 面板：底板改实色纸面（修 BottomBar 透出）；「本次的照片 · 事情 1」→「这次的照片 · 第 1 件事」；模型名移到面板底部 12pt 脚注。
- 测试：`tests/photo-metadata.test.ts`／相关纯函数测试 +2（跨日判定、单日不分组）。
- DESIGN.md「编辑」条目改写；README「使用」第 4 条改为「照片跨多天时会建议分成几件事」。

**提交 12 · 空实体自动清理**
- 新纯函数模块 `mobile/src/local/empties.ts`：`isEmptyDraft(d)`（无标题／正文／地点／人物／素材／录音）、`isEmptyLetter(l)`（未封存且无标题／正文／录音）、`isEmptySeries(s)`（默认名且无照片）。
- `Editor` 卸载／返回时若 `isEmptyDraft` → 静默删除草稿（`store.change`），不弹确认；`LetterEditor`、`Series` 同理。`nudge.ts` 草稿搁置只统计非空草稿（自然成立）。
- 测试 `tests/empties.test.ts` +6；`local-backup.test.ts`／冒烟不受影响（冒烟都先输入内容再重启）。

### 五、「我的」（提交 13–15）

**提交 13 · 「我的」分组列表**
- `Settings.tsx:41-82` 改为分组 `Card` + `SettingsRow`：【她】`{profile.name || "宝宝"}的资料`（副题：昵称／生日）；【资料】「备份与恢复」（副题：上次导出 N 天前）、「本机存储」（副题：照片和录音占用 N MB）；【家人与 AI】「AI 设置」（副题：已登录 · 名字／未登录）；【外观】「外观设置」。行文本与既有冒烟一致（`备份与恢复`、`AI 设置`、`外观设置`）。
- 顶部保留一句 tagline；DESIGN.md 第 50 行「我的」开头改写为分组列表。

**提交 14 · 备份页重排（为 Build 70 远端卡腾位）**
- `Backup()` 结构：`Page title="备份与恢复"` → 卡 A「导出与恢复」：一句说明 + 「上次导出：…」+ 主按钮「导出完整备份」(`backup-export`) + 次级「从备份恢复」(`backup-restore`) + 状态行（live region，恢复播报不变）+ 12pt 脚注「备份是 .xmb 文件，请保存到应用之外」→ 卡 B「本机保留的备份」：每份一行「9月19日 15:44 · 0.1 MB」（不显示文件名）+ 同行三个文字级「恢复这份备份」「另存」「删除这份备份」（前后两个文本不变，冒烟 `tap_seek('恢复这份备份')` → `tap('恢复并替换')` 照旧；`.xmb` 后缀只在读不出来时提示）→ 卡 C「开放归档」（沿用，但按钮改**次级**，一页只有一个主按钮）。
- 说明文字从三段压成一句 + 一条脚注；「正在校验和处理文件」→「正在检查文件…」。
- DESIGN.md 第 50 行备份页部分改写并注明「Build 70 的远端备份卡放在开放归档之后」。

**提交 15 · 外观、本机存储、AI 设置**
- 外观：主题改一行三个 `compact selected` 按钮（勾选态），文本「跟随系统／浅色／深色」不变（冒烟 `tap('深色')`）；「更大文字」「应用锁」保持开关，应用锁说明压成一句。
- 本机存储：「素材占用」→「照片和录音占用」；「本机健康」收进文字级「查看本机健康」展开区；「清理未使用素材（N 份）」→「清理没用到的照片和录音（N 个）」。
- AI 设置（`ai/Settings.tsx`）：首段改「用家人账号登录后，AI 可以帮你整理照片、写记录。原图和记录仍在本机。」，模型名移到页尾脚注「由 DeepSeek Flash High 提供」；`ai/client.ts` 的 NETWORK 文案改「现在连不上服务，请稍后再试。」（重试语义句删掉）；登录表单在离线时禁用态用统一 40% 透明。`tests/ai-client.test.ts` 相应断言更新。

### 六、文案与图标（提交 16）
- 单位统一：记录 → 「N 段时光」（`Shelf.tsx:613,669,687`、`Home.tsx:231,258`、`Albums.tsx:405,499`、`Settings.tsx:246,380`、`Storage`）；附件 → 「N 张照片／N 段录音／N 个附件」（`Home.tsx:157`、`Editor.tsx:362`、`Media.tsx:255`、`Settings.tsx:331,552`）。
- 你／她：`Editor.tsx:428` 占位「今天，她又带来了什么小惊喜？」；`LetterEditor.tsx:273,284` 统一为「给十八岁的你」「此刻想对你说的话…」；省略号统一「…」。
- 图标：`Record.tsx:201` 她说的话 → `quote`；`Shelf.tsx:520` 那年今日 → `calendar`；`Record.tsx:249` 换地名 → `pin`；`heart` 只留纪念卡与寄语卡。
- 搜索页 chip「她说的话」图标同步；`App.tsx:363`「查看素材」→「查看照片」（按种类：录音时「听录音」）。
- 测试：`tests/search.test.ts` 等涉及文案断言处同步；DESIGN.md 追加原则 6、7。

### 七、冒烟与收尾（提交 17–18）

**提交 17 · 双端冒烟对齐**
- `smoke-android.py`：`tap('我的')`；在 `home-390` 之后补 `shot('home-recent')`（有记录后的首页）；`record-reading` 截图前 `find('record-edit')` 改在底栏（`tap` 自动可达）；其余步骤不变。
- `NativeRegressionTests.swift`：`open-settings` 不变；补一张 `record-bottom-bar` 截图；`assertNoFailure` 沿用。
- 预期报告键不变（`letterSealed`、`archiveSheet`、`backupRoundtrip`…）。

**提交 18 · 收尾**
- `DESIGN.md` 一致性通读（页面与操作各条与实现一致；删除已不存在的「虚位册」「印章进入」措辞）。
- `CHANGELOG.md`：`## Build 69 — 界面整顿`（首页、页头、阅读页、编辑器、我的、文案与图标、工程：按钮四级／GlassDepth／空实体清理／测试 275 → 约 295）。无格式变化，无降级警告。
- `README.md`「使用」第 1、4、5、6 条微调（「我的」入口是右上角名字圆章；照片跨天才分组）；「当前本机版」改 69。
- `HANDOFF.md`：一／二／三节重写（下一步 = Build 70 资料不灭，指向本文件第二部分与 `docs/plans/PLAN-BUILD-70.md` 待写）；踩坑清单补三条（`Page` 顶栏与 `usePreventRemove`、GlassDepth、冒烟标签「我的」）。
- `docs/plans/PLAN-BUILD-69.md` 归档本计划第一部分 + 顶部「实施偏离」注释。
- `mobile/app.json`：第 16 行 `"buildNumber": "69"`、第 24 行 `"versionCode": 69`（定点字符串替换，文件含 `\uXXXX` 转义）。
- 派发：`gh workflow run mobile-build.yml --ref main -f source_sha=<40 位 SHA>`；三作业全绿后把 APK／IPA 的 SHA-256 记进 HANDOFF 第一节。

## 四、需要主人点头的产品行为改动（默认按下列执行，不同意的在批准时划掉）
1. 首页同屏只留一张提醒卡，备份提醒也可关（关 7 天后再出现）。
2. 书架「月度册」只显示最近 6 个月，更早的进年度册；「最近」条成为首页第一区。
3. 编辑器加照片**不再默认**按拍摄日期分组（分享进来的跨天照片除外），正文框永不消失。
4. 空草稿／空信／空系列退出即自动清理。
5. 「我的」入口改为名字首字的小圆章，读屏标签「我的」。
6. 阅读页动作移到底栏，「删除记录」仍在页尾。
7. 备份页不再显示文件名，`.xmb` 只出现在脚注；开放归档按钮降为次级。
8. AI 页不再以模型名开头，模型名移到页尾脚注。

## 五、风险与取舍
- **原生页头下线**：所有页面同一天迁移（提交 1 + 7 同日推送）；iOS 侧滑返回需在首次 iOS 冒烟确认；`Editor` 的 `usePreventRemove` 逻辑不动。
- **横向条在 uiautomator 下只 dump 可见节点**：冒烟依赖的目标都是各条第一项；若首次派发红，先查可达性（Build 68 教训）。
- **书架性能**：横条 + 固定比例封面减少测量抖动；派生量仍按集合 memo，`local-scale` 基线不应退化。
- **改动面广但都是表层**：不碰模型（除 `nudgeClosedAt` 根字段）、不碰备份格式、不碰服务端。

## 六、验证清单
1. 每提交前：`cd mobile && TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck && npm run lint && npm run doctor`；`cd server && npm test && npm run typecheck`；`python3 mobile/scripts/verify-local-boundary.py`；`python3 -m unittest discover -s mobile/scripts -p 'test_*.py'`。
2. 测试数：mobile 275 → 约 295（nudge +6、core +2、services +3、photo-metadata +2、empties +6、文案断言若干）；server 不变；Python 3 不变。
3. 真机／模拟器（320／390、浅深色、大字、键盘、读屏）：空库首页只有一张「最近」空态卡 + 三条空区提示；有记录后首屏能看到照片；二级页顶栏一行、iOS 侧滑返回可用；阅读页先照片后动作、底栏三键在 320 宽不换行；编辑器加照片后正文框还在；「我的」分组列表；备份页一页一个主按钮；外观主题勾选可见；AI 面板底部无透出；`BookPreview` 标题不压时钟。
4. 派发 `mobile-build.yml`，quality／Android／iOS 全绿，`result.json` 既有键全为 true；下载 APK／IPA 记 SHA-256。

---

# 第二部分 · Build 70「传家 · 中」资料不灭（路线 + 约束 + 提交概要）

> 开工时把本部分展开成 `docs/plans/PLAN-BUILD-70.md`。主人已拍板：一个包含 A 本机 blob 备份库、B `.xmb` 分卷、C 加密远端备份（含远端恢复）、D 宪法修订；恢复码即密钥。

## 一、约束清单

**VPS 与反代**
1. `server/src/app.ts:9` 只有内置 JSON 解析器（`bodyLimit` 15 MiB、`requestTimeout` 120 s）：八进制上传要 `addContentTypeParser('application/octet-stream', passthrough)`，且 passthrough 不受 `bodyLimit` 保护 → 自己按 `Content-Length` 预检 + 落盘计数双重限流（对象硬上限 8 MiB）。
2. 容器 `read_only: true`，只有 `/data`（host `/opt/anan-ai/data`，UID 1000）可写，`/tmp` 是 32 MB tmpfs：临时文件放 `/data/backup/tmp/`（同文件系统 → `rename` 原子），成品 `/data/backup/<memberId>/objects/<id前2位>/<id>`。
3. `mem_limit 768m`、`cpus 1.0`：流式落盘、边写边 sha256，绝不 `Buffer` 整对象。
4. 磁盘水位：`fs.promises.statfs('/data')` 剩余 < 5 GiB → 507 `SERVER_FULL`；每成员配额 `members.backup_limit_bytes` 默认 20 GiB，主人可改。
5. **反代配置不在仓库、上限未知**（nginx 默认 1 MB）：上线第一天对新端点 PUT 4 MB 与 9 MB 各探一次，区分我们的 JSON 413 与反代的 HTML 413；必要时 `client_max_body_size 16m; proxy_request_buffering off; proxy_read_timeout 130s;`。
6. `throttle()` 在反代后是全家共享的 per-IP 预算，**不用于备份路由**；改为每成员同时 ≤ 2 个上传（429 `BUSY`）+ 配额。
7. `deploy/backup.sh` 只快照 SQLite；`/data/backup/` 不备份也不轮转 → README 写明「对象库是副本不是源头，手机才是源头」。
8. 部署顺序：**先部服务端**（对 Build 69 及更早的 App 完全向后兼容）→ 探反代 → 再派发手机包。

**零知识与密钥**
9. 主密钥 K = 16 字节随机，**必须用 `expo-crypto` 的 `getRandomBytes(16)`**（Hermes／RN 0.86 没有 `crypto.getRandomValues`，`@noble/ciphers` 的 `randomBytes` 与 `@scure/bip39` 的 `generateMnemonic()` 在真机上都会失败）；存 SecureStore `anan-backup-key-v1`（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`），展示为 12 词 BIP39（`entropyToMnemonic`，默认英文词表，简体中文词表一行可换）。
10. `K_enc = hkdf(sha256, K, undefined, "anan-backup-v1/enc", 32)`；`keyId = sha256(K)` 前 16 hex，随远端数据存，换错恢复码在下载前就能判出。
11. 每素材 nonce 前缀 **确定性派生**：`hkdf(sha256, K, undefined, "anan-nonce-v1/"+媒体sha256, 20)`（内容寻址下同 key 同 nonce 对应恒定明文，不构成复用；换来断点续传不存 nonce、重装后对象 id 一致、Build 71 两台设备算出同样 id）。
12. 服务端永远不接触明文、密钥、文件名；能看到的只有对象大小分布与时间。密钥只经恢复码离开手机，绝不写进 Library、日志、剪贴板或分享面板。

**宪法与边界**
13. `verify-local-boundary.py` 重构为可导入的 `local_boundary.py` + 瘦包装 + `test_local_boundary.py`；`fetch(` 白名单 = {`src/ai/client.ts`, `src/sync/transport.ts`}；`serverUrl`／`credentials` 两个子串在每个文件里仍禁止（注意 `fetch(url,{credentials:…})` 都不能写）。
14. 服务地址字面量搬到 `src/local/brand.ts` 的 `SERVICE_URL`，校验脚本改为断言它在 brand.ts；`ai/client.ts` 与 `sync/transport.ts` 都 import 它。
15. 新增可执行宪法：`src/local/**` 只有 `App.tsx` 与 `Settings.tsx` 允许 import `../sync/`。
16. `AGENTS.md` 加一句：「备份传输只走 `src/sync`；`src/local` 不得联网；远端只存密文，密钥只以恢复码形式离开手机。」
17. DESIGN.md 第 55 行「普通记录流程不出现服务器、上传队列或同步占位入口」不放宽：远端 UI 只在「我的 → 备份与恢复」末尾一张卡与恢复码页。

**数据安全不变量**
18. blob 写入 `<sha256>.part` →（长度 + sha256 双验）→ `rename`；已存在且长度对的跳过；异常删 `.part`。
19. 恢复／导出任一素材缺失或哈希不符 → 整份失败不写半成品；中途停止删临时文件。
20. 本机 GC 只删「所有保留清单并集之外」的 blob；**任一保留清单读不出来就本轮不 GC**。
21. 远端 prune 只删「不在 keep 且创建超过 1 小时」的对象。
22. 远端恢复复用本机闭环：远端 → 写 blob 库 + `.xmbm` → 交给现有 `restoreBackup`／`recoverStartupBackup`，不新开第二条恢复路径、不产生 2× 缓存。

**兼容与格式**
23. `.xmb` 单卷在装得下时与 Build 68 **逐字节一致**（不写 `set` 字段）；v1/v2 旧备份继续可恢复。
24. 清单魔数 `XIAOMEI3`，meta 与 v2 同形（仍 `version: 2`），`decodeMetaV2`／`decodeLibraryV2` 原样复用。
25. **分卷每一卷都写同一份全集 `blobs`**（`decodeLibraryV2` 强校验 blobs 与库内素材一一对应），`set:{id,index,count,from,take}` 指明本卷承载区间；绝不把一个 blob 劈成两卷。
26. `.xmbm` 与分卷 `.xmb` 是 Build 70 起才认识的格式 → CHANGELOG 降级警告；`local_fixture.py` 的 `read_backup`（第二个独立读取器）与 `smoke-ios-regression.py:62` 的 glob 必须同步。
27. 素材文件名、缩略图、SQLite 结构不动；Library 不新增远端字段（同步状态在 `anan-v1/sync/state.json`）。

**前台上传与性能预算**
28. 安卓 `blockedPermissions` 含 `ACCESS_NETWORK_STATE`、`expo-network` 被宪法禁止 → 不做连通性探测，只靠请求失败反馈；上传只在前台跑，带「停止」，按对象续传；进度写在主按钮标题里，错误是卡内一行红字。
29. 明文分块 1 MiB，每对象 ≤ 4 块（≈ 4 MiB），服务端硬上限 8 MiB；素材按 256 KiB 读、每块 `await tick()`；内存 ≤ 1 明文块 + 1 对象缓冲。
30. 清单不走整包：清单本体切成普通对象上传，`PUT /manifest` 只传 < 64 KiB 的密文索引（keyId、对象 id 列表、字节数、时间）。
31. 纯 JS XChaCha20 在 Hermes 上可能只有个位数 MB/s：记录 Node 端 64 MiB 基准；首次真机实测 MB/s 写进 HANDOFF；对象头留 1 字节 `alg`，若 < 5 MB/s 可换 `expo-crypto` 自带的原生 AES-256-GCM 而不换格式。

**测试策略**
32. 纯函数（格式、分卷规划、密码学、planner）零 mock 单测；IO 层沿用 vitest expo-file-system fake（需补 `Paths.cache`、`availableDiskSpace`、`handle.offset` setter、目录识别；`local-backup.test.ts:686,688` 的 `readdirSync` 计数改按扩展名过滤）。
33. `transport.ts` 用 `tests/ai-client.test.ts` 的 fetch-stub 模板；`engine.ts` 用内存假 transport；**一条真 e2e** `mobile/tests/sync-e2e.test.ts` 拉起真实服务端子进程跑「开启→上传→验证→远端恢复」（CI 的 `local-quality` 作业多跑一次 `server` 的 `npm ci`）。
34. 服务端测试沿用 `new Store(':memory:')` + `app.inject()`，文件用 `mkdtempSync`（`provider.test.ts` 模式）。

## 二、提交概要（21 个，展开细节见开工时的 PLAN-BUILD-70.md）

| 组 | 提交 | 要点 |
| --- | --- | --- |
| 地基 | 1 宪法重构 | `local_boundary.py` + 测试 6 例；`SERVICE_URL` 进 brand.ts；AGENTS 新句 |
| | 2 格式层 | `BACKUP_MAGIC_V3`、`VOLUME_LIMIT`=2 GiB、`BackupSet`、`setId`、`planVolumes`（纯函数，`tests/backup-format.test.ts`） |
| | 3 文件层与夹具 | `files.ts` 导出 `CHUNK`、`blobDirectory`、`blobFile`；两处 vitest fake 补齐 |
| 本机 blob 库 | 4 写入侧 | `createBackup(state, onProgress?, signal?)` 增量：已有 blob 跳过、`.part`→双验→rename、写 `.xmbm`、`verifyManifest` |
| | 5 读回侧 | `inspectBackup(file \| File[])` 按魔数分发；`.xmbm` 恢复；`App.tsx` 启动救援候选并集 |
| | 6 保留与回收 | `pruneBackups` 合并 `.xmbm`/旧 `.xmb`；`collectBlobs()` 保守 GC；`listLocalBackups()` 给备份页 |
| | 7 夹具与冒烟 | `local_fixture.py` 认 `XIAOMEI3` 并 seed 一份清单 + blob；iOS 冒烟核对 blob 文件名 == 内容 sha256 |
| 分卷 | 8 从 blob 库拼 `.xmb` | `backup-export.ts`：`planExport`、`writeVolume`（单卷逐字节同旧格式）、`purgeExports`、`assertExportSpace` |
| | 9 多卷读取 | 乱序／缺卷／混选校验；`DocumentPicker multiple:true` |
| | 10 备份页导出 | 逐卷「保存第 1 卷／共 3 卷」状态机（`Sharing.shareAsync` 一次一个 URI），进度 + `backup-stop` |
| 服务端 | 11 对象库与路由 | `backup-store.ts`（流式 receive/read/remove/manifest/wipe/statfs/sweepTemp）；表 `backup_objects`、`backup_manifests`、列 `backup_limit_bytes`；路由 `GET /backup/status`、`POST /backup/objects/have`、`PUT/GET /backup/objects/:id`、`PUT/GET /backup/manifest`、`POST /backup/prune`、`DELETE /backup`（成员删自己的）；~10 例测试 |
| | 12 主人视角与部署 | overview 含备份字节；`PATCH` 配额；`DELETE /admin/members/:id/backup`；`manage.ts wipe-backup`；`verify-service.py` 加备份段；`deploy/README.md` 新节（路径、配额、反代三行、`backup.sh` 不覆盖对象库） |
| 手机端远端 | 13 密码学 | `src/sync/crypto.ts`：对象格式 `ANANOBJ1 \| alg \| keyId \| sha256 \| prefix \| first \| count \| final \| [len+ct]×n`，AAD 绑 sha256+块序+final；`sealManifest`/`parseManifestIndex`；`mnemonicOf`/`keyFromMnemonic`；新增依赖 `@noble/ciphers`、`@scure/bip39`（`npm ls @noble/hashes` 确认只有一份） |
| | 14 状态与规划器 | `state.ts`（`state.json` + SecureStore 钥匙）、`planner.ts`（`planUpload`、`objectsOf`、`progressLabel`） |
| | 15 传输层 | `ai/session.ts` 抽出 token 读写（`client.ts` re-export）；`sync/transport.ts` 唯一第二个 `fetch(`，115 s 超时、`SyncError` 映射 |
| | 16 引擎：备份 | `runRemoteBackup`：ensureKey → status(keyId 校验) → planUpload → have → 逐素材 seal/put → 清单对象 + 索引 → prune → 写 state |
| | 17 引擎：恢复 | `restoreFromRemote(key)`：索引 → 清单对象 → 逐素材下载解密写 blob 库（已存在跳过 = 断点续传）→ 写 `.xmbm` → 交给 `restoreBackup` |
| | 18 UI | `sync/RemoteBackupCard.tsx`（`remote-card`，备份页最后；未登录／未开启／已开启三态；「现在备份」「查看恢复码」(应用锁开启时先生物识别)「验证远端备份」「从远端恢复」「关闭远端备份」(保留／删除两路)）；`sync/RecoveryCode.tsx`（show／enter）；路由 `RecoveryCode`；冒烟离线断言 `remote-card` + `去登录` |
| | 19 端到端 | `tests/sync-e2e.test.ts` 真服务端子进程；CI 多装一次 server 依赖 |
| 收尾 | 20 文档与构建号 | CHANGELOG「Build 70 — 传家 · 中」+ 降级警告；README；HANDOFF；PLAN 归档；app.json 70 |
| | 21（可选） | `mobile-build.yml` 加 `release_tag` → GitHub Release（解决 artifacts 30 天过期） |

## 三、开工第一天（Build 70）
1. `git pull --ff-only`，查 main CI；把本部分展开成 `docs/plans/PLAN-BUILD-70.md`（含上表每项的函数签名与测试清单）。
2. 先做提交 11–12 并部署服务端，跑 `verify-service.py`；随后用一次性 token 探反代：4 MB PUT 期望 200，9 MB PUT 期望**我们的** JSON 413；不符则改 nginx 三行后重探。
3. 再做手机端，最后一起派发一个包；首个真机版记录加密 MB/s。

## 四、Build 71「家人一起记」（一句话）
第二台设备登录同一家庭账号，输入恢复码后从远端清单拉全量；记录 last-writer-wins（revision + updatedAt），媒体按 sha256 增量；只在同一记录两端都改时提示冲突。前置：70 的远端对象与清单；改 `Library` 加设备 id 前先出 `PLAN-SHARING.md`。明确不做：实时协作、云端搜索、第三方云盘、人脸识别。
