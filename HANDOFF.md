# 桉桉成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-19，Build 68「传家 · 上」源码交付、构建号已占 68、安装包派发中（见第二节）。

---

## 一、当前状态快照（2026-09-19）

- **Build 67「AI 改为账号登录」**：交付提交 `dfbf592`，打包 run 35434384089 全绿。
  服务端同日部署到 capsule.yep.li 并按主人指示清库从零（/status initialized=false，等新 App
  首次「创建主人账号」）。APK SHA-256 `e484c4a1…bf4953`，未签名 arm64 IPA SHA-256 `0b4f8608…dec2c899`，
  本地存 `C:\vibe-coding\releases\build-67\`。
- **Build 68「传家 · 上」（本版）**：一天内 15 个小提交直推 main，内容见 CHANGELOG「Build 68」：
  工程债（仓库卫生、scrypt2 密码哈希、未改动集合引用稳定）→ 时间胶囊信（模型／书架区／写信读信页／双端冒烟）
  → 开放归档（ZIP 写入器／版面规划／离线网页／导出编排与备份页卡片／双端冒烟）→ 「她说的话」→ 装订提醒 → 收尾。
  服务端改动只有 `passwords.ts`／`store.ts`／`manage.ts`／`app.ts` 的哈希升级，**尚未部署**（部署步骤见 `deploy/README.md`；
  旧哈希兼容，随时可部）。
- **Build 68 打包**：收尾提交后派发 `mobile-build.yml`（完整 SHA），全绿后把 run 号、APK/IPA 校验和补进本节。
- **下一步**：Build 69「传家 · 中」资料不灭（见第四节）。动工前先看 `docs/plans/PLAN-BUILD-68.md` 末尾的 69/70 路线。
- **工作区**：`git status` 应干净（`.zcode/`、`.commandcode/` 为本地会话目录，已在 .gitignore，不要提交）。

## 二、恢复提示词（直接复制粘贴）

```text
你是「桉桉成长记」的实现工程师代理。这台是新开发机，请恢复开发并继续执行迭代。

第一步·环境自检：
1. 读仓库根目录的 AGENTS.md（发布纪律：只从 main 工作、小提交直接推、本地三件套绿后推送、
   不等待 CI；开工前查上次 CI 是否红）、README.md（架构/命令）、DESIGN.md（设计规范）、
   CHANGELOG.md（近期变更）、HANDOFF.md（本文件）、docs/plans/PLAN-BUILD-68.md
   （Build 68 已批准计划原文 + 实施偏离 + Build 69/70 路线）。
2. git checkout main && git pull --ff-only origin main && git status --short 应干净。
3. cd mobile && npm install；cd ../server && npm install。
4. 验证三件套：mobile 下 npm test、npm run typecheck、npm run lint（275 个测试）；
   server 下 npm test、npm run typecheck（20 个测试，server 没有 lint 脚本）；
   python3 mobile/scripts/verify-local-boundary.py；
   python3 -m unittest discover -s mobile/scripts -p 'test_*.py'。
   本机 /tmp 若是满的 tmpfs，跑 mobile 测试要 TMPDIR=/var/tmp/anan-tests（先 mkdir）。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·先看 HANDOFF 第一节「Build 68 打包」有没有补上 run 号与校验和：
- 没有 → gh run list --workflow mobile-build.yml 查最近一次派发；红了就修，绿了就把
  APK/IPA 校验和记进 HANDOFF 第一节并推送。
- 服务端 scrypt2 改动尚未部署：按 deploy/README.md 部署一次（旧哈希登录时自动升级，无需迁移）。

第三步·继续 Build 69「传家 · 中」资料不灭（路线见 docs/plans/PLAN-BUILD-68.md 第六节）：
1. 本机备份改 blob 库：backups/blobs/<sha256> + 清单 .xmbm（v2 头不带素材字节），引用计数回收，
   库 + 备份从约 4 倍降到约 2 倍；.xmb 分卷导出（阈值切多卷，读取端支持拼接）。
2. 加密单向远端备份：客户端 @noble/hashes/scrypt 派生密钥 + @noble/ciphers（新增）
   XChaCha20-Poly1305 逐块加密；服务端 PUT /backup/blobs/:sha256、PUT/GET /backup/manifest，
   按成员配额存到 AI_DATA_DIR/backup/。前置：blob 库。要修订两条「宪法」：
   verify-local-boundary.py 允许 src/sync/ 目录 fetch，AGENTS 加一条「备份传输只走 src/sync」。
   决策点（问持有者）：口令丢失即不可恢复，要不要在 App 内生成 12 词恢复码让家长抄写。
3. 顺手的小项（可选）：mobile-build.yml 加 release_tag 输入，把 APK/IPA/sha256 挂到 GitHub Release，
   解决 artifacts 30 天过期（Build 68 计划里的可选提交 16，未做）。
明确不做：实时协作、云端搜索、第三方云盘、人脸识别、真地图足迹。
```

## 三、Build 68 交付清单（源码已在 main）

| 提交 | 内容 |
| --- | --- |
| 1869bfb | 仓库卫生：.commandcode 出库、四个零引用依赖、PLAN 归档到 docs/plans、.nvmrc |
| 5f83be3 | 服务端：scrypt2 带参数哈希、旧哈希登录自动升级、兜底命令按登录名找人 |
| d889f31 | 没动过的集合保持引用不变，书架／年度册／搜索按集合记忆 |
| f830bc1 | letters 实体：校验、素材保护、备份往返、纯函数状态 |
| 8fec661 | 书架「时间胶囊」区、信件路由与服务 |
| 132d3a6 | 写信页与读信页（useRecorder 泛化） |
| 52d1314 | 双端冒烟：写信 → 封存 → 重启 → 提前拆封；fixture 带一封封存的信 |
| cdd33e2 | 零依赖流式 ZIP 写入器（Python zipfile 校验） |
| 98bdfed | 归档版面规划（纯函数） |
| 731ca5c | 离线网页 index.html（桩 DOM 测试） |
| 089941d | 导出编排、备份页「开放归档」卡、双端冒烟 |
| 68aed3c | 「她说的话」：quote 字段、阅读页切换、语录册、搜索 chip |
| c89a0fd | 装订提醒：yearBooksBoundAt、bookNudgeOf、书架纸卡 |
| 收尾 | CHANGELOG／README／HANDOFF／PLAN 归档、app.json 68 |

实施中与计划的偏离都记在 `docs/plans/PLAN-BUILD-68.md` 顶部注释里（ZIP64 按需而非始终、归档留缓存到下次导出等）。

## 四、后续路线

- **Build 69「传家 · 中」资料不灭**：本机 blob 备份库 + 分卷 + 加密远端单向备份（见第二节第三步）。
- **Build 70「传家 · 下」家人一起记**：第二台设备登录同一家庭账号后从远端清单拉全量（含原图，已拍板），
  记录 last-writer-wins 合并（revision + updatedAt），媒体按 sha256 增量；只在同一记录两端都改时提示冲突。
  前置：69 的远端 blob 与清单；改 Library 加设备 id／向量时钟前先出 PLAN-SHARING.md。

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
  （state.records 而不是 state），派生量交给编译器自动记忆时别再手写 useMemo，否则报「memoization could not be preserved」。
- uiautomator 只 dump 看得见的节点：书架与长表单里首屏之外的目标用 smoke-android.py 的 tap_seek（滑动再找）。
- Android APK 用持有者私有 release 密钥签名（GitHub Secrets：ANDROID_KEYSTORE_BASE64/PASSWORD/ALIAS/KEY_PASSWORD），
  指纹钉在 mobile-build.yml。

## 六、环境备忘

- Node.js 24（本机 26 也能跑）；要跑 Android 真机需 Java 21 + Android SDK（ANDROID_HOME）；
  iOS 打包不需要本机 macOS——全部走 GitHub Actions。
- `gh` CLI 并 `gh auth login`（派发打包、查 Actions、设 Secrets 用）；git 凭据（HTTPS PAT 或 SSH 均可）。
- `npm run doctor`（expo-doctor）有两项需要连 exp.host，离线机器上会红，CI 上是绿的。
- 仓库根目录若有 `node_modules/`、`.next/`、`build/`（上一代 Next.js 残留，已被 .gitignore），可直接删。
- （可选但强烈建议）从旧机复制 `release-keystore/xiaomei-release.keystore` 母本另存；日常开发与 CI 打包都不需要它，只有轮换 Secrets 时用。

## 七、命令速查

```sh
git clone https://github.com/YePiXpert/family-time-capsule.git
cd family-time-capsule/mobile && npm install && cd ../server && npm install && cd ..
npm test && npm run typecheck && npm run lint        # 根目录命令 = mobile 三件套
(cd server && npm test && npm run typecheck)
python3 mobile/scripts/verify-local-boundary.py
# 出安装包（替换为最终交付提交的完整 SHA）：
gh workflow run mobile-build.yml --ref main -f source_sha=<完整40位SHA>
# 只跑规模基准：
npx --prefix mobile vitest run --root mobile tests/local-scale.test.ts --reporter=verbose
```
