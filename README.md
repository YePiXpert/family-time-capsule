# 桉桉成长记

记下现在，写给未来。一家人在共同时间线上留下文字、照片、视频和声音，也把想说的话写成未来的信。

Android / iOS，本机优先。只供自家使用，一本家庭册，不开放注册。

## 安装

当前安装包：[1.2.0 · 构建号 89](https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.2.0)。

- [Android APK](https://github.com/YePiXpert/family-time-capsule/releases/download/v1.2.0/FamilyTimeCapsule-android.apk)
- [iOS IPA（未签名，需自行签名）](https://github.com/YePiXpert/family-time-capsule/releases/download/v1.2.0/FamilyTimeCapsule-ios-unsigned.ipa)
- [SHA-256 校验和](https://github.com/YePiXpert/family-time-capsule/releases/download/v1.2.0/sha256sums.txt)

安装包、GitHub 源码和服务器分别交付；当前对应关系与验证结果见 [HANDOFF](HANDOFF.md)。

## 可以做什么

- **随手记**：离线写字、照片、视频或录音，草稿留在本机；保存后进入共同时间线。
- **一家人一起写**：扫码批准新手机，加密同步文字与小预览，原件点开下载；双方可编辑，完整修改历史可恢复。
- **写给未来**：独立信箱，封存时选择现在可读或约定生日再拆；回忆按年月浏览、搜索。旧册子继续可读、可导出。
- **带到 App 之外**：完整备份可恢复；开放归档包含 Markdown、原文件和离线网页。
- **年度故事**：结束的年份在前台同步成功后自动整理为短故事，可修改、重写和导出。AI 只处理任务所需文字或录音，不接收照片、信件或修改历史。

## 开始使用

装好就能离线记录。需要共同写作或 AI 时，在「设置 → 家庭与同步」开始家庭，或由管理者扫码加入。第一位管理者使用部署端生成的一次性激活码。

家庭恢复码抄在纸上收好。它能找回家庭钥匙，不能代替备份；定期在「设置 → 数据与备份」保存一份完整备份到手机之外。服务器只保存同步密文；调用 AI 时，所选文字或录音会经家庭服务交给上游处理。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `mobile/` | Expo／React Native 手机应用（Android、iOS） |
| `server/` | 家庭服务：设备授权、密文同步存储、AI 代理（Node 24、Fastify、SQLite） |
| `deploy/` | Compose、环境示例与每日数据库备份脚本 |
| `docs/` | 结构与协议、开发、AI、验收；`docs/history/` 是已完成的计划与审查 |
| `.github/workflows/` | 日常 CI 与安装包构建 |

在根目录运行 `npm run check` 可以一次跑完全部本地门禁，依赖要先装好，见[开发指南](docs/DEVELOPMENT.md)。

## 项目文档

| 要找什么 | 文档 |
| --- | --- |
| 当前部署、发布与剩余验收 | [HANDOFF](HANDOFF.md) |
| 使用范围与取舍 | [产品定位](PRODUCT.md) |
| 模块、钥匙、同步与服务端接口 | [结构与协议](docs/ARCHITECTURE.md) |
| 开发、测试、版本号与出包 | [开发指南](docs/DEVELOPMENT.md) · [协作规则](AGENTS.md) |
| 手机界面规范 | [设计规范](DESIGN.md) |
| AI 输入与提示词 | [AI 说明](docs/AI-PROMPTS.md) |
| 服务配置、更新与回滚 | [部署指南](deploy/README.md) |
| 真机、双机与恢复验收 | [验收清单](docs/ACCEPTANCE.md) |
| 版本改动 | [CHANGELOG](CHANGELOG.md) |
| 已完成的计划与审查 | [历史文档索引](docs/history/README.md) |

私有家庭项目，不开源，不接受外部贡献。
