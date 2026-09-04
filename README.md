# Family Time Capsule

**v1.1.0-alpha.1 — Capture Anywhere & Family Rhythm**

A private, self-hosted family memory archive.

随处记录，统一归档。

照片可以来自系统相机，声音可以来自语音备忘录，
视频可以几个月后再补录，文字可以从聊天里复制。

本项目不要求你在「正确的 App」里记录人生。
它只负责把散落在不同地方的真实素材，
整理成一条可以保存几十年的家庭成长时间线。

AI helps organize memories.
Family members tell the story.
Original sources always come first.

> AI 默认关闭、始终可选；没有 API Key、Provider 或 worker 时，核心档案仍完整可用。
> 当前是 1.1 alpha：自动化、Docker 与原生包级门禁通过后发布 prerelease；系统分享、
> Files/iCloud/DocumentsProvider、通知和真实设备媒体行为仍必须按
> [真实设备验收](docs/REAL_DEVICE_TEST.md) 留档，不能由编译结果代替。

---

## 功能一览（v1.0）

- **私人认证**：无公开注册；首次部署凭 `INITIAL_SETUP_TOKEN` 初始化管理员。
- **家庭与人物**：Person ≠ User——女儿、外公、外婆没有账号也完整存在于记忆里。
- **每日首页**：使用真实家庭、孩子年龄、待整理素材、最近记忆、故事、胶囊与口述问题；空家庭直接引导留下第一条记忆。
- **原件档案**：照片/音频/视频/文字事后上传；SHA-256 去重；**原件永不覆盖**；EXIF 保留真实拍摄时间（`capturedAt` 与 `importedAt` 永不混淆）。
- **记录与收件箱**：文字、多文件照片/音频/视频可先收进来或直接整理；收件箱支持草稿字段、多选合并和确认入档。
- **时间轴与回顾**：按真实发生时间排序，显示孩子当时年龄；可按年月、人物、媒体与标签筛选，并重新遇见同日、月前、百天前和一年前的片段。
- **成长节点与人物主页**：节点仍是 `MemoryEvent`，可选类型和置顶；家人主页汇集共同记忆、亲口讲述与口述史问题。
- **多人视角**：同一件事，爸爸、妈妈、外婆各自独立讲述，互不覆盖。
- **时间胶囊**：按日期或孩子年龄封存开启；封存是仪式不是加密——导出永远完整。
- **完整导出**：ZIP 内含全部原件（哈希校验）+ JSON + 可读 Markdown，离开本系统一切仍可打开。

### 1.1 alpha：随处收集与家庭节奏

- **顺序式断点续传**：Web 与原生端按服务器 offset 续传，临时文件和 SHA-256 全程流式；
  持久 ImportSession 支持三并发、暂停、刷新恢复、失败重试与已完成项去重。
- **安全文档原件**：PDF/TXT/Markdown/RTF/DOCX 作为 document Asset 保存、下载、导出和恢复；
  只预览受限纯文本/PDF，不执行 HTML、SVG、宏或任意二进制。
- **系统分享与 Files**：Android SEND/SEND_MULTIPLE、iOS Share Extension + App Group、
  Files/iCloud/DocumentsProvider 都先复制到私有存储；无服务器或离线时也不丢唯一原件。
- **家庭投递箱**：亲友无需账号即可用可过期、可撤销、有限额的链接提交多文件、录音和文字；
  token 只存 hash，所有内容始终先进入 Inbox。
- **原生日常能力**：People、Stories、Capsules、Requests、Contribution Portals、Import Sessions
  与 Weekly Review 使用原生页面和独立离线缓存，高频路径不再以浏览器为主入口。
- **每周回顾**：按家庭时区完成整理、重点、家人声音和来源周记四步；无 AI 完整可用，
  AI 只在明确同意后优化未编辑草稿。本地提醒可关闭且锁屏不显示私人正文。
- **portable archive**：Import/Portal/Review 关系及 document 原件进入完整导出恢复；访客 token
  与本地账号不导出，恢复后的投递入口默认关闭，旧 v1/rc.4 归档使用安全默认值。


### v1 新增（AI 整理 / 搜索 / 故事 / 口述史 / 书籍 / 备份）

- **AI 整理员（provider 中立）**：转录（人工修订保护）、图片/视频理解
  （抽帧 + 优雅降级）、标题/地点/人物/标签/时间建议（带精度）、本地分簇
  建议（绝不自动合并）；AI 永远不能确认事实或伪造引文。
- **精确事实溯源**：每条事实的来源带逐字引文与转录时间段；AI 只见临时别名。
- **全文搜索**：本地 FTS5（中文 bigram），家庭隔离 + 可见性过滤 + 人物/标签/
  媒介/日期筛选；`npm run search:rebuild` 可随时重建。
- **故事**：周记/月章/年章，段落级来源链接、引文锁、再生保护；离线组装不需 AI。
- **口述史**：匿名讲述链接（hash token、可过期可撤销、限流），提交进收件箱审核。
- **胶囊对话**：封存前留下未来问题，开启后家人用文字/媒体回答。
- **书籍**：已发布故事与年度事件导出 PDF/EPUB（媒体内嵌、无内部 URL）。
- **远程备份**：WebDAV verified upload + 原子改名（凭据仅存环境变量）。
- **系统分享**：PWA Share Target 直达收件箱。
- **Web 与原生产品壳**：首页、时间轴、记录、收件箱、更多五个一级入口；桌面侧栏与移动底栏均可达，搜索是全局动作。
- **原生客户端**：React Native iOS/Android（无 WebView）；本机可闭环完成记录、修改、合并、确认、详情与时间轴。支持直接录音、拍照/视频、相册多选和离线 outbox；家庭服务器同步完全可选，断开或失败都不删除本地记录和原件。
- **回收站**：事件/讲述/故事软删除、恢复、确认式清除；素材引用守卫。

## 技术栈

服务端：Next.js 16（App Router）+ TypeScript strict + Tailwind CSS v4 + SQLite
（better-sqlite3 + Drizzle ORM）+ better-auth + Docker。原生端：Expo SDK 57 +
React Native + 原生 SQLite/SecureStore/FileSystem；不是 PWA/WebView 套壳。

## 本地开发

```bash
npm install
cp .env.example .env   # 按需调整 DATA_DIR / AUTH_SECRET / INITIAL_SETUP_TOKEN
npm run dev            # http://localhost:3000
```

### 首次初始化（私有注册策略）

本项目**没有公开注册**。首次部署后：

1. 在 `.env` 中设置 `INITIAL_SETUP_TOKEN`（一次性令牌）与 `AUTH_SECRET`；
2. 访问 `/setup`，凭令牌创建第一个管理员账号；
3. 初始化完成后 `/setup` 永久失效（即使令牌仍在），之后用 `/login` 登录；
4. 首次登录进入 `/onboarding`：创建家庭、孩子档案，并绑定自己。

详见 [docs/SECURITY.md](docs/SECURITY.md)。

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run lint` / `npm run typecheck` | 静态检查 |
| `npm test` | Vitest 单元 + 集成测试（539 个） |
| `npm run test:e2e` | 39 个 Playwright 场景 + 6 个生产灾难恢复 roundtrip（会先 build） |
| `npm run verify:export <zip>` | 校验导出 ZIP 的 manifest 与全部原件 SHA-256 |

原生客户端开发、设备数据边界和 GitHub 云构建 IPA/APK：
[docs/MOBILE.md](docs/MOBILE.md)。

## 备份与迁移

> **`/data` 是不可替代的持久数据。** 其中两样缺一不可：
> `db/capsule.sqlite`（家庭、人物、事件、讲述的全部结构化数据）与
> `originals/`（**全部照片/录音/视频原始字节**）。只复制 sqlite 会丢掉所有媒体；
> 只复制媒体会丢掉标题、真实时间与讲述。**二者必须一起备份。**

- 应用内导出：设置页「导出完整备份（ZIP）」或 `GET /api/export`；
  导出前服务端重验每个原件哈希，ZIP 可直接阅读/播放、可跨实例恢复；
- 独立校验：`npm run verify:export <zip>`；
- 灾难恢复：新实例 `/setup` 创建管理员后，本地用 `DATA_DIR=/data npm run restore -- backup.zip`；
  Compose 生产容器用 `docker compose exec app node /app/ops/restore.mjs /path/to/backup.zip`，
  再到 `/onboarding` 选择「你是谁」完成绑定（认证凭据永不来自备份）；
- 基础 3-2-1 与「停容器 → tar volume」等经过验证的备份命令：
  见 [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) §6；
- 导出格式与兼容承诺：[docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md)；
  恢复设计与安全校验：[docs/RESTORE.md](docs/RESTORE.md)。

## Docker 部署

```bash
AUTH_SECRET=$(openssl rand -base64 32) \
BETTER_AUTH_URL=http://localhost:3000 \
INITIAL_SETUP_TOKEN=<一次性令牌> \
docker compose up -d --build --wait
```

所有原件、衍生物、导出与数据库都保存在 Compose 逻辑卷 `capsule-data`（挂载为容器内 `/data`；实际卷名通常为 `<项目名>_capsule-data`），重建容器数据不丢失。备份命令必须从正在运行的 `app` 容器解析实际 `/data` 卷名，详见部署清单 §6。`AUTH_SECRET` 未设置时 compose 拒绝启动。
`BETTER_AUTH_URL` 也必须设置为浏览器实际访问的唯一 origin（反代时填最终 HTTPS
地址）；填错会安全拒绝登录。`app` 与 `worker` 都有各自适用的健康检查。

## 文档

- [docs/PRD.md](docs/PRD.md) — 产品计划书（唯一需求来源）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术架构与存储约定
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — 核心数据模型
- [docs/SECURITY.md](docs/SECURITY.md) — 安全基线与威胁模型（含 #017 / RH-010 审计结论）
- [docs/ISSUES.md](docs/ISSUES.md) — 开发路线、垂直切片与 Issue 清单
- [docs/DECISIONS.md](docs/DECISIONS.md) — 关键决策记录（ADR）
- [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) — 部署、冒烟、持久性验证与备份/灾难恢复手册
- [docs/REAL_DEVICE_TEST.md](docs/REAL_DEVICE_TEST.md) — 真实设备手工验收清单（正式录入前执行）
- [docs/MOBILE.md](docs/MOBILE.md) — 原生客户端、本地数据、同步协议与云构建
- [docs/RELEASE_1.0.md](docs/RELEASE_1.0.md) — 1.0 RC 自动化、Docker 与外部门禁报告
- [docs/RELEASE_1_1.md](docs/RELEASE_1_1.md) — 1.1 alpha 自动化、云包与未完成真机门禁
- [docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md) / [docs/RESTORE.md](docs/RESTORE.md) — 导出格式与恢复设计
- [CHANGELOG.md](CHANGELOG.md) — 版本记录
