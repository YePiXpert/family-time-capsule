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

## 相册与章节切片（本地门禁通过）

- Web `/collections`、`/collections/[id]`；原生 Collections/CollectionDetail。
- 时间轴多选、记忆详情加入，手动/时间排序、小节、说明、封面、日期范围、阅读模式、
  乐观锁冲突保留输入、删除恢复。大于 30 个相册可继续分页，时间轴指定相册可直接恢复。
- migration 0036；三个 Collection 模块文件纳入 manifest、verifier 和事务恢复。
  软删除来源保留 tombstone；不导出 token 或临时任务。
- 独立生成五个虚构 JPEG 原件，双相册整理/删除恢复/重开，原件数量与 SHA 不变；
  完整档案恢复到新目录再导出，关系、顺序、说明及 SHA 相同。
- 实际 0035 schema 前缀升级到 0036；注入失败迁移验证回滚。并非宣称真实用户 1.1 卷已验收。
- 根 lint/typecheck/test/build 通过：81 files / 557 tests。
- Production 相册 E2E 2 passed；disaster roundtrip 6 passed。
- Mobile test/typecheck/lint 通过：13 files / 61 tests；相册真实组件交互 2 passed。
  Doctor 21/21；Android/iOS Expo export 通过。真机触控及安全区仍未验证。
- 375/768/1024/1440px 虚构家庭页面截图检查通过，键盘排序、并发冲突和恢复有交互断言。
- 日历提交后的完整 CI `33933984509`（`32bcabf`）全绿；相册提交对应 run 待 push 后核对。
