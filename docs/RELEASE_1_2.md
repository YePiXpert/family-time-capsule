# 1.2.0-alpha.1 开发与发布记录

状态：M1–M8 功能与本地门禁完成；发布提交准备中，等待对应 SHA 完整 CI 后创建 prerelease。
不代表 stable 或真实设备验收。历史切片记录保留下方，最终结果以末尾发布记录为准。

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

## 出版切片（本地门禁通过，尚非发布）

- 年册提交 `c6392504019e5872abe47b692cb8c278a7253dfe` 的
  [CI 33940479011](https://github.com/YePiXpert/family-time-capsule/actions/runs/33940479011) 全绿。
- migration 0039：有界 BookRenderJob、共享租约、取消/重试/单调进度、版本与来源幂等、
  原子产物、下载实时重验。渲染由独立 Node 进程处理，与 AI 启用无关。
- PDFKit 替换整页 JPEG PDF 主路径；OFL Noto CJK 嵌字，A4/A5、封面/目录/页码/章分页、
  混排和长文，原件适配图片。旧年度/故事 PDF/EPUB URL 保持成功时二进制兼容行为。
- Web 年册页和原生 BookDetail 接入出版进度、取消、重试、下载/系统副本导出。
  手机下载被拒绝或不完整时不导出，仅清理本次临时文件。主动离线收藏仍待 M7。
- 根 lint/typecheck/test/build/build:ops 通过；最新全套根 **84 files / 574 tests**。
  Production **45 passed**，disaster roundtrip **6 passed**。新增跨家庭真实管理员会话 API
  检查四种出版端点均 404；来源删改/权限收紧后旧产物拒绝读取。
- 实际 32 块虚构图文内容生成 **34 页 PDF / 751322 bytes**，中文提取、全部页面 Poppler
  渲染、文字边界及联系表视觉检查通过；EPUB **473199 bytes**，EPUBCheck 无错误/警告。
  A4 长文自动分页、超 200 页失败、缺字失败、真正子进程取消/重试均有执行断言。
- Mobile **16 files / 68 tests**，typecheck/lint 通过；Doctor **21/21**，Android/iOS Expo export
  成功，根与 mobile npm audit 均 **0 vulnerabilities**。无真实设备验收结论。
- 独立 Docker 卷 `ftc-m5-publication-smoke`：Alpine 镜像 app health/login/匿名鉴权与 worker
  smoke 通过；实际队列生成 3 页中文 PDF（75780 bytes）及 EPUB（2949 bytes），宿主再次
  提取中文、渲染并 EPUBCheck 通过。镜像本地 ID `sha256:c6a1e841fee591dd7f9a41cae0f437770fd9d731772e2f1bf83368692c13d1a6`。
  这不是旧卷升级或最终发布镜像验收；M8 仍需完整升级/回滚与恢复矩阵。
- 真实流式原件/转换/排版性能见 PERFORMANCE，Node、渲染子进程、Poppler 分开记录。
  发现并修复 PDF 页脚导致物理页数翻倍、bundle 默认 Helvetica 动态加载以及 CI 缺少 ops
  构建等确定性问题；没有放宽断言来通过。

本切片 push 对应 SHA/CI 将在下一里程碑记录。M6 回顾作品、M7 离线、M8 完整发布门禁
未完成，尚未创建 `v1.2.0-alpha.1`，不宣称 stable 或旧包无损升级已验收。

出版提交 `22250cc968960accfff5c16182ebb7092714181f` 已 push；CI `33943168055` 的 web-quality
通过，mobile-quality 发现新增测试的 `findAll` 谓词返回 `number | false`，不能满足严格 boolean。
此前本地异步 typecheck 的失败未及时核对，因此上节 Mobile typecheck“通过”应以本修复后结果
为准。已显式比较 `length > 0`，本地 Mobile typecheck、2 项出版交互、lint 再次全部通过；
未改断言内容。修复提交后核对新的完整 CI，不把旧 run 记为全绿。

## 回顾作品切片（本地门禁通过，尚非发布）

- 出版类型修复 `12351c42331d26fe6e02818ec762b89cc0fcd513` 的
  [CI 33943415940](https://github.com/YePiXpert/family-time-capsule/actions/runs/33943415940) 三 job 全绿。
- Web `/books/review`、原生 BookReview：月/年/1–366 天自选日期，出生第一周、首月、前百天/
  出生百天；真实记忆、成长节点、家人讲述、已发布周记和故事选材，分页和人工精选。
- 复用 ReviewPeriod/ReviewPeriodEvent；相同范围/读者/模板恢复同一未完成 BookProject。
  年度预建 12 个月章节，无记忆的月份不编故事。可显式追加素材、复制新册、标记完成/重开；
  并发冲突保留输入，不重写旧稿。相册草稿仅建立现有确认记忆的关系。
- 首页只有本月回顾和最多三份实际正在制作的作品。新记忆按发生日期提示可加入，
  私密/父母/延后可见讲述与未到期胶囊仍按目标读者过滤。每次批量选材原子校验。
- 修复讲述日期语义：记忆发生日期与 `authoredAt` 分开，署名可显示“讲述于”；
  月份归组按来源记忆发生时间或故事范围，避免最近写下的旧事被归到上传/讲述月份。
  模板版本更新到 `1.2-layout-2`，旧产物下载会重新验证版本与来源。
- 根 lint/typecheck/test/build/build:ops 全部通过：**85 files / 580 tests**。
  Production **46 passed**，disaster roundtrip **6 passed**；Mobile **17 files / 70 tests**，
  typecheck/lint 通过，Doctor **21/21**，Android/iOS Expo export 均成功（约 3.6 MB Hermes）。
- 新增 6 项真实回顾集成，包含 31 条同刻事件的稳定 cursor、封存/软删除计数排除、跨家庭 API
  拒绝、私密来信原子拒绝、五记忆相册排序重开、日期变化、复制/完成与独立恢复。
  恢复后 draftKey、人工精选、编辑图保持一致，重复建立仍返回原有未完成作品。
- 新增 2 项原生组件交互；production 出生第一周 → 精选 → 草稿编辑 → 恢复同稿 → 明确复制
  → 改日期 → 回顾/日历同步，通过键盘触发并检查 375/768/1440px 虚构家庭截图。
  真机触控、安全区和系统行为仍未验收。

本里程碑尚未包含主动离线收藏、精选 ZIP 阅读包或最终旧卷升级/回滚与发布；不创建提前发布 tag。

## 离线收藏切片（非最终发布）

- 回顾提交 `f549d414164137d5ced9277fa88fcd0076f68ac4` 的
  [CI 33944333371](https://github.com/YePiXpert/family-time-capsule/actions/runs/33944333371) 三 job 全绿。
- M7 原生详情主动下载、容量确认、独立缓存 SQLite/目录、当前连接 512 MiB/全机 1 GiB
  配额、暂停/继续/重试/清理、章节/播放进度；“更多”进入离线收藏，仍为五个一级标签。
- 读者清单/文件 digest 与实时 FamilyContext 校验；新版本、删除、失权撤下旧缓存和当前
  阅读页。401/403/404/409 与断网/503 分别处理，离线无法立即获知远程撤权。
- reading_zip 真实 worker，原件流式随册媒体、自包含转义 HTML/CSS/来源，file:// 不依赖
  网络、fetch 或登录。仍是精选阅读包，接收者可保存/转发，不可远程收回，不是完整备份。
- 素材来源的发生时间改为事件时间，单独保留 capturedAt；声音署名保留 authoredAt。
  出版模板 `1.2-layout-3`，幂等摘要包含随册媒体和声音权限变化。
- 根 lint/typecheck/test/build/build:ops 通过：**86 files / 584 tests**；其中新增 4 项
  实际 ZIP、文件 Range/读者隔离/跨家庭/失权 API、离线 Chromium 图文/CSS/脚本转义。
- Mobile lint/typecheck/test 通过：**19 files / 77 tests**，Doctor **21/21**；
  Android/iOS Expo export 成功，各约 **3.8 MB** Hermes。依赖审计根/mobile **0 漏洞**。
- 原生新增 3 项真实流式文件与 SQLite 场景、3 项组件交互、1 项本地声音定位；
  64 KiB 增量校验、暂停后跳过已完成文件、独立 SQLite 重开恢复进度、清缓存原件 SHA
  和 outbox 不变、账号/家庭/服务器隔离、配额、损坏重试和下载并发互斥均通过。
  Expo/React Native host 使用测试适配器，不能冒充真机吞吐或系统级验收。
- disaster roundtrip **6 passed**。第一次本地 production 全量 **45 passed / 1 failed**：
  在 Next build 前构建的 ops 被 build 清除；已将 pretest:e2e 固定为 build 后 build:ops。
  补建后针对出版重跑又发现 ZIP 按钮文字选择器多一个空格，已修正为实际可访问名称，
  未跳过测试或降低断言。最终重验结果随后补记。

M8 完整独立旧卷/恢复、最终云原生构建与 prerelease 尚未完成；不提前打 tag。

修复构建顺序和 ZIP 按钮选择器后，production book-projects **3/3 passed**，包含真实
worker PDF/EPUB/ZIP 下载及 ZIP 解压后 offline browser 阅读。其余全量场景 **43/43**
在首次运行通过（全量 45/46 中另有两个 book-projects 场景）；最终 M8 再执行完整门禁。

## M8 独立升级、恢复与 Docker 证据

- 离线提交 `6211993440381a31c7048b3dd9dd64d714b7cc20` 的
  [CI 33946382625](https://github.com/YePiXpert/family-time-capsule/actions/runs/33946382625) 三 job 全绿。
- 独立 `git archive` 使用已发布 1.1 source
  `c885217e23c1fa1f26364a0b1e9dfd88d5e1c415`，执行其旧 schema/导出代码生成五张虚构图片
  和五条记忆；没有重新构建旧 App 来替代新开发。1.1 卷 → 1.2 原地迁移、迁移前 WAL
  快照、注入失败迁移回滚、1.1 实际导出 → 空 1.2 恢复 → 二次导出全部通过。
  `/tmp/ftc-m8-upgrade-report.json` 记录独立目录和五份原件 SHA；CI 增加该复现脚本。
- disaster roundtrip 扩为 **7 tests**：销毁源目录，完整恢复并真实 production 登录、读取
  相册顺序与人工说明、32 页手写块/焦点/来源/版本；九个新增元数据模块二次导出逐项一致。
  私密讲述不进入恢复后的家庭阅读清单，设备 token/任务/阅读缓存不恢复。
- Docker image `sha256:4aa7c205b6734fdcd57e4b5f09e61c0c0db585794de597dfc478471dfc56db67`
  （`ftc-12-final:local`）构建通过。独立 `ftc-12-upgrade-smoke` 承接旧卷后 app/worker
  smoke 通过，健康返回 `1.2.0-alpha.1`；字体、ffmpeg/ffprobe 和匿名媒体 401 检查通过。
- Docker 实际排版 **64 blocks / PDF 66 pages / 200767 bytes**，中文可提取，66 页均经
  Poppler 渲染并查看 contact sheet；EPUB **13861 bytes**，EPUBCheck **0 errors/warnings**；
  精选 ZIP **11831 bytes**。EPUB/ZIP job 的 pages 表示内容文档/章节数，不等于纸张页数。
- 独立 `ftc-12-restore-smoke` 先拒绝缺 book-chapters.json 的备份，family 表仍为空；随后
  完整恢复、成员绑定、API 读取及二次导出九模块逐项相同，五份原件逐一下载 SHA 不变。
  预览衍生物恢复后可重建，不要求它们的临时 ID 与源卷相同。
- Docker 验证脚本调试期间修复了重启就绪等待、恢复成员选择器，以及 fixture 报告与旧卷
  必须同次生成的测试参数；没有将失败尝试记作通过，也没有放宽核心编辑/原件断言。
- 最终原生工作流继续检查 Android SEND/SEND_MULTIPLE/PDF Intent、APK 签名 v2/包名/
  versionCode，并补齐展示 versionName；iOS 主程序和 appex 的包名/buildNumber/展示版本、
  双 App Group 与 arm64。真实设备执行仍未验证，等 tag run 取得包级实际结果。

最终本地根 lint/typecheck/test/build/build:ops 再次全部通过（**86 files / 584 tests**）；
Mobile lint/typecheck/test（**19 files / 77 tests**）、Doctor **21/21**、双平台 Expo export
再次通过，双端 Hermes 约 **3.8 MB**。根/mobile npm audit 再次均 **0 漏洞**。
最终真实出版性能重复测量见 PERFORMANCE：PDF **2400 ms / renderer RSS 270397440 bytes**，
EPUB **2455 ms / 265490432 bytes**，Poppler **1379 ms / 21049344 bytes**；编排 Node
**114515968 bytes**。实际流式 SHA/转换/渲染，非 mock 吞吐；浏览器/ffmpeg 未在此基准测量。

最终 production **46/46 passed**，disaster roundtrip **7/7 passed**，无跳过/放宽断言。
根/mobile package 与 lock 均为 **1.2.0-alpha.1**，原生展示 **1.2.0**；iOS buildNumber
和 Android versionCode 均在原来的 **5** 上递增为 **6**。最终提交按要求使用
`chore(release): prepare 1.2.0-alpha.1`；待该 SHA 完整 main CI 通过后创建不可移动标签。
