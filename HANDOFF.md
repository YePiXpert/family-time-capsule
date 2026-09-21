# 桉桉成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-20，Build 70「传家 · 中」已交付（源码 `7477504`，run 35494972998）；同日复查修了 4 笔（`dfdcad8`／`26e4e19`／`347200a`／`81d1ffe`），
> 服务端已切到生产（SOURCE_SHA `81d1ffe`）；**Build 71（复查修复版）已交付**：源码 `412f8e0`，run 35511463957 三作业全绿，APK／IPA 校验和在第一节；下一步 Build 72「家人一起写」。
> 2026-09-21 定位重述：新增 `PRODUCT.md`（不是相册，是一家人写给她的传家册；AI 从代笔改为访谈者与整理者），Build 72 改为「家人一起写」（落款先于同步），原 73「分享」不再单列——见第四节。主人同日拍板五项（PRODUCT.md 第九节）：落款用关系称呼、转写先本机后可用小米 MiMo 一类、「起个头」留着、App 一句话待选、1 与 2 都做；提示词整套在 `docs/AI-PROMPTS.md`。同日晚 `docs/plans/PLAN-SHARING.md` 起草完毕（落款 + 家庭对象空间 + 三方合并，16 个提交），待主人批。

---

## 一、当前状态快照（2026-09-20）

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
- **下一步**：Build 72「家人一起写」。计划已出：`docs/plans/PLAN-SHARING.md`（2026-09-21，16 个提交：服务端家庭空间 1–3 先部署，落款 4–7，同步 8–13，收尾 14，可选 15 扉页本名与诗），主人 2026-09-21 晚已批，第七节四条已拍板（自动同步默认开、冲突新者胜加留底、去掉「从远端恢复」、半句话「入淮清洛渐漫漫」+ 可选提交 15 做）。**执行中**，进度见第三节的 Build 72 清单。
  - **服务端已部署（2026-09-21 02:20）**：Build 72 提交 1／2（家庭对象空间 + 按设备清单）在 staging 3141 跑过 `verify-service.py` 全绿，并用生产数据副本 + 合成的成员目录／旧清单行演练过迁移（2 moved／1 member dir removed／旧表迁成 `legacy:` 行）后，
    生产切到 SOURCE_SHA `473339b62a5d9e0a984652e2bf7ce91571ad71de`（镜像 `anan-ai:473339b…`，healthy，本机与经代理的 HTTPS `/healthz` 都对得上）。切换前数据整目录拷到 `/opt/anan-ai/data.bak-20260921-0220`，旧 env 在 `service.env.bak-20260921-0220`；
    生产原本没有任何成员对象目录（主人还没用过远端备份），迁移只建了 `backup/family/`。回退到 `81d1ffe` 必须连同 `data.bak` 一起回退（旧版找的是成员目录与旧表）。
    **待主人**：用 Build 71 的手机点一次「远端备份 → 现在备份」确认兼容（旧手机走 `GET/PUT /backup/manifest`，服务端按设备记、按成员回退）。
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
4. 验证三件套：mobile 下 npm test、npm run typecheck、npm run lint（338 个测试）；
   server 下 npm test、npm run typecheck（30 个测试，server 没有 lint 脚本）；
   python3 mobile/scripts/verify-local-boundary.py；
   python3 -m unittest discover -s mobile/scripts -p 'test_*.py'。
   本机 /tmp 若是满的 tmpfs，跑 mobile 与 server 测试都要 TMPDIR=/var/tmp/anan-tests（先 mkdir）。
   本机若设置了 http_proxy/https_proxy，对 127.0.0.1 的请求要 env -u http_proxy -u https_proxy -u ALL_PROXY … 绕过。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·Build 71（复查修复版）安装包已交付（源码 412f8e0，run 35511463957，校验和在 HANDOFF 第一节，artifacts 2026-10-20 过期）：
   若主人本地还没存下 build-71 的 APK/IPA，提醒先 gh run download 存下来；过期后要重出同一版就用 412f8e0 的完整 40 位 SHA 重新派发
   mobile-build.yml（源码没变就不加构建号）。真机 XChaCha20 MB/s 由主人装机后观察，记在第一节。服务端已是 81d1ffe，不用再部。

第三步·Build 72「家人一起写」（计划 docs/plans/PLAN-SHARING.md 已写好、待主人批；下面是摘要，细节以计划为准）：
- 落款先于同步：每段时光有「谁写的」——落款是关系称呼（爸爸／妈妈／外婆…，主人拍板，不用账号名），这台手机设默认落款、每段可改，信的 from 已是先例；
  进阅读页、纪念卡、开放归档与纸书。改 Library 前先出 docs/plans/PLAN-SHARING.md 给主人批，落款与同步写在同一份计划里。
- 同步：第二台设备登录同一家庭账号、输入恢复码后从远端清单拉全量；记录 last-writer-wins（revision + updatedAt），
  媒体按 sha256 增量（远端对象 id 两台设备算得出同一个）；只在同一记录两端都改时提示冲突。
- 复用 Build 70 的 src/sync（crypto/planner/transport/engine）与服务端对象库；不做实时协作、云端搜索、第三方云盘、人脸识别、真地图足迹。
- 之后按 PRODUCT.md 第八节：Build 73「说一段」（iPhone 系统本机识别；国内安卓多半没有本机识别，走服务端转写，候选小米 MiMo 音频模型一类，逐段同意、服务端不留声音）
  → 出生的故事 → 访谈者（新增 writingMode，提示词按 docs/AI-PROMPTS.md 全文进 server/src/prompts.ts，含现有四条的重写）→ 家史 → 年度册的编者。原 73「分享」不再单列。
- App「我的」页那半句话主人要换但还没选定（PRODUCT.md 第九节备选），选定后只改 Settings.tsx 一行。
```

## 三、Build 70／71 交付清单（Build 70 安装包 run 35494972998；Build 71 安装包见第一节）

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

## 四、后续路线

定位与次序以 `PRODUCT.md` 第八节为准（2026-09-21 起草，待主人拍板；主人的想法：不能只做相册，AI 现在太简单，主要是为刚出生的女儿做纪念）。摘要：

- **Build 72「家人一起写」**（原「传家 · 下」家人一起记）：落款先于同步——每段时光有「谁写的」，再做第二台设备登录同一家庭账号、输入恢复码后从远端清单拉全量；记录 last-writer-wins（revision + updatedAt），
  媒体按 sha256 增量（Build 70 的对象 id 由钥匙 + 内容派生，两台设备天然一致）；只在同一记录两端都改时提示冲突。
  前置：70 的远端对象与清单已就位；改 `Library` 前先出 `docs/plans/PLAN-SHARING.md`，落款与同步写进同一份计划。
- **Build 73「说一段」**：编辑页录音 → 转写成正文，录音留在这段时光里；iPhone 走系统本机识别，国内安卓走服务端转写（候选小米 MiMo 音频模型一类），逐段同意、服务端不留声音。主人拍板 72 与 73 都做、紧接着做。
- **出生的故事**：一组带着人写的长故事（出生那天、怀孕、名字、我们怎么认识的），进第一本纸书的第一章。
- **访谈者**：AI 追问（新的 writingMode，只回问题，不写正文）；今天的小问题带上下文；写信引导。提示词整套（原则、共用底座、八条全文、客户端送什么、怎么验）已写在 `docs/AI-PROMPTS.md`，落地时连现有四条一起换。
- **家史**：给外公外婆爷爷奶奶的访谈与口述。
- **年度册的编者**：记录变长后 AI 帮挑、家人拍板；纸书章首引用家人原话。
- 原 73「分享」不再单列：家人是作者不是观众；不装 App 的亲戚用纪念卡、长图与纸书。
- 可选小件：`mobile-build.yml` 加 `release_tag` → GitHub Release（解决 artifacts 30 天过期）；远端备份的自动提醒（书架备份提醒里带上「远端」一句）。

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
- （CI 偶发）`statSync().mtimeMs` 有亚毫秒精度，`mtime < Date.now()` 对刚写下的文件不成立：0 宽限的清理要显式短路，别拿时间比。

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
#   起 3141 容器 → env -u http_proxy -u https_proxy python3 server/scripts/verify-service.py --base http://127.0.0.1:3141 --container <staging容器> → down
```
