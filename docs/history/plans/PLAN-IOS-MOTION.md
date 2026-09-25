# 桉桉成长记 · iOS 转场、动效与 Liquid Glass 打磨

> **历史记录**：2026-09-24～25 的 iOS 动效打磨：M0–M5 交付于 1.1.3，第九节（面板下拉、按压）交付于 1.1.4。原生手感待测项已并入验收清单。正文保留当时的状态、命令与待办，不代表现在。当前范围见 [PRODUCT](../../../PRODUCT.md)，交付状态见 [HANDOFF](../../../HANDOFF.md)，全部历史文档见 [索引](../README.md)。

> 2026-09-24 起草，按主人给的执行计划逐条对过 `main` 的代码与锁文件后落地。起点 HEAD：`5a60718587de1ef9c58fdc577a8e7703a0987a9c`（工作区干净，与 `origin/main` 一致；main 最新 CI `36021675477` 绿）。
> 性质：已有移动端的体验打磨，不增加业务功能、不重写导航、不改数据／存储／同步／加密／备份／AI 行为。
> 边界：本轮不打标签、不改版本号、不派发 `mobile-build.yml`、不部署、不改模型、不做付费 AI 调用、不用家庭真实资料。
> 目标一句话：**纸面负责阅读，Liquid Glass 负责操作，连续且可中断的转场负责连接两者。**

## 一、M0 盘点（对代码核实）

### 1. 安装版本（`mobile/node_modules/*/package.json`）

| 依赖 | 版本 | 本轮相关的事实（按安装版本源码／类型核对） |
| --- | --- | --- |
| react-native | 0.86.3 | `AccessibilityInfo.isReduceMotionEnabled()` 与 `reduceMotionChanged` 事件可用 |
| expo | 57.0.25 | — |
| @react-navigation/native-stack | 7.18.10 | `animation`、`fullScreenGestureEnabled`、`gestureEnabled`；`animationTypeForReplace` 类型注释写默认 `pop`，实际代码默认 `push`（`NativeStackView.native.tsx:106`）；`usePreventRemove` 生效时给 iOS 原生栈设 `preventNativeDismiss`，侧滑被原生拦下后走 `beforeRemove` |
| react-native-screens | 4.26.2 | `default`／`flip` 以外的动画在 iOS 都是自定义 animator（`RNSScreenStackAnimator isCustomAnimation`）；**iOS 26 起 `fullScreenSwipeEnabled` 未设时默认 `YES`**（`RNSScreen.mm isFullScreenSwipeEffectivelyEnabled`），用系统 `interactiveContentPopGestureRecognizer`；`default`／modal 类转场时长不可配 |
| react-native-reanimated | 4.5.1 | `useReducedMotion()` 只返回**启动时**的系统设置（`src/hook/useReducedMotion.ts`），改设置不重渲染；Shared Element Transitions 仍需实验 flag |
| expo-glass-effect | 57.0.4 | 导出 `GlassView`（`glassEffectStyle` 可为 `{style, animate, animationDuration}`）、`GlassContainer`（`spacing`）、`isLiquidGlassAvailable`、`isGlassEffectAPIAvailable`（部分 iOS 26 beta 缺 API 会崩，官方建议使用前检查） |
| react-native-gesture-handler | 2.32.0 | Android 看原图的捏合／拖动 |

### 2. 现状

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 导航呈现 | 一个 Native Stack，25 个路由全部 `card`；`animation: reduceMotion ? "none" : "fade"`（build 54 的审美选择，不是修 bug） | `mobile/src/local/App.tsx` |
| iOS 返回手势 | 未设 `fullScreenGestureEnabled` → iOS 26 上整屏任意位置右滑都能返回（包括看原图、横向书架条、最近卡所在页） | 同上 + screens 源码 |
| 页头 | `headerShown: false`，`Page` 画 52 高页内顶栏 | `ui.tsx` `Page` |
| 退出守卫 | `Editor`、`LetterEditor` 用 `usePreventRemove` + `ExitGate`（操作中按返回先记着、录音时问保存或放弃、空草稿静默清理）；`AlbumDetails` 用 `usePreventRemove`；`FamilyScreen` 用 `beforeRemove` | `Editor.tsx:265`、`LetterEditor.tsx:216`、`exitGate.ts` |
| 减少动态 | 四处读 Reanimated `useReducedMotion()`（App、CaptureFab、Shelf 的三个组件），**只在冷启动生效** | — |
| 减少透明度 | `ui.tsx useReduceTransparency` 已监听 `reduceTransparencyChanged`，实时 | `ui.tsx` |
| 玻璃层级 | `Glass`（regular）+ `GlassDepth`：Card、页面直摆的胶囊按钮、`BottomBar`、记一刻、月册行；深度 ≥1 退实色；液态玻璃判断只用了 `isLiquidGlassAvailable()` | `ui.tsx`、`CaptureFab.tsx`、`Home.tsx` |
| 按压 | 书架小封面 0.94、年度册月册 0.96、记一刻 0.92 且与原生 `isInteractive` 叠加；弹簧 `damping 14 / stiffness 220`（阻尼比约 0.47，偏弹） | `Shelf.tsx`、`CaptureFab.tsx`、`ui.tsx PRESS_SPRING` |
| 进场动画 | 书架小封面、提醒卡、最近卡 `FadeInUp`（玻璃卡在 iOS 已跳过）；年度册月册 `Volume` 在**被 push 进来的**年度页上逐个 `FadeInUp` | `Shelf.tsx`、`Year.tsx` |
| 弹层 | AI 面板、选照片、装订预览都是 RN `Modal`（`slide`），`visible={… && !locked}`；AI 面板是 `transparent` + 暗色蒙层，蒙层跟着面板一起从底下滑上来 | `ai/Editor.tsx`、`PhotoPicker.tsx`、`BookPreview.tsx` |
| 应用锁／隐私遮挡 | 锁与 iOS 多任务纸面遮罩是主窗口里 NavigationContainer 之后的一层 View；RN Modal 自成窗口画在它上面：锁住时 Modal 收起，但**iOS inactive 的纸面遮罩盖不住已打开的 Modal**（多任务界面里 AI 面板照常露出） | `App.tsx`、`lock.ts` |
| 封信 | 确认后 `flush → sealLetter → leave → navigation.replace("Letter")`（replace 走 push 动画）；没有成功反馈 | `LetterEditor.tsx:259` |
| 看图 | iOS 用 ScrollView 原生缩放，Android 用 RNGH 捏合／拖动 | `Media.tsx` |

**与主人计划的出入（需要主人知道）：** 计划把「信纸」列为保持纸面，但编辑页与写信页那张「纸」（`editor-sheet`、`letter-sheet`）以及阅读卡目前都是 `Card`，在 iOS 液态玻璃下是 regular 玻璃。本轮不改（会改变主人已在真机上认可的整页观感，属于重设计）；若要严格执行「纸面负责阅读」，建议下一轮给 `Card` 加实色纸面选项，先在写信页做真机对比再定。

### 3. 基线

- 手机 `vitest` 58 文件 830 项、`tsc`、`eslint` 全绿（`TMPDIR=/var/tmp/anan-tests`）；服务端未动。
- **没有 iOS 模拟器或真机**（Linux 开发机）。改前／改后原生录屏做不了；原生截图只能靠 `mobile-build.yml` 的 iOS 回归，而派发它不在本轮授权内。网页预览（react-native-web）不能代表原生转场、玻璃或手势，只用于排版自查，不作验收。

## 二、参照物 → 本项目 → 实现

| 参照 | 借什么 | 本项目落点 | 不借 |
| --- | --- | --- | --- |
| R1 Meet Liquid Glass（WWDC25 219） | 内容层／操作层分开；按压由材质自身反馈；不玻璃叠玻璃 | 记一刻、底栏、胶囊按钮沿用 `Glass` regular；玻璃按压交给系统 `isInteractive`；运行时 API 检测 | 整页玻璃、clear 玻璃、给正文加折射 |
| R2 Build a UIKit app with the new design（284） | 面板与触发处的关系、玻璃控件分组 | AI 面板开合、焦点回到触发钮 | 新底部标签栏；把设置／长表单塞进半屏；把 UIKit 能力当成 RN 已有 |
| R3 Enhance your UI animations and transitions（WWDC24 10145） | 层级推进要有方向；zoom 需要真实来源对象 | 普通路径改回平台默认 push；书册 zoom 只做可行性记录 | 每次跳转都 zoom；照录像（半速）定时长 |
| R4 Designing Fluid Interfaces（WWDC18 803） | 立即响应、可打断、可回头 | 侧滑返回可中途撤销；面板收放可被反向打断；按压不等回弹 | 锁住页面播完动画 |
| R5 Expo GlassEffect | `isGlassEffectAPIAvailable`、`isInteractive` | `liquid` 同时要求编译可用、运行时 API 可用、未开减少透明度 | 用 `GlassContainer` 合并控件（目前没有需要合并／展开的同组玻璃控件） |
| R6 Native Stack | `animation: "default"`、`animationTypeForReplace`、`fullScreenGestureEnabled` | 见第三节 | 给不可配置的原生动画套统一毫秒 |
| R7 usePreventRemove | 复用现有守卫 | 不新增任何退出状态机 | — |
| R8 Reanimated SET | — | 不开实验 flag | 生产路径用实验共享元素 |
| R9 useReducedMotion | 只读启动态 → 自己订阅系统事件 | `ui.tsx` 主题里实时的 `reduceMotion` | — |

## 三、转场分配与决定

| 场景 | 决定 | 理由／降级 |
| --- | --- | --- |
| 所有普通路径（书架 → 年／月／专题册 → 记录、设置及子页、家庭、备份、外观、信、看图） | `animation: "default"`（iOS 原生层级推进，Android 平台默认）；减少动态时 `none` | 原生转场可被侧滑中途撤销；页内顶栏不变。fade 期间原生容器透明度 < 1，与「玻璃祖先不能透明」的已知问题同源，改 push 顺带避开 |
| iOS 返回手势 | 全局 `fullScreenGestureEnabled: false`：只留左边缘侧滑 | 计划要求不全局开整屏返回；避免与看原图拖动、横向书架条、最近卡、正文选字冲突。代价：iOS 26 上「屏幕中间右滑返回」不再生效 |
| 写记录、写信 | **保留原栈（card + 平台默认 push）**，不改 `modal`／`formSheet`／`fullScreenModal` | 阻断项成立：原生 modal 由 UIKit 呈现在 RN 根视图之上，主窗口里的应用锁与 iOS 多任务遮罩会被它盖住；编辑页还会 `popTo("Record")`、写信页 `replace("Letter")`，跨呈现方式替换更难验证。退出仍全部走现有 `usePreventRemove` |
| 短选择器 | 不改成原生 sheet；试点对象是现有 AI 底部面板（受控 RN Modal） | 原生 formSheet 同样在锁之上；把回调型选择器改成路由会改导航结构。改良：蒙层淡入、面板上滑、收放可反向打断、关闭后读屏焦点回到「AI」钮 |
| 已打开的 Modal 与隐私遮挡 | Modal 里补一层同样的纸面遮罩，跟随 iOS inactive | 修复第一节列出的露出问题，不改变锁的时机 |
| 看原图 | 不动缩放逻辑 | 只受益于关闭整屏返回 |
| 书册／照片 zoom | 只做可行性记录（第五节），不进正式路径 | — |

## 四、动效起点（项目自定，不是 Apple 规格）

| 项 | 值 | 说明 |
| --- | --- | --- |
| 纸面按压 | `scale 0.97`，弹簧 `damping 22 / stiffness 320`（阻尼比约 0.6） | 书架小封面、年度册月册、记一刻的纸面退化形态；点击不等回弹 |
| 玻璃按压 | 只用系统 `isInteractive` | 记一刻在液态玻璃下不再叠 0.92 缩放；真机若觉得太弱，再 A/B「原生 + 0.98」 |
| 面板开 | 240 ms，ease-out | 蒙层淡入 + 面板上移，同一进度值驱动，可反向打断 |
| 面板收 | 200 ms，ease-in | 收完才卸下 Modal；途中重新打开就从当前位置回去 |
| 封信 | 约 440 ms，单次 | 纸面轻微收拢 + 印章落定；只在写入成功后的那一次进入 |
| 原生 push／replace | 平台默认 | 不配时长 |
| 减少动态 | 以上全部取消 | 状态文字、读屏播报、触感照旧 |

## 五、里程碑与拟改文件

| 阶段 | 内容 | 拟改文件 | 收益 | 风险／降级 |
| --- | --- | --- | --- | --- |
| M1 | 实时减少动态；动效 token；全局 `default` 转场；关整屏返回；年度页去掉与 push 叠加的逐个进场 | `ui.tsx`、`App.tsx`、`CaptureFab.tsx`、`Shelf.tsx` | 有方向的层级、可撤销侧滑、减少动态改设置即生效 | 原生转场只能真机验；若某页 push 时玻璃闪烁，单页退回 `fade` |
| M2 | 运行时玻璃 API 检测；记一刻玻璃按压只用原生反馈；纸面按压统一 0.97 | `ui.tsx`、`CaptureFab.tsx`、`Shelf.tsx` | 按压不再过重；老 beta 不崩 | 真机 A/B 未做 |
| M3 | AI 面板开合改良与焦点回归；Modal 隐私遮挡 | `ai/Editor.tsx`、`ui.tsx`、`lock.ts`、`App.tsx`、`PhotoPicker.tsx`、`BookPreview.tsx` | 蒙层不再整块滑动；多任务不露面板 | Modal 仍在锁之上，锁住时照旧收起 |
| M4A | 封信反馈：写入成功后的一次「收拢 + 落定」+ 成功触感 + 读屏播报 | `navigation.ts`、`LetterEditor.tsx`、`LetterScreen.tsx` | 封存有仪式感且不超前 | 路由参数只作一次性提示，读取后清掉；不影响信的状态 |
| M4B | 书册／照片 zoom 可行性 | 本文件 | 结论明确 | 不写生产代码 |
| M5 | 门禁、边界脚本、Python 工具测试；列出原生待测项 | `DESIGN.md` 动效小节、本文件 | — | 原生验收待真机／`mobile-build.yml` |

## 六、M4B 书册／照片 zoom 可行性（只做记录）

- **原生 zoom（iOS 18+ `preferredTransition = .zoom(sourceViewProvider:)`）**：react-native-screens 4.26.2 没有暴露这个能力（`stackAnimation` 枚举里没有 zoom，源码里没有 `preferredTransition`）。要用就得写原生桥接：在 push 前把来源视图（书架小封面的原生 view）交给目标 `UIViewController`，并处理列表复用、来源离屏、返回时来源已变的回退。这属于较大的原生桥接，本轮止于记录。
- **Reanimated Shared Element Transitions**：4.5.1 仍需实验 flag（`ENABLE_SHARED_ELEMENT_TRANSITIONS`），且官方标注不建议生产使用；计划禁止在正式构建开启。不做。
- **JS 自绘 zoom（在书架上方画一张封面放大后再 push）**：会与原生 push 叠成两套位移，侧滑返回时没有对应的缩回，违背「可打断、可回头」。不做。
- 结论：维持原生 push；等 react-native-screens 暴露 zoom 或主人同意做原生桥接时，再按「稳定 ID 取来源 → 来源不可见就退回默认 push」的规则单独立项。

## 七、M5 验收清单（原生部分待测）

本机能跑的：手机测试、类型检查、Lint、网络边界脚本、Python 工具测试，服务端测试与类型检查。

原生待测（真机或 `mobile-build.yml` 的 iOS 回归；两者本轮都没有）：

| 类别 | 情形 | 合格标准 |
| --- | --- | --- |
| 连续操作 | 书架 → 年度册 → 月册 → 记录 → 返回；侧滑一半松手；连点入口 | 无空屏、无重复栈、页内顶栏不闪 |
| 返回手势 | 看原图放大后左右拖；书架横条、最近卡左右翻；编辑页正文拖选 | 不触发返回；左边缘侧滑仍能返回 |
| 草稿 | 空草稿侧滑、已输入侧滑、录音中侧滑、保存中侧滑、保存失败 | 沿用原有提示与去处，不丢字、不重复写 |
| 玻璃 | 记一刻按下、忙碌；页面 push／pop 中途 | 玻璃不消失、不只剩图标 |
| 减少动态 | 进应用后到系统设置里切换再回来 | 立刻变为无转场、无按压缩放、无封信动画 |
| 减少透明度 | 同上 | 退回纸面 |
| AI 面板 | 请求中收起再开；快速连点开／收；读屏关闭后焦点 | 任务保留、无多发请求、焦点回到「AI」钮 |
| 隐私遮挡 | AI 面板、选照片、装订预览打开时上划进多任务；开锁时切后台 | 多任务卡片只见纸面；锁盖住一切 |
| 封信 | 成功、失败（如拆封日已过）、动画中返回、再次进入 | 只在成功后播一次；再次进入不播 |
| 可达性 | 320／390 宽、浅深色、大字、键盘 | 主要操作可达，短页不回弹 |

## 八、实施结果（2026-09-24）

| 阶段 | 提交 | 实际完成 | 改动文件 |
| --- | --- | --- | --- |
| M0 | `61fd4c4` | 本文件：盘点、参照对应、分配表、降级路线 | `docs/plans/PLAN-IOS-MOTION.md` |
| M1＋M2 | `1bdeb50` | 全局 `default` 转场、`fullScreenGestureEnabled: false`；主题里实时的 `reduceMotion`，并用 `ReducedMotionConfig` 让 Reanimated 全局跟着变；`MOTION` token；`usePressScale`（0.97）；记一刻玻璃只用原生按压；`liquid` 加 `isGlassEffectAPIAvailable()`；年度册月册去掉逐个进场 | `ui.tsx`、`App.tsx`、`CaptureFab.tsx`、`Shelf.tsx`、`Year.tsx` |
| M3 | `7c48530` | `SheetModal`（AI 面板）与 `PrivacyCover`（AI 面板、选照片、装订预览）；`ToolButton` 可接 `ref` 用于还焦点 | `ui.tsx`、`lock.ts`、`App.tsx`、`ai/Editor.tsx`、`PhotoPicker.tsx`、`BookPreview.tsx`、`tests/ai-editor.test.ts`（只改 mock） |
| M4A | `de4e823` | 封信成功触感、一次性 `sealed` 参数、等 `transitionEnd` 后落印、「封好了」与读屏播报；原生冒烟断言改为「封好了」＋重启后「还没到日子」（顺带验证不重播） | `navigation.ts`、`LetterEditor.tsx`、`LetterScreen.tsx`、`smoke-android.py`、`NativeRegressionTests.swift` |
| M4B | — | 只做可行性记录（第六节），没有生产代码 | — |
| M5 | 本次文档提交 | `DESIGN.md`「动效与转场」、`CHANGELOG.md` 未打包条目、`HANDOFF.md` 待验事项 | — |

**正式启用：** 平台默认 push、仅边缘侧滑、实时减少动态、运行时玻璃检测、纸面 0.97 按压、记一刻原生玻璃按压、AI 面板受控开合与焦点回归、Modal 隐私遮挡、封信落印。

**降级（有意不做）：** 写记录／写信的原生 modal 与 formSheet（锁层阻断）；短选择器改原生 sheet（同上，且需改导航结构）；`GlassContainer`（没有需要合并的同组玻璃控件）；clear 玻璃；AI 面板下拉手势关闭（需要在 Modal 里另起手势根，本轮不扩）。

**只做可行性：** 书册封面／缩略图 zoom（第六节）。

**验证：** 每次推送前手机 `vitest` 830/830、`tsc`、`eslint`、`verify-local-boundary.py`、Python 工具测试 45/45 通过；服务端 217/217 与类型检查通过（服务端未改）。`SheetModal` 的开、收、收到一半折回、收完卸下，用 react-native-web + Reanimated（带 worklets Babel 插件）在 Chromium 里跑过一遍，只算逻辑自查。

**原生验证构建（主人 2026-09-25 授权）：** [run 36077177631](https://github.com/YePiXpert/family-time-capsule/actions/runs/36077177631)（`a826196`）与 [run 36078927083](https://github.com/YePiXpert/family-time-capsule/actions/runs/36078927083)（`92df6f7`，含 Astra 脚注）七个必需作业全部成功，build-source、安卓与 iOS 报告源码均等于完整 SHA。iOS 26.5 模拟器（iPhone 16e）完整回归两项与启动 9 项通过，新断言「封好了」→ 重启后「还没到日子」通过；安卓冒烟 320／390 通过。截图看到：封存截图正处在原生推进中途（写信页左移、信页右进，印章位置空着等转场停稳）；重启后印章静态、不重播；AI 面板蒙层与面板正常，脚注为「由 GPT-6 Astra 提供」。版本沿用 1.1.2 / 84，只作验证。

**仍没有做到的：** 改前／改后原生录屏、真机帧率，以及第七节里截图验不了的项（侧滑中途撤销、玻璃按压手感、减少动态实时切换、多任务遮挡、读屏焦点）——需要真机。

**其他发现：** AI 面板脚注原写「由小米 MiMo 2.6 Pro 提供」，与已上线的 `gpt-6-astra` 不符；主人 2026-09-25 确认后改为「由 GPT-6 Astra 提供」（只改文案，不改模型与请求）。编辑纸／信纸在 iOS 是玻璃 Card（见第一节），是否改实色纸面待主人真机对比后定。

## 九、1.1.3 之后的调整（2026-09-25）

主人装上 1.1.3 后反馈「感觉没什么」，要求「面板可以下拉关闭，按压再明显一点」。

- 按压：纸面 `MOTION.pressScale` 0.97 → 0.95；记一刻玻璃在原生 `isInteractive` 之外叠 `MOTION.glassPressScale` 0.93（第四节「真机若觉得太弱」的预案）。
- `SheetModal` 下拉关闭：Modal 里另起 `GestureHandlerRootView`；拖拽区只有小横条和 `header`（AI 标题行），不接管下面的滚动区。手势认定拖拽（纵向 8）后才接管进度，点「收起」不会把正在打开的面板停在半路；松手时拉过 `dragClose`（0.25）或速度超过 `dragVelocity`（800）收起，否则弹回。减少动态时弹回不做动画，拖拽本身仍跟手。补了 `onAccessibilityEscape`。
- 自查：react-native-web 下拉 40 点松手弹回、160 点松手收起并回调 `onClose`；原生手感待真机。

