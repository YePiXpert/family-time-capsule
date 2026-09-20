# 桉桉成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-20，Build 69「界面整顿」源码已在 main；安装包的 run 号与校验和见第一节末尾（交付后补写）。

---

## 一、当前状态快照（2026-09-20）

- **Build 68「传家 · 上」**：交付提交 `dd0eee7`，打包 run 35450404867 全绿。APK SHA-256 `ee4abfca…3738a84`（66,464,850 字节）、
  未签名 arm64 IPA SHA-256 `df4b9532…a40010`（11,074,058 字节），本地存 `C:\vibe-coding\releases\build-68\`（artifacts 2026-10-19 过期）。
- **服务端**：2026-09-20 主人已把 main 最新（含 scrypt2 带参数哈希、旧哈希登录自动升级）部署到 capsule.yep.li。Build 69 没有服务端改动。
- **Build 69「界面整顿」（本版）**：一天内 18 个小提交直推 main（清单见第三节），纯手机端、不改数据格式：
  原生页头下线改 `Page` 页内顶栏 → 控件四级与 `GlassDepth` → 书架横向封面条 + 单张可关提醒 → 阅读页内容先行 + 底栏 + 就地加入相册
  → 相册／年度册／系列动作分主次 → 编辑器正文永不消失、分组改开关 → 空草稿／空信／空系列静默清理 → 「我的」分组列表 + 备份页三卡
  → 外观／存储／AI 设置 → 文案与图标统一 → 双端冒烟对齐。CHANGELOG「Build 69」有逐条说明。
- **Build 69 打包**：收尾提交（app.json 69）推上 main 后派发 `mobile-build.yml`；三作业全绿后，run 号、APK／IPA 大小与 SHA-256
  由一笔补充提交写在本节末尾。若本节末尾还没有这段，说明包还没交付：先看 `gh run list --workflow=mobile-build.yml`。
- **下一步**：Build 70「传家 · 中」资料不灭（见第四节；约束与提交概要在 `docs/plans/PLAN-BUILD-69.md` 第二部分，开工第一天先展开成 `docs/plans/PLAN-BUILD-70.md`）。
- **工作区**：`git status` 应干净（`.zcode/`、`.commandcode/` 为本地会话目录，已在 .gitignore，不要提交）。

## 二、恢复提示词（直接复制粘贴）

```text
你是「桉桉成长记」的实现工程师代理。这台是新开发机，请恢复开发并继续执行迭代。

第一步·环境自检：
1. 读仓库根目录的 AGENTS.md（发布纪律：只从 main 工作、小提交直接推、本地三件套绿后推送、
   不等待 CI；开工前查上次 CI 是否红）、README.md（架构/命令）、DESIGN.md（设计规范，UI 只用
   mobile/src/local/ui.tsx 的基元）、CHANGELOG.md（近期变更）、HANDOFF.md（本文件）、
   docs/plans/PLAN-BUILD-69.md（Build 69 已批准计划原文 + 实施偏离；第二部分是 Build 70 的约束清单与提交概要）。
2. git checkout main && git pull --ff-only origin main && git status --short 应干净。
3. cd mobile && npm install；cd ../server && npm install。
4. 验证三件套：mobile 下 npm test、npm run typecheck、npm run lint（299 个测试）；
   server 下 npm test、npm run typecheck（20 个测试，server 没有 lint 脚本）；
   python3 mobile/scripts/verify-local-boundary.py；
   python3 -m unittest discover -s mobile/scripts -p 'test_*.py'。
   本机 /tmp 若是满的 tmpfs，跑 mobile 测试要 TMPDIR=/var/tmp/anan-tests（先 mkdir）。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·Build 69 安装包：看 HANDOFF 第一节末尾有没有 run 号与校验和。
- 有：已交付，不必重新打包；artifacts 30 天过期，提醒持有者 gh run download 存到本地 releases/build-69/。
- 没有：查 gh run list --workflow=mobile-build.yml；红就按 Build 68 的经验先看双端冒烟的可达性
  （uiautomator 只 dump 可见节点、iOS 键盘遮挡），修好直推 main 再派发；绿就下载两端包、算 SHA-256 写进第一节。

第三步·Build 70「传家 · 中」资料不灭（一个安装包，主人已拍板）：
0. 先把 docs/plans/PLAN-BUILD-69.md 第二部分展开成 docs/plans/PLAN-BUILD-70.md（每个提交的函数签名与测试清单），
   已定决策：远端备份密钥 = 12 词恢复码即密钥（无口令、无 scrypt）；VPS 可用磁盘 50–200 GB；手机资料 < 5 GB；
   主密钥必须用 expo-crypto getRandomBytes（Hermes 没有 crypto.getRandomValues）。
1. 先做服务端对象库与路由（提交 11–12）并部署；用一次性 token 探反代：4 MB PUT 期望 200、9 MB PUT 期望我们的 JSON 413，
   不符就改 nginx 三行（client_max_body_size 16m; proxy_request_buffering off; proxy_read_timeout 130s）再探。
2. 再做手机端：宪法重构（local_boundary.py + SERVICE_URL 进 brand.ts）→ 格式层与 blob 库 → .xmb 分卷 → src/sync 密码学／状态／传输／引擎
   → 备份页末尾的远端卡与恢复码页 → 真服务端 e2e → 收尾（CHANGELOG 降级警告：.xmbm 与分卷 .xmb 只有 70 起能读）。
3. 首个真机版记录 XChaCha20 的 MB/s 到 HANDOFF；若 < 5 MB/s 用对象头的 alg 字节换 expo-crypto 的 AES-GCM。
明确不做：实时协作、云端搜索、第三方云盘、人脸识别、真地图足迹。
```

## 三、Build 69 交付清单（源码已在 main）

| 提交 | 内容 |
| --- | --- |
| 89e2bac | 页内顶栏：`Page` 自绘「‹ 返回 + 标题」，原生页头下线（`headerShown: false`） |
| ce4d60e | 控件四级与玻璃深度：`Button` 文字级／危险级、选中带勾；`Card`／底栏内不再套玻璃 |
| b298c2f | 提醒策略：`pickNudge` 同屏只挑一张卡，关闭状态入库 `nudgeClosedAt` |
| beeebff | 书架头部与单张提醒：名字圆章进「我的」，提醒卡都可关 |
| 58df185 | 书架改横向封面条：「最近」在最上，区标题右侧文字级新建，不再摆「+」虚位册 |
| 2e30460 | 书架收尾：那年今日卡紧凑化、「右下角的笔」改「记一刻」、扉页没名字不再拿应用名充数 |
| 7cfdfe5 | 全部页面迁到 `Page` 顶栏：表单与设置页标题进顶栏，内容页只留返回 |
| a424087 | 阅读页内容先行：照片分页、动作进底栏、就地加入相册（`appendToAlbum`／`newAlbumFrom`） |
| addd9e4 | 相册、年度册、系列页：动作一行分主次，寄语卡移到页尾，导出成长册就地展开 |
| 1f75538 | 空态给出下一步；编辑页保存中按返回改为等保存完再走 |
| 7df32df | 编辑器：正文永不消失、按天分组改为按需开关、次要动作降级；AI 面板实色底板 |
| 0ffb5bb | 空草稿、空信、空系列退出时静默清理（`empties.ts`） |
| 481a627 | 「我的」改为分组设置行（`SettingsGroup`／`SettingsRow`），副题带出状态 |
| 46503c8 | 备份页重排：三张纸卡、一个主按钮、不露文件名（`backupStampLabel`） |
| b63eb37 | 外观、本机存储、AI 设置：主题勾选一行、术语退出正文、模型名进脚注 |
| ab6cabc | 文案与图标统一：记录数成「段时光」，附件按种类，术语退出正文 |
| 86fb958 | 双端冒烟对齐：iOS 返回改点 page-back，补 home-recent 与 record-bottom-bar 截图 |
| （收尾） | CHANGELOG／README／HANDOFF／PLAN 归档、DESIGN 一致性、app.json 69（本提交） |

实施中与计划的偏离都记在 `docs/plans/PLAN-BUILD-69.md` 顶部注释里。

## 四、后续路线

- **Build 70「传家 · 中」资料不灭**（一个包）：A 本机 blob 备份库（`blobs/<sha256>` + `.xmbm` 清单，库 + 备份从约 4 倍降到约 2 倍）
  → B `.xmb` 分卷导出与多卷读取 → C 加密远端单向备份 + 远端恢复（客户端 XChaCha20-Poly1305 逐块加密、HKDF 派生、
  12 词 BIP39 恢复码即密钥；服务端 `/backup/*` 对象库按成员配额存到 `/data/backup/`）→ D 宪法修订（`src/sync` 是唯一第二个 `fetch(`）。
  34 条约束与 21 个提交概要见 `docs/plans/PLAN-BUILD-69.md` 第二部分。
- **Build 71「传家 · 下」家人一起记**：第二台设备登录同一家庭账号、输入恢复码后从远端清单拉全量；记录 last-writer-wins（revision + updatedAt），
  媒体按 sha256 增量；只在同一记录两端都改时提示冲突。前置：70 的远端对象与清单；改 `Library` 加设备 id 前先出 PLAN-SHARING.md。

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
- （Build 69）原生页头已下线：返回是 `Page` 里的 `IconButton`（testID `page-back`），iOS 冒烟点返回不能再用 `BackButton`；
  编辑页与写信页用 `usePreventRemove(!allowExit)` 拦全部退出，保存中按返回记到 `pendingExit`、本轮结束再放行；
  隐藏原生页头后 `useHeaderHeight()` 为 0，键盘偏移用 `useTopBarOffset()`；`Modal` 里 SafeAreaView 不可靠，
  BookPreview／PhotoPicker 用 `useSafeAreaInsets().top` 自己垫 + `Page top={false}`。
- （Build 69）`GlassDepth`：`Card`／`BottomBar` 给深度 +1，里面的 `Button`／`Glass` 渲染实色纸面，别指望卡里再套一层液态玻璃；
  按钮四级里一页只放一个 `primary`。
- （Build 69）冒烟标签：「我的」入口的 accessibilityLabel 是「我的」（testID `open-settings` 不变）；`SettingsRow` 的副题放在
  accessibilityValue 里、标签保持原文，双端冒烟才能按「AI 设置」「备份与恢复」文本命中；Android 的 desc 会拼成「标签, 值」。

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
