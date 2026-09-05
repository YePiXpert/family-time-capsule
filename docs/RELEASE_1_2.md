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

## 媒体阅读切片（本地门禁通过，尚非发布）

- 相册里程碑 `8ad023e4b02507875f7a3bf24ce5b01c401517b4` 已 push，
  [CI 33935554186](https://github.com/YePiXpert/family-time-capsule/actions/runs/33935554186) 全绿。
- Web/native 记忆详情：图片阅读器、前后切换/页码、缩放/原图按需加载、关闭返回，
  当前音视频播放器、倍速/进度、主动连续音频、真实转录点句定位与失败重试。
  人物主页最近声音列表保留作者/日期及来源跳转；原生支持主动导出原件副本。
- 非 AI MediaJob（0037）：预览、视频兼容版、最多前五分钟波形；队列/租约/超时/输出限额、
  固定格式转换参数、流式哈希与原子完成。来源授权收紧后旧衍生 URL 不能绕过读取。
- 原件恢复 SHA 相同；可再生预览不进入旧有完整档案，恢复后重建 SHA 相同；任务不恢复。
- 根 lint/typecheck/test/build/build:ops 通过：82 files / 564 tests。
- Production 全套 43 passed；disaster roundtrip 6 passed。
- Mobile test/typecheck/lint 通过：14 files / 63 tests；Doctor 21/21；Android/iOS Expo export
  生成约 3.6 MB Hermes bundle。expo-sharing 57.0.18 安装审计 0 漏洞。
- 媒体真实集成 6 场景通过：转换/方向/流式读取 SHA、并发、取消、缺编解码器重试、旧 URL
  权限拒绝、独立目录恢复重建。原生媒体真实组件交互 2 场景通过。
- 新的系统 ffprobe 检出既有 MOV fixture 的真实内嵌日期；修正原先依赖缺 ffprobe 的测试，
  分别严格断言真实日期和明确缺工具时 capturedAt=null。
- 375/768/1440px 虚构照片阅读截图检查，键盘持续翻页/焦点返回有 production 断言。
- 实际文件转换性能数据见 PERFORMANCE 的 1.2 节，Node RSS 与 ffmpeg 子进程单独记录；
  未把 mock、浏览器或真实手机资源混入测量。

BookProject、可搜索 PDF/EPUB 出版、回顾作品、原生主动离线收藏及最终发布门禁仍待完成。
这些结果不代表 1.2 已发布，也不代填 Android/iOS 真机、旧包升级及系统分享验收。

## 可编辑年册切片（本地门禁通过，尚非发布）

- 权限 SQL 关联修复 `0779a30`；其 CI `33938913770` 发现媒体 E2E 对异步列表/上传顺序
  的错误假设。修复 `497e88c` 后 [CI 33939884902](https://github.com/YePiXpert/family-time-capsule/actions/runs/33939884902)
  三 job 全绿；未放宽断言或增加重试次数。
- migration 0038：BookProject/Chapter/Block/SourceRef/BlockSource/Revision；三模板、真实选材、
  当前自动保存/明确版本快照、缺失/低清/空页/长文提醒、源变化提示、私人/家庭读者隔离。
- Web `/books`、`/books/[id]`、`/books/[id]/versions/[revision]`；原生更多 → Books/BookDetail，
  实际阅读、选材和基础编辑。原生精细焦点排版仍在 Web；主动离线收藏待 M7。
- 六文件年册模块纳入 portable manifest/verifier/restore，当前 metadata 文件数 34。
  独立目录恢复/二次导出保持来源、顺序、手工文字、焦点、历史版本与原件 SHA；
  坏关系/缺文件在写入前拒绝。所引用的删除记录保留墓碑，未引用的回收站内容沿用既有语义。
- 根 lint/typecheck/test/build/build:ops 通过：83 files / 570 tests。
- Production 全套 **44 passed**，disaster roundtrip **6 passed**。年册生产交互覆盖 32 页虚构
  内容、真实选材、排序、保存重开、冲突保留及 375/768/1440px；截图已检查，无真实家人照片。
  这不是 PDF 分页或印刷质量验收，出版门禁留待 M5。
- Mobile test/typecheck/lint 通过：15 files / 66 tests；新年册组件交互 3 passed。
  Doctor 21/21；Android/iOS Expo export 各约 3.6 MB Hermes，输出在独立临时目录。
- 本切片主干提交与 CI 待 push 后核对；可搜索 PDF/EPUB、回顾作品、原生离线及最终发布仍待完成。
