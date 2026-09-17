# 小美成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-18，Build 59 已交付后。

---

## 一、恢复提示词（直接复制粘贴）

```text
你是「小美成长记」的实现工程师代理。这台是新开发机，请恢复开发并继续执行迭代。

第一步·环境自检：
1. 读仓库根目录的 AGENTS.md（发布纪律：只从 main 工作、小提交直接推、推后看 Actions）、
   README.md（架构/命令）、DESIGN.md（设计规范）、CHANGELOG.md（近期变更）、
   PLAN-BUILD-60-61.md（接下来两轮迭代的任务清单与已知坑）。
2. git checkout main && git pull --ff-only origin main && git status --short 应干净。
3. cd mobile && npm install；cd ../server && npm install。
4. 验证三件套：npm test、npm run typecheck、npm run lint（根目录命令即可，全部应绿；
   mobile 91 个测试、server 13 个）。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·继续执行 Build 60「时光的礼物」：
严格按 PLAN-BUILD-60-61.md §2 的任务清单顺序做，每组一个提交：
  1) 时光系列（同款时光对比）：Library.series 四件套（类型/emptyLibrary/validateLibrary/
     normalizeLibrary，参照 yearNotes 与 lastExportAt 模式）、服务层、书架「时光系列」区、
     Series 内页（时间线 + 缺口月虚位卡 + 选图，换封面的平铺写法在 Albums.tsx）、
     keepsake.ts 加 layoutSeriesStrip 横排对比导出；测试见计划文档。
  2) 每日一问 prompts.ts（按月龄段、同日稳定的纯函数）+ 编辑器空正文时的温和提示。
  3) 年度重放 replay 选片纯函数 + RecapScreen 全屏幻灯（尊重减少动画设置，v1 不配乐）。
  4) 记录节奏温和提示卡 nudgeOf 纯函数 + Shelf 卡片。
  5) 文档（CHANGELOG/README/DESIGN）+ app.json 59→60（定点编辑，保留 \u 转义）→
     全套绿 → 推送 → ci.yml 绿 → gh workflow run mobile-build.yml --ref main
     -f source_sha=<完整40位SHA> → Android APK 与 iOS IPA 双绿 → 给出 artifacts 下载。

第三步·Build 61「记忆的秩序」：按 PLAN-BUILD-60-61.md §3 执行（人物标签、本机健康页、
轻量足迹；真地图 react-native-maps 为可整体裁剪的独立提交）。

注意事项（踩过的坑都在 PLAN-BUILD-60-61.md §4，务必先读）：
- 改原生 Kotlin 前先用独立 kotlinc 对 $ANDROID_HOME/platforms/android-36/android.jar
  编译一份用法一致的 snippet 验证（Build 56/57 的教训）。
- mobile-build 派发必须用完整 40 位 SHA。
- Android APK 已改用持有者私有 release 密钥签名（GitHub Secrets：
  ANDROID_KEYSTORE_BASE64/PASSWORD/ALIAS/KEY_PASSWORD），指纹钉在 mobile-build.yml。
  首个新签名包与旧模板签名包不能覆盖互装——用户已被告知需一次「导出备份→卸载→安装→恢复」。
- 签名密钥母本与密码由用户自行保存，不在仓库；若需重传 Secrets 让用户提供文件。
```

---

## 二、当前状态快照（2026-09-18）

- **已交付**：Build 57（礼物感）+ 58（性能与媒体）+ 59（数据安全），三打包作业全绿。
  最新交付提交 `69e39dd`（versionCode 59），产物在 Actions run
  https://github.com/YePiXpert/family-time-capsule/actions/runs/35267271054
  （artifacts 30 天有效期，约 2026-10-18 过期，需要就早下）。
- **签名**：`3cc56d9` 起 APK 用持有者私有 keystore 签名（secrets 已配置，指纹
  `FE:57:43:E4:…:B1:7E` 钉入 mobile-build.yml，与模板证书指纹二选一校验）。
- **Build 60/61：代码未动工**，完整任务清单在 PLAN-BUILD-60-61.md（含模型四件套写法、
  每个任务的测试要求、可复用基建清单：NoteCard/Stamp/keepsake/recap/search/dates/places）。
- **工作区**：应只有本文件与 PLAN 文档皆已入库，`git status` 干净（.zcode/ 为本地会话目录，
  不要提交）。

## 三、新机器环境清单

- Node.js 24；要跑 Android 真机需 Java 21 + Android SDK（ANDROID_HOME）；
  iOS 打包不需要本机 macOS——全部走 GitHub Actions。
- `gh` CLI 并 `gh auth login`（派发打包、查 Actions、设 Secrets 用）。
- git 凭据（HTTPS PAT 或 SSH 均可）。
- （可选但强烈建议）从旧机复制 `release-keystore/xiaomei-release.keystore` 母本另存；
  日常开发与 CI 打包都不需要它，只有轮换 Secrets 时用。

## 四、命令速查

```sh
git clone https://github.com/YePiXpert/family-time-capsule.git
cd family-time-capsule/mobile && npm install && cd ../server && npm install && cd ..
npm test && npm run typecheck && npm lint 2>/dev/null || npm run lint
# 出安装包（替换为最终交付提交的完整 SHA）：
gh workflow run mobile-build.yml --ref main -f source_sha=<完整40位SHA>
```
