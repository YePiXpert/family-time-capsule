# 1.2.0-alpha.1 家庭记忆馆与成长年册

状态：开发中。基线 `99ac692ec7bd5c91ca499d3c71cd6cedf4afcd10`；不替换已发布 1.1。

真实记忆 → Collection 整理 → 日历/年龄/媒体阅读 → BookProject 持续编辑 →
可搜索 PDF / EPUB / 精选离线阅读包 → portable archive 完整迁移。

## 实施边界

- 复用现有上传、同步、ImportSession、ReviewPeriod、Story 和授权服务；AI 默认关闭。
- Story 保存叙述；Collection 用 album/chapter 区分组织；BookProject 保存选材、版式和版本。
- CollectionSection 仅一层，CollectionItem 的事件来源使用外键；同册同来源唯一。
- BookChapter、BookBlock、BookSourceRef、BookRevision 是耐久编辑数据，核心来源关系使用外键。
- revision 乐观锁：冲突返回 409，客户端保留未保存输入；来源更新只提示，不覆盖编辑。
- 阅读、计数、封面及选材使用当前 FamilyContext。家庭阅读版只接受预定读者范围可见来源。
- 日/月/年使用家庭时区半开区间；月龄按日历周年锚点，月末向目标月份最后一天收敛。
- 渲染与媒体任务独立于 AI；后台有界处理，下载时重验来源与权限，旧产物失效。
- PDF 比较后选择 PDFKit + 独立 Node 进程，OFL Noto CJK 嵌字；正文不栅格化。
- 原生主动下载存独立 server/account/family 缓存；清理绝不触碰原件、intake 或 outbox。
- 精选阅读包无在线依赖，明确可保存转发且无法远程收回；它不是管理员完整备份。
- 新增耐久数据成组导出，声明存在却缺文件/关系时在写入前拒绝；旧档使用空模块默认值。

## 交付与证据

| 里程碑 | 状态 | 门禁 |
| --- | --- | --- |
| M1 章节/主题相册 | 核心实现及本地门禁通过 | 五事件双相册，排序/软删除/恢复，原件 SHA 不变 |
| M2 日历/年龄 | 核心实现及组合验收通过 | 跨午夜/跨年/DST/闰日/月末，Web/原生过滤与日期变更 |
| M3 媒体阅读 | 核心实现及本地门禁通过 | 按需播放器/衍生物、权限收紧、失败降级 |
| M4 编辑年册 | 核心实现及本地门禁通过 | 三模板、持久编辑/重开/冲突、来源漂移 |
| M5 出版 | 核心实现及本地门禁通过 | 34 页文本提取/逐页渲染、EPUBCheck、Docker 实际队列 |
| M6 回顾作品 | 核心实现及本地门禁通过 | 月/年/自选范围、草稿幂等、不改写人工编辑 |
| M7 离线收藏 | 已实现，自动化验证 | 主动下载/配额/清理、权限拒绝与断网区分 |
| M8 恢复/发布 | 待实现 | 独立目录/卷升级、旧档恢复、二次导出、失败回滚 |

五个主导航保持首页、时间轴、记录、收件箱、更多。相册和日历放时间轴内，书架为二级页面。
沿用暖纸张设计系统；375/768/1024/1440px、键盘与触控验证使用虚构家庭。

最终运行根 lint/typecheck/test/build、production E2E/disaster roundtrip、mobile
 test/typecheck/lint/doctor、Android/iOS export、出版/权限/离线专项、依赖审计、
Docker app/worker smoke、独立卷升级恢复。main 对应 SHA 完整 CI 全绿后才能创建不可移动
`v1.2.0-alpha.1`；最终 tag workflow 产出 APK、unsigned IPA、SHA256SUMS 和 prerelease。
真实设备项目保持未验证，包级检查不能代填。

### 已提交与当前验证

- 日历切片 `3c721e8`；CI 依赖修复 `32bcabf` 的 run `33933984509` 三 job 全绿。
- 当前相册切片新增 migration 0036、Web/原生持久整理和成组 portable archive。
  独立五原件/双相册往返与迁移成功/失败回滚共 3 项集成场景通过；生产相册交互 2 项通过，
  含分页、阅读、冲突保留输入和四种宽度。根 81 files / 557 tests，mobile 13 files / 61 tests。
  月份草稿复用后续回顾入口；M1/M2 组合验收和其余里程碑尚未全部完成，不提前打发布 tag。

- 媒体切片：Web/native 全屏阅读、主动播放器和人物声音来源；非 AI MediaJob、实时权限、
  流式衍生物存储、独立目录恢复后重建。根 82 files / 564 tests、native 14 files / 63 tests，
  production 43 tests + disaster 6 tests 通过；真实设备未验收。

- 年册切片：Web/原生书架、选材、持久编辑、三模板、源权限与历史版本、六文件完整恢复。
  根 83 files / 570 tests，Mobile 15 files / 66 tests，production 44 + disaster 6 通过。
  32 页虚构内容的 Web 保存/重开/预览已验收；真正 PDF/EPUB 分页与原生离线仍待后续。

- 出版切片：34 页真实中文 PDF / EPUBCheck、Web/原生出版任务与副本导出、Docker 队列
  字体验证。根 84 files / 574 tests，Mobile 16 files / 68 tests，production 45 + disaster 6。
  年册主干 `c6392504` 的 CI `33940479011` 全绿；M6–M8 与最终 tag 仍待完成。

- 回顾切片：Web `/books/review`、原生 BookReview；ReviewPeriod 精选复用、12 月章节、
  自选范围/出生第一周/第一个月/百天、月份相册草稿、显式复制与完成状态、已有作品新资料提示。
  根 85 files / 580 tests，Mobile 17 files / 70 tests，production 46 + disaster 6；独立目录
  恢复保持草稿幂等标识和人工精选，仍待 M7/M8 最终闭环。

- 离线切片：原生详情主动下载、容量确认、暂停/继续/重试/配额/清理、账号隔离、章节/声音进度；
  文件级实时 digest/读者校验、失权撤回；ZIP file:// 自包含阅读，脚本文字转义。
  设备系统操作仍待真机，M8 旧卷与最终发布待完成。
