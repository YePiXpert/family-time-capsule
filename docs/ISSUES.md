# 开发路线与 Issue 清单

> 来源：PRD §22（路线）、§23（垂直切片）、§24（Issues）、§27（P0 DoD）。每个 Issue 的执行方式见 PRD §25（固定前缀）与 §26（PR 自检）。

## 状态

| Issue | 标题 | 状态 |
| --- | --- | --- |
| #001 | Bootstrap Next.js + TypeScript + Docker + CI | ✅ 已完成（2026-08-29） |
| #002 | Authentication + private registration policy | ✅ 已完成（2026-08-29，better-auth + 首次 setup 令牌，见 docs/SECURITY.md） |
| #003 | Family / User / Person schema | ✅ 已完成（2026-08-29，family/person 表 + user 表业务 FK + /onboarding + /family 管理页） |
| #004 | AssetStorage abstraction + LocalFilesystemStorage | ✅ 已完成（2026-08-29，storage key 白名单 + 原件不可覆盖 + asset 表 + 去重索引） |
| #005 | Image upload + SHA-256 | ✅ 已完成（2026-08-29，MIME 白名单+魔数嗅探、50MB 限制、SHA-256 查重明确提示、/api/media 鉴权读取、恶意文件名测试） |
| #006 | EXIF capturedAt parser | ✅ 已完成（2026-08-29，exifr + DateTimeOriginal/OffsetTime + 家庭时区解释（D-009）+ user_confirmed 修正保留原 metadata） |
| #007 | Inbox workflow + UI | ✅ 已完成（2026-08-29，inbox_item + inbox_item_asset 关联表、缺时间自动 needs_review、收件箱 UI（预览/时间/来源/修改/废弃）） |
| #008 | Confirm InboxItem to MemoryEvent | ✅ 已完成（2026-08-29，memory_event + asset/participant 关联表、occurredAt 默认 capturedAt、ageDays 快照、事件详情页 /memories/[id]） |
| #009 | Timeline + child age calculation | ✅ 已完成（2026-08-29，按 occurredAt 倒序 + 家庭时区年月分组、年龄现算（出生前/当天/第N天/满月/百天/岁月）、关键 E2E「8/29 上传 8/10 照片出现在 8/10」） |
| #010 | Multi-select merge into one MemoryEvent | ✅ 已完成（2026-08-29，收件箱多选 + mergeInboxEntries：最早可信 capturedAt 为默认 occurredAt、条目全部 confirmed、Assets 只关联不复制；E2E 5 素材 → 1 事件） |
| #011 | Audio / video / text ingestion | ✅ 已完成（2026-08-29，audio/video MIME 白名单+魔数嗅探（200/500MB 限制）、ffprobe 增强（缺失时优雅降级）、/api/upload/media、媒体端点 HTTP Range、文字速记入箱、收件箱/事件页 audio/video 回放元素） |
| #012 | Contribution model + multi-view UI | ✅ 已完成（2026-08-29，contribution + fact 表、事件页按人分块独立编辑、作者可为无账号 Person、Fact 手工确认） |
| #013 | Capsule model + date/age unlock | ✅ 已完成（2026-08-29，capsule + asset/event/contribution 关联表、date/age 解锁（家庭时区/周岁）、seal 后 UI 隐藏但 includeLocked 供导出、到期开启） |
| #014 | Full export ZIP | ✅ 已完成（2026-08-29，archiver 流式打包；导出前重验全部原件 SHA-256，不符即失败（409）；manifest/7 个 JSON/timeline.md 相对路径引用；胶囊内容始终包含；/api/export 鉴权下载 + 设置页入口） |
| #015 | Backup/restore design document | ✅ 已完成（2026-08-29，docs/EXPORT_FORMAT.md + docs/RESTORE.md（哈希校验/重复合并/family ID 映射/User 关系/迁移策略）+ `npm run verify:export` CLI（实测通过/篡改双路径）） |
| #016 | PWA polish | ✅ 已完成（2026-08-29，manifest + 生成式图标（暖纸/皮革色）、standalone 可安装、viewport-fit + safe-area、极简离线壳（SW 只缓存离线提示页，/api/** 永不缓存）） |
| #017 | Security audit | ✅ 已完成（2026-08-29，双家庭全资源隔离专项测试（Asset/Inbox/Event/Contribution/Fact/Capsule/Export）；**发现并修复 High 级 IDOR 写入**（contribution/fact 先写后校验 → 先校验后写）；导出 Markdown 转义加固；docs/SECURITY.md 全面重写含审计结论） |
| #018 | Playwright critical regression suite | ✅ 已完成（2026-08-29，8 条关键路径全覆盖：setup→家庭、旧照片时间链路、5 合 1、音视频文字回放、多视角、胶囊锁/开、导出哈希验证、登出不可访问 + 冷启动回顾 + 伪装文件拒绝；全套 lint/typecheck/126 单测/build/19 e2e 全绿） |

## v0.1.1 Real-world Hardening（2026-08-30 完成）

| Issue | 标题 | 状态 |
| --- | --- | --- |
| RH-001 | 真实媒体格式兼容 | ✅（HEIC/HEIF/MOV/M4A 等支持矩阵 + fallback UI + 真实容器 fixtures） |
| RH-002 | Live Photo 安全摄取基础 | ✅（HEIC+MOV 独立保存/合并，D-013） |
| RH-003 | MemoryEvent 编辑 | ✅（lastEditedByUserId + IDOR 校验 + E2E 8/10→8/11） |
| RH-004 | 真正的 Restore | ✅（CLI + 绑定流 + 集成测试，D-014） |
| RH-005 | 灾难恢复 roundtrip | ✅（真实服务器 boot + HTTP 全链路验证） |
| RH-006 | E2E 独立性 | ✅（每 spec 独立 project/DATA_DIR，可单独执行） |
| RH-007 | 部署冒烟 | ✅（smoke 脚本 + /api/health + DEPLOYMENT_CHECKLIST.md） |
| RH-008 | 真实设备验收清单 | ✅（REAL_DEVICE_TEST.md） |
| RH-009 | 备份安全说明 | ✅（README + 清单；VACUUM INTO 实测） |
| RH-010 | 安全回归 | ✅（**修复 High 级公开注册漏洞**；restore 加固；IDOR 回归） |

## P0 完成顺序（PRD §22）

```text
Auth → Family/Person → Asset Upload → metadata/hash → Inbox
→ MemoryEvent → Contribution → Timeline → Capsule → Export → Docker
```

发布条件：手机/电脑产生的照片、系统录音、视频和文字都能事后导入，保持真实时间，并能合并成完整记忆事件。

## 垂直切片（PRD §23）

1. **Slice 1**：一张旧照片跑通全链路（登录 → Family/Child → 上传 → SHA-256 → EXIF capturedAt → InboxItem → 确认 → MemoryEvent → Timeline），整条路径写 Playwright。
2. **Slice 2**：上传 5 张照片 → 勾选 → 合并为一个 MemoryEvent（验收：5 Asset，1 Event）。
3. **Slice 3**：音频/视频/文字；FFmpeg 不可用时原件上传仍可工作；文字也先进 Inbox。
4. **Slice 4**：爸爸、妈妈两份 Contribution 独立保存，不能覆盖。
5. **Slice 5**：胶囊创建 → 加内容 → 设日期 → Seal → 到期 Open。
6. **Slice 6**：完整导出，manifest 校验全部 SHA-256，Markdown 相对路径引用媒体。

## P0 Definition of Done（PRD §27）— 2026-08-29 达成（v0.1.0）

```text
[x] 手机/电脑可创建私人家庭空间
[x] 可创建女儿与家庭成员
[x] 可后补上传旧照片
[x] 可上传音频和视频
[x] 可写文字
[x] capturedAt / importedAt 分离
[x] 相同原件可识别重复
[x] 多素材可合为一个 MemoryEvent
[x] 多家人可写独立 Contribution
[x] 时间轴按真实发生时间展示
[x] 显示事件发生时女儿年龄
[x] 可创建并封存日期/年龄胶囊
[x] 可完整 ZIP 导出
[x] 原件 SHA-256 可验证
[x] Docker 部署可持续保存数据（静态检查；本机无 Docker，见 CHANGELOG/报告）
[x] 无 AI key 也完整可用（P0 无任何 AI 代码路径）
[x] 关键 E2E 全绿（19 个）
[x] docs 与代码一致
```
