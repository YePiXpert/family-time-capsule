# 桉桉成长记

一家人写给桉桉的成长册。留下几句话、一段声音和照片，每段都有日期与落款，日后可以装订成书，也可以脱离 App 阅读。

Android / iOS，本机优先。只供自家使用，一本家庭册，不开放注册。

## 安装

当前安装包：[1.1.6 · 构建号 88](https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.1.6)。

- [Android APK](https://github.com/YePiXpert/family-time-capsule/releases/download/v1.1.6/FamilyTimeCapsule-android.apk)
- [iOS IPA（未签名，需自行签名）](https://github.com/YePiXpert/family-time-capsule/releases/download/v1.1.6/FamilyTimeCapsule-ios-unsigned.ipa)
- [SHA-256 校验和](https://github.com/YePiXpert/family-time-capsule/releases/download/v1.1.6/sha256sums.txt)

安装包、GitHub 源码和服务器分别交付；当前对应关系与验证结果见 [HANDOFF](HANDOFF.md)。

## 可以做什么

- **随手记**：离线写字、录音、加照片，保存草稿，按日期和人物找回来。
- **一家人一起写**：管理者扫码批准新手机；文字与附件加密同步，同时修改时保留另一版。
- **整理成册**：专题册、年度纪念册 PDF、纪念卡，以及写给未来的信。
- **带到 App 之外**：完整备份可恢复；开放归档包含 Markdown、原文件和离线网页。
- **AI 帮忙记录**：转写、润色、追问、今天的小问题和年度目录建议。只处理任务所需内容，不看照片；建议由家人采用。

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
