# 桉桉成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-23。**main 上有两批未打包的改动**：首页整理（`a973c21`／`864124e`／`510d835`，CHANGELOG 顶节「未打包 — 首页整理」；两端冒烟都已绿）与出包流水线第二轮提速（`ec60d63`：源提交核对独立成作业、两个 iOS 构建接入 ccache；`8f5c03f`：安卓冒烟点掉别的应用的无响应框；`a7ea727`：修 ccache 接法）。`a7ea727` 的冷编验证 [run 35822132750](https://github.com/YePiXpert/family-time-capsule/actions/runs/35822132750) **全绿**（25.5 分钟，基线 29.9；ccache 已接通，两把缓存键已存下）；热缓存测速 [run 35827094155](https://github.com/YePiXpert/family-time-capsule/actions/runs/35827094155)（源码 `5fd8ec4`）两个 iOS 构建 466／466 全部命中，xcodebuild 模拟器 2.9 分钟、真机 2.4 分钟，全程 17.7 分钟；但 iOS 回归两次都红、都与缓存无关：首轮红在 XCUITest 重启应用超时（模拟器系统启动链卡了约 60 秒，与 1.0.3 首轮同类），重跑的 attempt 2 红在首个断言（应用 20 秒内还停在开本机库的启动转圈上）。主人说「一起做吧」，`6f1310a` 一并做了三件事：回归只对「Timed out attempting to launch app」重装重跑一次、每次启动先等最多 120 秒开完本机库；两组 iOS 验证与模拟器构建同时起跑、先建好并热身模拟器；安卓 CMake 原生编译接 ccache。验证 [run 35832730488](https://github.com/YePiXpert/family-time-capsule/actions/runs/35832730488)（源码 `6f1310a`）**一次全绿**：iOS 这一路 16.7 分钟跑完（回归没用上重跑，首次启动 63 秒→2 秒），全程 22.1 分钟，最后结束的是 Android（21.8 分钟，其中 Gradle 12 分 50 秒，各次在 8～13 分钟间波动）；安卓 ccache 首次冷编，598 次编译里 408 次因预编译头不进缓存。主人说「都做」，`ebc4d97` 让安卓预编译头也进 ccache（缓存键换 v2）、安卓冒烟复用同一屏的无障碍层级并打印分段耗时；验证 [run 35836515125](https://github.com/YePiXpert/family-time-capsule/actions/runs/35836515125) **一次全绿，全程 17.6 分钟**（基线 29.9）：安卓 16.3 分钟（Gradle 9 分 14 秒，598 次编译全部可缓存、原先的 190 次全命中；冒烟 6.1→4.4 分钟、dump 71 次），最后结束的是 iOS 回归（17.2 分钟，XCUITest 这次 505 秒）。为验证预编译头缓存命中时构建照样正确，已派 run RUN_NEXT（第一节第一条）；可安装的仍是 1.0.3（第一节）。
> 旧记录：2026-09-22。**1.0.3（构建号 76）已交付；服务端 1.0.3 已部署生产**：主人 2026-09-22 拍板发版＋部署一条龙；发版提交 `8be3a46731b56f17fec0bdbb8aa12575ddefc96b`（`mobile/app.json` 1.0.3／构建号 76、服务端减法、CHANGELOG 顶节、README、本文；Fable 复核、门禁全绿后提交），轻量标签 `v1.0.3` 指向它，标签推送触发 run 35736146539（13:50 UTC，<https://github.com/YePiXpert/family-time-capsule/actions/runs/35736146539>）；首轮 iOS 回归启动超时；attempt 2 重跑后全部作业成功，[GitHub Release v1.0.3](https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.0.3) 已发布，双端包、源码与校验和已下载核对（详见第一节）；两台真机验收仍待完成。服务端同一提交已于 13:52 UTC 切到生产（镜像 `anan-ai:8be3a46…`，本机与公网 healthz 版本一致，账号／设备／设置／清单逐行保留；staging 五模式＋转写真实验证通过；证据与回滚材料在 `/opt/anan-ai/deployments/20260922-1.0.3-reduction/`），1.0.2 手机的分组／起个头／写信引导从此得到 400／404，其余功能照旧。
> 旧记录：2026-09-22。**1.0.2 已交付；AI 服务已切到 MiMo V2.6 Pro**：生产源码 `e2bd07fe77f5b185257ef1fc255462245a4d1577`，文字／看图为 `mimo-v2.6-pro`，云端转写为 `mimo-v2.5-asr`，使用主人指定并提供密钥的中国 Token Plan 地址；八模式和 ASR 合成样例验证通过，账号／设备／额度／备份保留。部署与回滚记录见第一节及 `docs/MIMO-ADAPTATION.md`。安装包仍为 `v1.0.2`，此次服务切换未重新出包。
> 旧记录：移动端状态 2026-09-22（减法）。**1.0.3「减法」已在 main、未出包**：主人拍板「不要冗余，贪多嚼不烂」，拿掉出生的故事（24 问并入小问题）、写信引导、时光系列、足迹、年度长图、重放、分成几件事／按事情分组、起个头，AI 不再看照片；提交 `8f36df0`…`feebcec` 与文档收尾提交（第一节第一条）。可安装的仍是 1.0.2（下一条）；本次减法未改服务端；后续模型部署见上。验证出包见第一节第一条。
> 旧记录：2026-09-22。**1.0.2 已交付**：发版提交 `c8adcde33302c2bbc576463773ac6cf26426b10e`，轻量标签 `v1.0.2`，run 35691714051 四作业全绿，GitHub Release 上有 APK／未签名 IPA／`build-source.json`／`sha256sums.txt`（第一节第一条）。服务端仍是 `b76439d` + DeepSeek（MiMo 适配未部署，见第一节「MiMo 内容模型适配」）；两台真机的验收仍未做。主人随后把出包流水线并行化（`300b12e`），首次 dispatch 的 iOS 回归红（脚手架超时，录音其实已开始），「说完了」等待放宽到 120 秒后，验证 run 35701034621 已全绿，总耗时约 32 分钟；本轮继续优化测试等待，实测结果待新验证构建（第一节第二条）。
> 旧记录：2026-09-22。**1.0.2（构建号 75）发版中**：主人复核后拍板发版；发版提交在 main（`mobile/app.json` 1.0.2／构建号 75、CHANGELOG 顶节「1.0.2」并入 1.0.1 内容与复核修复、README 当前版本），轻量标签 `v1.0.2` 指向它。标签出包的结果与 Release 校验和待 run 完成后核对再补进第一节；**在那之前不要把 1.0.2 当作已交付**。
> 旧记录：2026-09-22。**1.0.1（构建号 74）没有交付**：Kimi 的界面焕新 `3c0b017`…`05e229f` 已在 main，附注标签 `v1.0.1` 触发 run 35679134876——quality／Android 绿、iOS 回归红（测试脚手架点在屏幕底边被系统吞掉，应用没有问题）、release 作业跳过，**没有 GitHub Release v1.0.1**，可安装的仍是 1.0.0（下一条）。同日复核修复 `a01a1d8`…`9476895`、脚手架修复 `6238119`／`ae2323d` 与键盘避让修复 `3638d96` 已推 main；验证出包 run 35681782720 又在 iOS 回归红（还是脚手架：续写时的光标点落在新工具栏的「文件」钮上），第三次验证 run 35686815546（workflow_dispatch，源码 `3638d96`）**三作业全绿**（quality／Android APK／iOS unsigned IPA；release 作业非标签触发、按设计跳过，仍没有 Release）。要交付 1.0.1 的内容需主人拍板再出包（第一节第一条）。
> 旧记录：2026-09-21。**1.0.0 已交付**：交付提交 `16300f2`，标签 `v1.0.0`，run 35607118819 四作业全绿，GitHub Release 上有 APK／未签名 IPA／校验和（第一节第一条）；**服务端 `b76439d` 已部署生产**（主人授权，2026-09-21 14:46 UTC）；可安装 1.0.0 做真机验收。此后不加新功能，只做优化（第四节）。
> 旧记录：2026-09-21 12:10 UTC。**Build 72「家人一起写」已交付**：源码 `7cdc42d`，run 35590928208 三作业全绿，校验和在第一节「Build 72 打包」；同日主人拍板**家史不做**，后续路线按模块缺口重排（第四节），Build 73「说一段」计划在 `docs/plans/PLAN-BUILD-73.md`（开工前待主人拍板五项）。
> 旧记录：Build 70「传家 · 中」已交付（源码 `7477504`，run 35494972998）；同日复查修了 4 笔（`dfdcad8`／`26e4e19`／`347200a`／`81d1ffe`），
> 服务端已切到生产（SOURCE_SHA `81d1ffe`）；**Build 71（复查修复版）已交付**：源码 `412f8e0`，run 35511463957 三作业全绿，APK／IPA 校验和在第一节；下一步 Build 72「家人一起写」。
> 2026-09-21 定位重述：新增 `PRODUCT.md`（不是相册，是一家人写给她的传家册；AI 从代笔改为访谈者与整理者），Build 72 改为「家人一起写」（落款先于同步），原 73「分享」不再单列——见第四节。主人同日拍板五项（PRODUCT.md 第九节）：落款用关系称呼、转写先本机后可用小米 MiMo 一类、「起个头」留着、App 一句话待选、1 与 2 都做；提示词整套在 `docs/AI-PROMPTS.md`。同日晚 `docs/plans/PLAN-SHARING.md` 起草完毕（落款 + 家庭对象空间 + 三方合并，16 个提交），主人当晚批准。
> **2026-09-21（Build 72 过程，已完成）**：Build 72「家人一起写」服务端已上线生产（`473339b`），手机端提交 4–12 已推 main（落款全链路 + 传输层认识全家清单 + 本机状态 v2 + 纯函数三方合并 + 同步引擎 `318274e` + 「家人一起写」卡／冲突页 `f552b95` + 自动同步 `4ee5eaa`）；同日插入一轮全项目审查（`306cee2`／`cebfe13`／`f71f86c`，见 `PROJECT-AUDIT.md`；**服务端那半边未部署**）；
> 提交 12b（`77b3cbe`）与 13（两台手机端到端、双端冒烟落款、宪法第 6 条：`63e1c14`）**已推**；13b（版本世系：`3b7925a`）与 15 扉页（`f99699f`）**已推**；14 收尾 `7cdc42d`（`mobile/app.json` 72），出包 run 35590928208 与校验和见第一节「Build 72 打包」。逐条交接见第三节的 Build 72 小节。

---

## 一、当前状态快照（2026-09-23）

- **出包流水线第二轮提速（2026-09-23，`ec60d63`／`8f5c03f`／`a7ea727`／`6f1310a`／`ebc4d97`；冷编、热缓存、`6f1310a`、`ebc4d97` 都已验证，安卓全热待查）**：主人要求继续压 CI 时间。拆 run 35729090883（`52b5f76`，29.9 分钟）：最长路径是 quality 1.9 分钟 → iOS 模拟器构建 16.5（其中 xcodebuild 14.1，几乎全花在 Reanimated 119／SVG 94／Screens 88／Codegen 42／Worklets 38 等约 450 个 C++／Objective-C++ 编译单元上；React Native 核心已是预编译）→ 两组 iOS 验证 10.8／11.2（模拟器冷启动 1.5～2.5 分钟，启动完成到 XCUITest 开跑 2.2～4.5 分钟，回归主用例 318～353 秒，启动冒烟首个场景 3.3 分钟）；Android 16.9（Gradle 8.2 + 模拟器冒烟 7.2）与 IPA 15.0 不在最长路径上。改法：
  - 新增「Package source」作业，只核对源提交在 main 上、写 `build-source.json`；Android／IPA／模拟器构建只等它，quality 与之并行；GitHub Release 仍要等 quality、全部构建和两组 iOS 验证。
  - 两个 iOS 构建装 ccache 4.14（钉版本与 sha256），在 xcodebuild 命令行上传 `CC=<绝对路径的 ccache-clang 包装脚本>`（配置与 React Native 自带的 `ccache.conf` 相同：depend 模式、modules／time_macros 等宽松；缓存目录与配置路径写死）。缓存键 = `package-lock.json` + `mobile/plugins/**` + `mobile/modules/**` + Xcode 构建号，**不设回退键**：依赖一变就完整冷编，杜绝拿旧模块头文件的假命中（modules 宽松模式察觉不到模块内部变化，系统头文件也不进清单）。构建前清零、构建后「Show compiler cache statistics」打印命中率。Swift 不走 ccache。
  - 两个 iOS 冒烟脚本打印安装、首次启动与 XCUITest 耗时，下一轮据此判断冷模拟器那几分钟花在哪。
  - 第一次验证 run 35815958870（源码 `8f5c03f`）：Android 绿（17.2 分钟，冒烟 7.3 分钟，这次没弹无响应框）；**两个 iOS 构建都红**，两个原因叠在一起：①`USE_CCACHE=1` 让 React Native 把整个 Xcode 工程的 `CC`／`LD` 设成 `$(REACT_NATIVE_PATH)/scripts/xcode/ccache-clang.sh`，而 `REACT_NATIVE_PATH` 靠 `PODS_ROOT` 拼出来；不走 CocoaPods 的分享扩展 `FamilyShareExtension` 没有 `PODS_ROOT`，路径变成 `/../../node_modules/…`，链接时 `unable to spawn process`；②Pods 里的编译其实也没进 ccache（统计全 0）：RN 的包装脚本读 `$CCACHE_BINARY`，Xcode 26 只把构建设置当环境变量传给脚本阶段，不传给编译任务，脚本退回直接调 clang。`a7ea727` 改为不用 `USE_CCACHE`，自写绝对路径包装脚本经命令行 `CC=` 传入（命令行设置对所有目标生效，含分享扩展；`CC` 管 C／C++／Objective-C／Objective-C++ 全部编译，Swift 与链接不经它）；本机用 `env -i` 与假 xcrun 跑过同一段脚本：首次未命中、再编命中、改头文件后未命中。先派的 run 35815781459（`ec60d63`）已取消。
  - 预期：缓存命中时总时长约 19 分钟；依赖一变，第一次冷编并存下新缓存。
  - 冷编验证 [run 35822132750](https://github.com/YePiXpert/family-time-capsule/actions/runs/35822132750)（源码 `a7ea727`）**全绿**，总时长 25.5 分钟（基线 29.9）：
    - ccache 已接通：两个 iOS 构建的「Show compiler cache statistics」都是可缓存 466／466、命中 0、未命中 466，没有 Uncacheable 项；`ccache-ios-simulator-17F113-…` 与 `ccache-ios-device-17F113-…` 两把键都已存下（缓存目录 0.4 GiB，上传约 87 MB）。
    - 零命中时 xcodebuild 也快了（模拟器 14.1→8.5 分钟，真机归档 12.6→9.9），不是机器差异：两次是同一镜像版本（macos-26-arm64 20260907.0351.1），C 系编译都是 466 个，但基线日志里有 71 个 ScanDependencies 与 444 个 PrecompileModule（Clang 显式模块），这次一个都没有——命令行传了 `CC=` 以后 Xcode 不再做显式模块构建，省掉了依赖扫描和模块预编译。这部分每次都有，冷编也有。
    - 最长路径变成：Package source 7 秒 → iOS 模拟器构建 10.7 分钟 → iOS 回归 14.1 分钟；quality（2.0 分钟）已不在路径上。回归作业里：建模拟器 47 秒、冷启动 144 秒、安装 22 秒、首次启动 63 秒、写入测试数据 81 秒、XCUITest 376 秒、收尾留证据 83 秒。启动冒烟作业 8.6 分钟（冷启动 100 秒，九个场景各 20～31 秒）。
    - Android 20.9 分钟（Gradle 12.0，基线 8.2，波动原因未查；冒烟 7.4），这次不在最长路径上；iOS 构建再压下来后它就是瓶颈。
  - 热缓存测速 [run 35827094155](https://github.com/YePiXpert/family-time-capsule/actions/runs/35827094155)（源码 `5fd8ec4`，与 `a7ea727` 只差文档，缓存键相同；06:30 UTC 派出）：
    - 两个 iOS 构建都是 466／466 全部命中（direct 模式），零未命中。xcodebuild 模拟器 2.9 分钟（冷编 8.5，基线 14.1），真机归档 2.4 分钟（冷编 9.9，基线 12.6）；模拟器构建作业 5.5 分钟，IPA 作业 3.8 分钟。全程 17.7 分钟，最后结束的是 Android（17.5 分钟）；回归若通过，估计全程约 19～20 分钟（基线 29.9）。
    - **iOS 回归红，与缓存无关**：`NativeRegressionTests.swift:75` 的 `app.terminate(); app.launch()`。终止 1 秒正常完成；随后模拟器的启动调用本身 30 秒才返回，新进程 31 秒后才出现，SpringBoard 约 60 秒后才把应用切到前台（录屏这段一直是模拟器桌面）。应用到前台后 5 秒就显示书架，但 XCTest 在约 83 秒时判「Timed out attempting to launch app」。xcresult 里没有本应用的崩溃报告；同一个 .app 在并行的启动冒烟里九个场景全过，本用例前 35 秒也都正常。与 1.0.3 首轮（run 35736146539，那时还没有 ccache）同类，都是终止后重新启动时卡在系统启动链上。主用例有 11 次重启、恢复用例 1 次，每次都要过这一关。
    - 已 `gh run rerun 35827094155 --failed`（attempt 2，复用这次热缓存编出的 .app）：**又红，换了一种**。setUp 的 `app.launch()` 8.5 秒就返回，首个断言（`:61`，20 秒内等 9 月月册）没等到：应用还停在开本机库的启动转圈上，40 多秒后的收尾截图仍是转圈。这次机器上开库用了约 45 秒；不是崩溃，不是缓存，同一个 .app 首轮的启动冒烟九个场景全过。两次失败都是托管模拟器忙不过来，一次卡在系统启动链，一次卡在应用自己开库。
  - 主人 2026-09-23 说「一起做吧」，`6f1310a` 把下面几件一起做了（门禁全绿：mobile 729 项测试、typecheck、lint，server 183 项与 typecheck，脚本单测 22 项）：
    - 回归只对一种失败重来：`xctest_launch_timed_out` 要求 XCTest 报的每一条错都是「Failed to launch <本应用>: Timed out attempting to launch app」（两次真实原文进了单测），才卸载、清钥匙串、重装、重新写入测试数据、两段 XCUITest 从头再跑一次；第一轮证据挪进 `attempt-1/`，`result.json` 记 `launchTimeoutRetried`。断言失败、崩溃、别的错误照旧直接判红；第二次还超时也判红。
    - XCUITest 每次启动（setUp 与 12 处重启）先等最多 120 秒，等到书架页头的「我的」（`open-settings`）或开库失败页才往下走；进了书架后每一步仍是 20 秒。
    - 写测试数据前不再固定睡 12 秒，改为等应用自己把库的根那一行写好（`wait_for_library`，最多 120 秒）再多等 2 秒。
    - `ios-check` 只等 `source`：每个验证作业先 `ios_simulator.py prepare` 建 iPhone 16e、启动、开两次「设置」热身，再按作业状态（`jobs?filter=latest`，需 `actions: read`）等「iOS simulator build」成功，然后照旧下载测试包、核对源提交／架构／Xcode，把 UDID 用 `--udid` 交给冒烟脚本。构建失败或取消，验证作业随之失败；连续五分钟读不到状态或等满 90 分钟也失败。按作业状态而不按产物等，是因为重跑时上一轮同名的测试包还在列表里（run 35827094155 的回归证据包就有两份）；只重跑失败作业时构建作业沿用上一轮的成功结果，立即放行。没有 `prepare` 的旧提交跳过这步，脚本自己建模拟器。GitHub Release 的 needs 显式加上 `ios-simulator`。
    - 安卓：ccache 4.14（Linux glibc 包，钉 sha256）不进 PATH，只在构建这一步设 `CMAKE_C_COMPILER_LAUNCHER`／`CMAKE_CXX_COMPILER_LAUNCHER`；NDK 27.1 每次由 AGP 现装，所以 `compiler_check = %compiler% -v`，另设 `hash_dir = false`、`max_size = 2G`；缓存键同 iOS 三项文件，允许回退键。构建前清零，构建后「Show compiler cache statistics」打印命中率。本机用同一段安装脚本验过：配置生效，换目录编译 `-g` 也命中。
    - 预期：iOS 回归作业里建模拟器加冷启动约 3 分钟与构建重叠；安卓第一次是冷缓存（本 run 存键），第二次起才看得到安卓的节省。
    - 验证 [run 35832730488](https://github.com/YePiXpert/family-time-capsule/actions/runs/35832730488)（workflow_dispatch，源码 `6f1310a`，07:38 UTC 派出，08:00 结束）**一次全绿**（attempt 1；Release 按设计跳过），全程 22.1 分钟：
      - iOS 这一路 16.7 分钟跑完（上次热缓存估计要 19～20 分钟）。模拟器构建作业 7.2 分钟（466／466 全命中，xcodebuild 4.1 分钟，比上次的 2.9 慢，属机器波动）。两个验证作业都在构建期间建好模拟器（建 5～6 秒、冷启动 140 秒、两次开「设置」热身）；等构建：回归 155 秒、启动冒烟 217 秒。构建完成后回归只用了 9.2 分钟：安装 23 秒、**首次启动 63→2 秒**、库 1 秒内建好、XCUITest 394 秒、恢复用例约 1.5 分钟。没有用上重跑（日志无 reinstalling 行）。启动冒烟首个场景 29 秒（原来 3.3 分钟），九个场景全过，作业 12.4 分钟。
      - Android 21.8 分钟、最后结束：Gradle 12 分 50 秒，模拟器一步 7.7 分钟（装 SDK 49 秒、建 AVD 加启动 48 秒、冒烟脚本 6.1 分钟）。Gradle 用时各次在两档间跳：8 分 11 秒（基线）、12 分 1 秒（35822132750，那时安卓还没接 ccache）、8 分 23 秒（35827094155）、12 分 50 秒（本次），慢的两次各个原生编译阶段都整体慢 1.5～1.8 倍，看着像分到的机器不同，不全是冷缓存的开销。
      - 安卓 ccache 已接通、缓存键 `Linux-X64-ccache-android-42e0…` 已存下（约 38 MB）：可缓存 190／598，其中命中 15、未命中 175；**不可缓存 408／598，原因全部是「Could not use precompiled header」**。Reanimated、Worklets、expo-modules-core 三个库用了预编译头（`target_precompile_headers`），ccache 要设 `pch_defines,time_macros` 宽松项才肯缓存它们。Reanimated 已自带 `-Xclang -fno-pch-timestamp`（注释写明就是为了 ccache）；另两个没带，ccache 4.14 源码里对这种情况有保护：直接模式核对被包含文件的修改时间，预处理模式不复用 clang 生成的预编译头，不会拿旧的预编译头凑数。
  - 主人 2026-09-23 说「都做」（再测热缓存、安卓预编译头进缓存、压安卓冒烟），`ebc4d97`（门禁全绿；脚本单测 35 项）：
    - 安卓 ccache 加 `sloppiness = pch_defines,time_macros`。缓存键从 `ccache-android-` 换成 `ccache-android-v2-`：actions/cache 精确命中的键不会再保存，不换键的话新进缓存的预编译头部分永远存不下来；回退键仍是 `ccache-android-`，所以 v2 的第一次会先拿到 35832730488 存下的那份。本机用 gcc 验过同一份配置：预编译头的生成与使用都可缓存，换目录两次命中。
    - 安卓冒烟：uiautomator 每次 dump 要起进程、再等界面静止满 1 秒（两三秒一次），一百多次是冒烟 6.1 分钟的大头。查找逻辑挪到 `mobile/scripts/android_ui.py`：最近一次 dump 留在缓存，只要没有发过输入（点、滑、打字、启动、改分辨率、装包）同一屏直接复用；缓存里找不到马上重新 dump，新 dump 也找不到才等一秒或向下滑（不会在应用没画完时把目标滑走）；等分享面板、等导出的轮询每次都重新 dump。启动后不再固定睡 4 秒，改为等应用画出带文字的界面（启动画面没有文字），那次 dump 留给接下来的查找。320 宽截图前先等书架按新宽度画好。测试流程和断言不变；分段耗时与 dump 次数打印在日志里，也写进 `result.json` 的 `timing`。`test_android_ui.py` 13 项用假 adb 验缓存只省 dump、不掩盖屏幕变化。
    - 验证 [run 35836515125](https://github.com/YePiXpert/family-time-capsule/actions/runs/35836515125)（源码 `ebc4d97`，08:20 派出，08:37 结束）**一次全绿，全程 17.6 分钟**（基线 29.9，上一次 22.1）：
      - 安卓 16.3 分钟（上次 21.8）。缓存从旧键 `ccache-android-42e0…` 回退恢复；**598／598 全部可缓存**，命中 190（原先能缓存的全中）、未命中 408（预编译头这部分第一次存入）；缓存 0.3 GB，已存成 `ccache-android-v2-42e0…`。Gradle 9 分 14 秒（上次 12 分 50 秒，机器快慢也有份）。
      - 安卓冒烟 262 秒跑完各段（上次约 6.1 分钟），dump 71 次共 165 秒（平均 2.3 秒一次）；分段：装包 3 秒、欢迎页 14、记录与草稿 60、相册 89、写信 125、设置 161、备份导出与归档 187、恢复 228、纪念册 262。证据包 38 个文件照旧，`result.json` 全部为真并带 `timing`；320 宽截图是画完的书架。
      - iOS：模拟器构建 6.5 分钟（466／466 命中，xcodebuild 4.1 分钟）。启动冒烟 11.4 分钟，九个场景全过。回归作业 17.2 分钟、最后结束：模拟器这次特别慢（冷启动 113 秒，热身时第一次开「设置」88 秒），但都在构建期间做完，只多等了构建 90 秒；构建完成后 10.7 分钟：安装 28 秒、首次启动 2 秒、主用例 XCUITest 505 秒（前两次 376、394）、恢复用例约 1 分钟。没有用上重跑。主用例 449 秒的步骤里：点击 59 次 125 秒、重启 11 次 70 秒、逐字输入 104 个字 65 秒、存在性检查 162 次 59 秒，时间摊在几百个步骤上，快慢跟着托管模拟器走。
    - 现在两条路基本持平（iOS 回归约 17 分钟，安卓约 16 分钟），再往下压要动测试本身（拆分回归、改逐字输入），收益小、风险大，暂不做。
    - 为验证预编译头缓存命中时构建照样正确（命中后才会真正复用预编译头，出问题会在这一步报编译错），派了 [run RUN_NEXT](https://github.com/YePiXpert/family-time-capsule/actions/runs/RUN_NEXT)（源码 SRC_NEXT）**结果待查**，不轮询；查一次时看安卓 ccache 命中与 Gradle 时长，以及全程。
- **首页整理（未打包；2026-09-23）**：主人说「首页还是乱糟糟的」，看过方案后拍板「都做吧」：`a973c21`（iOS 液态玻璃：玻璃及其祖先不带透明度，卡片不淡入）、`864124e`（编辑页／写信页底栏的底部安全区藏到键盘后面）、`510d835`（「专题与信」一张卡、年份下不再有统计行、月名「9 月」、提醒卡文字级动作、空库不挂「最近」、备份提醒等第一段时光满 7 天）；细目在 CHANGELOG 顶节。验证 run 35813660997（源码 `510d835`）：quality、IPA、模拟器构建、iOS 启动与回归全绿；**Android 冒烟红在第一步**——欢迎页已显示，但冷模拟器弹出「Pixel Launcher isn't responding」盖住应用，uiautomator 只抓到弹窗，logcat 无崩溃，属环境抖动。`8f5c03f` 让冒烟点掉别的应用的无响应框（本应用的不点、照样判失败）；复验 run 35815958870（源码 `8f5c03f`）**Android 冒烟全绿**（这次没弹框，证据包 `result.json` 全部为真），该 run 的 iOS 红与首页无关（上一条）。截图已核对：run 35813660997 的 iOS 首页（备份提醒卡文字级「去备份」、「最近」、年份下无统计行，玻璃卡片正常显示）与编辑页（键盘弹起时工具栏和保存键直接贴在键盘上方，不再多出底部安全区的空白），run 35815958870 的安卓首页（空库只有欢迎卡加「写一封信」；有记录后「最近」→「2026 年／9 月」→新建相册与写一封信）。

- **1.0.3 出包失败与重跑记录（已通过；2026-09-22）**：主人报告失败后检查 run 35736146539：quality、Android APK、iOS unsigned IPA、iOS simulator build、iOS startup verification 均成功，iOS regression verification 失败，GitHub Release 跳过。`NativeRegressionTests.swift:108` 在专题册保存、重开并断言成功之后，再次 `app.launch()` 约 41 秒超时（尚未建立自动化会话）；录屏末尾停在模拟器桌面。现有证据不足以确定是模拟器启动故障还是应用问题，不跳过回归，也不据此改应用或放宽断言。已成功提交 `gh run rerun 35736146539 --failed`，保留源码 `8be3a46731b56f17fec0bdbb8aa12575ddefc96b`／版本 1.0.3／构建号 76／标签 `v1.0.3`，复用已成功作业的产物；主人通知 CI 绿后检查 [attempt 2](https://github.com/YePiXpert/family-time-capsule/actions/runs/35736146539/attempts/2)：全部七个作业成功，Release 已发布。相同源码与测试在重跑中通过，首轮启动超时未复现，根因仍未确定；未改应用或放宽断言。生产服务无需再次部署。

- **1.0.3「减法」已交付（构建号 76；2026-09-22）**：本次发版内容包含 `mobile/app.json` 的 1.0.3／76 三行版本更新、服务端减法与 CHANGELOG 顶节、README、本文、PRODUCT、`docs/AI-PROMPTS.md`、`deploy/README.md` 同步；Fable 复核并跑门禁（mobile 49 文件 727 测试、server 183、typecheck／lint／边界脚本／scripts unittest 全绿）后提交，发版提交 `8be3a46731b56f17fec0bdbb8aa12575ddefc96b`，轻量标签 `v1.0.3` 指向它，标签推送触发 run 35736146539（<https://github.com/YePiXpert/family-time-capsule/actions/runs/35736146539>，13:50 UTC 触发；首轮失败与 attempt 2 重跑见上一条）。现已确认 quality／Android APK／iOS unsigned IPA／iOS simulator build／两组 iOS 验证／Release 全绿。**[GitHub Release v1.0.3](https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.0.3)**：APK 66,698,322 字节、未签名设备 IPA 11,220,960 字节，另附 `build-source.json`／`sha256sums.txt`。本机下载后校验三份文件的 SHA-256 全部一致、APK／IPA 压缩包完整；源码记录确认为 `8be3a46731b56f17fec0bdbb8aa12575ddefc96b`／1.0.3／Android 76／iOS 76，IPA 主应用与分享扩展版本也一致。安卓回归 `success` 与各布尔检查全 true；iOS 启动九项检查成功；iOS 完整回归含纸书 PDF、开放归档、记录身份、专题册重启、跨月选材、完整备份恢复、损坏库恢复与原库保留，全 true，三份证据的源码 SHA 一致。两台真机验收仍待主人装机完成。

  ```text
  cf2bd67d9263cff5320470df0fa437a7ab0fb65291f99c9429150bb9c2841cdf  FamilyTimeCapsule-android.apk
  5c9f92cb539e82b4a75aaf5b8b9d152f9300eab88d9524c1fa4893226d01971c  FamilyTimeCapsule-ios-unsigned.ipa
  c57d2af63c9e621c09cb57201e300c9160bc002f5c1eb0bde6aa6914831b1731  build-source.json
  ```

  - 服务端 `contracts.ts`／`app.ts`／`provider.ts`／`ai-model.ts`／`prompts.ts` 只保留 `/api/v1/ai/write` 与必填的 `polish`／`recap`／`ask`／`question`／`editor`，`photos` 只接受空数组，每次请求计一次写作、零张图片；移除 group 路由、generate／letter 模式、相关提示词与 ASK 故事主题句，旧手机相应功能收到 400／404。其余验证、额度、缓存、转写与备份路径不变。
  - 更新 contracts／app／provider／prompts 测试与 ai-config 的 Provider／探针调用，手册六块逐字对照；`probe-common.ts`／`probe-text.ts` 与 `verify-service.py` 改为五种文字模式，删除 `probe.ts`，保留重放和照片拒收并补旧模式／路由负例。
  - **服务端 `8be3a46` 已部署生产（2026-09-22 13:52 UTC，主人「一条龙」授权）**：从 `e2bd07f` 升级，同一提交构建镜像 `anan-ai:8be3a46731b56f17fec0bdbb8aa12575ddefc96b`（标签 `org.opencontainers.image.revision`＝提交）。先在独立数据目录的 staging 3141 跑新版 `verify-service.py --allow-live`：ask 3.1 s／593 tokens、question 7.5 s／490、polish 1.5 s／565（同一请求重放 1 ms／0 tokens、用量不变）、recap 34.6 s／2191、editor 11.9 s／1104；带照片的 ask 400、`generate` 400、`/ai/group` 404 均不上游；转写 2 秒合成音 5.6 s／77 tokens，413／415／401 与临时文件清理、家庭备份对象库、设备撤销全过；staging 已 down。切换：`docker stop` 生产后 tar 备份数据（SHA-256 `5cf6058b069ca4ff…`，全文在证据目录 `data-before.sha256`）并记录四表逐行摘要，再以同一镜像 `up -d --no-build --pull never`（env 只改 `SOURCE_SHA`）；本机与公网 `/healthz` 都返回发版提交，me／admin／备份清单／写作／转写五类匿名请求均 401，成员 1／设备 1／设置 1／清单 0 逐行一致，容器健康。证据与回滚材料：`/opt/anan-ai/deployments/20260922-1.0.3-reduction/`（`previous.env`、`previous-compose.yaml`、`previous-container.json`、`previous-image-id.txt`、`production.env`、`target-compose.yaml`、`data-before.tar`、`deploy.py`、`staging-verification.log`、`deployment-result.json`）。回退：恢复 `previous.env` 到 `/opt/anan-ai/service.env`，用 `previous-compose.yaml` `up -d --no-build --pull never`，核对 healthz 回到 `e2bd07f`；无数据库结构改动，通常不必还原数据。第一次切换曾因公网健康地址拼错（把手机 `brand.ts` 的 `SERVICE_URL`（含 `/api/v1`）直接接 `/healthz`）而由脚本自动回滚（数据未动，`attempt1-*` 是那次的备份），改用站点根 `/healthz` 后第二次切换成功。

- **MiMo V2.6 Pro 已上线（2026-09-22）**：生产镜像 `anan-ai:e2bd07fe77f5b185257ef1fc255462245a4d1577`，内容为 `mimo-v2.6-pro`，云端 ASR 为 `mimo-v2.5-asr`；两路使用主人指定的中国 Token Plan 地址和提供的密钥。八种内容模式、ASR、隔离服务的账号／幂等／备份检查通过，本机与公网 healthz SHA 一致；原有成员、设备、额度、暂停状态与备份清单保留。旧客户端型号兼容归一；新源码脚注和本机任务标记已更新，现有安装包静态文案需下次出包更新。回滚材料和探测统计在 `/opt/anan-ai/deployments/20260922-mimo26-pro/`。配置记录的是主人选择，不声称小米特别许可；细节见 `docs/MIMO-ADAPTATION.md` 顶部。

- **1.0.3「减法」（手机端，已合 main；2026-09-22）**：主人拍板记在 PRODUCT.md 第九节末段，细目在 CHANGELOG 顶节。提交：`8f36df0` PRODUCT／CHANGELOG 骨架，`d29255e` 出生的故事并入小问题，`2b13b8d` 信精简与书架空区一行，`39a13cb` 时光系列／足迹页面（`series` 留作旧数据种类），`6cbcd3b` 长图／重放，`feebcec` 分成几件事／按事情分组／起个头／AI 不看照片，之后一笔文档收尾。Astra 逐个提交改工作树、Fable 复核并跑门禁后提交。兼容：实体种类只增不减，`RecordContent.story`／`settings.replayAudioId`／草稿 `photoEvents` 只停写不拒收（分组草稿在 `normalizeLibrary` 并回一份、旧 AI 任务在那里丢弃），服务端未动、所有请求仍带 `photos: []`。门禁：mobile 49 个文件 727 个测试、server 189、typecheck／lint／边界脚本／scripts unittest 全绿。验证出包：文档收尾提交推上 main 后派发一次 `mobile-build.yml`（完整 SHA，不轮询）——run 35728641333（源码 `faddfb3`，12:40 UTC）在 quality 作业就红了——`server/tests/backup.test.ts` 那条已知偶发：两次 `status()` 之间 `freeBytes` 现查磁盘差了 8 KB，与减法无关；修复 `52b5f76`（不再逐字节比 `freeBytes`）后重新派发 run 35729090883（源码 `52b5f76bddcbe690b6e95419a68bf45deaa1ef61`，12:45 UTC，<https://github.com/YePiXpert/family-time-capsule/actions/runs/35729090883>）；结果待主人通知后查一次：Android／iOS 冒烟截图看书架空态、编辑页小问题、AI 面板、年度册「装订纪念册」，`result.json` 不再有 `yearbookSheet`）。
  - 服务端减法与生产部署已纳入本节「1.0.3 已交付」记录。真机待验：书架空态两行入口、编辑页小问题（头六个月的故事题）、AI 面板只剩润色与追问、年度册「装订纪念册」。
- **1.0.2「界面焕新与复核修复」已交付（构建号 75；2026-09-22）**：主人复核后拍板发版。发版提交 `c8adcde33302c2bbc576463773ac6cf26426b10e`（`mobile/app.json` 1.0.2／构建号 75、CHANGELOG 顶节「1.0.2」并入 1.0.1 内容与复核修复、README 当前版本、HANDOFF 头注），轻量标签 `v1.0.2` 指向它，标签推送触发 run 35691714051，**四作业全绿**（quality／Android APK／iOS unsigned IPA／GitHub Release）。**GitHub Release**：<https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.0.2>（不过期；artifacts 2026-10-22 过期）。APK 66,776,146 字节、IPA 11,270,531 字节（IPA 未签名，由主人自签后装机）；SHA-256（与 Release 的 `sha256sums.txt` 一致，本机重新算过）：

  ```text
  5195171909fcff130138b9cbe5d953281aba83e71d95f0ec2499197df50f91ea  FamilyTimeCapsule-android.apk
  8663f99ba5d2cdebc7a051701a6a125d7c9859b282bcd1f8016180a67eff6916  FamilyTimeCapsule-ios-unsigned.ipa
  ```

  发版前复核（2026-09-22）：main CI 绿；验证 run 35686815546 的安卓冒烟 12 项、iOS 回归 9 项、iOS 启动 9 项检查全 true；安卓 320／390、深色截图目视正常；Opus 独立复核代码差异无阻塞项；门禁 mobile 789／server 189 全绿。注意：本版 AI 脚注写「由小米 MiMo 2.5 提供」（`6c926e2`），请求体不带模型字段。2026-09-22 生产已切至 MiMo V2.6 Pro，旧客户端可直接使用；安装包内 2.5 的静态文案需下次出包更新。
- **出包流水线并行化（主人 `300b12e`，2026-09-22，1.0.2 发版之后）**：iOS 拆成「iOS unsigned IPA」「iOS simulator build」（模拟器应用与 XCUITest runner 只编译一次，打成 tar 传给下游）和矩阵「iOS startup／regression verification」；README 加了一段说明；`smoke-ios-startup.py` 把 Vision OCR 编译成二进制只编一次。首次 dispatch run 35694486774：quality／Android／IPA／模拟器构建／启动校验全绿，**回归校验红**——`NativeRegressionTests.swift` 点「说一段」后 20 秒内没等到「说完了」，但拆解截图与 AX 树显示录音其实已开始（按钮已是「说完了」、卡片「正在录音，离开前请结束并保存。」）：全新运行器上第一次激活音频会话花了 30～50 秒；旧流水线里回归跟在启动冒烟后面、同一运行器早已热身。修法：「说完了」的等待放宽到 120 秒（`5498c66`）。验证 [run 35701034621](https://github.com/YePiXpert/family-time-capsule/actions/runs/35701034621) 已完成：quality、Android、IPA、模拟器构建和两组 iOS 验证全绿，Release 因 dispatch 按设计跳过。07:43:24—08:15:25 UTC，总耗时 32 分 1 秒，比并行化前约 47 分半缩短约 33%；iOS 回归任务 19 分 32 秒，其中主用例 700.158 秒。
  - **第二轮等待优化（待原生验证）**：已存在的控件、已满足的谓词先直接返回，否则仍调用原生等待并使用原超时上限。逐字输入与每字校验保留（早期整串输入有模拟器丢字记录），录音等待 120 秒、导出等待 300 秒、全部业务断言与崩溃观察窗口不变。只改测试脚手架，不改应用／版本／标签；实际提速以新验证构建为准。
- **1.0.1「界面焕新」（构建号 74，未交付；2026-09-22）**：Kimi 在 main 上直接提交 `3c0b017`（页内返回箭头改为订阅导航栈 state）、`dd6d933`／`0b098f2`／`f3b3b32`／`82f0e23`／`411e7dd`（纸卡纯白与投影、图标砖、我的档案卡、书架单月整宽行与空区行动行、编辑页贴底工具栏、月册吸顶与年度册扉页）、`57500dc`（DESIGN 同步）、`05e229f`（app.json 1.0.1／构建号 74、CHANGELOG 顶节），并打了**附注**标签 `v1.0.1`（规矩是轻量标签；实测 quality 作业的 SHA 核对也过了，`github.sha` 会解析到提交）。
  - 标签出包 run 35679134876：quality 绿、Android APK 绿（artifact `FamilyTimeCapsule-android-apk`，2026-10-22 过期）、**iOS 红**、GitHub Release 跳过——**没有 v1.0.1 的 Release，可安装的仍是 1.0.0**。iOS 失败在 `mobile/scripts/ios-regression/NativeRegressionTests.swift` 点「2026年9月」月册后 `record-fixture` 等不到。证据包 `FamilyTimeCapsule-ios-local-regression` 里的点击事件是 (90, 814.8)：书架收紧后月册只在屏幕底边露出 58 点，XCTest 点在可见部分的中心，落进 Home 指示条手势区被系统吞掉；1.0.0 时月册整个在屏幕外，XCTest 会先自动滚动。是测试脚手架的问题，不是应用的问题。
  - 同日 Fable + Astra 复核（无阻塞项），主人拍板全修，已推 main：`a01a1d8`（`Stamp` 搬进 ui.tsx）、`42fb8a9`（我的档案卡允许换行、名字与印章统一回退、`sealInitial` 取首个码点 + 测试）、`d2e2b75`（AI 钮共用 `ToolButton`：禁用 40%、标签 11／13 随更大文字、放大上限 1.4、底栏间距 8）、`6c03726`（AI 弹层重置 `GlassDepth`，卡片不再变平）、`9476895`（浅色赤陶压深到 #B2543B，纸底对比 4.58:1，派生色与归档阅读器 CSS 同步）、`6238119`（XCUITest `tap()` 要求可见中心离底边 ≥ 60 才点）。门禁：mobile 52 个文件 789 个测试、server 189、typecheck／lint／边界／scripts unittest 全绿。这些都在 `v1.0.1` 标签之后，**没进任何安装包**。
  - 验证出包 run 35681782720（workflow_dispatch，源码 `6238119`）：quality／Android 绿，**iOS 又红**——过了月册那一步，栽在续写「A little story.」：`type()` 靠点字段右下角（归一化 0.95／0.9）把光标挪到末尾，键盘弹起后底栏贴着字段下沿，1.0.1 把工具栏放进了底栏，那一点 (352, 263) 正是「文件」钮，点开系统文件浏览器、字段失焦，`typeText` 三次报 "Neither element nor any descendant has keyboard focus"。还是脚手架问题。顺带从两版真机截图看出编辑页与写信页键盘上方多出约 100 点空纸：`keyboardVerticalOffset` 传了顶部安全区 + 顶栏高，可 `KeyboardAvoidingView` 的布局帧相对整屏 SafeAreaView、已含顶栏，等于多抬了一个顶栏——1.0.0（`6ddf455` 迁到页内顶栏）起就有，不是 Kimi 引入的。
  - 修复已推 main：`ae2323d`（`type()` 改点首行右侧；相册／信封书的点击也走同一条 `tap()` 规则）、`3638d96`（两个编辑页去掉 `keyboardVerticalOffset` 与 `useTopBarOffset`，底栏贴键盘上沿；DESIGN 同步）。门禁同上全绿（server 有一处 `backup.test.ts` 比对 `freeBytes` 的偶发失败，重跑两次都 189 全过）。
  - 第三次验证出包 run 35686815546（workflow_dispatch，源码 `3638d96`）：**quality／Android APK／iOS unsigned IPA 全绿**，release 作业跳过（非标签触发）。iOS 回归两条用例都过（主流程 620.8 秒、备份恢复 35.2 秒），`result.json` 9 项布尔全 true、gitSha `3638d96`、构建号 74；截图里编辑页底栏已贴着键盘上沿、正文框整个露出。artifacts 2026-10-22 过期：`FamilyTimeCapsule-android-apk`（APK 66,776,146 字节）、`FamilyTimeCapsule-ios-unsigned-ipa`（IPA 11,270,529 字节，未签名，由主人自签后装机）。这只是验证包，**没有 GitHub Release**；主人想先装可以直接取这两个 artifact，SHA-256（本机重新算过）：

  ```text
  5179ad55179b90aa8a8f974c49ab3ed954ea3eb1217a1082b05d18ebe01382da  FamilyTimeCapsule-android.apk
  f44bbb18c5ece4c7ec06ca929c89573488d31729cc932c2a9f3ff9550eb1bd24  FamilyTimeCapsule-ios-unsigned.ipa
  ```

  - 再出包（需主人拍板）：`mobile/app.json` 构建号递增到 75、CHANGELOG 顶节改「1.0.2」并把上面的修复写进去、README 当前版本，打**轻量**标签 `git tag v1.0.2 <sha> && git push origin v1.0.2`，release 作业会自动发 Release；不要动 `v1.0.1` 标签。

- **历史：2026-09-21 MiMo 内容模型离线适配（已由上方 V2.6 Pro 部署记录取代）**：仓库目标 `mimo-v2.5`，专用 ASR 仍为 `mimo-v2.5-asr`；最小请求适配与 Mock 验证见 `docs/MIMO-ADAPTATION.md`（server 189、mobile 784、类型检查／lint／边界门禁通过）。当时只完成离线适配，没有真实模型调用或生产切换。
  生产仍是 `b76439d` + DeepSeek 普通 API；**既有 ASR 已使用 MiMo Token Plan**，按主人要求保持现状，未停服、删密钥或改配置。新代码需要 `AI_*` 与独立 `TRANSCRIBE_*` 配置，不能直接套用旧 `CPA_*` env；上线／回滚按适配记录执行。

- **1.0.0（Build 73–76）**：主人 2026-09-21 拍板「都做吧，做完了作为 1.0.0 发版然后暂不考虑增加新功能了，专注优化就行」。main 上已合（每笔推送前门禁全绿）：
  - Build 73「说一段」：服务端 `8a27c6a`（`POST /api/v1/ai/transcribe`：m4a → ffmpeg → 16 kHz 单声道 wav → CPA `mimo-v2.5-asr` 的 chat-style `input_audio`；不落盘不写日志、最长 3 分钟／5 MiB、一次计一次写作；顺手 `BackupStore` 必填、`claims` 每设备 10 万上限），
    手机端 `59ff497`（自写 Expo 模块 `mobile/modules/speech-recognition`：iOS `SFSpeechRecognizer` `requiresOnDeviceRecognition`，安卓存根回退服务端；`client.ts` 加二进制 `upload()`；编辑页「说一段／说完了」录完自动接在正文后、分组时接第一件事；逐段同意，「以后都同意」记在本机 `settings.transcribeConsent`）。
  - Build 74「出生的故事」：`6c72e56`（`RecordContent.story` 四主题、`stories.ts` 每题六问、书架合集常驻入口 + `Stories` 页、编辑页故事问题卡、阅读／搜索／归档带主题、纸书故事章排在寄语之前且月章不重复）。
  - Build 75「访谈者」：服务端 `b76439d`（writingMode ask／question／letter／editor，八条提示词逐字 = `docs/AI-PROMPTS.md`——`prompts.test.ts` 盯着；分模式校验；`server/scripts/probe-text.ts`）、手机端 `208c8e7`（AI 面板「追问我」、联网版「今天的小问题」一天一次本机缓存 `settings.dailyQuestion`、写信「不知道从哪开始？」、生成／润色送落款、寄语送她说的话、同意书 v2 共用 `src/ai/consent.ts`）。
  - Build 76「年度册的编者」：`5697dc1`（`yearPicks` 共享根字段：按年一块、两台都改取 `updatedAt` 晚的、`repairReferences` 只在真少了引用时换对象；年度册页「AI 建议目录」两次确认才送整年文字、预览可「不要」「不引」、采用才落库、手机端 `checkEditorResult` 再校验；纸书按目录装订、章首引语进 `lead`、建议书名替换封面书名；`backupNudgeBody` 认得 7 天内的家人同步）。
  - 出包流水线 `0b08b53`：quality 作业补 server typecheck；`v*` 标签自动发 GitHub Release（APK／未签名 IPA／`build-source.json`／`sha256sums.txt`，说明取 CHANGELOG 顶节；`contents: write` 只给该作业）。**标签要打轻量标签**（`git tag v1.0.0 <sha>`，不加 `-a`），`github.sha` 才等于提交、workflow 的 SHA 核对才过。
  - 发版：交付提交 `16300f2`（`mobile/app.json` 1.0.0／构建号 73，CHANGELOG 顶节「1.0.0」，README 当前本机版），轻量标签 `v1.0.0` 指向它，标签推送触发 run 35607118819（release 作业会发 GitHub Release `v1.0.0`：APK／未签名 IPA／`build-source.json`／`sha256sums.txt`）。run 35607118819 **四作业全绿**（quality／Android APK／iOS unsigned IPA／GitHub Release），`build-source.json` 的 gitSha = `16300f2339ae4c1242cad54b8356c1365a62ffa3`、version 1.0.0、androidVersionCode 73、iosBuildNumber "73"；
    双端冒烟 `result.json` 布尔项全 true（安卓 12 项、iOS 回归 9 项、iOS 启动 3 项，gitSha 都是 16300f2）。**GitHub Release**：<https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.0.0>（不过期；artifacts 2026-10-21 过期；VPS 上另有一份在 `/var/tmp/anan-tests/artifacts-35607118819/`）。
    APK 66,772,050 字节、IPA 11,267,601 字节（IPA 未签名，由主人自签后装机）；SHA-256（与 Release 的 `sha256sums.txt` 一致，本机重新算过）：

  ```text
  0039f80694f40c7af6010ee5134e8c160a25b4e968ef58a3a52e3558e49c4bb7  FamilyTimeCapsule-android.apk
  bd41a86d9c698476a85307f8205db9d585976c82a07267ce8daa9c4de9c81fc0  FamilyTimeCapsule-ios-unsigned.ipa
  ```

    同日的原生编译验证 run 35602906506（源码 `59ff497`，只为验证语音模块能编）也三作业全绿，不必再存。
  - **服务端 `b76439de5ce8b9e72080ffdd4eecfb2f5918f54b` 已部署生产**（2026-09-21，主人明确授权）。从 `f71f86c` 升级；复用镜像前，逐文件核对镜像内 `src`、`package.json` 与 lockfile，确认与该提交一致。
    切换前在独立数据目录的 staging 3141 跑新版 `verify-service.py` 全绿：group／write／ask／question／letter／editor／真实上游转写、临时音频清理、账号权限、幂等、家庭备份与撤销。测试容器已清理。
    停止生产写入后完整备份数据与 env，再切换已经验证的同一镜像；本机健康恢复耗时约 2 秒。生产本机及 HTTPS `/healthz` 均返回目标完整 SHA；两处账号初始化状态正常，me／管理员／备份清单／写作／转写五类未授权请求均返回 401。生产未运行会创建测试账号的 `verify-service.py`。
    SQLite 完整性检查通过；切换前后成员、设备、设置、备份清单逐行摘要一致。备份与证据目录：`/opt/anan-ai/deployments/20260921T144454Z/`，含 `data.before/`、`service.env.before`、`backup-sha256.json`、`staging-verification.log`、`deployment.json`。
    回退应用：恢复上述 `service.env.before` 到 `/opt/anan-ai/service.env`，用该证据目录的 `source/deploy/compose.yaml` 执行 `docker compose --env-file /opt/anan-ai/service.env -p anan-ai -f <compose路径> up -d --no-build --pull never`，核对健康版本回到 `f71f86c`；旧镜像保留。本次未改数据库结构，通常不需恢复数据；如必须还原 `data.before/`，先停服并另存当前数据，避免丢失部署后新增内容。
  - **AI 上游直连的历史部署记录（2026-09-21）**：文字／看图 `deepseek-flash`（High）→ `[服务地址已省略]`；转写 `mimo-v2.5-asr` → `[服务地址已省略]`。两份独立密钥只在 `/opt/anan-ai/secrets/`，不进仓库。`service.env` 保存地址及密钥路径，当时 `b7eefdf` 的 `deploy/compose.yaml` 支持该配置；MiMo 适配后的 main 已要求新 env，后续操作按 `docs/MIMO-ADAPTATION.md`，不要把新 Compose 套在旧环境上。源码镜像仍是 `b76439d`。
    独立 staging 实际调用通过看图分组、写作、ask／question／letter／editor、MiMo 转写与临时文件清理、账号权限及家庭备份；生产已重建容器，挂载密钥和地址核对通过，本机与公网健康正常。验证及回滚 env 存在 `/opt/anan-ai/deployments/upstreams-20260921T150506Z/`；回退上游时恢复其中 `service.env.before`，再用保存的 `b7eefdf` 旧 Compose `up -d --no-build --pull never`，不需要回退数据。
  - 真机待验（CI 做不了）：iPhone 中文本机识别可用性与准确度（系统「听写」要有中文离线包）、安卓无离线识别时的同意弹窗与服务转写、RN XHR 二进制上传的 Content-Length（`client.ts` 的 `upload()` 手动设了头）、
    追问／小问题／写信引导三个入口、编者目录预览与装订 PDF 的引语版面、两台手机同步 `story`／`yearPicks` 不出冲突卡。
- **Build 69「界面整顿」**：交付提交 `7a82903`，run 35489556795 全绿。APK SHA-256 `3201aa54…5083c8`（66,481,234 字节）、
  未签名 arm64 IPA SHA-256 `7fac29f2…f336f0`（11,084,240 字节），本地存 `C:\vibe-coding\releases\build-69\`（artifacts 2026-10-20 过期）。
- **服务端**：2026-09-20 已把 Build 70 的服务端（`/api/v1/backup/*` 对象库、配额、管理端）部署到 capsule.yep.li，
  `/opt/anan-ai/service.env` 的 SOURCE_SHA = `6672e661411f3bbca257a72becf51bb8d21d9311`，`/healthz` 本机与 HTTPS 都对得上；
  对旧版 App 完全向后兼容。staging 容器（3141）跑过 `verify-service.py` 全绿后已 down；匿名 `probe-upload-limit.py` 探过
  0.5／4／9／16 MB 全部直达服务（我们的 JSON 401），反代无需改动。**这台开发机就是 VPS**（hostname `gateway`），部署命令见 `deploy/README.md`。
  **当前生产 = 复查修复版**：2026-09-20 下午主人放行后已切到 SOURCE_SHA `81d1ffe37d7e68141efee1baac27a70b353f73f8`（镜像 `anan-ai:81d1ffe…`；
  切换前 staging 3141 用新版 `verify-service.py` 跑过全绿并 down），`/healthz` 本机与经代理的 HTTPS 都返回这个 SHA，旧 env 存在 `service.env.bak-<时间>`。
  新版对 Build 70 的 App 向后兼容（`objects` 可选）；Build 71 的 App 写远端清单会带 `objects`，旧服务端的 `.strict()` 会回 400——服务端不能回退到 `81d1ffe` 之前。
- **Build 70「传家 · 中」（本版）**：一天内 17 个小提交直推 main（清单见第三节）。
  本机 blob 库（`.xmbm` 清单 + `blobs/ab/<sha256>`，三份保留备份只占一份照片）→ 分卷导出（单卷与 Build 68 逐字节同形，> 2 GiB 分卷，乱序多选恢复）
  → 服务端对象库 → 密码学（12 词恢复码即钥匙，XChaCha20-Poly1305，id／nonce 按内容派生）→ 状态／规划器／传输层（XHR）→ 引擎（只传缺的、核对、远端恢复进 blob 库）
  → 备份页末尾「远端备份」卡 + 恢复码页 → 真服务端端到端 → 收尾。CHANGELOG「Build 70」有逐条说明，`docs/plans/PLAN-BUILD-70.md` 顶部记了 8 条实施偏离。
- **Build 70 打包（已交付，已被 Build 71 取代，不必再存）**：交付提交 `7477504`（`mobile/app.json` 70），run 35494972998 三作业全绿（quality／Android APK／iOS unsigned IPA），
  `build-source.json` 的 gitSha = `7477504e59b6489dbaadb9db8f06fb51e3d0f65b`；双端冒烟 `result.json` 全 true（含新键 `remoteCardOffline`）。
  artifacts 2026-10-20 过期，请尽快下载到 `C:\vibe-coding\releases\build-70\`：
  `gh run download 35494972998 -n FamilyTimeCapsule-android-apk` 与 `-n FamilyTimeCapsule-ios-unsigned-ipa`。
  APK 66,612,306 字节、IPA 11,161,950 字节（IPA 未签名，由主人自签后装机）；SHA-256（可直接存成 sha256sums.txt 后 `sha256sum -c`）：

  ```text
  f94424fffd3630afefba8f13ade7f2f61141fb3096736f5af4a27c2637abe544  FamilyTimeCapsule-android.apk
  2e978c240b8baa82d7731d6188e18faa817a224a6a160b268dde08f917ea726d  FamilyTimeCapsule-ios-unsigned.ipa
  ```

  **真机 XChaCha20 MB/s 还没有实测**：装上 Build 70 后在「远端备份 → 现在备份」看一次 4 MiB 以上照片的上传节奏，把 MB/s 记到这里；
  低于 5 MB/s 就用对象头的 `alg` 字节换 `expo-crypto` 的原生 AES-GCM，格式不用换。Node 26 基准：封装 64 MiB 约 220 MB/s。
- **交付后复查（2026-09-20）**：主人说「前期累积太多 CI 出错」，查明 main 连红三次只有一个原因——`879f51f` 只给 `mobile-build.yml` 补了 server 的 `npm ci`，
  push 触发的 `ci.yml` 漏了，端到端测试在 CI 上起不了服务端（`dfdcad8` 修，run 35509330400 全绿）。随后三路并行读码复查 Build 70 的 4,600 行，修了：
  服务端 `26e4e19`（同 id 换大免配额、prune 全信客户端 keep 能删掉清单指向的对象、删库顺序、启动 sweepTemp(0)）、
  手机端 `347200a`（`state.json` 异步 move 没等、远端上传时整页不锁、停止被当错误、离开页面不中止、钥匙串出错卡死、清单登记 objects）、
  `81d1ffe`（收拾出错把成功报成失败、入库无空间预检、写不进去被说成备份坏了、多卷长度晚验、停止不到块、远端恢复中断即丢续传、句柄与半成品清理）。
  手机端这两笔不在 Build 70 的安装包里（包是 `7477504`）：主人拍板出 **Build 71**（复查修复版），见下一条。
  没修的一条：服务端 `usage()` 每次 PUT 都全量 stat 一遍成员的对象目录（几千个对象几十毫秒，家庭规模够用；上万再做缓存）。
- **Build 71 打包（复查修复版，已交付）**：交付提交 `412f8e0`（`mobile/app.json` 71），run 35511463957 三作业全绿（quality 1.5 分钟／Android 16 分钟／iOS 52 分钟），
  `build-source.json` 的 gitSha = `412f8e032dd38ec3721d90fbee0df939af89f984`、androidVersionCode 71、iosBuildNumber "71"；双端冒烟 `result.json` 的布尔项全 true（安卓 12 项、iOS 回归 9 项、iOS 启动 3 项）。
  artifacts 2026-10-20 过期，请尽快下载到 `C:\vibe-coding\releases\build-71\`：
  `gh run download 35511463957 -n FamilyTimeCapsule-android-apk` 与 `-n FamilyTimeCapsule-ios-unsigned-ipa`（VPS 上另有一份在 `/var/tmp/anan-tests/artifacts-35511463957/`）。
  APK 66,620,498 字节、IPA 11,164,958 字节（IPA 未签名，由主人自签后装机）；SHA-256（可直接存成 sha256sums.txt 后 `sha256sum -c`）：

  ```text
  b6dab5075519a304db0fb868f9d677c120e5ad473cda7e85fa78309f81757af8  FamilyTimeCapsule-android.apk
  0480eed1f11e71747f1bdacb0c1960914dbd773461747f9e06491796d6e59956  FamilyTimeCapsule-ios-unsigned.ipa
  ```

  装上 Build 71 后请在「远端备份 → 现在备份」看一次 4 MiB 以上照片的上传节奏，把真机 MB/s 记到上面 Build 70 那段的位置（阈值 5 MB/s）。
- **书架重排（2026-09-20 晚，未打包）**：主人装上 Build 71 后发来两张真机截图（`/workspace/anan-test/1.png`、`2.png`，iPhone 深色、库里只有 1 段时光）说「ui 布局太丑了」：
  每个区块一条横向封面条，各只有一张封面靠在左边、同一张照片重复四次（最近／年度册／月度册／系列）、区块之间大片空白，首页拉了两屏半。
  改法（CHANGELOG「未打包 — 书架重排」）：横向封面条只留「最近」与每个年份名下的月册，年份成为书架本身（衬线年份标题 + 统计 + 「翻开年度册」，`volume-year-YYYY` 落在这个文字按钮上）；
  合集／专题册／时间胶囊／时光系列改成书册行（`SettingsRow` 的 `leading` + `serifLabel`）；间距收紧。冒烟 testID 全部不变（`recent-<id>` 仍在整宽卡上），本地门禁全绿（mobile 341）；**还没出包**，主人要看效果需要 Build 72 的包（家人一起记顺延为 73）或先看下一次 mobile-build 的安卓截图 `home-recent.png`。
  主人随后拍板两项（已实现，同样未打包）：「最近」改成整宽时光卡左右翻（`RecentFlip`／`RecentCard`，卡宽 = 可用宽 − 56、右内边距 36 让最后一张也对齐页边、按卡吸附、圆点）；
  「随便翻翻」（`shuffle` testID，≥ 3 段时光才出现）随机进阅读页，`Record` 路由带 `shuffle: true` 时顶栏右侧「再翻一页」（`shuffle-next`）用 `navigation.replace` 换随机另一段（`shuffle.ts` 的 `pickAnother` 保证不重复当前）。
  顺手修了 CI 偶发红：`sweepTemp(0)` 同毫秒漏删（run 35514369969 的 `ai-quality`）。
- **Build 72「家人一起写」（已交付）**：计划 `docs/plans/PLAN-SHARING.md`（16 个提交：服务端家庭空间 1–3 先部署，落款 4–7，同步 8–13，收尾 14，可选 15 扉页本名与诗），
  主人 2026-09-21 晚已批，第七节四条已拍板（自动同步默认开、冲突新者胜加留底、去掉「从远端恢复」、半句话「入淮清洛渐漫漫」+ 可选提交 15 做）。
  **已推 main：提交 1–12**（服务端 1–3 已部署生产；手机端落款 4–7、传输层与状态 8、纯函数合并 9、同步引擎 10、「家人一起写」卡与冲突页 11、自动同步 12）。12b 已推（`77b3cbe`）、13 已推（`63e1c14`）、13b 已推（`3b7925a`，版本世系 `ancestors`，两台都改时输的一方也留底——计划第五节第 3 条验收实测不成立，见下一步）。15 扉页已推（`f99699f`）。14 收尾 = `7cdc42d`（`app.json` 72；出包结果见下一条「Build 72 打包」）。审查修复 `306cee2`／`cebfe13`／`f71f86c` 已在 main，其中服务端部分**未部署**。
  逐条交接（目标／决策／改了哪些文件／验了什么／没验什么／下一步）在第三节的 Build 72 小节。
  - **服务端已部署（2026-09-21 02:20）**：Build 72 提交 1／2（家庭对象空间 + 按设备清单）在 staging 3141 跑过 `verify-service.py` 全绿，并用生产数据副本 + 合成的成员目录／旧清单行演练过迁移（2 moved／1 member dir removed／旧表迁成 `legacy:` 行）后，
    生产切到 SOURCE_SHA `473339b62a5d9e0a984652e2bf7ce91571ad71de`（镜像 `anan-ai:473339b…`，healthy，本机与经代理的 HTTPS `/healthz` 都对得上）。切换前数据整目录拷到 `/opt/anan-ai/data.bak-20260921-0220`，旧 env 在 `service.env.bak-20260921-0220`；
    生产原本没有任何成员对象目录（主人还没用过远端备份），迁移只建了 `backup/family/`。回退到 `81d1ffe` 必须连同 `data.bak` 一起回退（旧版找的是成员目录与旧表）。
    **待主人**：用 Build 71 的手机点一次「远端备份 → 现在备份」确认兼容（旧手机走 `GET/PUT /backup/manifest`，服务端按设备记、按成员回退）。
- **Build 72 打包（已交付）**：交付提交 `7cdc42d`（`mobile/app.json` 72），run 35590928208 三作业全绿（quality／Android APK／iOS unsigned IPA），
  `build-source.json` 的 gitSha = `7cdc42d525d9142a1379f664e53dee358d1d50dd`、androidVersionCode 72、iosBuildNumber "72"；双端冒烟 `result.json` 的布尔项全 true（安卓 12 项、iOS 回归 9 项、iOS 启动 3 项）。
  artifacts 2026-10-21 过期，请尽快下载到 `C:\vibe-coding\releases\build-72\`：
  `gh run download 35590928208 -n FamilyTimeCapsule-android-apk` 与 `-n FamilyTimeCapsule-ios-unsigned-ipa`（VPS 上另有一份在 `/var/tmp/anan-tests/artifacts-35590928208/`）。
  APK 66,710,610 字节、IPA 11,219,804 字节（IPA 未签名，由主人自签后装机）；SHA-256（可直接存成 sha256sums.txt 后 `sha256sum -c`）：

  ```text
  512ba99205a135629b5c1b893e3ba504b37f3a8786ef2969922907e02f5ef6f5  FamilyTimeCapsule-android.apk
  ad9220669a69a1d52c76bc9f8b6c86decd4a2449f83c1554a9b226774122f6e6  FamilyTimeCapsule-ios-unsigned.ipa
  ```

  装上后按 `docs/plans/PLAN-SHARING.md` 第五节做真机验收（主人两台 + 家人一台），顺便记真机 XChaCha20 MB/s（Build 70 起欠着，阈值 5 MB/s）。Build 71 的包不必再存。
- **工作区**：`git status` 应干净（`.zcode/`、`.commandcode/` 为本地会话目录，已在 .gitignore，不要提交）。

## 二、恢复提示词（直接复制粘贴）

```text
你是「桉桉成长记」的实现工程师代理。这台是新开发机，请恢复开发并继续执行迭代。

第一步·环境自检：
1. 读仓库根目录的 PRODUCT.md（定位、原则、不做什么、路线次序——排功能先看它）、AGENTS.md（发布纪律：只从 main 工作、小提交直接推、本地三件套绿后推送、
   不等待 CI；开工前查上次 CI 是否红；备份传输只走 src/sync）、README.md（架构/命令）、DESIGN.md（设计规范，UI 只用
   mobile/src/local/ui.tsx 的基元）、CHANGELOG.md（近期变更）、HANDOFF.md（本文件）、
   docs/plans/PLAN-BUILD-70.md（Build 70 计划 + 顶部实施偏离）、deploy/README.md（服务端部署与远端备份对象库）。
2. git checkout main && git pull --ff-only origin main && git status --short 应干净。
3. cd mobile && npm install；cd ../server && npm install（mobile 的 tests/sync-e2e.test.ts 会拉起真实服务端子进程，server 依赖必须装）。
4. 验证三件套：mobile 下 npm test、npm run typecheck、npm run lint（2026-09-22 减法后 49 个文件 727 个测试）；
   server 下 npm test、npm run typecheck（189 个测试，server 没有 lint 脚本）；
   python3 mobile/scripts/verify-local-boundary.py；
   python3 -m unittest discover -s mobile/scripts -p 'test_*.py'。
   本机 /tmp 若是满的 tmpfs，跑 mobile 与 server 测试都要 TMPDIR=/var/tmp/anan-tests（先 mkdir）。
   本机若设置了 http_proxy/https_proxy，对 127.0.0.1 的请求要 env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy NO_PROXY=127.0.0.1,localhost … 绕过；
   git push 与 gh 反过来必须带着代理（直连 github.com 会超时）。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·1.0.0（Build 73–76）**已交付**（第一节第一条：提交 16300f2、标签 v1.0.0、run 35607118819 四作业全绿、GitHub Release 上有 APK／IPA／校验和，不过期）。
   不要再出 1.0.0 的包；此后不加新功能，只做第四节的优化项。再次出包时按 AGENTS.md（workflow_dispatch 完整 40 位 SHA；正式版打轻量标签 v1.0.x 走 release 作业）并递增构建号。
   服务端生产已是 **b76439d（转写端点 + 四个新 writingMode）**；部署验证与备份位置在第一节，接下来做真机验收。
   两台真机的验收（说一段／追问我／今天的小问题／编者）还没做，清单在第一节。
   **1.0.2（构建号 75）已交付**：发版提交 `c8adcde33302c2bbc576463773ac6cf26426b10e`，标签 `v1.0.2`，run 35691714051 四作业全绿，Release 与校验和在第一节第一条；1.0.1（构建号 74）的标签出包失败、未发布，内容并入 1.0.2。
   **1.0.3「减法」在 main、未出包**（第一节第一条）：拿掉出生的故事模块（问题并入小问题）、写信引导、时光系列、足迹、长图、重放、分成几件事、AI 分组与起个头；AI 不看照片；服务端未动。出包要主人拍板：构建号 76、CHANGELOG 顶节补构建号、README 当前版本、轻量标签 v1.0.3。

第三步·真机验收与下一版：
- 先按 docs/plans/PLAN-SHARING.md 第五节做真机验收（主人两台手机 + 家人一台）——两台手机真跑同步从未验证过；主人用 Build 71/72 的手机点一次「远端备份 → 现在备份」确认服务端兼容。
- 1.0.0 之后**不加新功能，只做优化**（主人 2026-09-21 拍板）：待办清单在 HANDOFF 第四节（真机验收、服务端部署、性能、提示词坏例子、偶发测试）。
- 不做：新功能、家史（主人 2026-09-21 拍板）、实时协作、云端搜索、第三方云盘、人脸识别、真地图足迹；时光系列／足迹／长图／重放／照片分组／起个头 2026-09-22 拆掉，不再回来。
```

## 三、交付清单与 Build 72 进度

### Build 70／71 交付清单（Build 70 安装包 run 35494972998；Build 71 安装包见第一节）

| 提交 | 内容 |
| --- | --- |
| 47840da | 计划展开：`docs/plans/PLAN-BUILD-70.md`（环境事实、五条设计定稿、21 个提交的签名与测试清单） |
| 4c3fa16 | 宪法重构：`local_boundary.py` + 6 例测试；`SERVICE_URL` 进 brand.ts；AGENTS 新句 |
| 397bb90 | 服务端对象库与路由：`backup-store.ts` 流式落盘、`/api/v1/backup/*` 八个端点、配额列与清单表、管理端、`wipe-backup`；10 例测试 |
| 6672e66 | 主人视角与部署：`verify-service.py` 备份段、`probe-upload-limit.py`、deploy/README 新节（**生产部署的 SHA**） |
| 93c73f2 | 反代探测匿名模式；README 记录 2026-09-20 部署与探测结果 |
| 04d7cc7 | 格式层：`XIAOMEI3`、`BackupSet`、`VOLUME_LIMIT` 2 GiB、`planVolumes` |
| faf1cb8 | 文件层与夹具：`CHUNK`、`blobDirectory`／`blobFile`／`blobPartFile`；vitest 假件补齐 |
| 22a889e | 本机 blob 库：`.xmbm` 清单 + 按 sha256 存一份照片；读回、保守回收、列表；恢复时保护正要恢复的那份 |
| b1082ca | 分卷导出：`backup-export.ts`（单卷逐字节同旧格式、分卷 `-vol1of3`、空间预检）；备份页导出状态机、停止、多选恢复 |
| 923c30d | DESIGN：备份页补上 blob 库、分卷、停止、多选恢复的规则 |
| 1053d99 | 密码学：`src/sync/crypto.ts`（恢复码即钥匙、HKDF 派生 id／nonce、`ANANOBJ1` 对象格式、`sealSmall`、自带 base64）；依赖钉版 |
| dbc6b46 | 状态、规划器、传输层（XHR、可注入 HttpClient、错误映射）；`ai/session.ts` 抽出凭证读写 |
| 3ce80b0 | 引擎：`runRemoteBackup`／`verifyRemoteBackup`／`restoreFromRemote`；测试假件抽到 `tests/helpers/` |
| 6f2aecf | 界面：`RemoteBackupCard`（三态）与 `RecoveryCode` 页；双端冒烟断言离线只有「去登录」 |
| 879f51f | 端到端：真服务端子进程跑完整闭环；CI quality 作业多装一次 server 依赖 |
| 7477504 | 收尾：CHANGELOG／README／HANDOFF／PLAN 实施偏离、app.json 70（**打包源码 SHA**） |
| da198e7 | 交付：HANDOFF 记 run 35494972998 与 APK／IPA 校验和 |
| dfdcad8 | 复查·CI：`ci.yml` 也给 server 装依赖，main 恢复全绿（run 35509330400） |
| 26e4e19 | 复查·服务端：换大不免配额、清单登记的对象 prune 不删、先删索引再删对象、启动清空临时目录（**待部署生产**） |
| 347200a | 复查·远端界面与状态：`moveSync`、整页锁、停止与离开、钥匙串出错说明、清单登记 objects（未打包） |
| 81d1ffe | 复查·本机备份：收拾吞错、空间预检、读坏与写不进分清、多卷先验长度、停止到块、远端恢复钉子（未打包） |
| c62e744 | 复查收尾：CHANGELOG、HANDOFF、deploy/README 契约、`verify-service.py` 备份段 |
| 412f8e0 | Build 71 收尾：app.json 71、CHANGELOG「Build 71 — 复查修复」、README、HANDOFF（**Build 71 打包源码 SHA**） |
| （本次） | 交付：HANDOFF 记 run 35511463957 与 Build 71 的 APK／IPA 校验和 |

### Build 72「家人一起写」（2026-09-21，已交付：`7cdc42d`，run 35590928208）

**目标**（`docs/plans/PLAN-SHARING.md`，主人 2026-09-21 晚批准，16 个提交）：一是**落款**——每段时光都有「谁写的」，用关系称呼（爸爸／妈妈／外婆…），不是账号名；
二是**一起写**——一台服务 = 一家人，每台手机发布自己的全量清单（就是现有的 `.xmbm`），拉别人的清单做三方合并，自动同步默认开，冲突不弹窗、输的一版留底可换回。

| 提交 | commit | 内容 | 状态 |
| --- | --- | --- | --- |
| 1／2 | `848a0ca` | 服务端：家庭对象空间 `<root>/family/objects`、按设备存清单 `backup_manifests_v2`、配额按家庭算、prune 的 keep 并上全部设备清单、旧行迁成 `legacy:` | 已推 · 已部署 |
| — | `6db5b24` | `deploy/README.md` 与 `server/scripts/verify-service.py` 跟上家庭空间 | 已推 |
| 3 | `473339b` | 端到端跟上（删库只作废本成员清单）；**这就是生产的 SOURCE_SHA** | 已推 · 已部署 |
| 4 | `5247d50` | `RecordContent.by`（1–20 字）、`settings.by`（本机默认落款，不同步）、`Library.tombstones`、`unsignedRecords`／`stampUnsigned`，六处删除一律立碑 | 已推 |
| 5 | `d3c5ead`（+`71d4b08`） | 编辑页落款：`SignatureButton` 基元，正文框下「—— 爸爸」／「谁写的？」点开选称呼 | 已推 |
| 6 | `deb3621` | 落款到处可见：阅读页 `record-by`、纪念卡、纪念册、开放归档、搜索「谁写的」chips、年度统计一行 | 已推 |
| 7 | `ccfed1f` | 「我的落款」页（`Signature` 路由）、书架落款卡、提醒卡新增 `conflict`／`by` 两种 | 已推 |
| 8 | `2d25e95` | 传输层 `manifests()`／`deleteManifest()`／`wipeFamily()`、`RemoteStatus.manifests`、`RemoteManifest.deviceId?`；`RemoteState` 升 v2（v1 读入即升级）；`base.json`／`conflicts.json` | 已推 |
| 9 | `fdcbe8f` | `mobile/src/sync/merge.ts`：纯函数三方合并（36 例测试） | 已推 |
| 10 | `318274e` | `mobile/src/sync/family.ts`：`runFamilySync`／`joinFamily`／`leaveFamily`；`engine.ts` 抽出 `fetchManifestOf`／`pushManifest`／下载单个 blob；删 `restoreFromRemote` 与 `RecoveryCode` 的恢复态（路由 `mode: "show" | "join"`） | 已推 |
| 11 | `f552b95` | `FamilyCard.tsx` 取代 `RemoteBackupCard.tsx`（testID `remote-card` 等保留；未加入态按服务状态给「继续一起写／加入／开始一起写」，退出只走 `leaveFamily`）、`Conflicts.tsx` 与路由、纯函数 `sync/conflicts.ts`（`restoreLoser` + `repairReferences`）、`SyncStatusContext`（`local/context.tsx` 类型 + `sync/status.ts`）、书架冲突卡（✕ 当天沉默）、「我的」副题、`dateTimeLabel`、DESIGN | 已推 |
| 12 | `4ee5eaa` | `src/sync/auto.ts`：`createAutoSync`（单飞、保存后 30 秒防抖、忙时顺延、后台中止、自身写库不触发）+ `useAutoSync`（`AppState` 只认 active／background，`inactive` 不动；冷启动延 2 秒；NETWORK／TIMEOUT／INCOMPLETE 这类暂时失败不记 `lastError`）；`status.ts` `markLocalBusy`；`store.ts` 共享根字段未改时保留引用；`FamilyCard` 读 `SyncStatusContext`，自动同步中显示「正在同步…」并禁用动作；外观页「回到应用时自动同步」开关；备份页与归档卡不与同步并发、只在状态行说明；「我的」副题补「上次同步没成功，点开看看」 | 已推 |
| 12b | `77b3cbe` | 同步清单单独一份 `sync/manifest.xmbm`（不进「本机保留的备份」、不占三份保留位，`collectBlobs` 护住它引用的 blob，退出时删）；`RemoteState.lastPush {entitiesSha, manifestSha}`——实体段与远端里自己的索引都没变就不重传清单、不重发索引；顺手修 `pushManifest` 上传计数放在可选进度回调参数里、自动同步（不传回调）时 `pushed` 永远为 0 | 已推 |
| 13 | `63e1c14` | `tests/helpers/family-two-phones.ts` 同一段两台手机的故事三种模式跑（假传输内存／假传输 SQLite／真服务端 e2e，第二成员经 `POST /admin/members` + `/login`）；双端冒烟 `editor-by` → `editor-by-爸爸` → `record-by`「—— 爸爸」；宪法第 6 条「`src/sync`／`src/ai` 不得 import 本机页面组件，只放行 `ui`、`context`」（`Photo` 移入 `ui.tsx`）；删 `runRemoteBackup` | 已推 |
| 13b | `3b7925a` | records／letters 加 `ancestors?: string[]`（前几版内容哈希前 16 位，≤ 8）；`merge.ts`「本机没动」分支：远端版有世系却不含本机哈希 → 本机也留底（loser=本机版、device null）；旧版没世系不出卡；`hash.ts` 从 merge 搬到 local；保存／补落款／改信／封存／拆封／换回留底都延续世系；两台手机故事恢复并发场景（两边各一张留底、重跑幂等）| 已推 |
| 14 | `7cdc42d` | CHANGELOG／README／HANDOFF／`app.json` 72（定点改 `\uXXXX`）+ 派发 `mobile-build.yml`（完整 40 位 SHA） | 已推 · 已出包（run 35590928208，校验和在第一节） |
| 15 | `f99699f` | 扉页：`profile.fullName`／`profile.motto`（可选，≤ 20／≤ 60 字）、应用内扉页／纸书扉页／归档页头同序「名字 → 本名·小名 → 来历句 → 生日」、「我的」页那半句改成「入淮清洛渐漫漫」 | 已推 |

**关键决策**

- 主人拍板四条（计划第七节）：自动同步**默认开**（回前台 + 保存后 30 秒，照片一起下）；同一段两台都改 = 时间新者胜 + 留底可换回，**不弹窗**；
  **「从远端恢复」整体去掉**（换机就是「加入」，空库合并等于全量拉取）；半句话用「入淮清洛渐漫漫」，整句诗与本名进扉页（提交 15 做）。
- 哪些同步：records、media、albums、series、persons、letters 与根字段 profile／yearNotes／yearCovers／yearBooksBoundAt／tombstones。
  **不**同步：drafts、selections、settings（含 `settings.by`）、receivedShares、nudgeClosedAt、lastExportAt、welcome、revision——草稿是这台手机的事。
- 补落款（`stampUnsigned`）**只写 `by`，不动 `revision`／`updatedAt`**：这不是内容编辑，不能在家人合并时压过对方后来真正的改动。
- 六处删除（记录／相册／系列／信／人物删除与人物合并的 source）一律立墓碑，否则合并会把删掉的东西送回来。
- 实施补充（我在提交 9 定的，已写进计划第三节第 5 条）：别人的清单是**整库快照**，输掉的旧版会一直躺在里面，只靠「上次同步的指纹」会把它当新改动送回来——
  所以 `base.json` 除 `merged`（上次同步后每个实体的指纹）外还记 `known`（本机处理过的全部版本，每实体最多 32 枚）；
  本机没动而远端那版**比本机还旧**（对方恢复了旧备份／时钟不准）→ 留本机并出冲突卡，而不是倒退；同秒、以及没有时间的根字段与人物，按内容哈希定赢家（两台手机算出同一个）；
  年度寄语两边都改则两段都留（赢家在前）；相册／系列并集有新增时盖上合并时刻；系列里同一条记录／同一张照片只留一处；
  `revision` 不进指纹（它只是本机草稿的防撞计数，接别人的版本时在本机原值上加一）；冲突留底只记 records／letters，另一方是删除时 `winner.deleted = true`。

**改了哪些文件**（手机端提交 4–9：48 个 `mobile/` 文件 + `DESIGN.md` + 计划，合计 +3108／−117 行；服务端提交 1–3 另算）

- 本机模型与界面：`mobile/src/local/` 的 `model.ts`（+116）、`ui.tsx`（+102，`SignatureButton`）、`Settings.tsx`（+86，「我的落款」页）、`Editor.tsx`、`Record.tsx`、`Shelf.tsx`、`Year.tsx`、
  `search.ts`、`recap.ts`、`nudge.ts`、`keepsake.ts`、`book.ts`、`yearbook.ts`、`archive-layout.ts`、`archive-viewer.ts`、`photo-metadata.ts`、`services.ts`、`Albums.tsx`、`Series.tsx`、`navigation.ts`。
- 同步层：`mobile/src/sync/` 的 `transport.ts`（+102）、`state.ts`（重写，+208）、`merge.ts`（新，612 行）、`engine.ts`（改为写 v2 状态）、`RemoteBackupCard.tsx`／`RecoveryCode.tsx`（跟上 v2）。
- 服务端（提交 1–3）：`server/src/backup-store.ts`（家庭空间 + `migrateMemberSpaces`）、`store.ts`（`backup_manifests_v2`）、`app.ts`（`/backup/manifests`、`DELETE /backup/manifests/:deviceId`、`/admin/backup`）、`index.ts`、`manage.ts`、`tests/backup.test.ts`、`scripts/verify-service.py`、`deploy/README.md`。
- 测试：新增 `mobile/tests/sync-merge.test.ts`（987 行 36 例）、`sync-state.test.ts`（262 行 7 例）；扩充 `sync-transport.test.ts`（+77）、`sync-engine.test.ts`、`local-core.test.ts`（+112）、`local-backup.test.ts` 等 14 个既有测试文件。
- 文档：`docs/plans/PLAN-SHARING.md`（提交 8／9 的实施修订已回写）、`DESIGN.md`（落款相关页面规则）。

**已验证**

- mobile 门禁在提交 9 之后整套跑过且全绿：**34 个测试文件 398 个测试**、`npm run typecheck`、`npm run lint`、`python3 mobile/scripts/verify-local-boundary.py`、9 例 python 边界测试（`TMPDIR=/var/tmp/anan-tests`）。
- 合并语义由 36 例单元测试覆盖：首次加入拉全量、单边改、双边改（LWW／同秒比哈希／内容相同不算冲突）、过时副本不复活、输的一版不回潮、幂等、
  删 vs 改 vs 双删、墓碑并集、相册两边各加、系列同月各选一张、同名人物合一且标记改写、根字段各情形、只被别人草稿引用的素材不下载、不改传入对象。
- 服务端：提交 1–3 在 staging（3141，独立 env 与数据目录）跑过 `verify-service.py` 全绿，并用**生产数据副本**加合成的成员目录／旧清单行演练过迁移（2 moved／1 member dir removed／旧表迁成 `legacy:` 行），
  之后才切生产 `473339b`（`/healthz` 本机与经代理的 HTTPS 都对得上）。切换前整目录拷到 `/opt/anan-ai/data.bak-20260921-0220`，旧 env 在 `service.env.bak-20260921-0220`。
- 工作区干净：提交 9 之后 `git status` 无改动、无未跟踪文件。

**待验证 / 未解决**

- **主人还没用 Build 71 的手机点一次「远端备份 → 现在备份」**验证新服务端兼容（旧手机走 `GET/PUT /backup/manifest`，服务端按设备记、按成员回退）。这是唯一一条真机兼容性风险。
- **两台手机真跑同步从未验证**：`family.ts`（提交 10）、`FamilyCard`／`Conflicts`（提交 11）只有假传输与假文件系统的单元测试；素材下载、物化、一次 `store.change` 落库这条路径没在真机上走过。
- **自动同步（提交 12）只有假定时器与假 `AppState` 的单元测试**：真机上回前台触发、`inactive` 不中止、应用锁下照常同步、每次开应用的耗时与流量都没量过。
- **本次会话没查 main 的 CI**：`2d25e95`／`fdcbe8f` 的 run 没看过（按 AGENTS.md 常规推送不等 CI；**开工前先看一眼 main 最近一次 run 是否红**）。
- 两个后台实现代理（提交 10 与提交 15）于 2026-09-21 05:40 因会话额度（HTTP 429）中断，**没有留下任何文件改动**（已核对 `git status` 与 `grep`：`family.ts`／`fullName`／`TAGLINE` 都不存在），重新开工即可，不必清理。
- 遗留：服务端 `usage()` 每次 PUT 全量 stat 家庭目录（家庭规模够用，上万对象再做缓存）；真机 XChaCha20 MB/s 仍未实测（Build 70 起就欠着，阈值 5 MB/s）。

**下一步（按顺序）**

1. 提交 10 与 11 已推（见上表）。提交 11 的验收决策：冲突卡 ✕ 改为当天沉默（`nudge.ts` 不再对 conflict 恒不关）；「用这一版」换回后必须 `repairReferences`（否则相册／选材封面与系列条目悬空、坏库落盘、下次开库失败——已有回归测试）。
2. 提交 12 已推（`4ee5eaa`）。验收决策：iOS `inactive`（拉通知中心、来电）不中止同步，只有 `background` 才中止；自动尝试的暂时性失败（连不上、超时、资料刚变）不记 `lastError`，否则地铁里每次开应用副题都挂着「上次同步没成功」；自动同步进行中家人卡显示「正在同步…」、备份页顶卡状态行写「正在与家人同步，稍等一下。」，被互斥挡住的操作都要在状态行说明，不能静默无反应。
3. **12b（审查 12 时发现的两个既有机制在「每次回前台都同步」下成了问题）**：`pushManifest` 每次都经 `createBackup` 往 `backupDirectory` 写一份普通命名的 `.xmbm` 并 `pruneBackups(3)`——开三次应用，她自己导出的三份保留备份就被同步快照挤光；`meta.createdAt` 让清单字节每次不同，内容没变也重传清单、重发索引，家人手机再各下一遍。已推 `77b3cbe`（见进度表 12b 行）。
4. 提交 13 已推 `63e1c14`。**13b 的来由**：用两台手机的真故事跑计划第五节第 3 条（两台各改同一段 → 书架各有一张冲突卡）时发现只有后同步的那台有留底：A 先发布过自己的版本，它就成了 A 的合并之基，B 的版本到 A 时走「本机没动」分支被当普通更新接收——爸爸的字在爸爸手机上被换掉且无提示。修法是给版本加世系（`ancestors`），A 一看 B 版不是在自己那版之上改的就也留底；旧版本没有世系不出卡。任务书 `/tmp/astra-task.wareTx/task-13b.md`。**13b 已推 `3b7925a`**（Astra 一轮通过；沙箱外门禁 43 文件／583 例全绿，含真服务端 e2e 与两台手机并发场景；`validateLibrary` 校验世系形状：≤ 8 枚小写 16 位十六进制；归档输出与阅读器不带世系）。之后 → 14 收尾出包（`app.json` 72，派发 `mobile-build.yml` 用完整 40 位 SHA）→ 15 扉页本名与诗。**15 已推 `f99699f`**（Astra 两轮；首轮打回 4 处：纸书扉页把生日排在来历前（我任务书里坐标写反）、归档阅读器把「本名 · 小名」注进内联 script 字面量再防 `</script>`、只填本名没填昵称时纸书标题为空、资料页来历框顺序与多行高度。定下的规则：三处扉页同序「名字 → 本名 · 小名 → 来历 → 生日」；标题 = 昵称 ‖ 本名 ‖ 兜底，「本名 · 小名」行只在两者都有时出现；纸书两个新字段都没有时坐标不变，任一存在用 0.575／0.615／0.66／0.705／0.76、缺行不补位；应用里不写死本名与诗句，只有「我的」页那半句「入淮清洛渐漫漫」是写死文案）。
5. 校验和已记回第一节（run 35590928208）；剩真机验收（计划第五节，主人两台手机 + 家人一台）。

**接手提交 13 要用的现成接口**（别重写）

- `auto.ts`：`createAutoSync(deps)→{onForeground,onBackground,onLibraryChange,dispose}`（纯排期，假定时器可测）、`sharedChanged(prev,next)`、`useAutoSync(store)`（只在 `App.tsx`）；`status.ts`：`markSyncRunning`／`isSyncRunning`／`subscribeSyncRunning`、`markLocalBusy`／`isLocalBusy`、`readSyncStatus`、`useSyncStatusValue`；`local/context.tsx`：`SyncStatus {joined,lastSyncAt?,lastError?,conflicts,running}`、`useSyncStatus`。
- 12b 之后：`local/backup.ts` `createSyncManifest(state, onProgress?, signal?)` 写固定的 `sync/manifest.xmbm`（`files.ts` `syncManifestFile()`），`collectBlobs` 护住它；`RemoteState.lastPush {entitiesSha, manifestSha}`；`pushManifest` 多返回 `entitiesSha`；`syncFamily` 里 `unchanged` 判定在合并落库之后。
- 提交 13 的宪法新规不能按计划字面写成「`src/sync/**` 不得 import `../local/*.tsx`」——`FamilyCard`／`Conflicts`／`RecoveryCode` 都用 `../local/ui` 与 `../local/context`；应写成「`src/sync/**` 不得 import 本机页面组件（`Shelf`／`Settings`／`Editor`／`Record`…）」。

- `transport.ts`：`status()→{keyId,manifestUpdatedAt,objects,bytes,limitBytes,freeBytes,manifests}`、`missing`、`put`、`get`、`putManifest(keyId,index,objects)`、
  `getManifest()→{deviceId?,keyId,index,updatedAt}|null`、`manifests()→{deviceId,memberId,deviceName,keyId,index,updatedAt}[]`、`deleteManifest(deviceId)→{pruned}`、`prune`、`wipe`（本成员）、`wipeFamily`（主人）。
- `state.ts`：`RemoteState v2 {version,enabled,keyId,joinedAt,autoSync,seen,lastSyncAt?,lastSyncSummary?,lastError?}`、`freshRemoteState`、`readRemoteState`（async）、`writeRemoteState`、
  `readBase`（async）／`writeBase`、`readConflicts`（async）／`writeConflicts`、`clearSyncFiles`、`loadKey`／`storeKey`／`forgetKey`；三个 JSON 都在 `documents/anan-v1/sync/`，都是 `.part` + `moveSync`。
- `merge.ts`：`mergeLibraries(local, remotes: RemoteSnapshot[], base, now) → {next, conflicts, wantedMedia, base, pulled}`、`fingerprintOf`、`contentHashOf`、`canonical`／`hashOf`、
  `unionItems`、`unifyPersons`、`repairReferences`、`SHARED_KINDS`、`KNOWN_LIMIT`／`emptyBase`、类型 `SyncBase`／`Conflict`／`RemoteSnapshot`／`MergeResult`。
  `wantedMedia` 已经剥掉对方的 `thumb`（那是对方手机的产物），物化后再把本机的 `thumb`／`width`／`height` 补回去。

## 四、后续路线：1.0.0 之后只优化（2026-09-21 主人拍板）

第八节次序 2、3、4、6（73「说一段」、74「出生的故事」、75「访谈者」、76「年度册的编者」）已随 1.0.0 做完（第一节第一条有提交号）；家史（5）不做；74 的模块 2026-09-22 拆掉、问题并入小问题（第一节第一条）。**此后不加新功能，专注优化。** 按轻重排的优化待办：

1. **服务端 `b76439d` 已部署，待真机验收**（部署证据见第一节）。用 1.0.0 的手机各试一次：说一段（安卓走服务）、追问我、今天的小问题、AI 建议目录。
2. **真机验收**（第一节「真机待验」那一条）：iPhone 本机识别、安卓回退、二进制上传、两台手机同步 `yearPicks`（`story` 已是只读旧字段）；PLAN-SHARING.md 第五节的两台手机同步验收从 Build 72 起一直欠着；真机 XChaCha20 MB/s（阈值 5 MB/s）从 Build 70 起欠着。
3. **提示词坏例子**：主人用一周，把「问得不好」「写得不对」的例子记到 `docs/AI-PROMPTS.md` 末尾「坏例子」一节，改提示词、重部服务端即可（`prompts.test.ts` 逐字对照手册，改一处要改两处）。`server/scripts/probe-text.ts` 可随时重跑（需 CPA 密钥与 `CPA_BASE_URL`）。
4. **偶发与性能**：server `tests/backup.test.ts`「temp files never linger」的偶发已查明并修掉（`52b5f76`）：不是临时文件，是两次 `status()` 之间 `freeBytes` 现查磁盘漂了几 KB；服务端 `usage()` 每次 PUT 全量 stat 成员目录（上万对象再做缓存）；`archive-layout`／`yearbook` 在千条记录时的耗时可用 `tests/local-scale.test.ts` 的路子量一下。
5. **纸书版面真机看 PDF**：章首引语（`BookChapter.lead` 多行）、编者书名替换后的封面。
6. **文案与可达性**：三个访谈入口的文案是工作者自定的（见 `/tmp` 任务报告已并入 CHANGELOG／DESIGN），主人试用后统一口吻；同意书 v2 文案偏长，可再精简。
7. 密文对象位腐坏无自愈（PROJECT-AUDIT 残留风险 ③，不急）。
8. **服务端减法已随 1.0.3 做完（部署记录见第一节）**：删掉 group 路由、generate／letter 与相关提示词、ASK 故事主题句；手册六个 text 块与 `server/tests/prompts.test.ts` 已同步，所有手机请求仍带 `photos: []`，服务端保留该字段且只接受空数组。已于 2026-09-22 13:52 UTC 部署生产（第一节「服务端 `8be3a46` 已部署生产」）。

## 五、踩坑清单（务必先读，历史细节在 docs/plans/ 各计划的对应小节）

- 改原生 Kotlin 前先用独立 kotlinc 对 $ANDROID_HOME/platforms/android-36/android.jar
  编译一份用法一致的 snippet 验证（Build 56/57 的教训）。
- mobile-build 派发必须用完整 40 位 SHA。
- 成册取图两个平台不一样：安卓 toDataURL 按传入像素另开位图，iOS 只按视图自身点数画
  （原生 drawRect: 用的是 [self bounds]），所以 iOS 的屏外舞台必须就是目标尺寸。见 book-export.ts 的 captureGeometry。
- 素材行里的 width/height 是 512 缩略图的尺寸，不是原图尺寸；要原图尺寸得自己 renderAsync 一次（prepareBookPhoto）。
- app.json 含 \uXXXX 转义，定点编辑，别整文件重写。
- 手势回调里调用的每个函数都要标 "worklet"（Build 62 的 Android 原图缩放必崩）。
- 页面改成 Page scroll={false} 自带列表时，必须补回 keyboardShouldPersistTaps="handled"
  与 automaticallyAdjustKeyboardInsets，否则键盘弹着时第一次点击会被列表吃掉（Build 62 iOS 回归红过）。
- 库里的实体是冻结的：一次 change 里只能整个替换（editEntity），不能原地改。Object.assign 绕得过类型检查，绕不过冻结。
- 新增实体种类必须一次接全：ENTITY_KINDS、Library 类型、emptyLibrary、normalizeLibrary、forkLibrary、
  validEntity（放在 persons 兜底分支之前）、referencedMedia，以及 scripts/local_fixture.py 的 empty() 与 ENTITY_KINDS
  （local-core 有一条测试盯着 fixture 与 emptyLibrary 键序一致）。Build 68 的 letters 就是这么接的。
- React Compiler 的 lint 很严：渲染期不能读 ref（录音入库后的素材要放 useState 里再读）；useMemo 的依赖要缩到真正用到的集合
  （state.records 而不是 state），派生量交给编译器自动记忆时别再手写 useMemo，否则报「memoization could not be preserved」；
  useMemo 里没用到的依赖会被报「unnecessary dependency」——列表这种「操作结束后重读」的东西用 useState + 显式刷新。
- uiautomator 只 dump 看得见的节点：书架与长表单里首屏之外的目标用 smoke-android.py 的 tap_seek（滑动再找）／seek（只找不点）。
- Android APK 用持有者私有 release 密钥签名（GitHub Secrets：ANDROID_KEYSTORE_BASE64/PASSWORD/ALIAS/KEY_PASSWORD），
  指纹钉在 mobile-build.yml。
- （Build 69）原生页头已下线：返回是 `Page` 里的 `IconButton`（testID `page-back`），iOS 冒烟点返回不能再用 `BackButton`；
  编辑页与写信页用 `usePreventRemove(!allowExit)` 拦全部退出，保存中按返回记到 `pendingExit`、本轮结束再放行；
  隐藏原生页头后 `useHeaderHeight()` 为 0，键盘偏移用 `useTopBarOffset()`；`Modal` 里 SafeAreaView 不可靠，
  BookPreview／PhotoPicker 用 `useSafeAreaInsets().top` 自己垫 + `Page top={false}`。
- （Build 69）`GlassDepth`：`Card`／`BottomBar` 给深度 +1，里面的 `Button`／`Glass` 渲染实色纸面，别指望卡里再套一层液态玻璃；
  按钮四级里一页只放一个 `primary`。
- （Build 69）冒烟标签：「我的」入口的 accessibilityLabel 是「我的」（testID `open-settings` 不变）；`SettingsRow` 的副题放在
  accessibilityValue 里、标签保持原文，双端冒烟才能按「AI 设置」「备份与恢复」文本命中；Android 的 desc 会拼成「标签, 值」。
- （Build 70）server 用 Node 原生类型剥离跑 `.ts`：**不能写 TS 参数属性**（`constructor(public x)`），要显式声明字段；
  store.ts 与 backup-store.ts 不能互相 import（`DEFAULT_BACKUP_LIMIT` 只放 store.ts）。
- （Build 70）Fastify 的 4xx（如 `FST_ERR_CTP_INVALID_CONTENT_LENGTH`）要在错误处理器里原样透传状态码，否则会变成 500；
  `application/octet-stream` 走 passthrough 解析器，不受 bodyLimit 保护，得自己按 Content-Length 预检 + 落盘计数双重限流。
- （Build 70）这台开发机就是 VPS：**别对生产 3140 跑 verify-service.py**（会建测试账号并调模型），起一个 3141 的 staging 容器跑完再 down；
  shell 里有 http_proxy，对 127.0.0.1 要 `env -u http_proxy -u https_proxy -u ALL_PROXY …`；`/tmp` 是满的 tmpfs，mobile 与 server 测试都要 TMPDIR。
- （Build 70）Hermes 没有 `crypto.getRandomValues`：主密钥只能 `expo-crypto` 的 `getRandomBytes`，noble／scure 的随机函数真机上会抛；
  所以 nonce 全部按内容派生（HKDF(K, 内容 sha256)），连清单索引也不用随机数。`btoa`／`atob` 不保证有，crypto.ts 自带 base64。
- （Build 70）vitest 里 `vi.resetModules()` 之后动态 import 的模块里的类是另一份定义：`toBeInstanceOf(SyncError)` 会假失败，按 `name`／`code` 认；
  4 MiB 的 Buffer 别交给 `toEqual` 深比较（几秒起步，会撞 5 s 超时），用 `Buffer.equals`。
- （Build 70）expo-file-system／expo-sqlite 的假件在 `tests/helpers/`，用 `vi.mock(mod, async () => (await import("./helpers/…")).create…(env))`，
  env 由 `vi.hoisted` 提供；假件的 `list()` 会区分子目录（blob 库是两级目录）。
- （Build 70）服务端 prune 有一小时宽限：刚被替换的旧清单对象在测试里还在，断言对象数时要算上。
- （Build 70）iOS 冒烟「恢复这份备份」恢复的是 seed 的 v1 `baseline.xmb`（列表里唯一一份）；别在 seed 里再预置 `.xmbm`，会排到它前面。
- （Build 70 复查）`ci.yml` 与 `mobile-build.yml` 的 quality 步骤要一起改：端到端测试拉起真实服务端，两处都得 `npm ci` server；
  只改一处 main 就连红（879f51f 的教训）。修 CI 红时看 `gh api repos/{owner}/{repo}/actions/jobs/<id>/logs`，`--log-failed` 有时是空的。
- （Build 70 复查）服务端 prune 契约：`PUT /backup/manifest` 带 `objects`，服务端并入 keep；远端已有清单时 `keep: []` 一律 400
  （`verify-service.py` 备份段据此改过，别再传空 keep）；同 id 重传按多出的字节算配额。服务端 `.strict()` 不认未知字段——**先部服务端再出手机包**。
- （Build 70 复查）expo-file-system 的 `File.move` 返回 Promise：同步函数里要用 `moveSync`（`state.ts` 吃过亏）；
  `tests/helpers` 假件的 `move` 现在故意晚一拍，忘了 await 会被测出来。
- （Build 70 复查）远端恢复的钉子 `restoring-<stamp>-<sha8>.xmbm.part` 放在 backups 目录：`collectBlobs` 认它、`retainedBackups`／列表／启动救援不认
  （`isRetainedBackup` 只认 `.xmb`／`.xmbm` 结尾），`pruneBackups` 七天后清；iOS 冒烟的 glob `anan-*.xmb*` 碰不到它（前缀不同）。
- （Build 70 复查）备份页的本机按钮与远端卡共用一把锁：`locked = busy || remoteRunning`，新加按钮用 `locked` 别用 `busy`；
  `restoreBackup` 现在接受 `signal`，停止会以 `BackupStopped` 抛出。

- （书架重排）横向封面条只适合「一条里有好几张」的区块：每区一条、每条一张时就是一列孤零零靠左的封面（主人 2026-09-20 真机截图）。
  数据稀疏时的首页要按「一段时光、一个月、一年」的家庭来看，不能只看夹具数据的 `home-390.png`；新增区块先问「只有一本时长什么样」。
- （Build 72）vitest 里**只要 import 链碰到 react-native 就会报 `Flow is not supported`**：`src/sync/state.ts` 经 `crypto.ts` 碰 `expo-crypto`，
  纯逻辑测试也得 `vi.mock("expo-crypto", …)`；`src/local/services.ts` 经 `files.ts` 碰 react-native，服务层的测试只能放进已经备齐原生假件的 `tests/local-backup.test.ts` 里动态 import。
- （Build 72）`tests/helpers` 的 expo-file-system 假件里 `Paths.document` 就是 `env.root` 本身：同步目录的真实路径是 `<env.root>/anan-v1/sync/`，不是 `documents/anan-v1/sync/`。
- （Build 72）家人合并的基不能只记「上次同步的指纹」：别人的清单是整库快照，输掉的旧版会一直躺在里面，必须再记一份 `known`（本机处理过的版本）才不会复活删掉／改掉的东西，也不会反复出同一张冲突卡。
- （Build 72）`Library` 的校验比想象严：时光系列里**每条记录、每张照片各只能出现一次**（并集合并后要去重），相册封面必须是册内某条记录的照片，
  合并后一律走一遍 `repairReferences` 再进 `store.change`，否则整库校验会把这一次同步整个拒掉。
- （Build 72）补落款这类批量写入只改字段、**不碰 `revision`／`updatedAt`**，否则它会在家人合并时压过对方后来真正的改动。
- （1.0.0）这台机的 shell 有 http_proxy 等六个代理变量（大小写都有）：**git push 与 gh 必须带着代理**（直连 github.com 超时）；
  只有对 127.0.0.1（`verify-service.py`、`curl …/healthz`、`probe-text.ts` 对 `127.0.0.1:8317`）才 `env -u` 掉全部六个并设 `NO_PROXY=127.0.0.1,localhost`。
- （1.0.0）CPA 的 ASR（`mimo-v2.5-asr`）只认 chat-style `input_audio`（wav／mp3），`/audio/transcriptions` 是 404，user content 里夹文本 part 会 400——所以 m4a 在服务端用 ffmpeg 转 wav，提示只放 system。
- （1.0.0）`verify-service.py` 的验证对象 id 随内容走（`0a002a7`）：家庭空间先到为准，固定 id 重复跑会读回上一次的字节而假失败。
- （1.0.0）Astra（Codex）沙箱不能监听端口、spawn python、写 `.git`，也没有 `/var/tmp`：它报的「环境限制」要在主会话重跑门禁核实；它若把 `result.md` 写进仓库要移出去再提交。
- （1.0.0）`server/tests/prompts.test.ts` 逐字对照 `docs/AI-PROMPTS.md` 的六个 ```text 块（顺序：SHARED、POLISH、RECAP、ASK、QUESTION、EDITOR）：改手册必须同步改 `prompts.ts`。
- （1.0.0）`mobile-build.yml` 的 `v*` 标签触发：要轻量标签，`github.sha` 才是提交本身；release 作业 `needs` 三个作业，任一红就不发。（1.0.1 实测附注标签也能过 quality 的 SHA 核对，`github.sha` 会解析到提交；仍按轻量标签打。）
- （1.0.1）XCUITest 的 `tap()` 原来只查 `isHittable`：元素半露在屏幕底边时，XCTest 点在可见部分的中心，落进 Home 指示条手势区会被系统吞掉、页面不动（run 35679134876，点击坐标 (90, 814.8)）。现在要求可见中心离底边 ≥ 60，否则先滚动。布局改动让目标恰好停在底边时最容易踩，证据包里的「Synthesized Event」附件（bplist）能读出点击坐标。
- （1.0.1）XCUITest 的坐标点击要想清楚键盘弹起后那一点是谁：`type()` 续写时点字段右下角挪光标，底栏随键盘贴到字段下沿后那一点成了工具栏的「文件」钮，点开系统文件浏览器、字段失焦，`typeText` 报 "Neither element nor any descendant has keyboard focus"（run 35681782720）。现在点首行右侧空白。
- （1.0.1）页内顶栏下面的 `KeyboardAvoidingView` 不要传 `keyboardVerticalOffset`：它的布局帧相对整屏 SafeAreaView、已含顶栏，再加只会把底栏抬高一个顶栏，键盘上方留一条空纸（1.0.0 起两版真机截图都有，`3638d96` 去掉）。
- （1.0.2 后）流水线拆成并行作业后，XCUITest 回归在全新 macOS 运行器上跑：第一次激活音频会话（`setAudioModeAsync`／`prepareToRecordAsync`）可能要三五十秒，「说完了」20 秒等不到（run 35694486774）。凡是首次触碰系统服务（音频、相机、相册）的步骤都给长超时，别按热身过的旧流水线估时。
- （CI 偶发）`statSync().mtimeMs` 有亚毫秒精度，`mtime < Date.now()` 对刚写下的文件不成立：0 宽限的清理要显式短路，别拿时间比。
- （1.0.3）**实体种类只增不减**：`series` 页面拆掉了，但 `ENTITY_KINDS`／`TOMBSTONE_KINDS`／`validEntity`／合并／归档都留着——`backup-format.ts` 拒收未知 kind 的整份备份，`validRoot` 拒收未知墓碑键，`disk.ts` 静默丢未知 kind 的行。旧字段（`RecordContent.story`、`settings.replayAudioId`、草稿的 `photoEvents`）也是只停写、不拒收：`validateStoredAI` 一旦返回 false 会经 `validEntity` 抛 `invalidLibrary`、整库打不开，所以旧 AI 任务要在 `normalizeLibrary` 里丢，不能在校验里拒。
- （1.0.3 部署）公网健康检查地址是站点根 `/healthz`，不是手机 `brand.ts` 的 `SERVICE_URL`（带 `/api/v1`）再接 `/healthz`——拼错会 404，切换脚本会当作失败自动回滚（2026-09-22 第一次切换就是这样回滚的，数据未动）。`docker inspect <容器>` 输出的是单元素数组，存档后要取 `[0]`。
- （1.0.3）冒烟 `result.json` 的键随功能删减（长图的 `yearbookSheet` 已删）；改 workflow 或写断言前先看 `smoke-android.py` 末尾的 `report.update(...)` 与 `smoke-ios-regression.py`。

## 六、环境备忘

- Node.js 24（本机 26 也能跑）；要跑 Android 真机需 Java 21 + Android SDK（ANDROID_HOME）；
  iOS 打包不需要本机 macOS——全部走 GitHub Actions。
- `gh` CLI 并 `gh auth login`（派发打包、查 Actions、设 Secrets 用）；git 凭据（HTTPS PAT 或 SSH 均可）。
- `npm run doctor`（expo-doctor）有两项需要连 exp.host，离线机器上会红（19/21），CI 上是绿的。
- 仓库根目录若有 `node_modules/`、`.next/`、`build/`（上一代 Next.js 残留，已被 .gitignore），可直接删。
- 生产服务在这台机：容器 `anan-ai-ai-1`，compose 项目 `anan-ai`，环境 `/opt/anan-ai/service.env`（改前先 `cp` 一份 `.bak-<时间>`），
  数据 `/opt/anan-ai/data`（含 `backup/` 对象库，UID 1000）。部署：设 SOURCE_SHA 后
  `docker compose --env-file /opt/anan-ai/service.env -p anan-ai -f deploy/compose.yaml up -d --build`。
- （可选但强烈建议）从旧机复制 `release-keystore/xiaomei-release.keystore` 母本另存；日常开发与 CI 打包都不需要它，只有轮换 Secrets 时用。

## 七、命令速查

```sh
git clone https://github.com/YePiXpert/family-time-capsule.git
cd family-time-capsule/mobile && npm install && cd ../server && npm install && cd ..
TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck && npm run lint        # 根目录命令 = mobile 三件套
(cd server && TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck)
python3 mobile/scripts/verify-local-boundary.py
python3 -m unittest discover -s mobile/scripts -p 'test_*.py'
# 出安装包（替换为最终交付提交的完整 SHA）：
gh workflow run mobile-build.yml --ref main -f source_sha=<完整40位SHA>
# 只跑规模基准：
npx --prefix mobile vitest run --root mobile tests/local-scale.test.ts --reporter=verbose
# 服务端 staging 验证（别对生产 3140 跑）：
#   起 3141 容器（/var/tmp/anan-staging/service.env：SOURCE_SHA、AI_DATA_DIR=/var/tmp/anan-staging/data、APP_PORT=3141，密钥路径同生产）
#   docker compose --env-file /var/tmp/anan-staging/service.env -p anan-ai-staging -f deploy/compose.yaml up -d --build
#   env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy NO_PROXY=127.0.0.1,localhost \
#     python3 server/scripts/verify-service.py --base http://127.0.0.1:3141 --container anan-ai-staging-ai-1   # 然后 … down
# 文本探针（真模型，12 条合成样例，人工看编造／禁词／能不能答）：
#   cd server && env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy CPA_BASE_URL=http://127.0.0.1:8317/v1 node scripts/probe-text.ts
# 发版（轻量标签触发 mobile-build.yml 的 release 作业）：
#   git tag v1.0.0 <交付提交SHA> && git push origin v1.0.0
```
