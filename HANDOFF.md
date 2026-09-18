# 小美成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-18，Build 61 已交付后。

---

## 一、恢复提示词（直接复制粘贴）

```text
你是「小美成长记」的实现工程师代理。这台是新开发机，请恢复开发并继续执行迭代。

第一步·环境自检：
1. 读仓库根目录的 AGENTS.md（发布纪律：只从 main 工作、小提交直接推、推后看 Actions）、
   README.md（架构/命令）、DESIGN.md（设计规范）、CHANGELOG.md（近期变更）、
   PLAN-BUILD-60-61.md（Build 61 任务清单与已知坑，Build 60 已完成可作参照）。
2. git checkout main && git pull --ff-only origin main && git status --short 应干净。
3. cd mobile && npm install；cd ../server && npm install。
4. 验证三件套：npm test、npm run typecheck、npm run lint（根目录命令即可，全部应绿；
   mobile 124 个测试、server 13 个）。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·决定下一轮迭代（Build 62）：
PLAN-BUILD-60-61.md 的两轮计划已全部完成。候选方向（与用户确认优先级）：
  - 真地图足迹：react-native-maps 独立提交、可整体裁剪（61 留的口子，先轻量版验收）。
  - 年度重放配乐（本地选乐，需要新权限与依赖）。
  - 人物管理完善（改名/删除/合并，61 只做了新建与多选）。
  - 或由用户提出新主题。计划文档按 PLAN-BUILD-60-61.md 的格式另立新篇入库。

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

- **已交付**：Build 61「记忆的秩序」（人物标签、本机健康页、轻量足迹），交付提交
  `292c929`（versionCode 61），三打包作业全绿。产物在 Actions run
  https://github.com/YePiXpert/family-time-capsule/actions/runs/35304464742
  （artifacts 30 天有效期，约 2026-10-18 过期，需要就早下）。
  本轮未动原生代码；mobile 测试 113→124（persons 4 + health 5 + 聚类 2）。
  Build 60「时光的礼物」产物在 run 35299805334（同样约 10-18 过期）。
- **签名**：`3cc56d9` 起 APK 用持有者私有 keystore 签名（secrets 已配置，指纹
  `FE:57:43:E4:…:B1:7E` 钉入 mobile-build.yml，与模板证书指纹二选一校验）。
- **下一步**：PLAN-BUILD-60-61.md 已全部执行完；真地图足迹是计划内留下的独立可选提交，
  其余方向见恢复提示词第二步。
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
