# 桉桉成长记 · 换机恢复开发交接（HANDOFF）

> 用途：换电脑后，把下面「恢复提示词」整段粘给新会话里的 AI 代理即可继续开发。
> 本文档自包含；细节规范都在仓库内文件里，提示词会引导代理去读。
> 最后更新：2026-09-18，Build 63 交付中。

---

## 一、恢复提示词（直接复制粘贴）

```text
你是「桉桉成长记」的实现工程师代理。这台是新开发机，请恢复开发并继续执行迭代。

第一步·环境自检：
1. 读仓库根目录的 AGENTS.md（发布纪律：只从 main 工作、小提交直接推、推后看 Actions）、
   README.md（架构/命令）、DESIGN.md（设计规范）、CHANGELOG.md（近期变更）、
   PLAN-BUILD-62-65.md（Build 62→65 三阶段路线，含每一轮踩过的坑）。
2. git checkout main && git pull --ff-only origin main && git status --short 应干净。
3. cd mobile && npm install；cd ../server && npm install。
4. 验证三件套：npm test、npm run typecheck、npm run lint（根目录命令即可，全部应绿；
   mobile 163 个测试、server 13 个）。
5. gh auth status 可用（出安装包需要 gh CLI）。

第二步·继续 Build 64：
Build 63「十年之库·上」已交付（写入层、备份格式、恢复体验、分页 PDF 成长册）。
Build 64「十年之库·下」的清单见 PLAN-BUILD-62-65.md，另加一件从 63 顺延过来的：
  - 本机保留的备份改成共享 blob 库（现在三份全量副本，库 + 备份约占 4 倍空间；
    改成 blobs/<sha256> + 清单后约 2 倍）。备份 v2 的格式机械已经就位，直接接着做。
  - 媒体治理：导入降采样与视频上限、孤儿自动回收、巡检进度持久化、消除重复哈希 I/O。
  - 服务端 AI 闭环：结果落库但 24 小时后物理删除正文（已拍板）、requests 90 天裁剪、
    编辑器显示剩余额度、30 天用量渲染、设备自助撤销。
  - 礼物：月度 AI 回顾（按需生成，不做定时任务与推送）。
真地图足迹已明确跳过，继续用轻量足迹。家庭共享（Build 65/66）已立项：全量同步含原图，
动工前先写 PLAN-SHARING.md 并修订两处「宪法」（verify-local-boundary.py 的禁网边界、
AGENTS 发布纪律）。

注意事项（踩过的坑，务必先读 PLAN-BUILD-62-65.md 的对应小节）：
- 改原生 Kotlin 前先用独立 kotlinc 对 $ANDROID_HOME/platforms/android-36/android.jar
  编译一份用法一致的 snippet 验证（Build 56/57 的教训）。
- mobile-build 派发必须用完整 40 位 SHA。
- app.json 含 \uXXXX 转义，定点编辑，别整文件重写。
- 手势回调里调用的每个函数都要标 "worklet"（Build 62 的 Android 原图缩放必崩）。
- 页面改成 Page scroll={false} 自带列表时，必须补回 keyboardShouldPersistTaps="handled"
  与 automaticallyAdjustKeyboardInsets，否则键盘弹着时第一次点击会被列表吃掉
  （Build 62 的 iOS 回归就红在这里）。
- 库里的实体是冻结的：一次 change 里只能整个替换（editEntity），不能原地改。
  Object.assign 绕得过类型检查，绕不过冻结。
- Android APK 用持有者私有 release 密钥签名（GitHub Secrets：
  ANDROID_KEYSTORE_BASE64/PASSWORD/ALIAS/KEY_PASSWORD），指纹钉在 mobile-build.yml。
```

---

## 二、当前状态快照（2026-09-18）

- **Build 62「成长册」**：源码在 `4bf9362`，但首次打包的 iOS 回归红了——不是环境问题，
  是真回归：Build 62 把几个页面从 `Page`（自带滚动）改成 `Page scroll={false}` 加自带
  FlatList，丢掉了 `keyboardShouldPersistTaps="handled"`，键盘弹着时第一次点击只会收
  键盘。修复提交 `62bf99d`，打包 run 35342750069。
- **Build 63「十年之库·上」**：交付提交 `7fa5bd8`（versionCode 63），打包 run
  35345717654。本轮内容见 CHANGELOG「Build 63」。artifacts 保留 30 天，需要就早下。
- **签名**：`3cc56d9` 起 APK 用持有者私有 keystore 签名（secrets 已配置，指纹
  `FE:57:43:E4:…:B1:7E` 钉入 mobile-build.yml，与模板证书指纹二选一校验）。
- **下一步**：Build 64，清单见上面恢复提示词第二步。
- **工作区**：`git status` 应干净（`.zcode/`、`.commandcode/` 为本地会话目录，不要提交）。

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
npm test && npm run typecheck && npm run lint
# 出安装包（替换为最终交付提交的完整 SHA）：
gh workflow run mobile-build.yml --ref main -f source_sha=<完整40位SHA>
# 只跑规模基准：
npx --prefix mobile vitest run --root mobile tests/local-scale.test.ts --reporter=verbose
```
