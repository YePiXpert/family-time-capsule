# 小美成长记

在 Android／iOS 手机上记录文字、照片、视频和声音，整理相册，随时回看。所有内容保存在本机，无需账号、服务器或联网。

## 使用

1. 打开应用，点「开始记录」。宝宝昵称和生日可稍后在「我的」补充。
2. 「记一刻」中输入内容或添加素材；退出时保留草稿，明确保存后成为正式记录。
3. 在「相册」选择记录、命名并保存。删除相册不会删除原记录。
4. 定期在「我的 → 备份与恢复」导出完整 `.xmb` 备份，保存到应用之外。卸载应用会删除本机内容。

恢复会整库替换当前资料，先校验文件并询问确认；替换前自动生成当前内容的备份。系统导出面板关闭不代表文件一定已保存到外部，请确认保存位置。

## 开发

要求 Node.js 24；Android 原生构建需要 Java 21 和 Android SDK；iOS 原生构建需要 macOS、项目工作流指定的 Xcode 与 CocoaPods。

```sh
npm install
npm start
npm test
npm run typecheck
npm run lint
```

应用主体为 `mobile/`。根命令直接转发移动端任务。没有 Web 服务、数据库服务或 Docker 启动步骤。

## 数据与结构

- `mobile/src/local/`：界面、业务操作、SQLite、文件和备份。
- `mobile/modules/share-intake/`：系统分享接收的原生桥接。
- SQLite `xiaomei-local-v1.sqlite` 与文档目录 `xiaomei-v1/` 独立保存正式本机资料。
- 旧版本均为测试数据，本轮从空库开始，不迁移旧账号、服务端数据，也不自动删除旧目录。
- 备份按块读写并校验 SHA-256；所有数据修改串行提交，写入成功才更新界面。

## 发布

只从 main 构建。`ci.yml` 检查本机存储与备份测试、类型、代码规范和移动端打包；`mobile-build.yml` 检查 Android／iOS 原生流程并生成 APK 与未签名设备 IPA。IPA 需要持有者自行签名安装。

当前本机版：Build 43。两个包必须来自同一 main 提交。设计规则见 [DESIGN.md](DESIGN.md)。
