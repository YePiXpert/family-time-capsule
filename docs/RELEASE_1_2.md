# 1.2.0-alpha.1 开发与发布记录

状态：开发中，尚未发布。不代表 M1–M8 已完成，不代表 stable 或真实设备验收。

## 基线

- 审查与开工 HEAD：`99ac692ec7bd5c91ca499d3c71cd6cedf4afcd10`，分支 main。
- 基线 CI：`33930380728`，success。
- 锁定安装：根/mobile `npm ci`，各 0 漏洞。
- 根基线 lint/typecheck/test/build 通过：77 files / 542 tests。
- mobile 基线 test/typecheck/lint/doctor 通过：11 files / 57 tests，Doctor 21/21。
- 开始存在的未跟踪 pnpm 文件与调试 ZIP 保留，不进入本轮提交。

## 日历切片（本地证据，尚非最终门禁）

- 新 Web `/timeline/calendar`、原生 Calendar、`/api/mobile/v1/calendar`。
- 日期/月龄/日历/API/稳定分页专项：4 files / 25 tests，通过。
- Production timeline E2E：5 tests，通过，含改日期、日历计数、返回筛选与锚点、键盘。
- 375/768/1024/1440px 页面无横向溢出；虚构家庭截图在本机 `test-results/`，不打包真实照片。
- 原生组件交互：真实 CalendarScreen 在测试 renderer 中操作文档过滤、年龄跳转、打开来源、
  非法月份、断网/403 及重试，2 tests 通过。原生系统控件由测试 host 替代，不宣称真机通过。
- Expo SDK 57 官方 FileSystem/Audio/Video 文档已读取；后续媒体/离线实现使用对应版本 API。

本切片根 lint/typecheck/test 通过（79 files / 554 tests）；生产 build 与 timeline E2E 通过。
mobile test/typecheck/lint/doctor 通过（12 files / 59 tests，Doctor 21/21），Android/iOS
Expo export 均生成约 3.5 MB Hermes bundle。新增 renderer 仅用于组件测试，不进入原生业务代码。

最终全量根/mobile/生产 E2E/disaster roundtrip、出版/权限/离线专项、Docker、独立卷升级与
恢复、依赖审计、main CI、tag run、APK/unsigned IPA/SHA256SUMS 仍待后续里程碑完成并运行。
尚无 1.2 tag 或发布附件。

## 真实设备（未执行）

Android/iOS 安装及含唯一资料的旧包升级、系统分享 Intent/appex/App Group、相册/Files、
音视频解码/方向、触控缩放、安全区、断网杀进程、下载清理不伤原件/outbox、本地通知。
无签名凭据时只可交付 unsigned/test 包，不能据此宣称无损升级已验证。
